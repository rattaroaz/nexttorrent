//! RSS / Torznab fetch, filtering, and magnet discovery.

use std::collections::HashSet;
use std::sync::OnceLock;

use regex::Regex;
use reqwest::Client;
use rss::Channel;

use crate::settings::{RssFeedEntry, RssFeedKind};

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

#[derive(Debug, Clone)]
pub struct FeedMatch {
    #[allow(dead_code)]
    pub id: String,
    #[allow(dead_code)]
    pub title: String,
    #[allow(dead_code)]
    pub category: Option<String>,
    pub magnets: Vec<String>,
    pub output_folder: Option<String>,
}

fn compile_opt_regex(pat: &Option<String>) -> Option<Regex> {
    pat.as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .and_then(|s| Regex::new(s).ok())
}

fn quality_keywords(filter: &Option<String>) -> Vec<String> {
    filter
        .as_ref()
        .map(|s| {
            s.split(',')
                .map(|p| p.trim().to_ascii_lowercase())
                .filter(|p| !p.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

pub fn item_passes_filters(feed: &RssFeedEntry, title: &str, category: Option<&str>) -> bool {
    let title_lc = title.to_ascii_lowercase();
    if let Some(re) = compile_opt_regex(&feed.title_regex) {
        if !re.is_match(title) {
            return false;
        }
    }
    if let Some(re) = compile_opt_regex(&feed.exclude_regex) {
        if re.is_match(title) {
            return false;
        }
    }
    for kw in quality_keywords(&feed.quality_filter) {
        if !title_lc.contains(&kw) {
            return false;
        }
    }
    let _ = category;
    true
}

pub fn resolve_output_folder(feed: &RssFeedEntry, category: Option<&str>) -> Option<String> {
    if let Some(cat) = category {
        let key = cat.trim().to_ascii_lowercase();
        if let Some(path) = feed.category_save_paths.get(&key) {
            if !path.trim().is_empty() {
                return Some(path.trim().to_string());
            }
        }
    }
    feed.default_save_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn torznab_request_url(feed: &RssFeedEntry) -> String {
    let base = feed.url.trim();
    if feed.kind != RssFeedKind::Torznab {
        return base.to_string();
    }
    let mut url = base.to_string();
    let mut sep = if base.contains('?') { '&' } else { '?' };
    if !base.contains("t=") {
        url.push(sep);
        url.push_str("t=search");
        sep = '&';
    }
    if let Some(key) = feed
        .api_key
        .as_ref()
        .map(|k| k.trim())
        .filter(|k| !k.is_empty())
    {
        if !base.contains("apikey=") {
            url.push(sep);
            url.push_str("apikey=");
            url.push_str(key);
        }
    }
    url
}

fn item_category(item: &rss::Item) -> Option<String> {
    item.categories().first().map(|c| c.name().to_string())
}

fn item_id(item: &rss::Item) -> String {
    item.guid()
        .map(|g| g.value().to_string())
        .or_else(|| {
            item.link()
                .map(|l| l.to_string())
                .and_then(|l| item.title().map(|t| format!("{t}|{l}")))
        })
        .unwrap_or_else(|| item.title().unwrap_or("").to_string())
}

fn magnets_from_item(item: &rss::Item) -> Vec<String> {
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
        blob.push('\n');
    }
    if let Some(enclosure) = item.enclosure() {
        let u = enclosure.url();
        if u.starts_with("magnet:") {
            blob.push_str(u);
            blob.push('\n');
        }
    }
    extract_magnets_from_text(&blob)
}

/// Returns new feed matches not previously recorded in `last_seen_ids`.
pub async fn fetch_new_matches(
    client: &Client,
    feed: &RssFeedEntry,
) -> Result<(Vec<FeedMatch>, Vec<String>), String> {
    let url = torznab_request_url(feed);
    let body = client
        .get(&url)
        .header("User-Agent", "Nexttorrent/0.1 (rss)")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let channel = Channel::read_from(&body[..]).map_err(|e| e.to_string())?;
    let mut matches = Vec::new();
    let mut new_ids = Vec::new();
    let known: HashSet<String> = feed.last_seen_ids.iter().cloned().collect();

    for item in channel.items() {
        let id = item_id(item);
        if known.contains(&id) {
            continue;
        }

        let title = item.title().unwrap_or("").to_string();
        let category = item_category(item);
        if !item_passes_filters(feed, &title, category.as_deref()) {
            continue;
        }

        let magnets = magnets_from_item(item);
        if magnets.is_empty() {
            continue;
        }

        new_ids.push(id.clone());
        matches.push(FeedMatch {
            id,
            title,
            category: category.clone(),
            magnets,
            output_folder: resolve_output_folder(feed, category.as_deref()),
        });
    }

    Ok((matches, new_ids))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::RssFeedKind;

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
    fn quality_filter_requires_all_keywords() {
        let feed = RssFeedEntry {
            id: "1".into(),
            url: "http://x".into(),
            name: None,
            kind: RssFeedKind::Rss,
            api_key: None,
            enabled: true,
            auto_add: false,
            last_seen_ids: vec![],
            title_regex: None,
            exclude_regex: None,
            quality_filter: Some("1080p,WEB-DL".into()),
            category_save_paths: Default::default(),
            default_save_path: None,
        };
        assert!(item_passes_filters(&feed, "Movie 1080p WEB-DL x264", None));
        assert!(!item_passes_filters(&feed, "Movie 720p WEB-DL", None));
    }

    #[test]
    fn category_save_path_maps_case_insensitive() {
        let mut paths = std::collections::HashMap::new();
        paths.insert("movies".into(), "D:\\Movies".into());
        let feed = RssFeedEntry {
            id: "1".into(),
            url: "http://x".into(),
            name: None,
            kind: RssFeedKind::Rss,
            api_key: None,
            enabled: true,
            auto_add: false,
            last_seen_ids: vec![],
            title_regex: None,
            exclude_regex: None,
            quality_filter: None,
            category_save_paths: paths,
            default_save_path: None,
        };
        assert_eq!(
            resolve_output_folder(&feed, Some("Movies")),
            Some("D:\\Movies".into())
        );
    }
}
