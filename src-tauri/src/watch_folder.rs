//! Enumerate `.torrent` paths under configured absolute folders.

use std::path::{Path, PathBuf};

pub fn list_torrent_paths(folders: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for folder in folders {
        let root = Path::new(folder);
        if !root.is_dir() {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("torrent") && path.is_file() {
                out.push(path);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn lists_dot_torrent_in_folder() {
        let tmp = std::env::temp_dir().join("nexttorrent-watch-folder-test");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let mut f = fs::File::create(tmp.join("sample.torrent")).unwrap();
        writeln!(f, "x").unwrap();

        let paths = list_torrent_paths(&[tmp.to_string_lossy().into_owned()]);
        assert_eq!(paths.len(), 1);
        assert!(
            paths[0].to_string_lossy().ends_with("sample.torrent"),
            "{:?}",
            paths[0]
        );
    }

    #[test]
    fn skips_missing_folder_entries() {
        let paths = list_torrent_paths(&["/nonexistent/path/that/should/not/exist".into()]);
        assert!(paths.is_empty());
    }
}
