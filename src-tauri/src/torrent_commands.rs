use std::collections::HashSet;
use std::path::{Path, PathBuf};

use bytes::Bytes;
use chrono::Local;
use librqbit::api::{
    ApiAddTorrentResponse, ApiTorrentListOpts, LiveStats, TorrentDetailsResponse, TorrentIdOrHash,
    TorrentListResponse,
};
use librqbit::dht::DhtStats;
use librqbit::session_stats::snapshot::SessionStatsSnapshot;
use librqbit::{AddTorrent, AddTorrentOptions};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::disk::available_bytes_for_path;
use crate::scheduler::effective_rate_limits;
use crate::state::AppState;
use crate::validation::{torrent_total_bytes, validate_magnet_uri, validate_torrent_bytes};

fn parse_torrent_ref(s: &str) -> Result<TorrentIdOrHash, String> {
    TorrentIdOrHash::parse(s).map_err(|err| err.to_string())
}

/// librqbit returns errors when pause/resume is a no-op; these are not user failures.
fn is_idempotent_torrent_action_err(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    m.contains("torrent is already paused")
        || m.contains("torrent is already live")
        || m.contains("pausing already paused torrent")
}

fn map_cmd_err(state: &AppState, command: &'static str, msg: String) -> String {
    if is_idempotent_torrent_action_err(&msg) {
        tracing::debug!(command = command, detail = %msg, "benign torrent state");
        return msg;
    }
    tracing::warn!(command = command, error = %msg, "tauri command failed");
    if let Some(dir) = state.settings_path.parent() {
        let _ = crate::diag_log::append_failure(dir, command, &msg);
    }
    msg
}

async fn pause_torrent_action(
    state: &AppState,
    command: &'static str,
    idx: TorrentIdOrHash,
) -> Result<(), String> {
    match state.api.api_torrent_action_pause(idx).await {
        Ok(_) => Ok(()),
        Err(err) => {
            let msg = err.to_string();
            if is_idempotent_torrent_action_err(&msg) {
                tracing::debug!(command = command, detail = %msg, "torrent already paused");
                Ok(())
            } else {
                Err(map_cmd_err(state, command, msg))
            }
        }
    }
}

async fn start_torrent_action(
    state: &AppState,
    command: &'static str,
    idx: TorrentIdOrHash,
) -> Result<(), String> {
    match state.api.api_torrent_action_start(idx).await {
        Ok(_) => Ok(()),
        Err(err) => {
            let msg = err.to_string();
            if is_idempotent_torrent_action_err(&msg) {
                tracing::debug!(command = command, detail = %msg, "torrent already active");
                Ok(())
            } else {
                Err(map_cmd_err(state, command, msg))
            }
        }
    }
}

fn parse_torrent_ref_cmd(
    state: &AppState,
    command: &'static str,
    s: &str,
) -> Result<TorrentIdOrHash, String> {
    parse_torrent_ref(s).map_err(|e| map_cmd_err(state, command, e))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentsUpdatePayload {
    pub torrents: Vec<TorrentRow>,
    pub session: SessionStatsSnapshot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentRow {
    #[serde(flatten)]
    pub details: TorrentDetailsResponse,
    pub label: Option<String>,
    pub label_color: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsSnapshot {
    pub settings_file: String,
    pub rqbit_persistence_dir: String,
    pub config_dir: String,
    pub cache_dir: String,
    pub watch_processed_file: String,
    pub seeding_started_file: String,
}

pub fn build_update_payload(state: &AppState) -> TorrentsUpdatePayload {
    let list = state
        .api
        .api_torrent_list_ext(ApiTorrentListOpts { with_stats: true });
    let (labels, colors) = {
        let s = state.settings.read();
        (s.labels_by_info_hash.clone(), s.label_colors.clone())
    };
    let torrents = list
        .torrents
        .into_iter()
        .map(|details| {
            let label = labels.get(&details.info_hash).cloned();
            let label_color = label.as_ref().and_then(|l| colors.get(l).cloned());
            TorrentRow {
                label,
                label_color,
                details,
            }
        })
        .collect();
    TorrentsUpdatePayload {
        torrents,
        session: state.api.api_session_stats(),
    }
}

#[tauri::command]
pub fn torrent_list_full(state: State<'_, AppState>) -> Result<TorrentListResponse, String> {
    Ok(state
        .api
        .api_torrent_list_ext(ApiTorrentListOpts { with_stats: true }))
}

#[tauri::command]
pub fn torrent_build_update_payload(
    state: State<'_, AppState>,
) -> Result<TorrentsUpdatePayload, String> {
    Ok(build_update_payload(&state))
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(paused, has_output = output_folder.is_some()))]
pub async fn torrent_add_magnet(
    state: State<'_, AppState>,
    magnet: String,
    output_folder: Option<String>,
    only_files: Option<Vec<usize>>,
    paused: bool,
) -> Result<ApiAddTorrentResponse, String> {
    add_magnet_impl(&state, &magnet, output_folder, only_files, paused).await
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(torrent_path = %torrent_path, paused))]
pub async fn torrent_add_file(
    state: State<'_, AppState>,
    torrent_path: String,
    output_folder: Option<String>,
    only_files: Option<Vec<usize>>,
    paused: bool,
) -> Result<ApiAddTorrentResponse, String> {
    add_torrent_file_impl(&state, &torrent_path, output_folder, only_files, paused).await
}

#[tracing::instrument(skip_all, fields(torrent_path = %torrent_path, paused))]
pub async fn add_torrent_file_impl(
    state: &AppState,
    torrent_path: &str,
    output_folder: Option<String>,
    only_files: Option<Vec<usize>>,
    paused: bool,
) -> Result<ApiAddTorrentResponse, String> {
    let path = Path::new(torrent_path);
    if !path.is_absolute() {
        return Err(map_cmd_err(
            state,
            "torrent_add_file",
            "torrent path must be absolute".into(),
        ));
    }
    let bytes = std::fs::read(path)
        .map_err(|err| map_cmd_err(state, "torrent_add_file", err.to_string()))?;
    validate_torrent_bytes(&bytes).map_err(|e| map_cmd_err(state, "torrent_add_file", e))?;
    let total =
        torrent_total_bytes(&bytes).map_err(|e| map_cmd_err(state, "torrent_add_file", e))?;
    let settings = state.settings.read().clone();
    let target_dir: PathBuf = output_folder
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| state.download_root.clone());
    let reserve = settings
        .disk_space_reserve_mb
        .unwrap_or(0)
        .saturating_mul(1024 * 1024);
    match available_bytes_for_path(&target_dir) {
        Ok(avail) => {
            if avail < total.saturating_add(reserve) {
                return Err(map_cmd_err(
                    state,
                    "torrent_add_file",
                    format!(
                        "insufficient disk space (need at least {} bytes including reserve; {} available)",
                        total.saturating_add(reserve),
                        avail
                    ),
                ));
            }
        }
        Err(e) => {
            tracing::warn!(
                path = %target_dir.display(),
                err = %e,
                "disk space check skipped; add still attempted"
            );
        }
    }
    let opts = AddTorrentOptions {
        paused,
        output_folder,
        only_files,
        overwrite: true,
        ratelimits: settings.limits_config_for_info_hash(
            &crate::validation::info_hash_hex_from_torrent_bytes(&bytes)
                .map_err(|e| map_cmd_err(state, "torrent_add_file", e))?,
        ),
        ..Default::default()
    };
    let resp = state
        .api
        .api_add_torrent(AddTorrent::TorrentFileBytes(Bytes::from(bytes)), Some(opts))
        .await
        .map_err(|err| map_cmd_err(state, "torrent_add_file", err.to_string()))?;
    attach_sequential_if_enabled(state, &torrent_ref_from_add_response(&resp));
    Ok(resp)
}

#[tauri::command]
#[tracing::instrument(skip(state), fields(torrent_ref = %torrent_ref))]
pub async fn torrent_pause(state: State<'_, AppState>, torrent_ref: String) -> Result<(), String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_pause", &torrent_ref)?;
    pause_torrent_action(&state, "torrent_pause", idx).await
}

#[tauri::command]
#[tracing::instrument(skip(state), fields(torrent_ref = %torrent_ref))]
pub async fn torrent_resume(state: State<'_, AppState>, torrent_ref: String) -> Result<(), String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_resume", &torrent_ref)?;
    start_torrent_action(&state, "torrent_resume", idx).await
}

#[tauri::command]
#[tracing::instrument(skip(state), fields(torrent_ref = %torrent_ref, delete_files))]
pub async fn torrent_remove(
    state: State<'_, AppState>,
    torrent_ref: String,
    delete_files: bool,
) -> Result<(), String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_remove", &torrent_ref)?;
    if delete_files {
        state
            .api
            .api_torrent_action_delete(idx)
            .await
            .map_err(|err| map_cmd_err(&state, "torrent_remove", err.to_string()))?;
    } else {
        state
            .api
            .api_torrent_action_forget(idx)
            .await
            .map_err(|err| map_cmd_err(&state, "torrent_remove", err.to_string()))?;
    }
    state.sequential_streams.remove(&torrent_ref);
    Ok(())
}

#[tauri::command]
pub async fn torrent_update_only_files(
    state: State<'_, AppState>,
    torrent_ref: String,
    file_indices: Vec<usize>,
) -> Result<(), String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_update_only_files", &torrent_ref)?;
    let set: HashSet<usize> = file_indices.into_iter().collect();
    state
        .api
        .api_torrent_action_update_only_files(idx, &set)
        .await
        .map_err(|err| map_cmd_err(&state, "torrent_update_only_files", err.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn torrent_force_recheck(
    state: State<'_, AppState>,
    torrent_ref: String,
) -> Result<(), String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_force_recheck", &torrent_ref)?;
    pause_torrent_action(&state, "torrent_force_recheck", idx).await?;
    start_torrent_action(&state, "torrent_force_recheck", idx).await
}

#[tauri::command]
pub fn torrent_details(
    state: State<'_, AppState>,
    torrent_ref: String,
) -> Result<TorrentDetailsResponse, String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_details", &torrent_ref)?;
    state
        .api
        .api_torrent_details(idx)
        .map_err(|err| map_cmd_err(&state, "torrent_details", err.to_string()))
}

#[tauri::command]
pub fn torrent_peer_stats(
    state: State<'_, AppState>,
    torrent_ref: String,
) -> Result<serde_json::Value, String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_peer_stats", &torrent_ref)?;
    let snap = state
        .api
        .api_peer_stats(idx, Default::default())
        .map_err(|err| map_cmd_err(&state, "torrent_peer_stats", err.to_string()))?;
    serde_json::to_value(snap)
        .map_err(|err| map_cmd_err(&state, "torrent_peer_stats", err.to_string()))
}

#[tauri::command]
pub fn torrent_live_stats(
    state: State<'_, AppState>,
    torrent_ref: String,
) -> Result<LiveStats, String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_live_stats", &torrent_ref)?;
    state
        .api
        .api_stats_v0(idx)
        .map_err(|err| map_cmd_err(&state, "torrent_live_stats", err.to_string()))
}

#[tauri::command]
pub fn torrent_piece_bitmap_dump(
    state: State<'_, AppState>,
    torrent_ref: String,
) -> Result<String, String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_piece_bitmap_dump", &torrent_ref)?;
    state
        .api
        .api_dump_haves(idx)
        .map_err(|err| map_cmd_err(&state, "torrent_piece_bitmap_dump", err.to_string()))
}

#[tauri::command]
pub fn torrent_stats(
    state: State<'_, AppState>,
    torrent_ref: String,
) -> Result<librqbit::TorrentStats, String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_stats", &torrent_ref)?;
    state
        .api
        .api_stats_v1(idx)
        .map_err(|err| map_cmd_err(&state, "torrent_stats", err.to_string()))
}

#[tauri::command]
pub fn session_dht_stats(state: State<'_, AppState>) -> Result<DhtStats, String> {
    state
        .api
        .api_dht_stats()
        .map_err(|err| map_cmd_err(&state, "session_dht_stats", err.to_string()))
}

#[tauri::command]
pub fn get_nexttorrent_settings(
    state: State<'_, AppState>,
) -> crate::settings::NexttorrentSettings {
    state.settings.read().clone()
}

#[tauri::command]
pub fn save_nexttorrent_settings(
    state: State<'_, AppState>,
    settings: crate::settings::NexttorrentSettings,
) -> Result<(), String> {
    crate::settings::save_settings(&state.settings_path, &settings)
        .map_err(|err| map_cmd_err(&state, "save_nexttorrent_settings", err.to_string()))?;
    *state.settings.write() = settings.clone();
    let (d, u) = effective_rate_limits(&settings, Local::now());
    state.session.ratelimits.set_download_bps(d);
    state.session.ratelimits.set_upload_bps(u);
    Ok(())
}

#[tauri::command]
pub fn set_torrent_label(
    state: State<'_, AppState>,
    info_hash: String,
    label: Option<String>,
) -> Result<(), String> {
    let mut s = state.settings.write();
    match label {
        Some(l) if !l.is_empty() => {
            s.labels_by_info_hash.insert(info_hash, l);
        }
        _ => {
            s.labels_by_info_hash.remove(&info_hash);
        }
    }
    crate::settings::save_settings(&state.settings_path, &s)
        .map_err(|err| map_cmd_err(&state, "set_torrent_label", err.to_string()))
}

#[tauri::command]
pub fn torrent_trackers(
    state: State<'_, AppState>,
    torrent_ref: String,
) -> Result<Vec<String>, String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_trackers", &torrent_ref)?;
    let mgr = state
        .api
        .mgr_handle(idx)
        .map_err(|err| map_cmd_err(&state, "torrent_trackers", err.to_string()))?;
    Ok(mgr
        .shared()
        .trackers
        .iter()
        .map(|u| u.to_string())
        .collect())
}

#[tauri::command]
pub fn get_torrent_bandwidth_limits(
    state: State<'_, AppState>,
    info_hash: String,
) -> crate::settings::PerTorrentBandwidthLimits {
    state
        .settings
        .read()
        .per_torrent_limits_by_info_hash
        .get(&info_hash)
        .cloned()
        .unwrap_or_default()
}

/// Persist per-torrent caps and re-apply them to a running torrent when metadata is available.
/// Returns `true` when the running torrent was re-added with the new limits (files kept).
#[tauri::command]
#[tracing::instrument(skip(state), fields(info_hash = %info_hash))]
pub async fn set_torrent_bandwidth_limits(
    state: State<'_, AppState>,
    info_hash: String,
    download_limit_bps: Option<u32>,
    upload_limit_bps: Option<u32>,
) -> Result<bool, String> {
    {
        let mut s = state.settings.write();
        if download_limit_bps.is_none() && upload_limit_bps.is_none() {
            s.per_torrent_limits_by_info_hash.remove(&info_hash);
        } else {
            s.per_torrent_limits_by_info_hash.insert(
                info_hash.clone(),
                crate::settings::PerTorrentBandwidthLimits {
                    download_limit_bps,
                    upload_limit_bps,
                },
            );
        }
        crate::settings::save_settings(&state.settings_path, &s)
            .map_err(|err| map_cmd_err(&state, "set_torrent_bandwidth_limits", err.to_string()))?;
    }

    apply_bandwidth_limits_to_running(&state, &info_hash).await
}

/// Re-add the torrent with updated `ratelimits` so librqbit's live `Limits` pick them up.
/// librqbit 8 has no public setter for per-torrent limits after add.
async fn apply_bandwidth_limits_to_running(
    state: &AppState,
    info_hash: &str,
) -> Result<bool, String> {
    let idx = match TorrentIdOrHash::parse(info_hash) {
        Ok(i) => i,
        Err(_) => return Ok(false),
    };
    let handle = match state.api.mgr_handle(idx) {
        Ok(h) => h,
        Err(_) => return Ok(false),
    };

    let torrent_bytes = match handle.with_metadata(|m| m.torrent_bytes.clone()) {
        Ok(b) if !b.is_empty() => b,
        _ => {
            tracing::info!(
                info_hash,
                "bandwidth limits saved; torrent metadata not ready for live re-apply"
            );
            return Ok(false);
        }
    };

    let details = state
        .api
        .api_torrent_details(idx)
        .map_err(|err| map_cmd_err(state, "set_torrent_bandwidth_limits", err.to_string()))?;
    let only_files = handle.only_files();
    let was_paused = handle.is_paused();
    let output_folder = details.output_folder.clone();
    let old_ref = torrent_ref_from_details(details.id, info_hash);

    state
        .api
        .api_torrent_action_forget(idx)
        .await
        .map_err(|err| map_cmd_err(state, "set_torrent_bandwidth_limits", err.to_string()))?;
    state.sequential_streams.remove(&old_ref);

    let settings = state.settings.read().clone();
    let opts = AddTorrentOptions {
        paused: was_paused,
        output_folder: Some(output_folder),
        only_files,
        overwrite: true,
        ratelimits: settings.limits_config_for_info_hash(info_hash),
        ..Default::default()
    };
    let resp = state
        .api
        .api_add_torrent(
            AddTorrent::TorrentFileBytes(torrent_bytes),
            Some(opts),
        )
        .await
        .map_err(|err| map_cmd_err(state, "set_torrent_bandwidth_limits", err.to_string()))?;
    attach_sequential_if_enabled(state, &torrent_ref_from_add_response(&resp));
    tracing::info!(info_hash, "re-applied per-torrent bandwidth limits");
    Ok(true)
}

#[tauri::command]
pub fn export_configuration_paths(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<PathsSnapshot, String> {
    let paths = crate::paths::app_paths(&app).map_err(|e| e.to_string())?;
    Ok(PathsSnapshot {
        settings_file: state.settings_path.to_string_lossy().into_owned(),
        rqbit_persistence_dir: state.rqbit_persistence_dir.to_string_lossy().into_owned(),
        config_dir: paths.config_dir.to_string_lossy().into_owned(),
        cache_dir: paths.cache_dir.to_string_lossy().into_owned(),
        watch_processed_file: state.watch_processed_path.to_string_lossy().into_owned(),
        seeding_started_file: state.seeding_started_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn export_configuration_bundle(
    state: State<'_, AppState>,
    dest_zip: String,
) -> Result<(), String> {
    crate::config_backup::export_configuration_bundle(&state, Path::new(&dest_zip))
        .map_err(|e| map_cmd_err(&state, "export_configuration_bundle", e))
}

#[tauri::command]
pub fn import_configuration_bundle(
    state: State<'_, AppState>,
    app: AppHandle,
    src_zip: String,
) -> Result<(), String> {
    let paths = crate::paths::app_paths(&app).map_err(|e| e.to_string())?;
    crate::config_backup::import_configuration_bundle(
        &state,
        Path::new(&src_zip),
        &paths.config_dir,
        &paths.cache_dir,
    )
    .map_err(|e| map_cmd_err(&state, "import_configuration_bundle", e))
}

#[tauri::command]
pub fn list_network_interfaces() -> Vec<crate::network::NetworkInterfaceInfo> {
    crate::network::list_network_interfaces()
}

fn torrent_ref_from_details(id: Option<usize>, info_hash: &str) -> String {
    id.map(|i| i.to_string())
        .unwrap_or_else(|| info_hash.to_string())
}

fn torrent_ref_from_add_response(resp: &ApiAddTorrentResponse) -> String {
    torrent_ref_from_details(resp.id, &resp.details.info_hash)
}

fn attach_sequential_if_enabled(state: &AppState, torrent_ref: &str) {
    let sequential = state.settings.read().sequential_download;
    if let Err(e) = state
        .sequential_streams
        .attach_if_enabled(&state.api, sequential, torrent_ref)
    {
        tracing::warn!(torrent = %torrent_ref, error = %e, "sequential stream attach failed");
    }
}

#[tracing::instrument(skip_all, fields(paused, has_output = output_folder.is_some()))]
pub async fn add_magnet_impl(
    state: &AppState,
    magnet: &str,
    output_folder: Option<String>,
    only_files: Option<Vec<usize>>,
    paused: bool,
) -> Result<ApiAddTorrentResponse, String> {
    validate_magnet_uri(magnet).map_err(|e| map_cmd_err(state, "torrent_add_magnet", e))?;
    let settings = state.settings.read().clone();
    let info_hash = crate::validation::info_hash_hex_from_magnet(magnet)
        .map_err(|e| map_cmd_err(state, "torrent_add_magnet", e))?;
    let opts = AddTorrentOptions {
        paused,
        output_folder,
        only_files,
        overwrite: true,
        ratelimits: settings.limits_config_for_info_hash(&info_hash),
        ..Default::default()
    };
    let resp = state
        .api
        .api_add_torrent(AddTorrent::Url(magnet.into()), Some(opts))
        .await
        .map_err(|err| map_cmd_err(state, "torrent_add_magnet", err.to_string()))?;
    attach_sequential_if_enabled(state, &torrent_ref_from_add_response(&resp));
    Ok(resp)
}

fn file_abs_path(output_folder: &str, components: &[String], name: &str) -> PathBuf {
    let mut path = PathBuf::from(output_folder);
    if components.is_empty() {
        path.push(name);
    } else {
        for part in components {
            path.push(part);
        }
    }
    path
}

fn persist_watch_processed(state: &AppState) -> Result<(), String> {
    let v: Vec<String> = state.watch_processed.read().iter().cloned().collect();
    let t = serde_json::to_string_pretty(&v)
        .map_err(|e| map_cmd_err(state, "persist_watch_processed", e.to_string()))?;
    std::fs::write(&state.watch_processed_path, t)
        .map_err(|e| map_cmd_err(state, "persist_watch_processed", e.to_string()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RssPollResult {
    pub magnets_added: usize,
    pub messages: Vec<String>,
}

#[tauri::command]
pub fn torrent_open_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    torrent_ref: String,
) -> Result<(), String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_open_folder", &torrent_ref)?;
    let details = state
        .api
        .api_torrent_details(idx)
        .map_err(|err| map_cmd_err(&state, "torrent_open_folder", err.to_string()))?;
    app.opener()
        .open_path(&details.output_folder, None::<&str>)
        .map_err(|err| map_cmd_err(&state, "torrent_open_folder", err.to_string()))
}

#[tauri::command]
pub fn torrent_reveal_file(
    app: AppHandle,
    state: State<'_, AppState>,
    torrent_ref: String,
    file_index: usize,
) -> Result<(), String> {
    let idx = parse_torrent_ref_cmd(&state, "torrent_reveal_file", &torrent_ref)?;
    let details = state
        .api
        .api_torrent_details(idx)
        .map_err(|err| map_cmd_err(&state, "torrent_reveal_file", err.to_string()))?;
    let files = details.files.ok_or_else(|| {
        map_cmd_err(
            &state,
            "torrent_reveal_file",
            "torrent has no file list".into(),
        )
    })?;
    let file = files.get(file_index).ok_or_else(|| {
        map_cmd_err(
            &state,
            "torrent_reveal_file",
            format!("invalid file index {file_index}"),
        )
    })?;
    let path = file_abs_path(&details.output_folder, &file.components, &file.name);
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|err| map_cmd_err(&state, "torrent_reveal_file", err.to_string()))
}

#[tauri::command]
pub async fn torrent_pause_all(state: State<'_, AppState>) -> Result<(), String> {
    pause_all_impl(&state).await
}

#[tracing::instrument(skip_all)]
pub async fn pause_all_impl(state: &AppState) -> Result<(), String> {
    let list = state
        .api
        .api_torrent_list_ext(ApiTorrentListOpts { with_stats: false });
    for t in list.torrents {
        let key = torrent_ref_from_details(t.id, &t.info_hash);
        let idx = parse_torrent_ref_cmd(state, "torrent_pause_all", &key)?;
        pause_torrent_action(state, "torrent_pause_all", idx).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn torrent_resume_all(state: State<'_, AppState>) -> Result<(), String> {
    resume_all_impl(&state).await
}

#[tracing::instrument(skip_all)]
pub async fn resume_all_impl(state: &AppState) -> Result<(), String> {
    let list = state
        .api
        .api_torrent_list_ext(ApiTorrentListOpts { with_stats: false });
    for t in list.torrents {
        let key = torrent_ref_from_details(t.id, &t.info_hash);
        let idx = parse_torrent_ref_cmd(state, "torrent_resume_all", &key)?;
        start_torrent_action(state, "torrent_resume_all", idx).await?;
    }
    Ok(())
}

#[tracing::instrument(skip_all)]
pub(crate) async fn rss_poll_feeds_impl(state: &AppState) -> Result<RssPollResult, String> {
    let feeds: Vec<crate::settings::RssFeedEntry> = state.settings.read().rss_feeds.clone();
    let client = state.http_client.clone();
    let mut magnets_added = 0usize;
    let mut messages = Vec::new();
    let mut pending_ids: Vec<(String, Vec<String>)> = Vec::new();

    for feed in feeds {
        if !feed.enabled {
            continue;
        }
        let label = feed.name.as_deref().unwrap_or(&feed.url);
        match crate::rss::fetch_new_matches(&client, &feed).await {
            Ok((matches, ids)) => {
                if matches.is_empty() {
                    continue;
                }
                pending_ids.push((feed.id.clone(), ids));
                for m in matches {
                    for magnet in m.magnets {
                        if let Err(e) = validate_magnet_uri(&magnet) {
                            messages.push(e);
                            continue;
                        }
                        let info_hash = match crate::validation::info_hash_hex_from_magnet(&magnet) {
                            Ok(h) => h,
                            Err(e) => {
                                messages.push(e);
                                continue;
                            }
                        };
                        let settings = state.settings.read().clone();
                        let opts = AddTorrentOptions {
                            paused: false,
                            output_folder: m.output_folder.clone(),
                            overwrite: true,
                            ratelimits: settings.limits_config_for_info_hash(&info_hash),
                            ..Default::default()
                        };
                        match state
                            .api
                            .api_add_torrent(AddTorrent::Url(magnet.into()), Some(opts))
                            .await
                        {
                            Ok(resp) => {
                                magnets_added += 1;
                                attach_sequential_if_enabled(
                                    state,
                                    &torrent_ref_from_add_response(&resp),
                                );
                            }
                            Err(e) => messages.push(format!("{label}: {e}")),
                        }
                    }
                }
            }
            Err(e) => messages.push(format!("{label}: {e}")),
        }
    }

    if !pending_ids.is_empty() {
        let mut s = state.settings.write();
        for (fid, ids) in pending_ids {
            if let Some(f) = s.rss_feeds.iter_mut().find(|x| x.id == fid) {
                for id in ids {
                    if !f.last_seen_ids.contains(&id) {
                        f.last_seen_ids.push(id);
                    }
                }
                while f.last_seen_ids.len() > 500 {
                    f.last_seen_ids.remove(0);
                }
            }
        }
        crate::settings::save_settings(&state.settings_path, &s)
            .map_err(|e| map_cmd_err(state, "rss_poll_feeds", e.to_string()))?;
    }

    Ok(RssPollResult {
        magnets_added,
        messages,
    })
}

#[tauri::command]
pub async fn rss_poll_feeds(state: State<'_, AppState>) -> Result<RssPollResult, String> {
    rss_poll_feeds_impl(&state).await
}

#[tauri::command]
pub fn disk_free_bytes(path: String) -> Result<u64, String> {
    available_bytes_for_path(Path::new(&path)).map_err(|e| {
        let msg = e.to_string();
        tracing::warn!(path = %path, error = %msg, "disk_free_bytes failed");
        msg
    })
}

#[tracing::instrument(skip_all)]
pub(crate) async fn watch_poll_impl(state: &AppState) -> Result<usize, String> {
    let folders = state.settings.read().watch_folders.clone();
    let paths = crate::watch_folder::list_torrent_paths(&folders);
    let mut added = 0usize;
    for p in paths {
        let key = p
            .canonicalize()
            .unwrap_or_else(|_| p.clone())
            .to_string_lossy()
            .into_owned();
        if state.watch_processed.read().contains(&key) {
            continue;
        }
        let bytes =
            std::fs::read(&p).map_err(|e| map_cmd_err(state, "watch_poll", e.to_string()))?;
        validate_torrent_bytes(&bytes).map_err(|e| map_cmd_err(state, "watch_poll", e))?;
        let total = torrent_total_bytes(&bytes).map_err(|e| map_cmd_err(state, "watch_poll", e))?;
        let settings = state.settings.read().clone();
        let reserve = settings
            .disk_space_reserve_mb
            .unwrap_or(0)
            .saturating_mul(1024 * 1024);
        match available_bytes_for_path(state.download_root.as_path()) {
            Ok(avail) => {
                if avail < total.saturating_add(reserve) {
                    tracing::warn!(path=?p, "watch folder: skipped (disk space)");
                    continue;
                }
            }
            Err(e) => tracing::warn!(path=?p, err=%e, "watch folder: disk check skipped"),
        }
        let opts = AddTorrentOptions {
            overwrite: true,
            ..Default::default()
        };
        match state
            .api
            .api_add_torrent(AddTorrent::TorrentFileBytes(Bytes::from(bytes)), Some(opts))
            .await
        {
            Ok(_) => {
                state.watch_processed.write().insert(key);
                persist_watch_processed(state)?;
                added += 1;
            }
            Err(e) => tracing::warn!(path=?p, error=%e, "watch folder add failed"),
        }
    }
    Ok(added)
}

#[tauri::command]
pub async fn watch_poll(state: State<'_, AppState>) -> Result<usize, String> {
    watch_poll_impl(&state).await
}

#[cfg(test)]
mod tests {
    use super::is_idempotent_torrent_action_err;

    #[test]
    fn idempotent_pause_error_is_recognized() {
        assert!(is_idempotent_torrent_action_err(
            "error pausing torrent\n\nCaused by:\n    torrent is already paused"
        ));
    }

    #[test]
    fn idempotent_resume_error_is_recognized() {
        assert!(is_idempotent_torrent_action_err(
            "error starting torrent\n\nCaused by:\n    torrent is already live"
        ));
    }

    #[test]
    fn real_pause_errors_are_not_idempotent() {
        assert!(!is_idempotent_torrent_action_err(
            "error pausing torrent\n\nCaused by:\n    can't pause torrent in error state"
        ));
    }
}
