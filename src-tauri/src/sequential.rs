//! Keep librqbit `FileStream` handles alive to bias piece picking toward sequential download.

use std::any::Any;
use std::collections::HashMap;

use librqbit::api::{Api, TorrentDetailsResponse, TorrentIdOrHash};
use parking_lot::Mutex;

pub struct SequentialStreams {
    /// Opaque `librqbit` stream handles (private `FileStream` type).
    inner: Mutex<HashMap<String, Box<dyn Any + Send + 'static>>>,
}

impl SequentialStreams {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub fn remove(&self, torrent_ref: &str) {
        self.inner.lock().remove(torrent_ref);
    }

    pub fn attach_if_enabled(
        &self,
        api: &Api,
        sequential_enabled: bool,
        torrent_ref: &str,
    ) -> Result<(), String> {
        if !sequential_enabled {
            return Ok(());
        }
        let idx = TorrentIdOrHash::parse(torrent_ref).map_err(|e| e.to_string())?;
        let details = api.api_torrent_details(idx).map_err(|e| e.to_string())?;
        let Some(file_id) = pick_sequential_file_id(&details) else {
            return Ok(());
        };
        let stream = api.api_stream(idx, file_id).map_err(|e| e.to_string())?;
        self.inner
            .lock()
            .insert(torrent_ref.to_string(), Box::new(stream));
        tracing::info!(torrent = %torrent_ref, file_id, "sequential download stream attached");
        Ok(())
    }
}

fn pick_sequential_file_id(details: &TorrentDetailsResponse) -> Option<usize> {
    let files = details.files.as_ref()?;
    files
        .iter()
        .enumerate()
        .filter(|(_, f)| f.included)
        .max_by_key(|(_, f)| f.length)
        .map(|(idx, _)| idx)
}
