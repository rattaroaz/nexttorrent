//! Command-line arguments for magnets, torrent files, and `--add` targets.

use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct LaunchAddRequest {
    pub magnets: Vec<String>,
    pub torrent_files: Vec<String>,
    pub paused: bool,
}

fn is_torrent_path(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    if !(lower.ends_with(".torrent") || Path::new(s).extension().is_some_and(|e| e == "torrent")) {
        return false;
    }
    Path::new(s).is_file()
}

fn push_add_target(target: &str, req: &mut LaunchAddRequest) {
    let t = target.trim();
    if t.is_empty() {
        return;
    }
    if t.starts_with("magnet:") {
        req.magnets.push(t.to_string());
    } else if is_torrent_path(t) {
        req.torrent_files.push(t.to_string());
    }
}

/// Parse process args (including `--add`, `-a`, `--paused`, bare magnets and `.torrent` paths).
pub fn parse_launch_args(args: &[String]) -> LaunchAddRequest {
    let mut req = LaunchAddRequest::default();
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "--add" || a == "-a" {
            if let Some(next) = args.get(i + 1) {
                push_add_target(next, &mut req);
                i += 2;
                continue;
            }
        } else if a == "--paused" || a == "-p" {
            req.paused = true;
        } else if a.starts_with("magnet:") {
            req.magnets.push(args[i].clone());
        } else if is_torrent_path(a) {
            req.torrent_files.push(args[i].clone());
        }
        i += 1;
    }
    req
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_add_flag_and_paused() {
        let args = vec![
            "nexttorrent.exe".into(),
            "--add".into(),
            "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            "--paused".into(),
        ];
        let req = parse_launch_args(&args);
        assert_eq!(req.magnets.len(), 1);
        assert!(req.paused);
    }
}
