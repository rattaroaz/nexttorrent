mod ai_diagnostics;
mod cli;
mod commands;
mod config_backup;
mod diag_event;
mod diag_log;
mod disk;
mod engine;
mod ipc;
mod magnet_handler;
mod network;
mod paths;
mod queue_control;
mod rss;
mod scheduler;
mod seeding_rules;
mod sequential;
mod settings;
mod startup_fail;
mod state;
mod torrent_commands;
mod trace_layer;
mod tray;
mod updater_http;
mod validation;
mod watch_folder;

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chrono::Local;
use parking_lot::RwLock;
use tauri::{Emitter, Manager};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

use crate::scheduler::effective_rate_limits;
use crate::state::AppState;
use crate::trace_layer::ActivityTraceLayer;

/// Default keeps app INFO visible while quieting chatty engine crates.
/// Override anytime with `RUST_LOG` (e.g. `RUST_LOG=librqbit=debug,nexttorrent=info`).
const DEFAULT_LOG_FILTER: &str = "info,librqbit=warn,librqbit_core=warn";

fn init_tracing() {
    // Persist session lines ASAP using the OS config fallback; setup() may refine the path.
    crate::diag_log::set_config_dir(crate::startup_fail::fallback_config_dir());

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER));
    let _ignored = tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .with(ActivityTraceLayer)
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
            if let Err(e) = crate::torrent_commands::watch_poll_impl(&bg).await {
                let corr = crate::diag_log::emit_failure(
                    "watch_folder",
                    "watch_loop_failed",
                    &e,
                    [("error".into(), e.clone())],
                );
                tracing::error!(ai_skip = true, error = %e, corr = %corr, "watch folder poll failed");
            }
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
            match crate::torrent_commands::rss_poll_feeds_impl(&bg, true).await {
                Ok(r) if r.magnets_added > 0 || !r.messages.is_empty() => {
                    tracing::info!(
                        magnets_added = r.magnets_added,
                        messages = r.messages.len(),
                        "rss auto-poll complete"
                    );
                    for msg in r.messages.iter().take(5) {
                        crate::diag_log::emit_event(
                            crate::diag_event::DiagEvent::new(
                                crate::diag_event::DiagLevel::Warn,
                                "rss",
                                "rss_feed_error",
                                msg,
                            )
                            .with_field("source", "auto_poll"),
                        );
                    }
                }
                Err(e) => {
                    let corr = crate::diag_log::emit_failure(
                        "rss",
                        "rss_loop_failed",
                        &e,
                        [("error".into(), e.clone())],
                    );
                    tracing::error!(ai_skip = true, error = %e, corr = %corr, "rss auto-poll failed");
                }
                _ => {}
            }
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
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let req = magnet_handler::parse_launch_add_request(&argv);
            magnet_handler::spawn_launch_add_request(app, req);
        }))
        .plugin(tauri_plugin_deep_link::init())
        // Keep the plugin registered for capabilities. Feed fetch/install uses
        // `updater_http` because the plugin HTTP client fails on some Windows hosts.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            crate::diag_log::set_config_dir(paths.config_dir.clone());
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

            if let Some(iface) = loaded
                .bind_interface
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                tracing::warn!(
                    interface = %iface,
                    "bind_interface is saved but librqbit 8 cannot bind sockets to a specific interface; use SOCKS5 through your VPN client or OS routing"
                );
            }

            let api = Arc::new(librqbit::Api::new(session.clone(), None));
            let settings = Arc::new(RwLock::new(loaded.clone()));
            crate::settings::save_settings(&settings_path, &loaded).map_err(|e| e.to_string())?;

            let watch_processed_path = paths.config_dir.join("watch_processed.json");
            let watch_processed =
                Arc::new(RwLock::new(load_watch_processed(&watch_processed_path)));

            let seeding_started_path = seeding_rules::seeding_started_path(&paths.config_dir);
            let seeding_started =
                Arc::new(RwLock::new(seeding_rules::load_seeding_started(
                    &seeding_started_path,
                )));

            let http_client = reqwest::Client::builder()
                .use_rustls_tls()
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(60))
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
                sequential_streams: Arc::new(sequential::SequentialStreams::new()),
                seeding_started_path,
                seeding_started,
            };

            app.manage(state.clone());

            tray::setup_tray(app.handle()).map_err(|e| e.to_string())?;

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(
                    target_os = "linux",
                    target_os = "windows",
                    all(debug_assertions, target_os = "macos")
                ))]
                {
                    app.deep_link().register_all().map_err(|e| e.to_string())?;
                }
                let deep_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                    let magnets: Vec<String> = urls
                        .into_iter()
                        .filter(|u| u.starts_with("magnet:"))
                        .collect();
                    magnet_handler::spawn_external_magnets(&deep_handle, magnets);
                });
            }

            let launch_req = magnet_handler::parse_launch_add_request(
                &std::env::args().collect::<Vec<_>>(),
            );
            magnet_handler::spawn_launch_add_request(&handle, launch_req);

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
            let _ = crate::ai_diagnostics::refresh_ai_brief_with_state(&state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::quit_app,
            commands::get_session_snapshot,
            commands::get_activity_log,
            commands::open_logs_folder,
            commands::resolve_download_path,
            updater_http::updater_check_feed,
            updater_http::updater_download_and_install,
            ai_diagnostics::get_ai_brief,
            ai_diagnostics::export_ai_diagnostics,
            ai_diagnostics::log_frontend_event,
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
            torrent_commands::torrent_trackers,
            torrent_commands::get_torrent_bandwidth_limits,
            torrent_commands::set_torrent_bandwidth_limits,
            torrent_commands::export_configuration_paths,
            torrent_commands::export_configuration_bundle,
            torrent_commands::import_configuration_bundle,
            torrent_commands::list_network_interfaces,
            torrent_commands::torrent_pause_all,
            torrent_commands::torrent_resume_all,
            torrent_commands::torrent_open_folder,
            torrent_commands::torrent_reveal_file,
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
