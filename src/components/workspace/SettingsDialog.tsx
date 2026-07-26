import type {
  NexttorrentSettings,
  NetworkInterfaceInfo,
  RssFeedEntry,
} from "../../ipc/contracts";
import {
  categoryPathsToText,
  defaultRssFeed,
  textToCategoryPaths,
} from "./shared";

function ensureSchedulerSlot(d: NexttorrentSettings): NexttorrentSettings {
  const slots = [...(d.speedScheduler.slots ?? [])];
  if (slots.length === 0) {
    slots.push({
      startHour: 22,
      endHour: 6,
      downloadLimitBps: null,
      uploadLimitBps: null,
    });
  }
  return {
    ...d,
    speedScheduler: { ...d.speedScheduler, slots },
  };
}

type Props = {
  settingsDraft: NexttorrentSettings;
  onSettingsDraftChange: (draft: NexttorrentSettings) => void;
  networkInterfaces: NetworkInterfaceInfo[];
  onSave: () => void;
  onCancel: () => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  onCheckForUpdates: () => void;
  onOpenLogsFolder: () => void;
};

export function SettingsDialog({
  settingsDraft,
  onSettingsDraftChange,
  networkInterfaces,
  onSave,
  onCancel,
  onExportBackup,
  onImportBackup,
  onCheckForUpdates,
  onOpenLogsFolder,
}: Props) {
  const setSettingsDraft = onSettingsDraftChange;

  return (
    <dialog open className="modal wide">
      <h3>Settings</h3>
      <label>
        Download directory override
        <input
          value={settingsDraft.downloadDir ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              downloadDir: e.target.value || null,
            })
          }
        />
      </label>
      <label>
        Global download limit (B/s, blank = unlimited)
        <input
          type="number"
          value={settingsDraft.globalDownLimitBps ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              globalDownLimitBps: e.target.value
                ? Number(e.target.value)
                : null,
            })
          }
        />
      </label>
      <label>
        Global upload limit (B/s)
        <input
          type="number"
          value={settingsDraft.globalUpLimitBps ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              globalUpLimitBps: e.target.value
                ? Number(e.target.value)
                : null,
            })
          }
        />
      </label>
      <label>
        Listen port range
        <input
          type="number"
          value={settingsDraft.listenPortStart}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              listenPortStart: Number(e.target.value),
            })
          }
        />
        <input
          type="number"
          value={settingsDraft.listenPortEnd}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              listenPortEnd: Number(e.target.value),
            })
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={settingsDraft.enableUpnp}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              enableUpnp: e.target.checked,
            })
          }
        />
        Enable UPnP port forwarding
      </label>
      <label>
        SOCKS5 proxy URL
        <input
          value={settingsDraft.socksProxy ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              socksProxy: e.target.value || null,
            })
          }
        />
      </label>
      <label>
        Preferred network interface (VPN)
        <select
          value={settingsDraft.bindInterface ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              bindInterface: e.target.value || null,
            })
          }
        >
          <option value="">System default</option>
          {networkInterfaces.map((n) => (
            <option key={n.name} value={n.name}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        librqbit 8 binds to all interfaces. For VPN-only traffic use a SOCKS5
        proxy from your VPN client, or OS routing rules. The interface preference
        is saved for a future engine upgrade.
      </p>
      <label>
        Theme
        <select
          data-testid="settings-theme-select"
          value={settingsDraft.theme}
          onChange={(e) =>
            setSettingsDraft({ ...settingsDraft, theme: e.target.value })
          }
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={settingsDraft.sequentialDownload}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              sequentialDownload: e.target.checked,
            })
          }
        />
        Prefer sequential download (prioritizes pieces from the start of the
        largest included file)
      </label>
      <label>
        Max active downloads (blank = unlimited)
        <input
          type="number"
          value={settingsDraft.maxActiveDownloads ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              maxActiveDownloads: e.target.value
                ? Number(e.target.value)
                : null,
            })
          }
        />
      </label>
      <label>
        Max active uploads / seeding slots (blank = unlimited)
        <input
          type="number"
          value={settingsDraft.maxActiveUploads ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              maxActiveUploads: e.target.value
                ? Number(e.target.value)
                : null,
            })
          }
        />
      </label>
      <label>
        Stop seeding at share ratio (blank = off, e.g. 1.0)
        <input
          type="number"
          step="0.1"
          min="0"
          value={settingsDraft.seedRatioLimit ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              seedRatioLimit: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </label>
      <label>
        Stop seeding after hours (blank = off)
        <input
          type="number"
          step="0.5"
          min="0"
          value={settingsDraft.seedTimeLimitHours ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              seedTimeLimitHours: e.target.value
                ? Number(e.target.value)
                : null,
            })
          }
        />
      </label>
      <label>
        Stalled timeout (seconds, blank = off)
        <input
          type="number"
          value={settingsDraft.stalledTimeoutSecs ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              stalledTimeoutSecs: e.target.value
                ? Number(e.target.value)
                : null,
            })
          }
        />
      </label>
      <label>
        Reserve disk space (MiB) when adding .torrent files
        <input
          type="number"
          value={settingsDraft.diskSpaceReserveMb ?? ""}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              diskSpaceReserveMb: e.target.value
                ? Number(e.target.value)
                : null,
            })
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={settingsDraft.minimizeToTray}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              minimizeToTray: e.target.checked,
            })
          }
        />
        Minimize to tray on window close (hide); use Quit toolbar to exit
      </label>
      <label>
        <input
          type="checkbox"
          checked={settingsDraft.startAtLogin}
          onChange={(e) =>
            setSettingsDraft({
              ...settingsDraft,
              startAtLogin: e.target.checked,
            })
          }
        />
        Start at login (OS integration via autostart plugin)
      </label>

      <h4 className="settings-section">Speed scheduler</h4>
      <label>
        <input
          type="checkbox"
          checked={settingsDraft.speedScheduler.enabled}
          onChange={(e) => {
            let next = {
              ...settingsDraft,
              speedScheduler: {
                ...settingsDraft.speedScheduler,
                enabled: e.target.checked,
              },
            };
            if (e.target.checked) {
              next = ensureSchedulerSlot(next);
            }
            setSettingsDraft(next);
          }}
        />
        Enable time-of-day limits (first slot below; local time)
      </label>
      {settingsDraft.speedScheduler.enabled &&
        (settingsDraft.speedScheduler.slots[0] ? (
          <div className="scheduler-grid">
            <label>
              Start hour (0–23)
              <input
                type="number"
                min={0}
                max={23}
                value={settingsDraft.speedScheduler.slots[0]!.startHour}
                onChange={(e) => {
                  const slots = [...settingsDraft.speedScheduler.slots];
                  slots[0] = {
                    ...slots[0]!,
                    startHour: Number(e.target.value),
                  };
                  setSettingsDraft({
                    ...settingsDraft,
                    speedScheduler: {
                      ...settingsDraft.speedScheduler,
                      slots,
                    },
                  });
                }}
              />
            </label>
            <label>
              End hour (0–24, exclusive)
              <input
                type="number"
                min={0}
                max={24}
                value={settingsDraft.speedScheduler.slots[0]!.endHour}
                onChange={(e) => {
                  const slots = [...settingsDraft.speedScheduler.slots];
                  slots[0] = {
                    ...slots[0]!,
                    endHour: Number(e.target.value),
                  };
                  setSettingsDraft({
                    ...settingsDraft,
                    speedScheduler: {
                      ...settingsDraft.speedScheduler,
                      slots,
                    },
                  });
                }}
              />
            </label>
            <label>
              Download limit in slot (B/s)
              <input
                type="number"
                value={
                  settingsDraft.speedScheduler.slots[0]!.downloadLimitBps ?? ""
                }
                onChange={(e) => {
                  const slots = [...settingsDraft.speedScheduler.slots];
                  slots[0] = {
                    ...slots[0]!,
                    downloadLimitBps: e.target.value
                      ? Number(e.target.value)
                      : null,
                  };
                  setSettingsDraft({
                    ...settingsDraft,
                    speedScheduler: {
                      ...settingsDraft.speedScheduler,
                      slots,
                    },
                  });
                }}
              />
            </label>
            <label>
              Upload limit in slot (B/s)
              <input
                type="number"
                value={
                  settingsDraft.speedScheduler.slots[0]!.uploadLimitBps ?? ""
                }
                onChange={(e) => {
                  const slots = [...settingsDraft.speedScheduler.slots];
                  slots[0] = {
                    ...slots[0]!,
                    uploadLimitBps: e.target.value
                      ? Number(e.target.value)
                      : null,
                  };
                  setSettingsDraft({
                    ...settingsDraft,
                    speedScheduler: {
                      ...settingsDraft.speedScheduler,
                      slots,
                    },
                  });
                }}
              />
            </label>
          </div>
        ) : null)}

      <h4 className="settings-section">Logs &amp; diagnostics</h4>
      <p className="hint">
        Session log (<code>nexttorrent.log</code>) and failure log (
        <code>nexttorrent-diag.log</code>) live in the app config directory.
        Default filter is <code>info,librqbit=warn</code>; override with{" "}
        <code>RUST_LOG</code>.
      </p>
      <div className="modal-actions">
        <button type="button" onClick={() => void onOpenLogsFolder()}>
          Open logs folder…
        </button>
      </div>

      <h4 className="settings-section">Backup &amp; restore</h4>
      <p className="hint">
        Exports settings.json, watch/seeding state, and the librqbit session
        folder into a zip archive.
      </p>
      <div className="modal-actions">
        <button type="button" onClick={() => void onExportBackup()}>
          Export configuration…
        </button>
        <button type="button" onClick={() => void onImportBackup()}>
          Import configuration…
        </button>
      </div>

      <h4 className="settings-section">Updates</h4>
      <p className="hint">
        Checks GitHub releases for a signed update (MSI/MSIX builds).
      </p>
      <button type="button" onClick={() => void onCheckForUpdates()}>
        Check for updates…
      </button>

      <h4 className="settings-section">RSS feeds</h4>
      <p className="hint">
        RSS 2.0 or Torznab/Jackett feeds. Use title/quality filters and
        category → save-path lines (e.g. <code>movies=D:\Movies</code>). Enable
        “auto add” for background polling (~15 min).
      </p>
      {settingsDraft.rssFeeds.map((feed, idx) => (
        <div key={feed.id} className="rss-feed-card">
          <div className="rss-row">
            <input
              value={feed.name ?? ""}
              onChange={(e) => {
                const rssFeeds = [...settingsDraft.rssFeeds];
                rssFeeds[idx] = {
                  ...feed,
                  name: e.target.value || null,
                };
                setSettingsDraft({ ...settingsDraft, rssFeeds });
              }}
              placeholder="Display name"
            />
            <select
              value={feed.kind ?? "rss"}
              onChange={(e) => {
                const rssFeeds = [...settingsDraft.rssFeeds];
                rssFeeds[idx] = {
                  ...feed,
                  kind: e.target.value as RssFeedEntry["kind"],
                };
                setSettingsDraft({ ...settingsDraft, rssFeeds });
              }}
            >
              <option value="rss">RSS</option>
              <option value="torznab">Torznab</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={feed.enabled}
                onChange={(e) => {
                  const rssFeeds = [...settingsDraft.rssFeeds];
                  rssFeeds[idx] = { ...feed, enabled: e.target.checked };
                  setSettingsDraft({ ...settingsDraft, rssFeeds });
                }}
              />
              On
            </label>
            <label>
              <input
                type="checkbox"
                checked={feed.autoAdd}
                onChange={(e) => {
                  const rssFeeds = [...settingsDraft.rssFeeds];
                  rssFeeds[idx] = { ...feed, autoAdd: e.target.checked };
                  setSettingsDraft({ ...settingsDraft, rssFeeds });
                }}
              />
              Auto add
            </label>
            <button
              type="button"
              onClick={() => {
                const rssFeeds = settingsDraft.rssFeeds.filter(
                  (_, i) => i !== idx,
                );
                setSettingsDraft({ ...settingsDraft, rssFeeds });
              }}
            >
              Remove
            </button>
          </div>
          <input
            className="rss-url"
            value={feed.url}
            onChange={(e) => {
              const rssFeeds = [...settingsDraft.rssFeeds];
              rssFeeds[idx] = { ...feed, url: e.target.value };
              setSettingsDraft({ ...settingsDraft, rssFeeds });
            }}
            placeholder="Feed or Torznab API URL"
          />
          {(feed.kind ?? "rss") === "torznab" ? (
            <input
              value={feed.apiKey ?? ""}
              onChange={(e) => {
                const rssFeeds = [...settingsDraft.rssFeeds];
                rssFeeds[idx] = {
                  ...feed,
                  apiKey: e.target.value || null,
                };
                setSettingsDraft({ ...settingsDraft, rssFeeds });
              }}
              placeholder="Torznab API key"
            />
          ) : null}
          <div className="rss-filters">
            <input
              value={feed.titleRegex ?? ""}
              onChange={(e) => {
                const rssFeeds = [...settingsDraft.rssFeeds];
                rssFeeds[idx] = {
                  ...feed,
                  titleRegex: e.target.value || null,
                };
                setSettingsDraft({ ...settingsDraft, rssFeeds });
              }}
              placeholder="Title regex (optional)"
            />
            <input
              value={feed.excludeRegex ?? ""}
              onChange={(e) => {
                const rssFeeds = [...settingsDraft.rssFeeds];
                rssFeeds[idx] = {
                  ...feed,
                  excludeRegex: e.target.value || null,
                };
                setSettingsDraft({ ...settingsDraft, rssFeeds });
              }}
              placeholder="Exclude regex (optional)"
            />
            <input
              value={feed.qualityFilter ?? ""}
              onChange={(e) => {
                const rssFeeds = [...settingsDraft.rssFeeds];
                rssFeeds[idx] = {
                  ...feed,
                  qualityFilter: e.target.value || null,
                };
                setSettingsDraft({ ...settingsDraft, rssFeeds });
              }}
              placeholder="Quality keywords (1080p, WEB-DL)"
            />
          </div>
          <input
            value={feed.defaultSavePath ?? ""}
            onChange={(e) => {
              const rssFeeds = [...settingsDraft.rssFeeds];
              rssFeeds[idx] = {
                ...feed,
                defaultSavePath: e.target.value || null,
              };
              setSettingsDraft({ ...settingsDraft, rssFeeds });
            }}
            placeholder="Default save path (optional)"
          />
          <textarea
            rows={2}
            value={categoryPathsToText(feed.categorySavePaths)}
            onChange={(e) => {
              const rssFeeds = [...settingsDraft.rssFeeds];
              rssFeeds[idx] = {
                ...feed,
                categorySavePaths: textToCategoryPaths(e.target.value),
              };
              setSettingsDraft({ ...settingsDraft, rssFeeds });
            }}
            placeholder={"Category paths (category=path per line)"}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const id =
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `feed-${Date.now()}`;
          setSettingsDraft({
            ...settingsDraft,
            rssFeeds: [...settingsDraft.rssFeeds, defaultRssFeed(id)],
          });
        }}
      >
        Add RSS feed
      </button>

      <h4 className="settings-section settings-section-spaced">Watch folders</h4>
      <p className="hint">
        Absolute paths, one per line. Scanned every ~2 minutes.
      </p>
      <textarea
        rows={4}
        value={settingsDraft.watchFolders.join("\n")}
        onChange={(e) =>
          setSettingsDraft({
            ...settingsDraft,
            watchFolders: e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
      />

      <p className="hint">
        Listen ports and proxy changes may require restarting the app to take full
        effect in the engine.
      </p>
      <div className="modal-actions">
        <button
          type="button"
          data-testid="settings-save"
          onClick={() => void onSave()}
        >
          Save
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
