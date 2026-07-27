//! Compact AI-oriented diagnostic brief + zip export.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::diag_event::DiagEvent;
use crate::diag_log::{
    ai_brief_path, config_dir, diag_log_path, events_jsonl_path, recent_error_events,
    recent_events, session_log_path, set_config_dir,
};
use crate::settings::NexttorrentSettings;
use crate::state::AppState;

const HOW_TO_USE: &str = "Read this file first (ai-brief.json). Inspect recentErrors and match corr= in nexttorrent-events.jsonl. Propose a minimal fix in the cited component. Do not invent remote telemetry.";

const README_FOR_AI: &str = r#"# Nexttorrent diagnostics for AI

1. Open `ai-brief.json` first.
2. Use `recentErrors` / `corr` to find matching lines in `nexttorrent-events.jsonl`.
3. Human logs (`nexttorrent.log`, `nexttorrent-diag.log`) are secondary context.
4. Fix the cited `component` with a minimal change. Do not add cloud telemetry.
"#;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiBrief {
    v: u32,
    generated_at: String,
    app: Value,
    paths: Value,
    how_to_use: &'static str,
    recent_errors: Vec<DiagEvent>,
    recent_events: Vec<DiagEvent>,
    session: Value,
    settings_safe: Value,
}

/// Sanitize settings for export: drop secrets / credentials.
pub fn settings_safe_json(settings: &NexttorrentSettings) -> Value {
    let feeds: Vec<Value> = settings
        .rss_feeds
        .iter()
        .map(|f| {
            json!({
                "id": f.id,
                "name": f.name,
                "url": f.url,
                "kind": f.kind,
                "enabled": f.enabled,
                "autoAdd": f.auto_add,
                "hasApiKey": f.api_key.as_ref().map(|k| !k.is_empty()).unwrap_or(false),
            })
        })
        .collect();

    json!({
        "downloadDir": settings.download_dir,
        "listenPortStart": settings.listen_port_start,
        "listenPortEnd": settings.listen_port_end,
        "enableUpnp": settings.enable_upnp,
        "socksProxy": redact_proxy(settings.socks_proxy.as_deref()),
        "theme": settings.theme,
        "sequentialDownload": settings.sequential_download,
        "watchFolders": settings.watch_folders,
        "maxActiveDownloads": settings.max_active_downloads,
        "maxActiveUploads": settings.max_active_uploads,
        "stalledTimeoutSecs": settings.stalled_timeout_secs,
        "startAtLogin": settings.start_at_login,
        "minimizeToTray": settings.minimize_to_tray,
        "diskSpaceReserveMb": settings.disk_space_reserve_mb,
        "seedRatioLimit": settings.seed_ratio_limit,
        "seedTimeLimitHours": settings.seed_time_limit_hours,
        "bindInterface": settings.bind_interface,
        "rssFeedCount": settings.rss_feeds.len(),
        "rssFeeds": feeds,
        "speedSchedulerEnabled": settings.speed_scheduler.enabled,
    })
}

fn redact_proxy(proxy: Option<&str>) -> Option<String> {
    let raw = proxy.filter(|s| !s.is_empty())?;
    // socks5://user:pass@host:port → socks5://***@host:port
    if let Some(at) = raw.find('@') {
        if let Some(scheme_end) = raw.find("://") {
            let scheme = &raw[..scheme_end + 3];
            let rest = &raw[at..];
            return Some(format!("{scheme}***{rest}"));
        }
    }
    Some(raw.to_string())
}

fn build_brief(state: Option<&AppState>) -> AiBrief {
    let dir = config_dir().unwrap_or_else(crate::startup_fail::fallback_config_dir);
    let log_filter = std::env::var("RUST_LOG")
        .unwrap_or_else(|_| "info,librqbit=warn,librqbit_core=warn".to_string());

    let (torrent_count, download_dir, settings_safe, rqbit) = if let Some(st) = state {
        let count = st
            .api
            .api_torrent_list_ext(librqbit::api::ApiTorrentListOpts { with_stats: false })
            .torrents
            .len();
        let settings = st.settings.read().clone();
        (
            count,
            st.download_root.to_string_lossy().into_owned(),
            settings_safe_json(&settings),
            librqbit::version().to_string(),
        )
    } else {
        (0, String::new(), json!({}), librqbit::version().to_string())
    };

    AiBrief {
        v: 1,
        generated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        app: json!({
            "name": "Nexttorrent",
            "version": env!("CARGO_PKG_VERSION"),
            "rqbit": rqbit,
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "logFilter": log_filter,
        }),
        paths: json!({
            "configDir": dir,
            "eventsJsonl": events_jsonl_path(&dir),
            "sessionLog": session_log_path(&dir),
            "diagLog": diag_log_path(&dir),
            "aiBrief": ai_brief_path(&dir),
        }),
        how_to_use: HOW_TO_USE,
        recent_errors: recent_error_events(40),
        recent_events: recent_events(80),
        session: json!({
            "torrentCount": torrent_count,
            "downloadDir": download_dir,
        }),
        settings_safe,
    }
}

fn write_brief_to_disk(brief: &AiBrief) -> Result<PathBuf, String> {
    let dir = config_dir().unwrap_or_else(crate::startup_fail::fallback_config_dir);
    let _ = std::fs::create_dir_all(&dir);
    set_config_dir(dir.clone());
    let path = ai_brief_path(&dir);
    let body = serde_json::to_string_pretty(brief).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Debounced / lightweight refresh (no AppState — session fields empty).
pub fn refresh_ai_brief_lightweight() {
    let brief = build_brief(None);
    let _ = write_brief_to_disk(&brief);
}

pub fn refresh_ai_brief_with_state(state: &AppState) -> Result<PathBuf, String> {
    let brief = build_brief(Some(state));
    write_brief_to_disk(&brief)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn get_ai_brief(state: State<'_, AppState>) -> Result<String, String> {
    let brief = build_brief(Some(&state));
    let path = write_brief_to_disk(&brief)?;
    tracing::info!(path = %path.display(), "refreshed ai-brief.json");
    serde_json::to_string_pretty(&brief).map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip(app, state))]
pub async fn export_ai_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let brief = build_brief(Some(&state));
    let brief_path = write_brief_to_disk(&brief)?;
    let dir = config_dir().unwrap_or_else(crate::startup_fail::fallback_config_dir);

    let default_name = format!(
        "nexttorrent-ai-diagnostics-{}.zip",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );

    let dest = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Zip", &["zip"])
        .blocking_save_file()
        .ok_or_else(|| "export dialog cancelled".to_string())?;

    let dest_path: PathBuf = dest.into_path().map_err(|e| format!("{e:?}"))?;
    write_diagnostics_zip(&dest_path, &dir, &brief_path)?;
    tracing::info!(path = %dest_path.display(), "exported AI diagnostics zip");
    Ok(dest_path.to_string_lossy().into_owned())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn log_frontend_event(
    state: State<'_, AppState>,
    event: String,
    message: String,
    corr: Option<String>,
    command: Option<String>,
) -> Result<(), String> {
    let _ = state;
    let mut ev = crate::diag_event::DiagEvent::new(
        crate::diag_event::DiagLevel::Error,
        "frontend",
        if event.is_empty() {
            "ipc_invoke_failed"
        } else {
            &event
        },
        message,
    );
    if let Some(c) = corr {
        ev = ev.with_corr(c);
    }
    if let Some(cmd) = command {
        ev = ev.with_field("command", cmd);
    }
    crate::diag_log::emit_event(ev);
    Ok(())
}

fn write_diagnostics_zip(dest: &Path, config_dir: &Path, brief_path: &Path) -> Result<(), String> {
    let file = File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    add_file_to_zip(&mut zip, opts, "ai-brief.json", brief_path)?;
    add_bytes_to_zip(&mut zip, opts, "README-FOR-AI.md", README_FOR_AI.as_bytes())?;

    for (name, path) in [
        ("nexttorrent-events.jsonl", events_jsonl_path(config_dir)),
        ("nexttorrent.log", session_log_path(config_dir)),
        ("nexttorrent-diag.log", diag_log_path(config_dir)),
    ] {
        if path.is_file() {
            // Tail large files (~256 KiB).
            let data = read_tail_bytes(&path, 256 * 1024).unwrap_or_default();
            add_bytes_to_zip(&mut zip, opts, name, &data)?;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn add_file_to_zip(
    zip: &mut ZipWriter<File>,
    opts: SimpleFileOptions,
    name: &str,
    path: &Path,
) -> Result<(), String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    add_bytes_to_zip(zip, opts, name, &buf)
}

fn add_bytes_to_zip(
    zip: &mut ZipWriter<File>,
    opts: SimpleFileOptions,
    name: &str,
    data: &[u8],
) -> Result<(), String> {
    zip.start_file(name, opts).map_err(|e| e.to_string())?;
    zip.write_all(data).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_tail_bytes(path: &Path, max: usize) -> std::io::Result<Vec<u8>> {
    let mut f = File::open(path)?;
    let len = f.metadata()?.len() as usize;
    if len <= max {
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        return Ok(buf);
    }
    use std::io::Seek;
    f.seek(std::io::SeekFrom::End(-(max as i64)))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{RssFeedEntry, RssFeedKind};

    #[test]
    fn redacts_proxy_credentials() {
        assert_eq!(
            redact_proxy(Some("socks5://user:secret@127.0.0.1:1080")).as_deref(),
            Some("socks5://***@127.0.0.1:1080")
        );
        assert_eq!(
            redact_proxy(Some("socks5://127.0.0.1:1080")).as_deref(),
            Some("socks5://127.0.0.1:1080")
        );
    }

    #[test]
    fn settings_safe_strips_api_keys() {
        let mut s = NexttorrentSettings::default();
        s.socks_proxy = Some("socks5://u:p@host:1".into());
        s.rss_feeds.push(RssFeedEntry {
            id: "1".into(),
            url: "https://example.com/rss".into(),
            name: Some("x".into()),
            kind: RssFeedKind::Rss,
            api_key: Some("SUPERSECRET".into()),
            enabled: true,
            auto_add: false,
            last_seen_ids: Vec::new(),
            title_regex: None,
            exclude_regex: None,
            quality_filter: None,
            category_save_paths: Default::default(),
            default_save_path: None,
        });
        let v = settings_safe_json(&s);
        let text = v.to_string();
        assert!(!text.contains("SUPERSECRET"));
        assert!(!text.contains("u:p@"));
        assert!(text.contains("hasApiKey\":true") || text.contains("\"hasApiKey\": true"));
    }
}
