//! BitTorrent engine integration via **librqbit** ([`librqbit::Session`]).
//! Networking (DHT, PEX, trackers, TCP peers, encryption negotiation, UPnP when enabled, SOCKS proxy)
//! is handled inside librqbit — see repository `ENGINE.md` for the phase mapping.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::Local;
use librqbit::{limits::LimitsConfig, Session, SessionOptions, SessionPersistenceConfig};

use crate::scheduler::effective_rate_limits;
use crate::settings::NexttorrentSettings;

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
        ..Default::default()
    };

    Session::new_with_opts(output_folder, opts).await
}
