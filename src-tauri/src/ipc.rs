//! IPC payload types shared with the TypeScript frontend (keep in sync with `src/ipc/contracts.ts`).

use serde::Serialize;

/// Emitted on startup and returned by `get_session_snapshot`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub download_dir: String,
    pub effective_download_dir: String,
    pub config_dir: String,
    pub cache_dir: String,
    pub log_filter: String,
    pub rqbit_version: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_snapshot_serializes_camel_case_fields() {
        let s = SessionSnapshot {
            download_dir: "d".into(),
            effective_download_dir: "e".into(),
            config_dir: "c".into(),
            cache_dir: "x".into(),
            log_filter: "info".into(),
            rqbit_version: "9".into(),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert!(v.get("effectiveDownloadDir").is_some());
        assert!(v.get("rqbitVersion").is_some());
        assert!(v.get("download_dir").is_none());
    }
}
