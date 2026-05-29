import { useVirtualizer } from "@tanstack/react-virtual";
import { message, open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_NEXTTORRENT_SETTINGS,
  IPC_EVENTS,
  type NexttorrentSettings,
  type TorrentRow,
  type TorrentsUpdatePayload,
} from "../ipc/contracts";
import { normalizeDialogFilePath } from "../ipc/dialogPaths";
import { formatInvokeError } from "../ipc/invokeError";
import {
  getNexttorrentSettings,
  quitApp,
  rssPollFeeds,
  saveNexttorrentSettings,
  torrentAddFile,
  torrentAddMagnet,
  torrentBuildUpdatePayload,
  torrentDetails,
  torrentForceRecheck,
  torrentPause,
  torrentPauseAll,
  torrentPeerStats,
  torrentPieceDump,
  torrentRemove,
  torrentResume,
  torrentUpdateOnlyFiles,
  setTorrentLabel,
  watchPoll,
} from "../ipc/client";
import {
  formatBytes,
  formatBps,
  formatEta,
  ratioString,
} from "../utils/format";
import { RateGraph } from "./RateGraph";

function torrentRef(row: TorrentRow): string {
  if (row.id != null) {
    return String(row.id);
  }
  return row.info_hash;
}

function mbpsToApproxBps(mbps: number): number {
  return mbps * 1024 * 1024;
}

type TabId =
  | "overview"
  | "files"
  | "peers"
  | "trackers"
  | "pieces"
  | "activity";

type SortKey = "name" | "progress" | "size" | "eta";

async function notifyTorrentDone(body: string) {
  try {
    const n = await import("@tauri-apps/plugin-notification");
    let granted = await n.isPermissionGranted();
    if (!granted) {
      granted = (await n.requestPermission()) === "granted";
    }
    if (!granted) {
      return;
    }
    await n.sendNotification({ title: "Torrent finished", body });
  } catch {
    /* optional */
  }
}

export function TorrentWorkspace() {
  const parentRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<TorrentsUpdatePayload | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof torrentDetails>
  > | null>(null);
  const [peerDump, setPeerDump] = useState<Record<string, unknown> | null>(
    null,
  );
  const [pieceDump, setPieceDump] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  /** Offset from centered position while dragging the add-torrent dialog. */
  const [addModalDrag, setAddModalDrag] = useState({ dx: 0, dy: 0 });
  const addModalDragRef = useRef(addModalDrag);
  const addModalPointerDrag = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    originDx: number;
    originDy: number;
  } | null>(null);

  useEffect(() => {
    addModalDragRef.current = addModalDrag;
  }, [addModalDrag]);
  const [settingsDraft, setSettingsDraft] =
    useState<NexttorrentSettings | null>(null);
  const [magnetDraft, setMagnetDraft] = useState("");
  const [addOutputDir, setAddOutputDir] = useState<string | null>(null);
  /** After picking a `.torrent` path, user confirms with "Add to session". */
  const [pendingTorrentPath, setPendingTorrentPath] = useState<string | null>(
    null,
  );
  const [perTorrentLabel, setPerTorrentLabel] = useState("");
  const [labelColorHex, setLabelColorHex] = useState("#60a5fa");
  const [filterQuery, setFilterQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sessionDownHist, setSessionDownHist] = useState<number[]>([]);
  const [sessionUpHist, setSessionUpHist] = useState<number[]>([]);
  const finishedSeen = useRef<Set<string>>(new Set());

  const log = useCallback((msg: string) => {
    const line = `${new Date().toLocaleTimeString()} — ${msg}`;
    setActivity((prev) => [...prev.slice(-199), line]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void torrentBuildUpdatePayload().then((p) => {
      if (!cancelled) {
        setPayload(p);
      }
    });
    const unlistenP = listen<TorrentsUpdatePayload>(
      IPC_EVENTS.torrentsUpdate,
      (ev) => setPayload(ev.payload),
    );
    return () => {
      cancelled = true;
      void unlistenP.then((u) => u());
    };
  }, []);

  const rows = useMemo(() => payload?.torrents ?? [], [payload]);

  const displayRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (!q) {
        return true;
      }
      const name = (r.name ?? "").toLowerCase();
      const lab = (r.label ?? "").toLowerCase();
      const hash = r.info_hash.toLowerCase();
      return name.includes(q) || lab.includes(q) || hash.includes(q);
    });
    list = [...list].sort((a, b) => {
      const sa = a.stats;
      const sb = b.stats;
      const ta = sa?.total_bytes ?? 0;
      const tb = sb?.total_bytes ?? 0;
      const pa = ta > 0 ? (sa?.progress_bytes ?? 0) / ta : 0;
      const pb = tb > 0 ? (sb?.progress_bytes ?? 0) / tb : 0;
      const da = mbpsToApproxBps(
        (sa?.live as { download_speed?: { mbps?: number } } | undefined)
          ?.download_speed?.mbps ?? 0,
      );
      const db = mbpsToApproxBps(
        (sb?.live as { download_speed?: { mbps?: number } } | undefined)
          ?.download_speed?.mbps ?? 0,
      );
      const ea =
        da > 0 && ta > (sa?.progress_bytes ?? 0)
          ? (ta - (sa?.progress_bytes ?? 0)) / da
          : Number.POSITIVE_INFINITY;
      const eb =
        db > 0 && tb > (sb?.progress_bytes ?? 0)
          ? (tb - (sb?.progress_bytes ?? 0)) / db
          : Number.POSITIVE_INFINITY;
      switch (sortBy) {
        case "name":
          return (a.name ?? a.info_hash).localeCompare(b.name ?? b.info_hash);
        case "progress":
          return pb - pa;
        case "size":
          return tb - ta;
        case "eta":
          return ea - eb;
        default:
          return 0;
      }
    });
    return list;
  }, [rows, filterQuery, sortBy]);

  useEffect(() => {
    if (!payload?.session) {
      return;
    }
    const d = payload.session.download_speed.mbps;
    const u = payload.session.upload_speed.mbps;
    setSessionDownHist((h) => [...h.slice(-119), d]);
    setSessionUpHist((h) => [...h.slice(-119), u]);
  }, [payload?.session]);

  useEffect(() => {
    if (!payload) {
      return;
    }
    for (const t of payload.torrents) {
      if (t.stats?.finished && !finishedSeen.current.has(t.info_hash)) {
        finishedSeen.current.add(t.info_hash);
        void notifyTorrentDone(t.name ?? t.info_hash.slice(0, 14));
      }
    }
  }, [payload]);

  const selectedRow = useMemo(
    () => displayRows.find((r) => torrentRef(r) === selectedRef) ?? null,
    [displayRows, selectedRef],
  );

  useEffect(() => {
    if (!selectedRef) {
      setDetail(null);
      return;
    }
    void torrentDetails(selectedRef)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selectedRef, payload?.torrents]);

  useEffect(() => {
    if (tab !== "peers" || !selectedRef) {
      setPeerDump(null);
      return;
    }
    void torrentPeerStats(selectedRef)
      .then(setPeerDump)
      .catch(() => setPeerDump(null));
  }, [tab, selectedRef, payload?.torrents]);

  useEffect(() => {
    if (tab !== "pieces" || !selectedRef) {
      setPieceDump(null);
      return;
    }
    void torrentPieceDump(selectedRef)
      .then(setPieceDump)
      .catch(() => setPieceDump("(unavailable)"));
  }, [tab, selectedRef]);

  useEffect(() => {
    if (!selectedRow) {
      setPerTorrentLabel("");
      setLabelColorHex("#60a5fa");
      return;
    }
    setPerTorrentLabel(selectedRow.label ?? "");
    setLabelColorHex(selectedRow.labelColor ?? "#60a5fa");
  }, [selectedRow]);

  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12,
  });

  const session = payload?.session;

  const openSettings = async () => {
    const s = await getNexttorrentSettings();
    setSettingsDraft({
      ...DEFAULT_NEXTTORRENT_SETTINGS,
      ...s,
      labelsByInfoHash: { ...s.labelsByInfoHash },
      labelColors: { ...s.labelColors },
      rssFeeds: [...(s.rssFeeds ?? [])],
      watchFolders: [...(s.watchFolders ?? [])],
      speedScheduler: {
        enabled: s.speedScheduler?.enabled ?? false,
        slots: (s.speedScheduler?.slots ?? []).map((x) => ({ ...x })),
      },
    });
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    if (!settingsDraft) {
      return;
    }
    await saveNexttorrentSettings(settingsDraft);
    document.documentElement.dataset.theme = settingsDraft.theme;
    try {
      if (settingsDraft.startAtLogin) {
        await enable();
      } else {
        await disable();
      }
    } catch {
      log("Autostart plugin unavailable or denied.");
    }
    log("Settings saved.");
    setSettingsOpen(false);
  };

  const pickTorrentFile = async () => {
    try {
      const raw = await open({
        multiple: false,
        filters: [{ name: "Torrent", extensions: ["torrent"] }],
      });
      const path = normalizeDialogFilePath(raw);
      if (path) {
        setPendingTorrentPath(path);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void message(`Could not open file picker:\n${msg}`, {
        title: "Add torrent",
      });
    }
  };

  const confirmAddTorrentFile = async () => {
    if (!pendingTorrentPath) {
      return;
    }
    try {
      await torrentAddFile(pendingTorrentPath, addOutputDir, null, false);
      log(`Added torrent file ${pendingTorrentPath}`);
      setPendingTorrentPath(null);
      setAddOpen(false);
      setMagnetDraft("");
      setAddOutputDir(null);
    } catch (e) {
      const msg = formatInvokeError(e);
      log(`Add torrent file failed: ${msg}`);
      void message(msg, { title: "Could not add torrent" });
    }
  };

  const pickOutputDirectory = async () => {
    const d = await open({ directory: true, multiple: false });
    if (typeof d === "string") {
      setAddOutputDir(d);
    }
  };

  const submitMagnet = async () => {
    const m = magnetDraft.trim();
    if (!m) {
      return;
    }
    try {
      await torrentAddMagnet(m, addOutputDir, null, false);
      log("Added magnet.");
      setMagnetDraft("");
      setAddOutputDir(null);
      setPendingTorrentPath(null);
      setAddOpen(false);
    } catch (e) {
      const msg = formatInvokeError(e);
      log(`Add magnet failed: ${msg}`);
      void message(msg, { title: "Could not add magnet" });
    }
  };

  const saveLabel = async () => {
    if (!selectedRow) {
      return;
    }
    const v = perTorrentLabel.trim();
    await setTorrentLabel(selectedRow.info_hash, v.length ? v : null);
    const base = await getNexttorrentSettings();
    const next: NexttorrentSettings = {
      ...base,
      labelColors: { ...base.labelColors },
    };
    if (v.length && labelColorHex.trim()) {
      next.labelColors[v] = labelColorHex.trim();
    }
    await saveNexttorrentSettings(next);
    log(`Label updated for ${selectedRow.info_hash}`);
  };

  const ensureSchedulerSlot = (d: NexttorrentSettings): NexttorrentSettings => {
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
  };

  return (
    <div className="workspace">
      <header className="toolbar">
        <div className="brand">Nexttorrent</div>
        <button
          type="button"
          onClick={() => {
            setPendingTorrentPath(null);
            setAddModalDrag({ dx: 0, dy: 0 });
            setAddOpen(true);
          }}
        >
          Add torrent
        </button>
        <button type="button" onClick={openSettings}>
          Settings
        </button>
        <button
          type="button"
          onClick={() => {
            void torrentPauseAll().then(() => log("Paused all torrents."));
          }}
        >
          Pause all
        </button>
        <button
          type="button"
          onClick={() => {
            void rssPollFeeds().then((r) =>
              log(
                `RSS: added ${r.magnetsAdded}; ${r.messages.slice(0, 3).join("; ")}`,
              ),
            );
          }}
        >
          Poll RSS
        </button>
        <button
          type="button"
          onClick={() => {
            void watchPoll().then((n) => log(`Watch folders: ${n} new.`));
          }}
        >
          Scan watch folders
        </button>
        <button
          type="button"
          onClick={() => {
            void quitApp().catch((e) =>
              log(`Quit failed: ${formatInvokeError(e)}`),
            );
          }}
        >
          Quit
        </button>
      </header>

      <div className="toolbar filter-bar">
        <label className="grow">
          Filter
          <input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="name, label, hash…"
          />
        </label>
        <label>
          Sort
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
          >
            <option value="name">Name</option>
            <option value="progress">Progress</option>
            <option value="size">Size</option>
            <option value="eta">ETA</option>
          </select>
        </label>
      </div>

      <div className="main-split">
        <div className="list-pane">
          <div className="table-head">
            <span>Name</span>
            <span className="col-num">%</span>
            <span className="col-num">Size</span>
            <span className="col-num">ETA</span>
            <span className="col-num">Down</span>
            <span className="col-num">Up</span>
            <span className="col-num">Ratio</span>
            <span className="col-num">State</span>
          </div>
          <div ref={parentRef} className="table-scroll">
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const row = displayRows[vi.index]!;
                const ref = torrentRef(row);
                const stats = row.stats;
                const selected = ref === selectedRef;
                const total = stats?.total_bytes ?? 0;
                const prog = stats?.progress_bytes ?? 0;
                const pct = total > 0 ? (100 * prog) / total : 0;
                const live = stats?.live as
                  | {
                      download_speed?: { mbps?: number };
                      upload_speed?: { mbps?: number };
                    }
                  | undefined;
                const downMbps = live?.download_speed?.mbps ?? 0;
                const upMbps = live?.upload_speed?.mbps ?? 0;
                const down = mbpsToApproxBps(downMbps);
                const up = mbpsToApproxBps(upMbps);
                const eta =
                  down > 0 && total > prog ? (total - prog) / down : null;
                const stripe = row.labelColor ?? undefined;
                return (
                  <button
                    key={ref}
                    type="button"
                    className={`table-row ${selected ? "selected" : ""}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${vi.size}px`,
                      transform: `translateY(${vi.start}px)`,
                      borderLeft: stripe ? `4px solid ${stripe}` : undefined,
                    }}
                    onClick={() => setSelectedRef(ref)}
                  >
                    <span className="col-name">
                      {row.label ? `[${row.label}] ` : ""}
                      {row.name ?? row.info_hash.slice(0, 8)}
                    </span>
                    <span className="col-num">{pct.toFixed(1)}%</span>
                    <span className="col-num">{formatBytes(total)}</span>
                    <span className="col-num">{formatEta(eta)}</span>
                    <span className="col-num">{formatBps(down)}</span>
                    <span className="col-num">{formatBps(up)}</span>
                    <span className="col-num">
                      {ratioString(stats?.uploaded_bytes ?? 0, prog || 1)}
                    </span>
                    <span className="col-num">
                      {stats?.state != null ? String(stats.state) : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <section className="detail-pane">
          {!selectedRow ? (
            <p className="muted">Select a torrent to inspect details.</p>
          ) : (
            <>
              <div className="detail-head">
                <h2>{selectedRow.name ?? selectedRow.info_hash}</h2>
                <div className="detail-actions">
                  <button
                    type="button"
                    onClick={() => {
                      void torrentPause(torrentRef(selectedRow)).then(() =>
                        log("Paused."),
                      );
                    }}
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void torrentResume(torrentRef(selectedRow)).then(() =>
                        log("Resumed."),
                      );
                    }}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void torrentForceRecheck(torrentRef(selectedRow)).then(
                        () => log("Force recheck (pause/resume)."),
                      );
                    }}
                  >
                    Recheck
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void torrentRemove(torrentRef(selectedRow), false).then(
                        () => log("Removed from session."),
                      );
                    }}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      void torrentRemove(torrentRef(selectedRow), true).then(
                        () => log("Removed with files."),
                      );
                    }}
                  >
                    Delete files
                  </button>
                </div>
                <div className="label-row">
                  <input
                    value={perTorrentLabel}
                    onChange={(e) => setPerTorrentLabel(e.target.value)}
                    placeholder="Label"
                  />
                  <input
                    className="color-swatch"
                    value={labelColorHex}
                    onChange={(e) => setLabelColorHex(e.target.value)}
                    placeholder="#rrggbb"
                    aria-label="Label color"
                  />
                  <button type="button" onClick={() => void saveLabel()}>
                    Save label
                  </button>
                </div>
              </div>

              <nav className="tabs">
                {(
                  [
                    "overview",
                    "files",
                    "peers",
                    "trackers",
                    "pieces",
                    "activity",
                  ] as TabId[]
                ).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t[0]!.toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </nav>

              <div className="tab-body">
                {tab === "overview" && (
                  <pre className="json-pre">
                    {JSON.stringify(selectedRow.stats, null, 2)}
                  </pre>
                )}
                {tab === "files" && detail?.files && (
                  <ul className="file-list">
                    {detail.files.map((f, i) => (
                      <li key={`${f.name}-${i}`}>
                        <label>
                          <input
                            type="checkbox"
                            checked={f.included}
                            onChange={(e) => {
                              const files = detail.files!;
                              const pick = files.map((ff, j) =>
                                j === i ? e.target.checked : ff.included,
                              );
                              const indices = pick
                                .map((inc, j) => (inc ? j : -1))
                                .filter((j) => j >= 0);
                              void torrentUpdateOnlyFiles(
                                torrentRef(selectedRow),
                                indices,
                              ).then(
                                () =>
                                  void torrentDetails(
                                    torrentRef(selectedRow),
                                  ).then(setDetail),
                              );
                            }}
                          />
                          {f.name} ({formatBytes(f.length)})
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {tab === "peers" && (
                  <pre className="json-pre">
                    {JSON.stringify(peerDump, null, 2)}
                  </pre>
                )}
                {tab === "trackers" && (
                  <p className="muted">
                    Tracker announces and scrape schedules are handled
                    internally by librqbit (HTTP(S)/UDP). Use session DHT view
                    in logs if needed.
                  </p>
                )}
                {tab === "pieces" && (
                  <pre className="piece-dump">{pieceDump ?? "…"}</pre>
                )}
                {tab === "activity" && (
                  <pre className="activity-log">{activity.join("\n")}</pre>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <div className="graph-strip">
        <RateGraph downSeries={sessionDownHist} upSeries={sessionUpHist} />
      </div>

      <footer className="status-bar">
        <span>
          ↓{" "}
          {session
            ? formatBps(mbpsToApproxBps(session.download_speed.mbps))
            : "—"}
        </span>
        <span>
          ↑{" "}
          {session
            ? formatBps(mbpsToApproxBps(session.upload_speed.mbps))
            : "—"}
        </span>
        <span>
          Session: {session ? formatBytes(session.fetched_bytes) : "—"} fetched
        </span>
      </footer>

      {addOpen && (
        <dialog
          open
          className="modal modal-draggable"
          style={{
            transform: `translate(calc(-50% + ${addModalDrag.dx}px), calc(-50% + ${addModalDrag.dy}px))`,
          }}
        >
          <h3
            className="modal-drag-handle"
            onPointerDown={(e) => {
              if (e.button !== 0) {
                return;
              }
              e.preventDefault();
              const cur = addModalDragRef.current;
              addModalPointerDrag.current = {
                dragging: true,
                startX: e.clientX,
                startY: e.clientY,
                originDx: cur.dx,
                originDy: cur.dy,
              };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = addModalPointerDrag.current;
              if (!d?.dragging) {
                return;
              }
              setAddModalDrag({
                dx: d.originDx + (e.clientX - d.startX),
                dy: d.originDy + (e.clientY - d.startY),
              });
            }}
            onPointerUp={(e) => {
              const d = addModalPointerDrag.current;
              if (d) {
                d.dragging = false;
              }
              addModalPointerDrag.current = null;
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(
                  e.pointerId,
                );
              } catch {
                /* already released */
              }
            }}
            onPointerCancel={(e) => {
              const d = addModalPointerDrag.current;
              if (d) {
                d.dragging = false;
              }
              addModalPointerDrag.current = null;
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(
                  e.pointerId,
                );
              } catch {
                /* already released */
              }
            }}
          >
            Add torrent
          </h3>
          <p className="hint">
            Optional output folder (default: session download directory).
          </p>
          <div className="modal-actions" style={{ marginBottom: 8 }}>
            <button type="button" onClick={() => void pickOutputDirectory()}>
              Choose save folder…
            </button>
            {addOutputDir ? (
              <span className="muted" style={{ flex: 1, fontSize: 12 }}>
                {addOutputDir}
              </span>
            ) : null}
            {addOutputDir ? (
              <button type="button" onClick={() => setAddOutputDir(null)}>
                Clear
              </button>
            ) : null}
          </div>
          <textarea
            value={magnetDraft}
            onChange={(e) => setMagnetDraft(e.target.value)}
            placeholder="magnet:?xt=urn:btih:…"
            rows={4}
          />
          {pendingTorrentPath ? (
            <div className="pending-file-box">
              <p className="hint">Selected file</p>
              <code className="pending-path">{pendingTorrentPath}</code>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => void confirmAddTorrentFile()}
                >
                  Add to session
                </button>
                <button type="button" onClick={() => void pickTorrentFile()}>
                  Choose different file…
                </button>
                <button
                  type="button"
                  onClick={() => setPendingTorrentPath(null)}
                >
                  Clear selection
                </button>
              </div>
            </div>
          ) : (
            <div className="modal-actions">
              <button type="button" onClick={() => void pickTorrentFile()}>
                Choose .torrent file…
              </button>
            </div>
          )}
          <div className="modal-actions">
            <button type="button" onClick={() => void submitMagnet()}>
              Add magnet
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingTorrentPath(null);
                setAddOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </dialog>
      )}

      {settingsOpen && settingsDraft && (
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
            Theme
            <select
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
            Prefer sequential download (stored for future engine support;
            librqbit v8 uses rarest-first internally)
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
                      settingsDraft.speedScheduler.slots[0]!.downloadLimitBps ??
                      ""
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
                      settingsDraft.speedScheduler.slots[0]!.uploadLimitBps ??
                      ""
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

          <h4 className="settings-section">RSS feeds</h4>
          <p className="hint">
            Enable “auto add” for background polling (every ~15 min). Use “Poll
            RSS” for an immediate fetch.
          </p>
          {settingsDraft.rssFeeds.map((feed, idx) => (
            <div key={feed.id} className="rss-row">
              <input
                value={feed.url}
                onChange={(e) => {
                  const rssFeeds = [...settingsDraft.rssFeeds];
                  rssFeeds[idx] = { ...feed, url: e.target.value };
                  setSettingsDraft({ ...settingsDraft, rssFeeds });
                }}
                placeholder="https://…/feed.xml"
              />
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
                rssFeeds: [
                  ...settingsDraft.rssFeeds,
                  {
                    id,
                    url: "",
                    enabled: true,
                    autoAdd: false,
                    lastSeenIds: [],
                  },
                ],
              });
            }}
          >
            Add RSS feed
          </button>

          <h4 className="settings-section">Watch folders</h4>
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
            Listen ports and proxy changes may require restarting the app to
            take full effect in the engine.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => void saveSettings()}>
              Save
            </button>
            <button type="button" onClick={() => setSettingsOpen(false)}>
              Cancel
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
