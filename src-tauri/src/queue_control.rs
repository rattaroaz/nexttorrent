//! Application-side queue rules: max parallel downloads and stalled timeouts.

use std::collections::HashMap;
use std::time::Duration;

use librqbit::api::{ApiTorrentListOpts, TorrentIdOrHash};
use librqbit::TorrentStatsState;

use crate::settings::NexttorrentSettings;
use crate::state::AppState;

const TICK_SECS: u64 = 5;

fn torrent_ref_string(id: Option<usize>, info_hash: &str) -> String {
    id.map(|i| i.to_string())
        .unwrap_or_else(|| info_hash.to_string())
}

fn mbps_near_zero(mbps: f64) -> bool {
    mbps.abs() < 1e-9 || mbps < 0.000_001
}

/// Pause torrents when too many are downloading, or when stalled (no meaningful download speed).
pub async fn apply_queue_rules(state: &AppState, stall_ticks: &mut HashMap<String, u32>) {
    let settings: NexttorrentSettings = state.settings.read().clone();
    let list = state
        .api
        .api_torrent_list_ext(ApiTorrentListOpts { with_stats: true });

    let mut downloaders: Vec<(String, i64)> = Vec::new();

    for t in &list.torrents {
        let Some(stats) = &t.stats else {
            continue;
        };
        let key = torrent_ref_string(t.id, &t.info_hash);
        if !matches!(stats.state, TorrentStatsState::Live) || stats.finished {
            stall_ticks.remove(&key);
            continue;
        }
        if stats.total_bytes > 0 && stats.progress_bytes >= stats.total_bytes {
            stall_ticks.remove(&key);
            continue;
        }
        let id_ord = t.id.map(|i| i as i64).unwrap_or(-1);
        downloaders.push((key, id_ord));
    }

    for t in &list.torrents {
        let key = torrent_ref_string(t.id, &t.info_hash);
        if !downloaders.iter().any(|(k, _)| k == &key) {
            continue;
        }
        let Some(stats) = &t.stats else {
            continue;
        };
        let live_mbps = stats
            .live
            .as_ref()
            .map(|l| l.download_speed.mbps)
            .unwrap_or(0.0);

        if let Some(timeout) = settings.stalled_timeout_secs.filter(|s| *s > 0) {
            let ticks_needed = timeout.div_ceil(TICK_SECS).max(1) as u32;
            if mbps_near_zero(live_mbps) {
                let n = stall_ticks.entry(key.clone()).or_insert(0);
                *n += 1;
                if *n >= ticks_needed {
                    if let Ok(idx) = TorrentIdOrHash::parse(&key) {
                        let _ = state.api.api_torrent_action_pause(idx).await;
                    }
                    stall_ticks.remove(&key);
                    tracing::info!(torrent = %key, "paused stalled torrent");
                }
            } else {
                stall_ticks.remove(&key);
            }
        }
    }

    if let Some(max) = settings.max_active_downloads.filter(|m| *m > 0) {
        let mut d = downloaders;
        d.sort_by(|a, b| b.1.cmp(&a.1));
        if d.len() > max as usize {
            for (key, _) in d.into_iter().skip(max as usize) {
                if let Ok(idx) = TorrentIdOrHash::parse(&key) {
                    let _ = state.api.api_torrent_action_pause(idx).await;
                }
                tracing::info!(torrent = %key, "paused due to max_active_downloads");
            }
        }
    }
}

pub fn spawn_queue_loop(state: AppState) {
    let bg = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut stall_ticks: HashMap<String, u32> = HashMap::new();
        let mut interval = tokio::time::interval(Duration::from_secs(TICK_SECS));
        loop {
            interval.tick().await;
            apply_queue_rules(&bg, &mut stall_ticks).await;
        }
    });
}
