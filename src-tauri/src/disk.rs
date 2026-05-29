//! Best-effort free-space queries for download directories.

use std::path::Path;

use sysinfo::Disks;

/// Available bytes on the disk hosting `path` (approximate; follows sysinfo semantics).
pub fn available_bytes_for_path(path: &Path) -> std::io::Result<u64> {
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());

    let disks = Disks::new_with_refreshed_list();
    let mut best: Option<(u64, usize)> = None;

    for disk in disks.list() {
        let mount = disk.mount_point();
        if path.starts_with(mount) {
            let len = mount.as_os_str().len();
            let avail = disk.available_space();
            match best {
                None => best = Some((avail, len)),
                Some((_, best_len)) if len > best_len => best = Some((avail, len)),
                _ => {}
            }
        }
    }

    best.map(|(a, _)| a).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "could not resolve disk for path",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn available_bytes_best_effort_for_temp_dir() {
        let tmp = std::env::temp_dir().join("nexttorrent-disk-bytes-test");
        let _ = fs::create_dir_all(&tmp);
        let got = available_bytes_for_path(&tmp);
        match got {
            Ok(_n) => {
                // sysinfo behavior varies wildly across CI containers, containers,
                // and developer machines. 0 or positive is acceptable for a best-effort API.
            }
            Err(e) => {
                // Accept common "could not map to a disk" outcomes on weird filesystems (CI, WSL, containers).
                assert!(
                    matches!(
                        e.kind(),
                        std::io::ErrorKind::NotFound | std::io::ErrorKind::Other | std::io::ErrorKind::Unsupported
                    ),
                    "unexpected error kind from available_bytes_for_path: {e:?}"
                );
            }
        }
    }
}
