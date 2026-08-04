//! Pause seeding torrents when global ratio or time limits are reached.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use librqbit::api::{ApiTorrentListOpts, TorrentIdOrHash};
use librqbit::TorrentStatsState;

use crate::settings::NexttorrentSettings;
use crate::state::AppState;

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn load_seeding_started(path: &Path) -> HashMap<String, u64> {
    if !path.exists() {
        return HashMap::new();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_seeding_started(path: &Path, map: &HashMap<String, u64>) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(map)?;
    fs::write(path, text)
}

/// Track when torrents first reach finished state; pause when limits exceeded.
pub async fn apply_seeding_rules(state: &AppState, seeding_started: &mut HashMap<String, u64>) {
    let settings: NexttorrentSettings = state.settings.read().clone();
    let ratio_limit = settings.seed_ratio_limit;
    let time_limit_secs = settings.seed_time_limit_hours.filter(|h| *h > 0.0).map(|h| {
        // Truncating sub-second values to 0 would pause immediately; require at least 1s.
        (h * 3600.0).ceil().max(1.0) as u64
    });

    if ratio_limit.is_none() && time_limit_secs.is_none() {
        return;
    }

    let list = state
        .api
        .api_torrent_list_ext(ApiTorrentListOpts { with_stats: true });

    let now = now_unix();
    let mut changed = false;

    for t in &list.torrents {
        let Some(stats) = &t.stats else {
            continue;
        };
        let key =
            t.id.map(|i| i.to_string())
                .unwrap_or_else(|| t.info_hash.clone());

        if !stats.finished || !matches!(stats.state, TorrentStatsState::Live) {
            if seeding_started.remove(&key).is_some() {
                changed = true;
            }
            continue;
        }

        if !seeding_started.contains_key(&key) {
            seeding_started.insert(key.clone(), now);
            changed = true;
        }

        let mut should_pause = false;

        if let Some(limit) = ratio_limit.filter(|r| *r > 0.0) {
            let downloaded = stats.progress_bytes.max(1);
            let ratio = stats.uploaded_bytes as f64 / downloaded as f64;
            if ratio >= limit {
                should_pause = true;
                tracing::info!(torrent = %key, ratio, limit, "seeding ratio limit reached");
            }
        }

        if let Some(limit_secs) = time_limit_secs {
            if let Some(started) = seeding_started.get(&key) {
                if now.saturating_sub(*started) >= limit_secs {
                    should_pause = true;
                    tracing::info!(torrent = %key, "seeding time limit reached");
                }
            }
        }

        if should_pause {
            if let Ok(idx) = TorrentIdOrHash::parse(&key) {
                let _ = state.api.api_torrent_action_pause(idx).await;
            }
            seeding_started.remove(&key);
            changed = true;
        }
    }

    if changed {
        let _ = save_seeding_started(&state.seeding_started_path, seeding_started);
    }
}

pub fn seeding_started_path(config_dir: &Path) -> PathBuf {
    config_dir.join("seeding_started.json")
}
