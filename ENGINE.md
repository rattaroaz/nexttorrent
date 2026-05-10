# BitTorrent engine

Nexttorrent embeds **[librqbit](https://github.com/ikatson/rqbit)** (`librqbit` on crates.io) as the BitTorrent implementation.

## Phase mapping

| Roadmap area | Provided by |
|--------------|-------------|
| Phase 2 — piece picking, disk I/O, magnets, multi-file, priorities (`only_files`) | librqbit session core |
| Phase 3 — TCP peers, trackers (HTTP(S)/UDP), DHT, PEX/LSD where implemented in librqbit, encryption, listen port range, UPnP, SOCKS proxy | librqbit session options (`SessionOptions`) and peer stack |

Application-specific behavior (Tauri IPC, UI, JSON settings file, labels, force-recheck shim) lives under `src-tauri/src/` and `src/`.

## Persistence

- **Nexttorrent settings**: `{config_dir}/settings.json` (theme, limits, optional download dir override, labels).
- **librqbit session state**: `{cache_dir}/rqbit-session/` via `SessionPersistenceConfig::Json`.

## Legal note

BitTorrent is a neutral protocol. You are responsible for complying with applicable laws and licenses when sharing or downloading content.
