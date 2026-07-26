//! Export / import Nexttorrent configuration (settings + librqbit session state).

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use walkdir::WalkDir;
use zip::read::ZipArchive;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::state::AppState;

const SETTINGS_ENTRY: &str = "settings.json";
const WATCH_PROCESSED_ENTRY: &str = "watch_processed.json";
const SEEDING_STARTED_ENTRY: &str = "seeding_started.json";
const RQBIT_DIR_PREFIX: &str = "rqbit-session/";

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

fn extract_zip_entry(
    archive: &mut ZipArchive<File>,
    i: usize,
    config_dir: &Path,
    cache_dir: &Path,
) -> Result<(), String> {
    let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
    let name = file.name().to_string();
    if name.ends_with('/') {
        return Ok(());
    }
    let out: PathBuf =
        if name == SETTINGS_ENTRY || name == WATCH_PROCESSED_ENTRY || name == SEEDING_STARTED_ENTRY
        {
            config_dir.join(name)
        } else if let Some(rel) = name.strip_prefix(RQBIT_DIR_PREFIX) {
            cache_dir.join("rqbit-session").join(rel)
        } else {
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
    // Reload in-memory settings for immediate UI consistency (session still needs restart).
    let loaded = crate::settings::load_settings(&state.settings_path)
        .unwrap_or_else(|_| crate::settings::NexttorrentSettings::default());
    *state.settings.write() = loaded;
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
        let mut settings = NexttorrentSettings::default();
        settings.theme = "backup-roundtrip".into();
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
            download_root: download,
            http_client: reqwest::Client::new(),
            watch_processed_path: config_dir.join("watch_processed.json"),
            watch_processed: Arc::new(RwLock::new(HashSet::new())),
            sequential_streams: Arc::new(SequentialStreams::new()),
            seeding_started_path: config_dir.join("seeding_started.json"),
            seeding_started: Arc::new(RwLock::new(HashMap::new())),
        }
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

        let mut overwritten = NexttorrentSettings::default();
        overwritten.theme = "overwritten".into();
        crate::settings::save_settings(&state.settings_path, &overwritten).unwrap();

        let config_dir = tmp.join("config");
        let cache_dir = tmp.join("cache");
        import_configuration_bundle(&state, &zip_path, &config_dir, &cache_dir).unwrap();

        assert_eq!(state.settings.read().theme, "backup-roundtrip");
        let on_disk = crate::settings::load_settings(&state.settings_path).unwrap();
        assert_eq!(on_disk.theme, "backup-roundtrip");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
