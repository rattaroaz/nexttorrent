//! Rotating diagnostic files plus in-memory rings for Activity UI and AI briefs.
//!
//! Human session lines → `nexttorrent.log`
//! Structured JSONL → `nexttorrent-events.jsonl`
//! Failures also → `nexttorrent-diag.log`
//!
//! Writes run on a background thread (batched). Early events before `set_config_dir`
//! stay in a pending buffer and flush when the config directory is known.

use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use serde::Serialize;

use crate::diag_event::{new_corr, DiagEvent, DiagLevel};

/// After this size each human log file is trimmed (keeps newest half).
const MAX_BYTES: u64 = 512 * 1024;
/// JSONL can grow a bit larger for AI tails.
const MAX_EVENTS_BYTES: u64 = 1024 * 1024;
const MAX_TRACE_LINES: usize = 500;
const MAX_EVENTS: usize = 400;
const MAX_PENDING_DISK: usize = 256;
const WRITE_BATCH_MAX: usize = 64;
const WRITE_FLUSH_IDLE: Duration = Duration::from_millis(150);
const BRIEF_DEBOUNCE: Duration = Duration::from_secs(1);

#[derive(Clone)]
enum DiskWrite {
    Session(String),
    EventJson(String),
}

static TRACE_BUFFER: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
static EVENT_BUFFER: OnceLock<Mutex<VecDeque<DiagEvent>>> = OnceLock::new();
static CONFIG_DIR: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
static PENDING_DISK: OnceLock<Mutex<VecDeque<DiskWrite>>> = OnceLock::new();
static LOG_TX: OnceLock<Sender<DiskWrite>> = OnceLock::new();
static BRIEF_DIRTY: AtomicBool = AtomicBool::new(false);
static LAST_BRIEF_MS: AtomicU64 = AtomicU64::new(0);

fn trace_buffer() -> &'static Mutex<VecDeque<String>> {
    TRACE_BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_TRACE_LINES)))
}

fn event_buffer() -> &'static Mutex<VecDeque<DiagEvent>> {
    EVENT_BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_EVENTS)))
}

fn config_dir_slot() -> &'static Mutex<Option<PathBuf>> {
    CONFIG_DIR.get_or_init(|| Mutex::new(None))
}

fn pending_disk() -> &'static Mutex<VecDeque<DiskWrite>> {
    PENDING_DISK.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_PENDING_DISK)))
}

fn now_stamp() -> String {
    chrono::Local::now()
        .format("%Y-%m-%dT%H:%M:%S%.3f")
        .to_string()
}

/// Prefix a line with a local timestamp when it does not already look stamped.
#[cfg(test)]
pub fn stamp_line(line: impl AsRef<str>) -> String {
    let line = line.as_ref();
    if looks_timestamped(line) {
        return line.to_string();
    }
    format!("{} {line}", now_stamp())
}

#[cfg(test)]
fn looks_timestamped(line: &str) -> bool {
    let b = line.as_bytes();
    b.len() >= 23 && b[4] == b'-' && b[7] == b'-' && b[10] == b'T' && b[13] == b':' && b[16] == b':'
}

pub fn set_config_dir(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    {
        let mut slot = config_dir_slot().lock().expect("config dir lock");
        *slot = Some(dir);
    }
    ensure_writer_started();
    flush_pending_to_writer();
}

pub fn config_dir() -> Option<PathBuf> {
    config_dir_slot().lock().expect("config dir lock").clone()
}

fn ensure_writer_started() {
    LOG_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<DiskWrite>();
        let _ = thread::Builder::new()
            .name("nexttorrent-log".into())
            .spawn(move || writer_loop(rx));
        tx
    });
}

fn flush_pending_to_writer() {
    let Some(tx) = LOG_TX.get() else {
        return;
    };
    let mut pending = pending_disk().lock().expect("pending disk lock");
    while let Some(item) = pending.pop_front() {
        if tx.send(item).is_err() {
            break;
        }
    }
}

fn enqueue_disk(item: DiskWrite) {
    ensure_writer_started();
    if let Some(tx) = LOG_TX.get() {
        if tx.send(item.clone()).is_ok() {
            return;
        }
    }
    let mut pending = pending_disk().lock().expect("pending disk lock");
    if pending.len() >= MAX_PENDING_DISK {
        pending.pop_front();
    }
    pending.push_back(item);
}

fn writer_loop(rx: Receiver<DiskWrite>) {
    let mut session_batch: Vec<String> = Vec::with_capacity(WRITE_BATCH_MAX);
    let mut event_batch: Vec<String> = Vec::with_capacity(WRITE_BATCH_MAX);
    loop {
        match rx.recv_timeout(WRITE_FLUSH_IDLE) {
            Ok(item) => {
                push_write(&mut session_batch, &mut event_batch, item);
                while session_batch.len() + event_batch.len() < WRITE_BATCH_MAX {
                    match rx.try_recv() {
                        Ok(more) => push_write(&mut session_batch, &mut event_batch, more),
                        Err(_) => break,
                    }
                }
                flush_batches(&mut session_batch, &mut event_batch);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                flush_batches(&mut session_batch, &mut event_batch);
                break;
            }
        }
    }
}

fn push_write(session: &mut Vec<String>, events: &mut Vec<String>, item: DiskWrite) {
    match item {
        DiskWrite::Session(line) => session.push(line),
        DiskWrite::EventJson(line) => events.push(line),
    }
}

fn flush_batches(session: &mut Vec<String>, events: &mut Vec<String>) {
    if !session.is_empty() {
        write_named_batch("session", session);
        session.clear();
    }
    if !events.is_empty() {
        write_named_batch("events", events);
        events.clear();
    }
}

fn write_named_batch(kind: &str, lines: &[String]) {
    let Some(dir) = config_dir() else {
        let mut pending = pending_disk().lock().expect("pending disk lock");
        for line in lines {
            if pending.len() >= MAX_PENDING_DISK {
                pending.pop_front();
            }
            let item = if kind == "events" {
                DiskWrite::EventJson(line.clone())
            } else {
                DiskWrite::Session(line.clone())
            };
            pending.push_back(item);
        }
        return;
    };
    let (path, max) = if kind == "events" {
        (events_jsonl_path(&dir), MAX_EVENTS_BYTES)
    } else {
        (session_log_path(&dir), MAX_BYTES)
    };
    let _ = append_lines_with_max(&path, lines, max);
}

fn trim_file_if_needed(path: &Path, max_bytes: u64) -> std::io::Result<()> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(()),
    };
    if meta.len() <= max_bytes {
        return Ok(());
    }
    let text = std::fs::read_to_string(path)?;
    let keep_from = text.len().saturating_sub((max_bytes / 2) as usize);
    let trimmed = text[text.floor_char_boundary(keep_from)..].to_string();
    std::fs::write(path, trimmed)
}

fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    append_lines_with_max(path, &[line.to_string()], MAX_BYTES)
}

fn append_lines_with_max(path: &Path, lines: &[String], max_bytes: u64) -> std::io::Result<()> {
    if lines.is_empty() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    trim_file_if_needed(path, max_bytes)?;
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    for line in lines {
        writeln!(f, "{line}")?;
    }
    Ok(())
}

/// Push a stamped human line into the ring buffer and session log.
#[cfg(test)]
pub fn push_trace_line(line: String) {
    let stamped = stamp_line(line);
    {
        let mut buf = trace_buffer().lock().expect("trace buffer lock");
        if buf.len() >= MAX_TRACE_LINES {
            buf.pop_front();
        }
        buf.push_back(stamped.clone());
    }
    enqueue_disk(DiskWrite::Session(stamped));
}

pub fn recent_trace_lines(max_lines: usize) -> Vec<String> {
    let buf = trace_buffer().lock().expect("trace buffer lock");
    let skip = buf.len().saturating_sub(max_lines);
    buf.iter().skip(skip).cloned().collect()
}

pub fn recent_events(max: usize) -> Vec<DiagEvent> {
    let buf = event_buffer().lock().expect("event buffer lock");
    let skip = buf.len().saturating_sub(max);
    buf.iter().skip(skip).cloned().collect()
}

pub fn recent_error_events(max: usize) -> Vec<DiagEvent> {
    let buf = event_buffer().lock().expect("event buffer lock");
    buf.iter()
        .rev()
        .filter(|e| {
            matches!(
                e.level,
                DiagLevel::Warn | DiagLevel::Error | DiagLevel::Fatal
            )
        })
        .take(max)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

pub fn diag_log_path(config_parent: &Path) -> PathBuf {
    config_parent.join("nexttorrent-diag.log")
}

pub fn session_log_path(config_parent: &Path) -> PathBuf {
    config_parent.join("nexttorrent.log")
}

pub fn events_jsonl_path(config_parent: &Path) -> PathBuf {
    config_parent.join("nexttorrent-events.jsonl")
}

pub fn ai_brief_path(config_parent: &Path) -> PathBuf {
    config_parent.join("ai-brief.json")
}

/// Emit a structured event (JSONL + human session line + ring). Debounces AI brief on errors.
pub fn emit_event(event: DiagEvent) {
    let human = event.to_human_line();
    {
        let mut buf = event_buffer().lock().expect("event buffer lock");
        if buf.len() >= MAX_EVENTS {
            buf.pop_front();
        }
        buf.push_back(event.clone());
    }
    {
        let mut buf = trace_buffer().lock().expect("trace buffer lock");
        if buf.len() >= MAX_TRACE_LINES {
            buf.pop_front();
        }
        buf.push_back(human.clone());
    }
    enqueue_disk(DiskWrite::Session(human));
    if let Ok(json) = event.to_json_line() {
        enqueue_disk(DiskWrite::EventJson(json));
    }
    if event.level.is_error_like() || matches!(event.level, DiagLevel::Warn) {
        schedule_brief_refresh();
    }
}

/// Convenience: failure event with new corr; also writes human diag file line.
pub fn emit_failure(
    component: &str,
    event_code: &str,
    message: &str,
    fields: impl IntoIterator<Item = (String, String)>,
) -> String {
    let corr = new_corr();
    let mut ev = DiagEvent::new(DiagLevel::Error, component, event_code, message).with_corr(&corr);
    for (k, v) in fields {
        ev = ev.with_field(k, v);
    }
    if let Some(dir) = config_dir() {
        let path = diag_log_path(&dir);
        let line = format!(
            "{} ! {component} — {} corr={corr}",
            now_stamp(),
            message.replace('\n', " ")
        );
        let _ = append_line(&path, &line);
    }
    emit_event(ev);
    corr
}

/// Append one human failure line to nexttorrent-diag.log and emit a structured event.
#[cfg(test)]
pub fn append_failure(config_parent: &Path, command: &str, message: &str) -> std::io::Result<()> {
    {
        let mut slot = config_dir_slot().lock().expect("config dir lock");
        if slot.is_none() {
            *slot = Some(config_parent.to_path_buf());
        }
    }
    ensure_writer_started();
    let corr = new_corr();
    let path = diag_log_path(config_parent);
    let line = format!(
        "{} ! {command} — {} corr={corr}",
        now_stamp(),
        message.replace('\n', " ")
    );
    append_line(&path, &line)?;
    emit_event(
        DiagEvent::new(DiagLevel::Error, "ipc", "ipc_command_failed", message)
            .with_corr(corr)
            .with_field("command", command),
    );
    Ok(())
}

pub fn read_file_tail(path: &Path, max_lines: usize) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    let skip = lines.len().saturating_sub(max_lines);
    lines.iter().skip(skip).map(|s| (*s).to_string()).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogSnapshot {
    pub trace_lines: Vec<String>,
    pub diag_file_lines: Vec<String>,
    pub session_file_lines: Vec<String>,
}

pub fn activity_log_snapshot(config_parent: &Path, max_lines: usize) -> ActivityLogSnapshot {
    ActivityLogSnapshot {
        trace_lines: recent_trace_lines(max_lines),
        diag_file_lines: read_file_tail(&diag_log_path(config_parent), max_lines),
        session_file_lines: read_file_tail(&session_log_path(config_parent), max_lines),
    }
}

fn schedule_brief_refresh() {
    BRIEF_DIRTY.store(true, Ordering::SeqCst);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let last = LAST_BRIEF_MS.load(Ordering::SeqCst);
    if now_ms.saturating_sub(last) < BRIEF_DEBOUNCE.as_millis() as u64 {
        return;
    }
    LAST_BRIEF_MS.store(now_ms, Ordering::SeqCst);
    let _ = thread::Builder::new()
        .name("nexttorrent-ai-brief".into())
        .spawn(|| {
            thread::sleep(BRIEF_DEBOUNCE);
            if BRIEF_DIRTY.swap(false, Ordering::SeqCst) {
                crate::ai_diagnostics::refresh_ai_brief_lightweight();
            }
        });
}

#[cfg(test)]
pub fn flush_for_test() {
    thread::sleep(Duration::from_millis(400));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Instant;

    static DISK_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn unique_tmp(label: &str) -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "nexttorrent-diag-{label}-{}-{n}",
            std::process::id()
        ))
    }

    fn wait_for_file_contains(path: &Path, needle: &str, timeout: Duration) -> String {
        let start = Instant::now();
        loop {
            if let Ok(s) = fs::read_to_string(path) {
                if s.contains(needle) {
                    return s;
                }
            }
            if start.elapsed() > timeout {
                let current = fs::read_to_string(path).unwrap_or_default();
                panic!("timeout waiting for {needle:?} in {path:?}; file contents:\n{current}");
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn stamp_line_adds_timestamp() {
        let s = stamp_line("INFO foo — bar");
        assert!(looks_timestamped(&s));
        assert!(s.contains("INFO foo — bar"));
    }

    #[test]
    fn stamp_line_idempotent() {
        let s = stamp_line("2026-01-01T00:00:00.000 INFO x");
        assert_eq!(s, "2026-01-01T00:00:00.000 INFO x");
    }

    #[test]
    fn append_failure_writes_line() {
        let _guard = DISK_TEST_LOCK.lock().expect("disk test lock");
        let tmp = unique_tmp("append");
        let _ = fs::create_dir_all(&tmp);
        set_config_dir(tmp.clone());
        let path = diag_log_path(&tmp);
        let _ = fs::remove_file(&path);
        append_failure(&tmp, "unit_cmd", "bad thing").unwrap();
        let s = fs::read_to_string(&path).unwrap();
        assert!(s.contains("unit_cmd"));
        assert!(s.contains("bad thing"));
    }

    #[test]
    fn read_file_tail_returns_last_lines() {
        let tmp = unique_tmp("tail");
        let _ = fs::create_dir_all(&tmp);
        let path = diag_log_path(&tmp);
        fs::write(&path, "a\nb\nc\nd\n").unwrap();
        let tail = read_file_tail(&path, 2);
        assert_eq!(tail, vec!["c".to_string(), "d".to_string()]);
    }

    #[test]
    fn push_trace_line_persists_when_config_dir_set() {
        let _guard = DISK_TEST_LOCK.lock().expect("disk test lock");
        let tmp = unique_tmp("session");
        let _ = fs::create_dir_all(&tmp);
        let log_path = session_log_path(&tmp);
        let _ = fs::remove_file(&log_path);
        let marker = format!("hello-persist-{}", now_stamp());
        set_config_dir(tmp);
        push_trace_line(format!("INFO test — {marker}"));
        let s = wait_for_file_contains(&log_path, &marker, Duration::from_secs(3));
        assert!(s.lines().any(looks_timestamped));
    }

    #[test]
    fn early_lines_flush_after_config_dir() {
        let _guard = DISK_TEST_LOCK.lock().expect("disk test lock");
        let tmp = unique_tmp("early");
        let _ = fs::create_dir_all(&tmp);
        let log_path = session_log_path(&tmp);
        let _ = fs::remove_file(&log_path);
        let marker = format!("early-marker-{}", now_stamp());
        push_trace_line(format!("INFO test — {marker}"));
        set_config_dir(tmp);
        flush_for_test();
        let ring = recent_trace_lines(500);
        assert!(ring.iter().any(|l| l.contains(&marker)));
        let _ = log_path;
    }

    #[test]
    fn emit_event_writes_jsonl() {
        let _guard = DISK_TEST_LOCK.lock().expect("disk test lock");
        let tmp = unique_tmp("jsonl");
        let _ = fs::create_dir_all(&tmp);
        let path = events_jsonl_path(&tmp);
        let _ = fs::remove_file(&path);
        set_config_dir(tmp);
        let marker = format!("jsonl-marker-{}", now_stamp());
        emit_event(
            DiagEvent::new(DiagLevel::Error, "unit", "unit_failed", &marker)
                .with_corr("deadbeef")
                .with_field("k", "v"),
        );
        let s = wait_for_file_contains(&path, &marker, Duration::from_secs(3));
        assert!(s.contains("\"event\":\"unit_failed\""));
        assert!(s.contains("deadbeef"));
        let events = recent_events(10);
        assert!(events.iter().any(|e| e.msg.contains(&marker)));
    }
}
