use std::path::PathBuf;

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::ipc::SessionSnapshot;
use crate::paths::{self, PathError};
use crate::settings::NexttorrentSettings;
use crate::state::AppState;

fn path_buf_to_string(path: PathBuf) -> Result<String, PathError> {
    path.into_os_string()
        .into_string()
        .map_err(|_| PathError::NonUtf8)
}

pub fn build_session_snapshot<R: tauri::Runtime>(
    app: &AppHandle<R>,
    settings: &NexttorrentSettings,
) -> Result<SessionSnapshot, PathError> {
    let paths = paths::app_paths(app)?;
    let effective = settings.resolved_download_dir(&paths);
    let log_filter = std::env::var("RUST_LOG")
        .unwrap_or_else(|_| "info,librqbit=warn,librqbit_core=warn".to_string());

    Ok(SessionSnapshot {
        download_dir: path_buf_to_string(paths.download_dir.clone())?,
        effective_download_dir: effective.to_string_lossy().into_owned(),
        config_dir: path_buf_to_string(paths.config_dir.clone())?,
        cache_dir: path_buf_to_string(paths.cache_dir.clone())?,
        log_filter,
        rqbit_version: librqbit::version().to_string(),
    })
}

#[tauri::command]
pub fn get_session_snapshot(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SessionSnapshot, String> {
    let settings = state.settings.read().clone();
    build_session_snapshot(&app, &settings).map_err(|err| err.to_string())
}

/// Clean shutdown via Tauri (preferred over `WebviewWindow.destroy` — avoids capability gaps).
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn get_activity_log(
    app: AppHandle,
    max_lines: Option<usize>,
) -> Result<crate::diag_log::ActivityLogSnapshot, String> {
    let paths = paths::app_paths(&app).map_err(|e| e.to_string())?;
    let n = max_lines.unwrap_or(200).clamp(10, 500);
    Ok(crate::diag_log::activity_log_snapshot(&paths.config_dir, n))
}

/// Open the app config directory (where `nexttorrent.log` / `nexttorrent-diag.log` live).
#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn open_logs_folder(app: AppHandle) -> Result<String, String> {
    let paths = paths::app_paths(&app).map_err(|e| e.to_string())?;
    let dir = paths.config_dir;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path_str = dir.to_string_lossy().into_owned();
    app.opener()
        .open_path(&path_str, None::<&str>)
        .map_err(|e| e.to_string())?;
    tracing::info!(path = %path_str, "opened logs folder");
    Ok(path_str)
}

#[tauri::command]
pub fn resolve_download_path(
    state: State<'_, AppState>,
    relative_path: String,
) -> Result<String, String> {
    let root = state.live_download_root();
    let resolved = paths::safe_join_under(&root, &relative_path).map_err(|err| err.to_string())?;
    Ok(resolved.to_string_lossy().into_owned())
}
