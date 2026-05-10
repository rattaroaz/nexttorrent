//! Rotating append-only diagnostic file next to `settings.json` (support / debugging).

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

/// After this size the log is truncated (single segment; avoids unbounded growth).
const MAX_BYTES: u64 = 512 * 1024;

/// Append one line: timestamp, level symbol, context, message.
pub fn append_failure(config_parent: &Path, command: &str, message: &str) -> std::io::Result<()> {
    let path = config_parent.join("nexttorrent-diag.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let _ = std::fs::remove_file(&path);
        }
    }
    let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
    let ts = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
    writeln!(f, "{ts} ! {command} — {}", message.replace('\n', " "))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn append_failure_writes_line() {
        let tmp = std::env::temp_dir().join("nexttorrent-diag-append-test");
        let _ = fs::create_dir_all(&tmp);
        let path = tmp.join("nexttorrent-diag.log");
        let _ = fs::remove_file(&path);
        append_failure(&tmp, "unit_cmd", "bad thing").unwrap();
        let s = fs::read_to_string(&path).unwrap();
        assert!(s.contains("unit_cmd"));
        assert!(s.contains("bad thing"));
    }
}
