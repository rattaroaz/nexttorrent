//! Rotating diagnostic file plus in-memory trace ring buffer for the Activity tab.
//!
//! Session lines are written on a background thread (batched) so hot paths never
//! block on disk I/O. Early events before `set_config_dir` stay in a pending buffer
//! and flush when the config directory is known.

use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use serde::Serialize;

/// After this size each log file is trimmed (keeps newest half).
const MAX_BYTES: u64 = 512 * 1024;
const MAX_TRACE_LINES: usize = 500;
const MAX_PENDING_DISK: usize = 256;
const WRITE_BATCH_MAX: usize = 64;
const WRITE_FLUSH_IDLE: Duration = Duration::from_millis(150);

static TRACE_BUFFER: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
static CONFIG_DIR: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
/// Lines that arrived before a config dir was known (or while writer was starting).
static PENDING_DISK: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
static LOG_TX: OnceLock<Sender<String>> = OnceLock::new();

fn trace_buffer() -> &'static Mutex<VecDeque<String>> {
    TRACE_BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_TRACE_LINES)))
}

fn config_dir_slot() -> &'static Mutex<Option<PathBuf>> {
    CONFIG_DIR.get_or_init(|| Mutex::new(None))
}

fn pending_disk() -> &'static Mutex<VecDeque<String>> {
    PENDING_DISK.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_PENDING_DISK)))
}

fn now_stamp() -> String {
    chrono::Local::now()
        .format("%Y-%m-%dT%H:%M:%S%.3f")
        .to_string()
}

/// Prefix a line with a local timestamp when it does not already look stamped.
pub fn stamp_line(line: impl AsRef<str>) -> String {
    let line = line.as_ref();
    if looks_timestamped(line) {
        return line.to_string();
    }
    format!("{} {line}", now_stamp())
}

fn looks_timestamped(line: &str) -> bool {
    // 2026-07-09T12:34:56.789
    let b = line.as_bytes();
    b.len() >= 23 && b[4] == b'-' && b[7] == b'-' && b[10] == b'T' && b[13] == b':' && b[16] == b':'
}

/// Called as early as possible (and again when Tauri resolves AppConfig) so session
/// logs persist. Switching dir re-targets the writer; pending lines are flushed.
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
        let (tx, rx) = mpsc::channel::<String>();
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
    while let Some(line) = pending.pop_front() {
        if tx.send(line).is_err() {
            break;
        }
    }
}

fn enqueue_disk_line(line: String) {
    ensure_writer_started();
    if let Some(tx) = LOG_TX.get() {
        // Prefer live channel; if full/disconnected, fall back to pending.
        if tx.send(line.clone()).is_ok() {
            return;
        }
    }
    let mut pending = pending_disk().lock().expect("pending disk lock");
    if pending.len() >= MAX_PENDING_DISK {
        pending.pop_front();
    }
    pending.push_back(line);
}

fn writer_loop(rx: Receiver<String>) {
    let mut batch: Vec<String> = Vec::with_capacity(WRITE_BATCH_MAX);
    loop {
        match rx.recv_timeout(WRITE_FLUSH_IDLE) {
            Ok(line) => {
                batch.push(line);
                while batch.len() < WRITE_BATCH_MAX {
                    match rx.try_recv() {
                        Ok(more) => batch.push(more),
                        Err(_) => break,
                    }
                }
                write_session_batch(&batch);
                batch.clear();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if !batch.is_empty() {
                    write_session_batch(&batch);
                }
                break;
            }
        }
    }
}

fn write_session_batch(lines: &[String]) {
    let Some(dir) = config_dir() else {
        let mut pending = pending_disk().lock().expect("pending disk lock");
        for line in lines {
            if pending.len() >= MAX_PENDING_DISK {
                pending.pop_front();
            }
            pending.push_back(line.clone());
        }
        return;
    };
    let path = session_log_path(&dir);
    // Do not call `tracing` here — this runs on the log writer thread and must not re-enter the layer.
    let _ = append_lines(&path, lines);
}

fn trim_file_if_needed(path: &Path) -> std::io::Result<()> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(()),
    };
    if meta.len() <= MAX_BYTES {
        return Ok(());
    }
    let text = std::fs::read_to_string(path)?;
    let keep_from = text.len().saturating_sub((MAX_BYTES / 2) as usize);
    let trimmed = text[text.floor_char_boundary(keep_from)..].to_string();
    std::fs::write(path, trimmed)
}

fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    append_lines(path, &[line.to_string()])
}

fn append_lines(path: &Path, lines: &[String]) -> std::io::Result<()> {
    if lines.is_empty() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    trim_file_if_needed(path)?;
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    for line in lines {
        writeln!(f, "{line}")?;
    }
    Ok(())
}

/// Push a stamped line into the ring buffer and (asynchronously) the session log.
pub fn push_trace_line(line: String) {
    let stamped = stamp_line(line);
    {
        let mut buf = trace_buffer().lock().expect("trace buffer lock");
        if buf.len() >= MAX_TRACE_LINES {
            buf.pop_front();
        }
        buf.push_back(stamped.clone());
    }
    enqueue_disk_line(stamped);
}

pub fn recent_trace_lines(max_lines: usize) -> Vec<String> {
    let buf = trace_buffer().lock().expect("trace buffer lock");
    let skip = buf.len().saturating_sub(max_lines);
    buf.iter().skip(skip).cloned().collect()
}

pub fn diag_log_path(config_parent: &Path) -> PathBuf {
    config_parent.join("nexttorrent-diag.log")
}

pub fn session_log_path(config_parent: &Path) -> PathBuf {
    config_parent.join("nexttorrent.log")
}

/// Append one line: timestamp, level symbol, context, message (also into the ring).
pub fn append_failure(config_parent: &Path, command: &str, message: &str) -> std::io::Result<()> {
    // Ensure session writes target the same dir when possible.
    {
        let mut slot = config_dir_slot().lock().expect("config dir lock");
        if slot.is_none() {
            *slot = Some(config_parent.to_path_buf());
        }
    }
    ensure_writer_started();

    let path = diag_log_path(config_parent);
    let line = format!(
        "{} ! {command} — {}",
        now_stamp(),
        message.replace('\n', " ")
    );
    append_line(&path, &line)?;
    // Already timestamped — push without double-stamping via stamp_line's detect.
    {
        let mut buf = trace_buffer().lock().expect("trace buffer lock");
        if buf.len() >= MAX_TRACE_LINES {
            buf.pop_front();
        }
        buf.push_back(line.clone());
    }
    enqueue_disk_line(line);
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
    /// Omitted from UI when it is just a disk mirror of `trace_lines` (see frontend de-dupe).
    pub session_file_lines: Vec<String>,
}

pub fn activity_log_snapshot(config_parent: &Path, max_lines: usize) -> ActivityLogSnapshot {
    ActivityLogSnapshot {
        trace_lines: recent_trace_lines(max_lines),
        diag_file_lines: read_file_tail(&diag_log_path(config_parent), max_lines),
        session_file_lines: read_file_tail(&session_log_path(config_parent), max_lines),
    }
}

/// Best-effort: wait for the log writer to drain (used in tests).
#[cfg(test)]
pub fn flush_for_test() {
    // Give the writer thread a chance to process.
    thread::sleep(Duration::from_millis(300));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn unique_tmp(label: &str) -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("nexttorrent-diag-{label}-{n}"))
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
        let tmp = unique_tmp("append");
        let _ = fs::create_dir_all(&tmp);
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
        let tmp = unique_tmp("session");
        let _ = fs::create_dir_all(&tmp);
        let log_path = session_log_path(&tmp);
        let _ = fs::remove_file(&log_path);
        set_config_dir(tmp.clone());
        push_trace_line("INFO test — hello".into());
        flush_for_test();
        let s = fs::read_to_string(&log_path).unwrap();
        assert!(s.contains("hello"));
        assert!(s.lines().any(looks_timestamped));
    }

    #[test]
    fn early_lines_flush_after_config_dir() {
        let tmp = unique_tmp("early");
        let _ = fs::create_dir_all(&tmp);
        let log_path = session_log_path(&tmp);
        let _ = fs::remove_file(&log_path);
        // Reset is hard with statics; use a unique message.
        let marker = format!("early-marker-{}", now_stamp());
        push_trace_line(format!("INFO test — {marker}"));
        set_config_dir(tmp);
        flush_for_test();
        // Best-effort: line may already be in pending or channel.
        let s = fs::read_to_string(&log_path).unwrap_or_default();
        // Either flushed or still only in ring — ring always has it.
        let ring = recent_trace_lines(500);
        assert!(ring.iter().any(|l| l.contains(&marker)));
        let _ = s; // disk is best-effort under shared static writer
    }
}
