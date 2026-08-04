# Nexttorrent user guide

## Install & run

1. Install **Rust** (stable), **Node.js**, and system WebView dependencies for your OS (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).
2. From the repository root:
   - `npm install`
   - `npm run tauri dev` — runs the desktop app with hot reload.

Release installers are produced by `npm run tauri build` (see `src-tauri/tauri.conf.json` bundle settings).

### MSI installer (Windows, WiX)

Tauri builds a **`.msi`** using the [WiX Toolset v3](https://wixtoolset.org/docs/wix3/). On a Windows machine:

1. Install WiX v3 so **`candle`** and **`light`** are on your `PATH` (Visual Studio “WiX Toolset” component, or the standalone WiX installer).
2. From the repo root: **`npm run build:msi`** (same as `npm run tauri build`; runs the frontend `beforeBuildCommand`, then bundles).

Output: **`src-tauri/target/release/bundle/msi/`** — look for `Nexttorrent_1.2.0_x64_en-US.msi` (exact filename follows version and locale from `tauri.conf.json`). An NSIS setup `.exe` may appear under `bundle/nsis/` when `bundle.targets` includes it (`all` does).

MSI builds **only run on Windows**; they cannot be produced on Linux/macOS hosts without a Windows toolchain.

### MSIX (Windows)

Microsoft Store–style packages use [@choochmeque/tauri-windows-bundle](https://www.npmjs.com/package/@choochmeque/tauri-windows-bundle):

1. Install prerequisites: **Rust**, **Node**, **`cargo install msixbundle-cli`** (add `%USERPROFILE%\.cargo\bin` to PATH if needed).
2. From the repo root: `npm run build:msix` (same as `npm run tauri:windows:build`).
3. Packages appear under `src-tauri/target/msix/` (for example `Nexttorrent_x64.msix`).

If your clone lives under a path **with spaces**, `scripts/msix-build.ps1` maps the folder to a spare drive letter via `SUBST` before invoking the packager (otherwise `msixbundle-cli` may split paths incorrectly).

For Microsoft Store or sideloading, sign the package and align **publisher** in `src-tauri/gen/windows/bundle.config.json` and `tauri.conf.json` (`bundle.publisher`) with your certificate subject (replace `CN=Nexttorrent` when you have real signing certs).

## Ports & networking

- **Listen range**: Configure **Listen port range** in Settings (defaults 6881–6891). Firewall rules must allow inbound TCP on the chosen port for best peer connectivity.
- **UPnP**: Optional automatic port mapping on supported routers.
- **SOCKS proxy**: Set **SOCKS5 proxy URL** for tracker and peer traffic when supported by the underlying engine (restart may be required).

## VPN / binding

Binding to a specific VPN interface is **not exposed as a first-class UI toggle** in this build; use OS routing tables or VPN clients that force traffic through the tunnel. SOCKS proxy settings can help steer BitTorrent traffic when your VPN provides a local SOCKS endpoint.

## RSS & watch folders

- **RSS**: Add feeds under Settings → RSS feeds. Enable **Auto add** for periodic background polling (~15 minutes). Use **Poll RSS** on the toolbar for an immediate fetch. Items must expose `magnet:` links in the description or link field.
- **Watch folders**: Enter absolute paths (one per line). The client scans every ~2 minutes for new `.torrent` files and adds them once per canonical path.

## Queue & scheduler

- **Max active downloads** & **Stalled timeout** are enforced in the app layer (pause torrents when limits are exceeded or download speed stays near zero).
- **Max active uploads** is enforced for finished (seeding) torrents when set.
- **Speed scheduler**: One configurable daily window (local time) overrides global bandwidth caps while active.
- **Sequential download**: When enabled in Settings, new torrents attach a librqbit streaming handle on the largest included file to bias piece picking toward the file start.

## Magnet links, files & clipboard

- **OS magnet handler**: After install, Nexttorrent registers for `magnet:` links (deep link). Clicking a magnet in the browser opens or focuses Nexttorrent and adds the torrent.
- **Clipboard on startup**: If the clipboard contains a `magnet:?` URI when the app launches, you are prompted to add it.
- **Drag and drop**: Drop one or more `.torrent` files onto the main window to add them.
- **List UX**: Click column headers to sort (click again to reverse). Right-click a row for pause/resume, open folder, copy hash/name, or remove.
- **Per-torrent speed limits**: Set under the detail pane. Limits are saved and re-applied to the running torrent when metadata is available (brief reconnect; completed pieces stay on disk).

## Tray & autostart

- **System tray**: A tray icon is always available with **Show**, **Pause all**, **Resume all**, and **Quit**.
- **Minimize to tray**: When enabled, closing the window hides it instead of quitting; use the tray menu or **Quit** in the toolbar to exit fully.
- **Start at login**: Uses the Tauri autostart plugin; OS prompts may appear depending on platform policies.

## Updates

Updates are **manual only** (never checked on startup). Use **Settings → Check for updates…**.

The app fetches a signed `latest.json` from the configured GitHub Releases endpoint, compares versions with a strict semver guard, downloads the signed installer, installs in passive mode on Windows, then relaunches via `tauri-plugin-process`.

Configure `plugins.updater.pubkey` and `endpoints` in `src-tauri/tauri.conf.json` (see `docs/CODE_SIGNING.md` and `updaterdocs.txt`). If no release feed exists yet, the dialog explains that setup is incomplete instead of showing a raw 404.

## Logs & diagnostics

Nexttorrent keeps several log surfaces for troubleshooting:

| Location                                             | Purpose                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Logs** side panel / **Activity** tab               | UI session messages plus live backend trace lines                               |
| **`nexttorrent.log`** (config dir)                   | Persistent INFO/WARN/ERROR session log (batched writes; timestamps)             |
| **`nexttorrent-diag.log`** (config dir)              | Command failures and fatal startup errors                                       |
| **`ai-brief.json`** / **`nexttorrent-events.jsonl`** | AI-oriented structured diagnostics (see [AI_DIAGNOSTICS.md](AI_DIAGNOSTICS.md)) |

Default Rust filter is `info,librqbit=warn,librqbit_core=warn` so engine chatter stays out of the activity log. Override with the `RUST_LOG` environment variable (for example `RUST_LOG=librqbit=debug`).

On Windows the config directory is typically under `%APPDATA%` for the app identifier. Use **Settings → Open logs folder…** or **Logs → Open folder** to reveal it in the file manager.

**For AI / support:** use **View logs → Copy AI brief** or **Export for AI**. Agents should read `ai-brief.json` first, then match `corr` in `nexttorrent-events.jsonl`. Use **Export backup** in Settings for a full settings + session archive (not a log bundle).
