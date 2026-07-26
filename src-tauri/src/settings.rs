//! Persistent Nexttorrent preferences (JSON). librqbit keeps its own session DB under `cache/rqbit-session`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::paths::AppPaths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedSchedulerSlot {
    /// Start hour (0–23), inclusive.
    #[serde(default)]
    pub start_hour: u8,
    /// End hour (0–23), exclusive; may be less than `start_hour` for overnight windows.
    #[serde(default = "default_slot_end_hour")]
    pub end_hour: u8,
    #[serde(default)]
    pub download_limit_bps: Option<u32>,
    #[serde(default)]
    pub upload_limit_bps: Option<u32>,
}

fn default_slot_end_hour() -> u8 {
    24
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedScheduler {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub slots: Vec<SpeedSchedulerSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RssFeedKind {
    Rss,
    Torznab,
}

impl Default for RssFeedKind {
    fn default() -> Self {
        Self::Rss
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssFeedEntry {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub kind: RssFeedKind,
    /// Torznab / Jackett API key (appended as `apikey` query param when set).
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub auto_add: bool,
    #[serde(default)]
    pub last_seen_ids: Vec<String>,
    /// Optional regex; item title must match when set.
    #[serde(default)]
    pub title_regex: Option<String>,
    /// Optional regex; items matching are skipped.
    #[serde(default)]
    pub exclude_regex: Option<String>,
    /// Comma-separated keywords; all must appear in the title (case-insensitive).
    #[serde(default)]
    pub quality_filter: Option<String>,
    /// Category name (lowercase) → absolute save directory.
    #[serde(default)]
    pub category_save_paths: HashMap<String, String>,
    /// Default save directory when no category mapping matches.
    #[serde(default)]
    pub default_save_path: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerTorrentBandwidthLimits {
    #[serde(default)]
    pub download_limit_bps: Option<u32>,
    #[serde(default)]
    pub upload_limit_bps: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexttorrentSettings {
    /// When set, torrents download here instead of the OS download folder.
    pub download_dir: Option<String>,
    #[serde(default)]
    pub global_down_limit_bps: Option<u32>,
    #[serde(default)]
    pub global_up_limit_bps: Option<u32>,
    #[serde(default = "default_listen_start")]
    pub listen_port_start: u16,
    #[serde(default = "default_listen_end")]
    pub listen_port_end: u16,
    #[serde(default = "default_true")]
    pub enable_upnp: bool,
    #[serde(default)]
    pub socks_proxy: Option<String>,
    /// UI preference: "light" | "dark" | "system"
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Human-readable labels keyed by info hash (40-char hex).
    #[serde(default)]
    pub labels_by_info_hash: HashMap<String, String>,
    /// Label name → `#rrggbb` for list coloring.
    #[serde(default)]
    pub label_colors: HashMap<String, String>,
    #[serde(default)]
    pub sequential_download: bool,
    #[serde(default)]
    pub rss_feeds: Vec<RssFeedEntry>,
    /// Absolute directories scanned periodically for `.torrent` files.
    #[serde(default)]
    pub watch_folders: Vec<String>,
    #[serde(default)]
    pub max_active_downloads: Option<u32>,
    /// Max simultaneous seeding (finished + live) torrents; enforced in `queue_control`.
    #[serde(default)]
    pub max_active_uploads: Option<u32>,
    #[serde(default)]
    pub stalled_timeout_secs: Option<u64>,
    #[serde(default)]
    pub speed_scheduler: SpeedScheduler,
    #[serde(default)]
    pub start_at_login: bool,
    #[serde(default)]
    pub minimize_to_tray: bool,
    /// Warn / block adds when free space falls below this (mebibytes), best-effort.
    #[serde(default)]
    pub disk_space_reserve_mb: Option<u64>,
    /// Per-torrent download/upload caps (applied when torrent is added).
    #[serde(default)]
    pub per_torrent_limits_by_info_hash: HashMap<String, PerTorrentBandwidthLimits>,
    /// Pause seeding when upload/download ratio reaches this (e.g. 1.0).
    #[serde(default)]
    pub seed_ratio_limit: Option<f64>,
    /// Pause seeding after this many hours once the torrent finishes.
    #[serde(default)]
    pub seed_time_limit_hours: Option<f64>,
    /// Preferred network interface name (stored for VPN workflows; librqbit 8 does not bind yet).
    #[serde(default)]
    pub bind_interface: Option<String>,
}

fn default_listen_start() -> u16 {
    6881
}

fn default_listen_end() -> u16 {
    6891
}

fn default_true() -> bool {
    true
}

fn default_theme() -> String {
    "system".into()
}

impl Default for NexttorrentSettings {
    fn default() -> Self {
        Self {
            download_dir: None,
            global_down_limit_bps: None,
            global_up_limit_bps: None,
            listen_port_start: default_listen_start(),
            listen_port_end: default_listen_end(),
            enable_upnp: default_true(),
            socks_proxy: None,
            theme: default_theme(),
            labels_by_info_hash: HashMap::new(),
            label_colors: HashMap::new(),
            sequential_download: false,
            rss_feeds: Vec::new(),
            watch_folders: Vec::new(),
            max_active_downloads: None,
            max_active_uploads: None,
            stalled_timeout_secs: None,
            speed_scheduler: SpeedScheduler::default(),
            start_at_login: false,
            minimize_to_tray: false,
            disk_space_reserve_mb: Some(512),
            per_torrent_limits_by_info_hash: HashMap::new(),
            seed_ratio_limit: None,
            seed_time_limit_hours: None,
            bind_interface: None,
        }
    }
}

impl NexttorrentSettings {
    pub fn limits_config_for_info_hash(&self, info_hash: &str) -> librqbit::limits::LimitsConfig {
        use std::num::NonZeroU32;

        self.per_torrent_limits_by_info_hash
            .get(info_hash)
            .map(|l| librqbit::limits::LimitsConfig {
                download_bps: l.download_limit_bps.and_then(|v| NonZeroU32::new(v)),
                upload_bps: l.upload_limit_bps.and_then(|v| NonZeroU32::new(v)),
            })
            .unwrap_or_default()
    }

    pub fn resolved_download_dir(&self, paths: &AppPaths) -> PathBuf {
        self.download_dir
            .as_ref()
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| paths.download_dir.clone())
    }
}

pub fn load_settings(path: &Path) -> anyhow::Result<NexttorrentSettings> {
    if !path.exists() {
        return Ok(NexttorrentSettings::default());
    }
    let text = fs::read_to_string(path)?;
    let s = serde_json::from_str(&text)?;
    Ok(s)
}

pub fn save_settings(path: &Path, settings: &NexttorrentSettings) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(settings)?;
    fs::write(path, text)?;
    Ok(())
}
