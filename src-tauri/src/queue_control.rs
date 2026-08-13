//! Application-side queue rules: max parallel downloads and stalled timeouts.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use librqbit::api::{ApiTorrentListOpts, LiveStats, TorrentIdOrHash};
use librqbit::TorrentStatsState;

use crate::seeding_rules;
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

/// True when the torrent has already discovered or connected to peers.
/// Brand-new torrents with 0 peers must not be treated as stalled.
fn has_peer_activity(live: Option<&LiveStats>) -> bool {
    let Some(live) = live else {
        return false;
    };
    let ps = &live.snapshot.peer_stats;
    ps.live > 0 || ps.connecting > 0 || ps.seen > 0 || ps.queued > 0
}

/// Whether stall ticks should advance for this torrent.
fn should_count_stall_tick(download_mbps: f64, has_peers: bool) -> bool {
    mbps_near_zero(download_mbps) && has_peers
}

/// How many queued torrents to resume for a slot cap.
/// `usize::MAX` means resume all queued.
fn resume_slot_count(live: usize, max: Option<u32>) -> usize {
    match max.filter(|m| *m > 0) {
        None => usize::MAX,
        Some(max) => {
            let max = max as usize;
            if live > max {
                0
            } else {
                max - live
            }
        }
    }
}

fn torrent_is_complete(stats: &librqbit::TorrentStats) -> bool {
    stats.finished || (stats.total_bytes > 0 && stats.progress_bytes >= stats.total_bytes)
}

async fn resume_queue_paused(
    state: &AppState,
    queued: &mut HashSet<String>,
    slots: usize,
    seeding: bool,
) {
    if slots == 0 || queued.is_empty() {
        return;
    }
    let list = state
        .api
        .api_torrent_list_ext(ApiTorrentListOpts { with_stats: true });
    let mut candidates: Vec<(String, i64)> = Vec::new();
    let mut stale = Vec::new();
    for t in &list.torrents {
        let Some(stats) = &t.stats else {
            continue;
        };
        if !queued.contains(&t.info_hash) {
            continue;
        }
        if !matches!(stats.state, TorrentStatsState::Paused) {
            stale.push(t.info_hash.clone());
            continue;
        }
        if seeding != torrent_is_complete(stats) {
            continue;
        }
        let id_ord = t.id.map(|i| i as i64).unwrap_or(-1);
        candidates.push((t.info_hash.clone(), id_ord));
    }
    for hash in stale {
        queued.remove(&hash);
    }
    candidates.sort_by_key(|b| b.1);
    for (key, _) in candidates.into_iter().take(slots) {
        if let Ok(idx) = TorrentIdOrHash::parse(&key) {
            let _ = state.api.api_torrent_action_start(idx).await;
        }
        queued.remove(&key);
        tracing::info!(torrent = %key, "resumed queued torrent");
    }
}

/// Pause torrents when too many are downloading, or when stalled (no meaningful download speed).
pub async fn apply_queue_rules(
    state: &AppState,
    stall_ticks: &mut HashMap<String, u32>,
    seeding_started: &mut HashMap<String, u64>,
    queue_paused_downloads: &mut HashSet<String>,
    queue_paused_uploads: &mut HashSet<String>,
) {
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
        if !matches!(stats.state, TorrentStatsState::Live) || torrent_is_complete(stats) {
            stall_ticks.remove(&key);
            continue;
        }
        let id_ord = t.id.map(|i| i as i64).unwrap_or(-1);
        downloaders.push((t.info_hash.clone(), id_ord));
    }

    for t in &list.torrents {
        let key = torrent_ref_string(t.id, &t.info_hash);
        if !downloaders.iter().any(|(h, _)| h == &t.info_hash) {
            continue;
        }
        let Some(stats) = &t.stats else {
            continue;
        };
        let live = stats.live.as_ref();
        let live_mbps = live.map(|l| l.download_speed.mbps).unwrap_or(0.0);
        let peers = has_peer_activity(live);

        if let Some(timeout) = settings.stalled_timeout_secs.filter(|s| *s > 0) {
            let ticks_needed = timeout.div_ceil(TICK_SECS).max(1) as u32;
            if should_count_stall_tick(live_mbps, peers) {
                let n = stall_ticks.entry(key.clone()).or_insert(0);
                *n += 1;
                if *n >= ticks_needed {
                    if let Ok(idx) = TorrentIdOrHash::parse(&key) {
                        let _ = state.api.api_torrent_action_pause(idx).await;
                    }
                    stall_ticks.remove(&key);
                    tracing::info!(torrent = %key, "paused stalled torrent");
                }
            } else if mbps_near_zero(live_mbps) && !peers {
                stall_ticks.remove(&key);
                tracing::debug!(
                    torrent = %key,
                    "stall timer skipped — no peers yet"
                );
            } else {
                stall_ticks.remove(&key);
            }
        }
    }

    for (hash, _) in &downloaders {
        queue_paused_downloads.remove(hash);
    }

    let resume_dl = resume_slot_count(downloaders.len(), settings.max_active_downloads);
    if let Some(max) = settings.max_active_downloads.filter(|m| *m > 0) {
        let mut d = downloaders;
        d.sort_by_key(|b| std::cmp::Reverse(b.1));
        if d.len() > max as usize {
            for (key, _) in d.into_iter().skip(max as usize) {
                if let Ok(idx) = TorrentIdOrHash::parse(&key) {
                    let _ = state.api.api_torrent_action_pause(idx).await;
                }
                queue_paused_downloads.insert(key.clone());
                tracing::info!(torrent = %key, "paused due to max_active_downloads");
            }
        } else {
            resume_queue_paused(state, queue_paused_downloads, resume_dl, false).await;
        }
    } else {
        resume_queue_paused(state, queue_paused_downloads, resume_dl, false).await;
    }

    let mut uploaders: Vec<(String, i64)> = Vec::new();
    for t in &list.torrents {
        let Some(stats) = &t.stats else {
            continue;
        };
        if !matches!(stats.state, TorrentStatsState::Live) || !stats.finished {
            continue;
        }
        let id_ord = t.id.map(|i| i as i64).unwrap_or(-1);
        uploaders.push((t.info_hash.clone(), id_ord));
    }

    for (hash, _) in &uploaders {
        queue_paused_uploads.remove(hash);
    }

    let resume_up = resume_slot_count(uploaders.len(), settings.max_active_uploads);
    if let Some(max) = settings.max_active_uploads.filter(|m| *m > 0) {
        let mut u = uploaders;
        u.sort_by_key(|b| std::cmp::Reverse(b.1));
        if u.len() > max as usize {
            for (key, _) in u.into_iter().skip(max as usize) {
                if let Ok(idx) = TorrentIdOrHash::parse(&key) {
                    let _ = state.api.api_torrent_action_pause(idx).await;
                }
                queue_paused_uploads.insert(key.clone());
                tracing::info!(torrent = %key, "paused due to max_active_uploads");
            }
        } else {
            resume_queue_paused(state, queue_paused_uploads, resume_up, true).await;
        }
    } else {
        // Only resume torrents this loop paused for the slot cap — not seeds
        // paused by ratio/time rules.
        resume_queue_paused(state, queue_paused_uploads, resume_up, true).await;
    }

    seeding_rules::apply_seeding_rules(state, seeding_started).await;
}

pub fn spawn_queue_loop(state: AppState) {
    let bg = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut stall_ticks: HashMap<String, u32> = HashMap::new();
        let mut queue_paused_downloads: HashSet<String> = HashSet::new();
        let mut queue_paused_uploads: HashSet<String> = HashSet::new();
        let mut interval = tokio::time::interval(Duration::from_secs(TICK_SECS));
        loop {
            interval.tick().await;
            let mut seeding = bg.seeding_started.read().clone();
            apply_queue_rules(
                &bg,
                &mut stall_ticks,
                &mut seeding,
                &mut queue_paused_downloads,
                &mut queue_paused_uploads,
            )
            .await;
            *bg.seeding_started.write() = seeding;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stall_tick_requires_peers() {
        assert!(!should_count_stall_tick(0.0, false));
        assert!(should_count_stall_tick(0.0, true));
        assert!(!should_count_stall_tick(0.5, true));
        assert!(!should_count_stall_tick(0.5, false));
    }

    #[test]
    fn queue_slots_resume_when_free() {
        assert_eq!(resume_slot_count(5, Some(3)), 0);
        assert_eq!(resume_slot_count(2, Some(3)), 1);
        assert_eq!(resume_slot_count(3, Some(3)), 0);
        assert_eq!(resume_slot_count(1, None), usize::MAX);
        assert_eq!(resume_slot_count(4, Some(0)), usize::MAX);
    }
}
