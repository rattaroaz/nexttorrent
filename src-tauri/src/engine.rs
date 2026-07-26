//! BitTorrent engine integration via **librqbit** ([`librqbit::Session`]).
//! Networking (DHT, PEX, trackers, TCP peers, encryption negotiation, UPnP when enabled, SOCKS proxy)
//! is handled inside librqbit — see repository `ENGINE.md` for the phase mapping.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use chrono::Local;
use librqbit::{
    limits::LimitsConfig, PeerConnectionOptions, Session, SessionOptions, SessionPersistenceConfig,
};
use url::Url;

use crate::scheduler::effective_rate_limits;
use crate::settings::NexttorrentSettings;

/// Well-known public trackers merged into every torrent's peer source.
/// Magnets with few/no `tr=` params otherwise rely on DHT alone.
pub fn default_public_trackers() -> HashSet<Url> {
    const URLS: &[&str] = &[
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://explodie.org:6969/announce",
        "udp://tracker1.bt.moack.co.kr:80/announce",
        "http://tracker.openbittorrent.com:80/announce",
        "http://tracker.opentrackr.org:1337/announce",
    ];
    URLS.iter()
        .filter_map(|s| Url::parse(s).ok())
        .collect()
}

pub async fn create_session(
    output_folder: PathBuf,
    rqbit_persistence_dir: PathBuf,
    settings: &NexttorrentSettings,
) -> anyhow::Result<Arc<Session>> {
    std::fs::create_dir_all(&output_folder)?;
    std::fs::create_dir_all(&rqbit_persistence_dir)?;

    let (d, u) = effective_rate_limits(settings, Local::now());
    let opts = SessionOptions {
        persistence: Some(SessionPersistenceConfig::Json {
            folder: Some(rqbit_persistence_dir),
        }),
        fastresume: true,
        enable_upnp_port_forwarding: settings.enable_upnp,
        listen_port_range: Some(settings.listen_port_start..settings.listen_port_end),
        socks_proxy_url: settings.socks_proxy.clone(),
        ratelimits: LimitsConfig {
            download_bps: d,
            upload_bps: u,
        },
        trackers: default_public_trackers(),
        // Fail dead DHT peers faster so the dialer can try the next address.
        peer_opts: Some(PeerConnectionOptions {
            connect_timeout: Some(Duration::from_secs(4)),
            ..Default::default()
        }),
        ..Default::default()
    };

    Session::new_with_opts(output_folder, opts).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_public_trackers_parse() {
        let set = default_public_trackers();
        assert!(
            set.len() >= 5,
            "expected several valid tracker URLs, got {}",
            set.len()
        );
        for url in &set {
            assert!(
                matches!(url.scheme(), "udp" | "http" | "https"),
                "unexpected scheme: {url}"
            );
        }
    }
}
