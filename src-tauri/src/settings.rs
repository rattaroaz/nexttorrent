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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssFeedEntry {
    pub id: String,
    pub url: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub auto_add: bool,
    #[serde(default)]
    pub last_seen_ids: Vec<String>,
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
    /// Reserved for future engine hooks (stored for UX parity with roadmap).
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
        }
    }
}

impl NexttorrentSettings {
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
