use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use librqbit::{Api, Session};
use parking_lot::RwLock;
use reqwest::Client;

use crate::sequential::SequentialStreams;
use crate::settings::NexttorrentSettings;

#[derive(Clone)]
pub struct AppState {
    pub api: Arc<Api>,
    pub session: Arc<Session>,
    pub settings: Arc<RwLock<NexttorrentSettings>>,
    pub settings_path: PathBuf,
    pub rqbit_persistence_dir: PathBuf,
    /// OS default download directory (used when settings.download_dir is empty).
    pub default_download_dir: PathBuf,
    /// Live session download directory (updated when settings are saved).
    pub download_root: Arc<RwLock<PathBuf>>,
    pub http_client: Client,
    pub watch_processed_path: PathBuf,
    pub watch_processed: Arc<RwLock<HashSet<String>>>,
    pub sequential_streams: Arc<SequentialStreams>,
    pub seeding_started_path: PathBuf,
    pub seeding_started: Arc<RwLock<HashMap<String, u64>>>,
    /// Info hashes the download queue paused. User pause removes hashes so they stay stopped.
    pub queue_paused_downloads: Arc<RwLock<HashSet<String>>>,
    /// Info hashes the upload queue paused. Seeding-rule pauses are not stored here.
    pub queue_paused_uploads: Arc<RwLock<HashSet<String>>>,
}

impl AppState {
    pub fn live_download_root(&self) -> PathBuf {
        self.download_root.read().clone()
    }
}
