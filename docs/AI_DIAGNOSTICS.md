# AI diagnostics (Nexttorrent)

Local, machine-parseable observability for fixing bugs with an AI assistant. **Nothing is sent to the cloud.**

## Read this first

1. Open **`ai-brief.json`** in the app config directory (or from an exported zip).
2. Inspect **`recentErrors`** — each item has stable `event`, `component`, `corr`, and `fields`.
3. Match `corr=` in **`nexttorrent-events.jsonl`** for surrounding context.
4. Propose a **minimal fix** in the cited component. Do not add remote telemetry.

## How to get the files

| Action                        | Result                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| **View logs → Copy AI brief** | Clipboard = pretty-printed `ai-brief.json` (also refreshed on disk) |
| **View logs → Export for AI** | Zip: brief + JSONL + human logs + `README-FOR-AI.md`                |
| **Open logs folder**          | Reveal config dir in the file manager                               |

Windows config dir is typically under `%APPDATA%\com.nexttorrent.desktop` (or the packaged app identifier).

## Files

| File                       | Purpose                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `ai-brief.json`            | Compact snapshot: app version, paths, recent errors/events, sanitized settings |
| `nexttorrent-events.jsonl` | Append-only structured events (schema `v: 1`)                                  |
| `nexttorrent.log`          | Human session log                                                              |
| `nexttorrent-diag.log`     | Human failure lines (`! command — message`)                                    |

## Event schema (v1)

```json
{
  "v": 1,
  "ts": "2026-07-26T21:05:37.118Z",
  "level": "error",
  "component": "updater_http",
  "event": "feed_fetch_failed",
  "corr": "a1b2c3d4",
  "msg": "…",
  "fields": { "url": "…" },
  "appVersion": "1.2.0"
}
```

Stable `event` codes include: `ipc_command_failed`, `feed_fetch_failed`, `download_failed`, `signature_failed`, `installer_launch_failed`, `rss_loop_failed`, `rss_feed_error`, `watch_loop_failed`, `fatal_startup`, `panic`, `ipc_invoke_failed`.

## Privacy

Exports redact SOCKS proxy passwords and omit RSS API keys (`hasApiKey` only). Still treat diagnostics as potentially sensitive (paths, feed URLs).
