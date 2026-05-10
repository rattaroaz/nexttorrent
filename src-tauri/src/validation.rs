//! Validate untrusted magnet URIs and torrent payloads before they reach the engine.

use librqbit::torrent_from_bytes;
use librqbit::Magnet;
use librqbit_buffers::ByteBuf;

/// Reject obvious junk and delegate structural validation to librqbit_core.
pub fn validate_magnet_uri(raw: &str) -> Result<(), String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("magnet URI is empty".into());
    }
    const PREFIX: &str = "magnet:?";
    if !s.starts_with(PREFIX) {
        return Err("magnet URI must start with magnet:?".into());
    }
    if s.len() > 16 * 1024 {
        return Err("magnet URI is too long".into());
    }
    Magnet::parse(s)
        .map_err(|e| format!("invalid magnet: {e}"))
        .map(|_| ())
}

/// Ensure `.torrent` bytes decode as metainfo (info dict present).
pub fn validate_torrent_bytes(bytes: &[u8]) -> Result<(), String> {
    const MAX: usize = 32 * 1024 * 1024;
    if bytes.len() > MAX {
        return Err(".torrent payload exceeds maximum size".into());
    }
    if bytes.is_empty() {
        return Err(".torrent payload is empty".into());
    }
    torrent_from_bytes::<ByteBuf>(bytes).map_err(|e| format!("invalid torrent file: {e}"))?;
    Ok(())
}

/// Total transfer length declared by the metainfo (for disk-space checks).
pub fn torrent_total_bytes(bytes: &[u8]) -> Result<u64, String> {
    validate_torrent_bytes(bytes)?;
    let meta =
        torrent_from_bytes::<ByteBuf>(bytes).map_err(|e| format!("invalid torrent file: {e}"))?;
    let lengths = librqbit_core::lengths::Lengths::from_torrent(&meta.info)
        .map_err(|e| format!("invalid torrent file: {e}"))?;
    Ok(lengths.total_length())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_magnet() {
        assert!(validate_magnet_uri("http://example.com").is_err());
    }

    #[test]
    fn accepts_minimal_magnet_with_btih() {
        let m = "magnet:?xt=urn:btih:cab507494d02ebb1178b38f2e9d7be299c86b862";
        validate_magnet_uri(m).expect("valid magnet");
    }

    #[test]
    fn rejects_empty_magnet() {
        assert!(validate_magnet_uri("   ").is_err());
    }

    #[test]
    fn rejects_empty_torrent_bytes() {
        assert!(validate_torrent_bytes(&[]).is_err());
    }

    #[test]
    fn rejects_invalid_bencode_without_large_alloc() {
        assert!(validate_torrent_bytes(b"not-valid-metainfo").is_err());
    }
}
