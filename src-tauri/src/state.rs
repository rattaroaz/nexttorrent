use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use librqbit::{Api, Session};
use parking_lot::RwLock;
use reqwest::Client;

use crate::settings::NexttorrentSettings;

#[derive(Clone)]
pub struct AppState {
    pub api: Arc<Api>,
    pub session: Arc<Session>,
    pub settings: Arc<RwLock<NexttorrentSettings>>,
    pub settings_path: PathBuf,
    pub rqbit_persistence_dir: PathBuf,
    /// Effective session download directory (resolved at startup).
    pub download_root: PathBuf,
    pub http_client: Client,
    pub watch_processed_path: PathBuf,
    pub watch_processed: Arc<RwLock<HashSet<String>>>,
}
