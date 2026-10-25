//! External magnet URIs and torrent files from OS handlers, CLI args, or deep links.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::cli::LaunchAddRequest;
use crate::state::AppState;
use crate::torrent_commands::{add_magnet_impl, add_torrent_file_impl};
use crate::validation::validate_magnet_uri;

enum PendingAdd {
    Magnet { magnet: String, paused: bool },
    TorrentFile { path: String, paused: bool },
}

static PENDING: Mutex<Vec<PendingAdd>> = Mutex::new(Vec::new());

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
        tracing::warn!("external magnet before app state ready; queued");
        enqueue(PendingAdd::Magnet {
            magnet: magnet.to_string(),
            paused,
        });
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
        tracing::warn!("external torrent file before app state ready; queued");
        enqueue(PendingAdd::TorrentFile {
            path: path.to_string(),
            paused,
        });
        return;
    };

    match add_torrent_file_impl(&state, path, None, None, paused).await {
        Ok(resp) => {
            show_main_window(app);
            let name = resp
                .details
                .name
                .unwrap_or_else(|| resp.details.info_hash.clone());
            tracing::info!(name = %name, path = %path, "added torrent from external file");
        }
        Err(e) => {
            tracing::warn!(error = %e, path = %path, "failed to add external torrent file");
            show_main_window(app);
            let _ = app.emit("magnet:rejected", e);
        }
    }
}

fn enqueue(item: PendingAdd) {
    match PENDING.lock() {
        Ok(mut q) => q.push(item),
        Err(poisoned) => poisoned.into_inner().push(item),
    }
}

fn take_pending() -> Vec<PendingAdd> {
    match PENDING.lock() {
        Ok(mut q) => std::mem::take(&mut *q),
        Err(poisoned) => std::mem::take(&mut *poisoned.into_inner()),
    }
}

fn spawn_magnet(app: &AppHandle, magnet: String, paused: bool) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        process_external_magnet(&handle, &magnet, paused).await;
    });
}

fn spawn_torrent_file(app: &AppHandle, path: String, paused: bool) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        process_external_torrent_file(&handle, &path, paused).await;
    });
}

/// Hold the add until `AppState` exists when a deep link arrives during startup.
/// The ready check and the queue push share one lock so a drain cannot miss the item.
fn submit(app: &AppHandle, item: PendingAdd) {
    let mut guard = match PENDING.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if app.try_state::<AppState>().is_none() {
        guard.push(item);
        return;
    }
    drop(guard);
    match item {
        PendingAdd::Magnet { magnet, paused } => spawn_magnet(app, magnet, paused),
        PendingAdd::TorrentFile { path, paused } => spawn_torrent_file(app, path, paused),
    }
}

/// Drain adds that arrived before the session was managed. Call after `app.manage`.
pub fn drain_pending(app: &AppHandle) {
    for item in take_pending() {
        submit(app, item);
    }
}

pub fn spawn_launch_add_request(app: &AppHandle, req: LaunchAddRequest) {
    for magnet in req.magnets {
        submit(
            app,
            PendingAdd::Magnet {
                magnet,
                paused: req.paused,
            },
        );
    }
    for path in req.torrent_files {
        submit(
            app,
            PendingAdd::TorrentFile {
                path,
                paused: req.paused,
            },
        );
    }
}

pub fn spawn_external_magnets(app: &AppHandle, magnets: Vec<String>) {
    for magnet in magnets {
        submit(
            app,
            PendingAdd::Magnet {
                magnet,
                paused: false,
            },
        );
    }
}
