mod commands;
mod diag_log;
mod disk;
mod engine;
mod ipc;
mod paths;
mod queue_control;
mod rss;
mod scheduler;
mod settings;
mod startup_fail;
mod state;
mod torrent_commands;
mod validation;
mod watch_folder;

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chrono::Local;
use parking_lot::RwLock;
use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

use crate::scheduler::effective_rate_limits;
use crate::state::AppState;

fn init_tracing() {
    let _ignored = tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .try_init();
}

fn load_watch_processed(path: &Path) -> HashSet<String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn spawn_stats_loop(handle: tauri::AppHandle, state: AppState) {
    let background = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(750));
        loop {
            interval.tick().await;
            let payload = crate::torrent_commands::build_update_payload(&background);
            if let Ok(value) = serde_json::to_value(payload) {
                let _ = handle.emit("torrents:update", value);
            }
        }
    });
}

fn spawn_scheduler_loop(state: AppState) {
    let bg = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            let settings = bg.settings.read().clone();
            let (d, u) = effective_rate_limits(&settings, Local::now());
            bg.session.ratelimits.set_download_bps(d);
            bg.session.ratelimits.set_upload_bps(u);
        }
    });
}

fn spawn_watch_folder_loop(state: AppState) {
    let bg = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(120));
        loop {
            interval.tick().await;
            if bg.settings.read().watch_folders.is_empty() {
                continue;
            }
            let _ = crate::torrent_commands::watch_poll_impl(&bg).await;
        }
    });
}

fn spawn_rss_loop(state: AppState) {
    let bg = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(900));
        loop {
            interval.tick().await;
            let auto = bg
                .settings
                .read()
                .rss_feeds
                .iter()
                .any(|f| f.enabled && f.auto_add);
            if !auto {
                continue;
            }
            let _ = crate::torrent_commands::rss_poll_feeds_impl(&bg).await;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(debug_assertions))]
    {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            default_hook(info);
            let payload = info
                .payload()
                .downcast_ref::<&str>()
                .copied()
                .map(String::from)
                .or_else(|| info.payload().downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic payload".into());
            let loc = info.location().map(|l| l.to_string()).unwrap_or_default();
            let msg = format!("panic: {payload}\n{loc}");
            crate::startup_fail::report_fatal_startup(&msg);
        }));
    }

    init_tracing();

    let ctx = tauri::generate_context!();

    let app_result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = crate::paths::app_paths(app.handle()).map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&paths.config_dir).map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&paths.cache_dir).map_err(|e| e.to_string())?;

            let settings_path = paths.config_dir.join("settings.json");
            let loaded = crate::settings::load_settings(&settings_path).unwrap_or_default();

            let effective_download = loaded.resolved_download_dir(&paths);
            std::fs::create_dir_all(&effective_download).map_err(|e| e.to_string())?;

            let rqbit_persistence_dir = paths.cache_dir.join("rqbit-session");
            std::fs::create_dir_all(&rqbit_persistence_dir).map_err(|e| e.to_string())?;

            let session = tauri::async_runtime::block_on(crate::engine::create_session(
                effective_download.clone(),
                rqbit_persistence_dir.clone(),
                &loaded,
            ))
            .map_err(|e| e.to_string())?;

            let api = Arc::new(librqbit::Api::new(session.clone(), None));
            let settings = Arc::new(RwLock::new(loaded.clone()));
            crate::settings::save_settings(&settings_path, &loaded).map_err(|e| e.to_string())?;

            let watch_processed_path = paths.config_dir.join("watch_processed.json");
            let watch_processed =
                Arc::new(RwLock::new(load_watch_processed(&watch_processed_path)));

            let http_client = reqwest::Client::builder()
                .use_rustls_tls()
                .build()
                .map_err(|e| e.to_string())?;

            let state = AppState {
                api,
                session,
                settings,
                settings_path,
                rqbit_persistence_dir,
                download_root: effective_download,
                http_client,
                watch_processed_path,
                watch_processed,
            };

            app.manage(state.clone());

            spawn_stats_loop(handle.clone(), state.clone());
            crate::queue_control::spawn_queue_loop(state.clone());
            spawn_scheduler_loop(state.clone());
            spawn_watch_folder_loop(state.clone());
            spawn_rss_loop(state.clone());

            let snapshot =
                crate::commands::build_session_snapshot(app.handle(), &state.settings.read())
                    .map_err(|e| e.to_string())?;
            handle.emit("session:ready", snapshot)?;
            tracing::info!("application ready");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::quit_app,
            commands::get_session_snapshot,
            commands::resolve_download_path,
            torrent_commands::torrent_list_full,
            torrent_commands::torrent_build_update_payload,
            torrent_commands::torrent_add_magnet,
            torrent_commands::torrent_add_file,
            torrent_commands::torrent_pause,
            torrent_commands::torrent_resume,
            torrent_commands::torrent_remove,
            torrent_commands::torrent_update_only_files,
            torrent_commands::torrent_force_recheck,
            torrent_commands::torrent_details,
            torrent_commands::torrent_peer_stats,
            torrent_commands::torrent_live_stats,
            torrent_commands::torrent_piece_bitmap_dump,
            torrent_commands::torrent_stats,
            torrent_commands::session_dht_stats,
            torrent_commands::get_nexttorrent_settings,
            torrent_commands::save_nexttorrent_settings,
            torrent_commands::set_torrent_label,
            torrent_commands::export_configuration_paths,
            torrent_commands::torrent_pause_all,
            torrent_commands::rss_poll_feeds,
            torrent_commands::disk_free_bytes,
            torrent_commands::watch_poll,
        ])
        .build(ctx);

    let app = match app_result {
        Ok(a) => a,
        Err(e) => {
            let msg = format!("{e}");
            tracing::error!("failed to build application: {msg}");
            crate::startup_fail::report_fatal_startup(&msg);
            return;
        }
    };

    app.run(move |app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                let session = state.session.clone();
                tauri::async_runtime::block_on(async move {
                    session.stop().await;
                });
            }
        }
    });
}
