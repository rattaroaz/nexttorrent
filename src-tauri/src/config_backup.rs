//! Export / import Nexttorrent configuration (settings + librqbit session state).

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use walkdir::WalkDir;
use zip::read::ZipArchive;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::state::AppState;

const SETTINGS_ENTRY: &str = "settings.json";
const WATCH_PROCESSED_ENTRY: &str = "watch_processed.json";
const SEEDING_STARTED_ENTRY: &str = "seeding_started.json";
const RQBIT_DIR_PREFIX: &str = "rqbit-session/";

/// Resolve a zip entry to a path under config/cache. Rejects `..` and absolute segments.
pub(crate) fn zip_output_path(
    name: &str,
    config_dir: &Path,
    cache_dir: &Path,
) -> Result<Option<PathBuf>, String> {
    let name = name.replace('\\', "/");
    if name.ends_with('/') {
        return Ok(None);
    }
    if name == SETTINGS_ENTRY || name == WATCH_PROCESSED_ENTRY || name == SEEDING_STARTED_ENTRY {
        if Path::new(&name)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(format!("refusing zip entry {name}"));
        }
        return Ok(Some(config_dir.join(name)));
    }
    if let Some(rel) = name.strip_prefix(RQBIT_DIR_PREFIX) {
        if rel.is_empty() {
            return Ok(None);
        }
        let session_root = cache_dir.join("rqbit-session");
        return Ok(Some(safe_extract_path(&session_root, rel)?));
    }
    Ok(None)
}

fn add_file_to_zip<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    entry_name: &str,
    path: &Path,
) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    zip.start_file(entry_name, SimpleFileOptions::default())
        .map_err(|e| e.to_string())?;
    zip.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(())
}

fn add_dir_to_zip<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    prefix: &str,
    dir: &Path,
) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        let rel = path
            .strip_prefix(dir)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let name = format!("{prefix}{rel}");
        add_file_to_zip(zip, &name, path)?;
    }
    Ok(())
}

pub fn export_configuration_bundle(state: &AppState, dest_zip: &Path) -> Result<(), String> {
    if let Some(parent) = dest_zip.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = File::create(dest_zip).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);

    add_file_to_zip(&mut zip, SETTINGS_ENTRY, &state.settings_path)?;
    add_file_to_zip(&mut zip, WATCH_PROCESSED_ENTRY, &state.watch_processed_path)?;
    add_file_to_zip(&mut zip, SEEDING_STARTED_ENTRY, &state.seeding_started_path)?;
    add_dir_to_zip(&mut zip, RQBIT_DIR_PREFIX, &state.rqbit_persistence_dir)?;

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Join zip-relative path segments under `root`, rejecting `..`, absolute, and prefix components.
fn safe_extract_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = relative.replace('\\', "/");
    if relative.is_empty() || relative.starts_with('/') {
        return Err(format!("unsafe zip entry path: {relative}"));
    }
    let mut out = root.to_path_buf();
    for component in Path::new(&relative).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(format!("unsafe zip entry path: {relative}"));
            }
        }
    }
    Ok(out)
}

fn extract_zip_entry(
    archive: &mut ZipArchive<File>,
    i: usize,
    config_dir: &Path,
    cache_dir: &Path,
) -> Result<(), String> {
    let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
    let name = file.name().to_string();
    let Some(out) = zip_output_path(&name, config_dir, cache_dir)? else {
        return Ok(());
    };
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    fs::write(&out, buf).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn import_configuration_bundle(
    state: &AppState,
    src_zip: &Path,
    config_dir: &Path,
    cache_dir: &Path,
) -> Result<(), String> {
    let file = File::open(src_zip).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        extract_zip_entry(&mut archive, i, config_dir, cache_dir)?;
    }
    // Reload in-memory maps for immediate UI consistency (session DB still needs restart).
    let loaded = crate::settings::load_settings(&state.settings_path).map_err(|e| {
        format!("imported settings.json could not be parsed (file was written): {e}")
    })?;
    let new_root = loaded.resolved_download_dir_with_fallback(&state.default_download_dir);
    std::fs::create_dir_all(&new_root).map_err(|e| e.to_string())?;
    *state.download_root.write() = new_root;
    *state.settings.write() = loaded;
    *state.watch_processed.write() =
        crate::watch_folder::load_processed_keys(&state.watch_processed_path);
    *state.seeding_started.write() =
        crate::seeding_rules::load_seeding_started(&state.seeding_started_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;

    use parking_lot::RwLock;

    use crate::sequential::SequentialStreams;
    use crate::settings::NexttorrentSettings;
    use crate::state::AppState;

    fn test_state(base: &Path) -> AppState {
        let config_dir = base.join("config");
        let cache_dir = base.join("cache");
        let download = base.join("downloads");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::create_dir_all(&cache_dir).unwrap();
        std::fs::create_dir_all(&download).unwrap();

        let settings_path = config_dir.join("settings.json");
        let settings = NexttorrentSettings {
            theme: "backup-roundtrip".into(),
            ..Default::default()
        };
        crate::settings::save_settings(&settings_path, &settings).unwrap();

        let rqbit_persistence_dir = cache_dir.join("rqbit-session");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let session = rt
            .block_on(crate::engine::create_session(
                download.clone(),
                rqbit_persistence_dir.clone(),
                &settings,
            ))
            .unwrap();

        AppState {
            api: Arc::new(librqbit::Api::new(session.clone(), None)),
            session,
            settings: Arc::new(RwLock::new(settings)),
            settings_path,
            rqbit_persistence_dir,
            default_download_dir: download.clone(),
            download_root: Arc::new(RwLock::new(download)),
            http_client: reqwest::Client::new(),
            watch_processed_path: config_dir.join("watch_processed.json"),
            watch_processed: Arc::new(RwLock::new(HashSet::new())),
            sequential_streams: Arc::new(SequentialStreams::new()),
            seeding_started_path: config_dir.join("seeding_started.json"),
            seeding_started: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    #[test]
    fn safe_extract_path_rejects_traversal() {
        let root = PathBuf::from("C:/safe/root");
        assert!(safe_extract_path(&root, "../outside").is_err());
        assert!(safe_extract_path(&root, "/abs").is_err());
        assert!(safe_extract_path(&root, "ok/nested").is_ok());
    }

    #[test]
    fn export_import_roundtrip_restores_settings() {
        let tmp =
            std::env::temp_dir().join(format!("nexttorrent-backup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let state = test_state(&tmp);
        let zip_path = tmp.join("bundle.zip");
        export_configuration_bundle(&state, &zip_path).unwrap();

        let overwritten = NexttorrentSettings {
            theme: "overwritten".into(),
            ..Default::default()
        };
        crate::settings::save_settings(&state.settings_path, &overwritten).unwrap();

        let config_dir = tmp.join("config");
        let cache_dir = tmp.join("cache");
        import_configuration_bundle(&state, &zip_path, &config_dir, &cache_dir).unwrap();

        assert_eq!(state.settings.read().theme, "backup-roundtrip");
        let on_disk = crate::settings::load_settings(&state.settings_path).unwrap();
        assert_eq!(on_disk.theme, "backup-roundtrip");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn zip_output_path_rejects_traversal() {
        let tmp = std::env::temp_dir().join(format!("nexttorrent-zip-trav-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let config = tmp.join("config");
        let cache = tmp.join("cache");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&cache).unwrap();

        let err = zip_output_path("rqbit-session/../evil.txt", &config, &cache).unwrap_err();
        assert!(err.contains("unsafe zip entry path"), "{err}");
        let err =
            zip_output_path("rqbit-session/foo/../../../outside", &config, &cache).unwrap_err();
        assert!(err.contains("unsafe zip entry path"), "{err}");

        let ok = zip_output_path("rqbit-session/session.json", &config, &cache)
            .unwrap()
            .unwrap();
        assert!(ok.starts_with(cache.join("rqbit-session")));
        let settings = zip_output_path("settings.json", &config, &cache)
            .unwrap()
            .unwrap();
        assert_eq!(settings, config.join("settings.json"));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
