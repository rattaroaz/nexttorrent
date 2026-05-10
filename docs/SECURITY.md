# Security notes

## Threat model (BitTorrent client)

Nexttorrent accepts **untrusted network input** (peer wire protocol, trackers, DHT, RSS feeds, magnet URIs, and `.torrent` files). It must never execute that content as code and must avoid leaking machine-local paths or crossing filesystem boundaries outside configured download locations.

### Mitigations implemented

- **Magnet validation**: User-supplied magnets are parsed with `librqbit::Magnet::parse` after structural checks (prefix, length cap) before being passed to the engine (`validation.rs`).
- **Torrent file validation**: `.torrent` payloads are size-limited and parsed through `torrent_from_bytes` before being handed to librqbit (`validation.rs`).
- **Path traversal**: Relative paths joined under the OS download directory use `paths::safe_join_under`, which rejects `..` and absolute segments (`paths.rs`, unit tests).
- **Disk space**: Adding `.torrent` files compares declared total length plus a configurable reserve against available space (`torrent_commands.rs`, best-effort OS query via `sysinfo`).
- **RSS / HTTP**: RSS feeds are fetched over HTTPS where possible; HTML/description bodies are only scanned for `magnet:?` links—never evaluated as scripts.

### Residual risks

- **Engine attack surface**: librqbit and its dependencies handle protocol parsing; keep dependencies updated and monitor `RustSec` advisories (`cargo deny`).
- **RSS feeds**: Treat feeds as untrusted HTML/text; malicious entries could reference junk magnets—users should only subscribe to feeds they trust.
- **Full fuzzing** of bencode/magnet parsers is not bundled here; enable optional fuzz targets in CI if you extend custom parsers.
