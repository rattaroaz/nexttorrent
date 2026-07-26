//! External magnet URIs and torrent files from OS handlers, CLI args, or deep links.

use tauri::{AppHandle, Emitter, Manager};

use crate::cli::{parse_launch_args, LaunchAddRequest};
use crate::state::AppState;
use crate::torrent_commands::{add_magnet_impl, add_torrent_file_impl};
use crate::validation::validate_magnet_uri;

pub fn parse_launch_add_request(args: &[String]) -> LaunchAddRequest {
    parse_launch_args(args)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Validate, add to session, show window, and notify the UI.
pub async fn process_external_magnet(app: &AppHandle, magnet: &str, paused: bool) {
    let magnet = magnet.trim();
    if magnet.is_empty() {
        return;
    }
    if let Err(e) = validate_magnet_uri(magnet) {
        tracing::warn!(error = %e, "ignored invalid external magnet");
        let _ = app.emit("magnet:rejected", e);
        return;
    }

    let Some(state) = app.try_state::<AppState>() else {
        tracing::warn!("external magnet before app state ready");
        return;
    };

    match add_magnet_impl(&state, magnet, None, None, paused).await {
        Ok(resp) => {
            show_main_window(app);
            let _ = app.emit("magnet:added", magnet);
            let name = resp
                .details
                .name
                .unwrap_or_else(|| resp.details.info_hash.clone());
            tracing::info!(name = %name, "added torrent from external magnet");
        }
        Err(e) => {
            tracing::warn!(error = %e, "failed to add external magnet");
            show_main_window(app);
            let _ = app.emit("magnet:rejected", e);
        }
    }
}

pub async fn process_external_torrent_file(app: &AppHandle, path: &str, paused: bool) {
    let path = path.trim();
    if path.is_empty() {
        return;
    }

    let Some(state) = app.try_state::<AppState>() else {
        tracing::warn!("external torrent file before app state ready");
        return;
    };

    match add_torrent_file_impl(&state, path, None, None, paused).await {
        Ok(resp) => {
            show_main_window(app);
            let name = resp
                .details
                .name
                .unwrap_or_else(|| resp.details.info_hash.clone());
            let _ = app.emit("torrent:added", name.clone());
            tracing::info!(name = %name, path = %path, "added torrent from external file");
        }
        Err(e) => {
            tracing::warn!(error = %e, path = %path, "failed to add external torrent file");
            show_main_window(app);
            let _ = app.emit("magnet:rejected", e);
        }
    }
}

pub fn spawn_launch_add_request(app: &AppHandle, req: LaunchAddRequest) {
    for magnet in req.magnets {
        let handle = app.clone();
        let paused = req.paused;
        tauri::async_runtime::spawn(async move {
            process_external_magnet(&handle, &magnet, paused).await;
        });
    }
    for path in req.torrent_files {
        let handle = app.clone();
        let paused = req.paused;
        tauri::async_runtime::spawn(async move {
            process_external_torrent_file(&handle, &path, paused).await;
        });
    }
}

pub fn spawn_external_magnets(app: &AppHandle, magnets: Vec<String>) {
    for magnet in magnets {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            process_external_magnet(&handle, &magnet, false).await;
        });
    }
}
