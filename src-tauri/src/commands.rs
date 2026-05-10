use std::path::PathBuf;

use tauri::AppHandle;

use crate::ipc::SessionSnapshot;
use crate::paths::{self, PathError};
use crate::settings::NexttorrentSettings;

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
    let log_filter = std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());

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
pub fn get_session_snapshot(app: AppHandle) -> Result<SessionSnapshot, String> {
    let settings_path = paths::app_paths(&app)
        .map_err(|err| err.to_string())?
        .config_dir
        .join("settings.json");
    let settings = crate::settings::load_settings(&settings_path)
        .unwrap_or_else(|_| NexttorrentSettings::default());
    build_session_snapshot(&app, &settings).map_err(|err| err.to_string())
}

/// Clean shutdown via Tauri (preferred over `WebviewWindow.destroy` — avoids capability gaps).
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn resolve_download_path(app: AppHandle, relative_path: String) -> Result<String, String> {
    let paths = paths::app_paths(&app).map_err(|err| err.to_string())?;
    let resolved = paths::safe_join_under(&paths.download_dir, &relative_path)
        .map_err(|err| err.to_string())?;
    Ok(resolved.to_string_lossy().into_owned())
}
