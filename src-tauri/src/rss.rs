//! Minimal RSS fetch + magnet link discovery for automatic downloads.

use std::collections::HashSet;
use std::sync::OnceLock;

use regex::Regex;
use reqwest::Client;

use crate::settings::RssFeedEntry;

fn magnet_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"magnet:\?[^\s<>\x00]+").expect("valid regex"))
}

pub(crate) fn extract_magnets_from_text(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    for m in magnet_regex().find_iter(s) {
        let t = m.as_str().trim_end_matches(')').trim_end_matches('"');
        if t.len() > 8 {
            out.push(t.to_string());
        }
    }
    out
}

/// Returns new magnet links from a feed that were not previously recorded in `last_seen_ids`.
pub async fn fetch_new_magnets(
    client: &Client,
    feed: &RssFeedEntry,
) -> Result<(Vec<String>, Vec<String>), String> {
    let body = client
        .get(&feed.url)
        .header("User-Agent", "Nexttorrent/0.1 (rss)")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let channel = rss::Channel::read_from(&body[..]).map_err(|e| e.to_string())?;
    let mut new_magnets = Vec::new();
    let mut new_ids = Vec::new();
    let known: HashSet<String> = feed.last_seen_ids.iter().cloned().collect();

    for item in channel.items() {
        let id = item
            .guid()
            .map(|g| g.value().to_string())
            .or_else(|| {
                item.link()
                    .map(|l| l.to_string())
                    .and_then(|l| item.title().map(|t| format!("{t}|{l}")))
            })
            .unwrap_or_else(|| item.title().unwrap_or("").to_string());

        if known.contains(&id) {
            continue;
        }

        let mut blob = String::new();
        if let Some(l) = item.link() {
            blob.push_str(l);
            blob.push('\n');
        }
        if let Some(d) = item.description() {
            blob.push_str(d);
            blob.push('\n');
        }
        if let Some(e) = item.content() {
            blob.push_str(e);
        }

        let magnets = extract_magnets_from_text(&blob);
        if magnets.is_empty() {
            continue;
        }
        new_ids.push(id);
        new_magnets.extend(magnets);
    }

    Ok((new_magnets, new_ids))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_magnets_finds_btih_link() {
        let blob =
            r#"desc <a href="magnet:?xt=urn:btih:cab507494d02ebb1178b38f2e9d7be299c86b862">x</a>"#;
        let m = extract_magnets_from_text(blob);
        assert_eq!(
            m[0],
            "magnet:?xt=urn:btih:cab507494d02ebb1178b38f2e9d7be299c86b862"
        );
    }

    #[test]
    fn parses_inline_rss_fixture() {
        let xml = br#"<?xml version="1.0"?>
<rss version="2.0"><channel><title>t</title>
<item><title>i</title><description>
magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
</description></item>
</channel></rss>"#;
        let channel = rss::Channel::read_from(&xml[..]).expect("parse rss");
        assert_eq!(channel.items().len(), 1);
    }
}
