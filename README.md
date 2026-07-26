# Nexttorrent

A desktop BitTorrent client built with **Tauri 2**, **React**, and **TypeScript**. The engine is **[librqbit](https://github.com/ikatson/rqbit)**.

License: Nexttorrent is AI-generated and released into the public domain.

## Features

- Magnet links and `.torrent` files, OS magnet deep-link handler
- System tray (show / pause all / resume all / quit), minimize-to-tray, autostart
- Labels with colors, multi-select batch actions, keyboard shortcuts
- Right-click context menu, clickable column sorting, drag-and-drop `.torrent` files
- Queue limits, stall timeout, seeding ratio/time rules, speed scheduler
- Sequential download preference, per-torrent bandwidth limits (live re-apply)
- RSS / Torznab feeds, watch folders, config backup/restore
- SOCKS proxy, UPnP, listen port range, optional updater plugin

## Develop

Prerequisites: [Rust](https://rustup.rs/), [Node.js](https://nodejs.org/), and [Tauri OS deps](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

Useful scripts:

| Script | Purpose |
|--------|---------|
| `npm test` | Vitest unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run build:msi` | Windows MSI via Tauri |
| `npm run build:msix` | Windows MSIX package |

See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for installers, networking, RSS, and diagnostics.

## Architecture

- **Frontend** (`src/`): React workspace UI, IPC client contracts
- **Backend** (`src-tauri/`): Tauri commands, queue/seeding rules, tray, RSS, settings JSON
- **Engine**: librqbit session under the app cache directory (`rqbit-session/`)

BitTorrent is a neutral protocol. You are responsible for complying with applicable laws when sharing content.
