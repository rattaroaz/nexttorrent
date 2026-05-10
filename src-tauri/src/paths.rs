//! Sandbox-aware path resolution and traversal-safe joins under a download root.

use std::path::{Component, Path, PathBuf};

use tauri::path::BaseDirectory;
use tauri::Manager;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PathError {
    #[error("could not resolve a writable download directory")]
    DownloadDirUnavailable,
    #[error("absolute paths are not allowed for torrent-relative paths")]
    AbsoluteNotAllowed,
    #[error("path escapes the download directory")]
    PathTraversal,
    #[error("invalid UTF-8 in path")]
    NonUtf8,
}

/// Application directories derived from the OS and Tauri’s path resolver.
pub struct AppPaths {
    pub download_dir: PathBuf,
    pub config_dir: PathBuf,
    pub cache_dir: PathBuf,
}

/// Resolve default download directory: OS “Downloads” when available, else a subfolder of the home directory.
pub fn default_download_dir() -> Result<PathBuf, PathError> {
    if let Some(dir) = dirs::download_dir() {
        return Ok(dir);
    }
    dirs::home_dir()
        .map(|h| h.join("Downloads"))
        .filter(|p| {
            if let Some(parent) = p.parent() {
                parent.exists()
            } else {
                false
            }
        })
        .ok_or(PathError::DownloadDirUnavailable)
}

pub fn app_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<AppPaths, PathError> {
    let resolver = app.path();

    let download_dir = resolver
        .resolve("", BaseDirectory::Download)
        .or_else(|_| default_download_dir())?;

    let config_dir = resolver
        .resolve("", BaseDirectory::AppConfig)
        .map_err(|_| PathError::DownloadDirUnavailable)?;

    let cache_dir = resolver
        .resolve("", BaseDirectory::AppCache)
        .map_err(|_| PathError::DownloadDirUnavailable)?;

    Ok(AppPaths {
        download_dir,
        config_dir,
        cache_dir,
    })
}

/// Join a user-provided relative path under `root` without allowing `..` or absolute segments.
pub fn safe_join_under(root: &Path, user_relative: &str) -> Result<PathBuf, PathError> {
    let root = root
        .canonicalize()
        .map_err(|_| PathError::DownloadDirUnavailable)?;
    let relative = Path::new(user_relative);

    if relative.is_absolute() {
        return Err(PathError::AbsoluteNotAllowed);
    }

    let mut out = root.clone();
    for component in relative.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir => return Err(PathError::PathTraversal),
            Component::Prefix(_) | Component::RootDir => return Err(PathError::AbsoluteNotAllowed),
        }
    }

    let joined = out.canonicalize().unwrap_or(out);

    if !joined.starts_with(&root) {
        return Err(PathError::PathTraversal);
    }

    Ok(joined)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_parent_dir_escape() {
        let tmp = std::env::temp_dir().join("nexttorrent-path-test");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let root = tmp.canonicalize().unwrap();

        let err = safe_join_under(&root, "../outside").unwrap_err();
        assert!(matches!(
            err,
            PathError::PathTraversal | PathError::AbsoluteNotAllowed
        ));
    }

    #[test]
    fn allows_nested_folder_under_root() {
        let tmp = std::env::temp_dir().join("nexttorrent-path-test-nested");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let root = tmp.canonicalize().unwrap();

        let got = safe_join_under(&root, "movies/sub").unwrap();
        assert!(got.starts_with(&root));
    }
}
