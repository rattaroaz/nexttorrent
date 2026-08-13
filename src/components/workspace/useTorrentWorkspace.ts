import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_NEXTTORRENT_SETTINGS,
  IPC_EVENTS,
  type NexttorrentSettings,
  type NetworkInterfaceInfo,
  type SpeedSchedulerSlot,
  type TorrentRow,
  type TorrentsUpdatePayload,
} from "../../ipc/contracts";
import { normalizeDialogFilePath } from "../../ipc/dialogPaths";
import { formatInvokeError } from "../../ipc/invokeError";
import { runLogged } from "../../ipc/runLogged";
import { checkForUpdatesAndApply } from "../../services/updateService";
import {
  exportConfigurationBundle,
  getNexttorrentSettings,
  importConfigurationBundle,
  listNetworkInterfaces,
  openLogsFolder,
  getAiBrief,
  exportAiDiagnostics,
  saveNexttorrentSettings,
  torrentAddFile,
  torrentAddMagnet,
  torrentBuildUpdatePayload,
  torrentDetails,
  torrentOpenFolder,
  torrentPause,
  torrentRemove,
  torrentResume,
  setTorrentLabel,
  getTorrentBandwidthLimits,
  setTorrentBandwidthLimits,
  torrentLiveStats,
  torrentPeerStats,
  torrentPieceDump,
  torrentTrackers,
} from "../../ipc/client";
import {
  mbpsToApproxBps,
  torrentRef,
  type SortDir,
  type SortKey,
  type TabId,
} from "./shared";
import type { ContextMenuAction } from "./TorrentContextMenu";
import type { LogLevelFilter } from "../../utils/logFilter";

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

export function useTorrentWorkspace() {
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
  const [settingsDraft, setSettingsDraft] =
    useState<NexttorrentSettings | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<
    NetworkInterfaceInfo[]
  >([]);
  const [magnetDraft, setMagnetDraft] = useState("");
  const [addOutputDir, setAddOutputDir] = useState<string | null>(null);
  const [pendingTorrentPath, setPendingTorrentPath] = useState<string | null>(
    null,
  );
  const [perTorrentLabel, setPerTorrentLabel] = useState("");
  const [labelColorHex, setLabelColorHex] = useState("#60a5fa");
  const [filterQuery, setFilterQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(
    () => new Set(),
  );
  const [liveStats, setLiveStats] = useState<Record<string, unknown> | null>(
    null,
  );
  const [trackers, setTrackers] = useState<string[]>([]);
  const [perTorrentDownLimit, setPerTorrentDownLimit] = useState("");
  const [perTorrentUpLimit, setPerTorrentUpLimit] = useState("");
  const [batchLabelDraft, setBatchLabelDraft] = useState("");
  const lastClickIndex = useRef<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [sessionDownHist, setSessionDownHist] = useState<number[]>([]);
  const [sessionUpHist, setSessionUpHist] = useState<number[]>([]);
  const [logsPanelOpen, setLogsPanelOpen] = useState(false);
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>("all");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    refs: string[];
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Info-hashes already known finished (seeded on first snapshot; no notify). */
  const finishedSeen = useRef<Set<string>>(new Set());
  const finishedBaselineReady = useRef(false);

  const log = useCallback((msg: string) => {
    const line = `${new Date().toLocaleTimeString()} — ${msg}`;
    setActivity((prev) => [...prev.slice(-199), line]);
  }, []);

  const logErr = useCallback(
    (action: string, e: unknown) => {
      log(`${action} failed: ${formatInvokeError(e)}`);
    },
    [log],
  );

  const toggleLogsPanel = useCallback(() => {
    setLogsPanelOpen((open) => !open);
  }, []);

  const closeDetailPane = useCallback(() => {
    setSelectedRef(null);
    setSelectedRefs(new Set());
    setDetail(null);
    setPeerDump(null);
    setPieceDump(null);
    setLiveStats(null);
    setTrackers([]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void torrentBuildUpdatePayload()
      .then((p) => {
        if (!cancelled) {
          setPayload(p);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          logErr("Initial torrent list", e);
        }
      });
    const unlistenP = listen<TorrentsUpdatePayload>(
      IPC_EVENTS.torrentsUpdate,
      (ev) => setPayload(ev.payload),
    );
    const unlistenMagnetAdded = listen<string>(IPC_EVENTS.magnetAdded, (ev) => {
      log(`Added magnet from OS handler: ${ev.payload.slice(0, 48)}…`);
    });
    const unlistenMagnetRejected = listen<string>(
      IPC_EVENTS.magnetRejected,
      (ev) => {
        log(`Magnet rejected: ${ev.payload}`);
      },
    );
    return () => {
      cancelled = true;
      void unlistenP.then((u) => u());
      void unlistenMagnetAdded.then((u) => u());
      void unlistenMagnetRejected.then((u) => u());
    };
  }, [log, logErr]);

  const rows = useMemo(() => payload?.torrents ?? [], [payload]);

  const labelOptions = useMemo(() => {
    const labels = new Set<string>();
    for (const r of rows) {
      if (r.label) {
        labels.add(r.label);
      }
    }
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const displayRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (labelFilter === "__none__") {
        if (r.label) {
          return false;
        }
      } else if (labelFilter && r.label !== labelFilter) {
        return false;
      }
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
      const ua = mbpsToApproxBps(
        (sa?.live as { upload_speed?: { mbps?: number } } | undefined)
          ?.upload_speed?.mbps ?? 0,
      );
      const ub = mbpsToApproxBps(
        (sb?.live as { upload_speed?: { mbps?: number } } | undefined)
          ?.upload_speed?.mbps ?? 0,
      );
      const progA = sa?.progress_bytes ?? 0;
      const progB = sb?.progress_bytes ?? 0;
      const ea =
        da > 0 && ta > progA ? (ta - progA) / da : Number.POSITIVE_INFINITY;
      const eb =
        db > 0 && tb > progB ? (tb - progB) / db : Number.POSITIVE_INFINITY;
      const ra = progA > 0 ? (sa?.uploaded_bytes ?? 0) / progA : 0;
      const rb = progB > 0 ? (sb?.uploaded_bytes ?? 0) / progB : 0;
      let cmp = 0;
      switch (sortBy) {
        case "name":
          cmp = (a.name ?? a.info_hash).localeCompare(b.name ?? b.info_hash);
          break;
        case "progress":
          cmp = pa - pb;
          break;
        case "size":
          cmp = ta - tb;
          break;
        case "eta":
          cmp = ea - eb;
          break;
        case "down":
          cmp = da - db;
          break;
        case "up":
          cmp = ua - ub;
          break;
        case "ratio":
          cmp = ra - rb;
          break;
        case "state":
          cmp = String(sa?.state ?? "").localeCompare(String(sb?.state ?? ""));
          break;
        default:
          cmp = 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, filterQuery, labelFilter, sortBy, sortDir]);

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
    // First snapshot: remember already-finished torrents so we do not spam
    // "Torrent finished" for every seeding item after a restart.
    if (!finishedBaselineReady.current) {
      for (const t of payload.torrents) {
        if (t.stats?.finished) {
          finishedSeen.current.add(t.info_hash);
        }
      }
      finishedBaselineReady.current = true;
      return;
    }
    for (const t of payload.torrents) {
      if (t.stats?.finished && !finishedSeen.current.has(t.info_hash)) {
        finishedSeen.current.add(t.info_hash);
        void notifyTorrentDone(t.name ?? t.info_hash.slice(0, 14));
      }
    }
  }, [payload]);

  // Resolve from the full list so a filtered-away selection still shows details.
  const selectedRow = useMemo(
    () => rows.find((r) => torrentRef(r) === selectedRef) ?? null,
    [rows, selectedRef],
  );
  const selectedInfoHash = selectedRow?.info_hash ?? null;
  const selectedLabel = selectedRow?.label ?? null;
  const selectedLabelColor = selectedRow?.labelColor ?? null;

  const sessionCounts = useMemo(() => {
    let downloading = 0;
    let seeding = 0;
    let paused = 0;
    let errored = 0;
    for (const r of rows) {
      const st = (r.stats?.state ?? "").toLowerCase();
      if (r.stats?.error) {
        errored += 1;
        continue;
      }
      if (st.includes("paused")) {
        paused += 1;
      } else if (r.stats?.finished) {
        seeding += 1;
      } else if (st.includes("live") || st.includes("download")) {
        downloading += 1;
      }
    }
    return {
      total: rows.length,
      downloading,
      seeding,
      paused,
      errored,
    };
  }, [rows]);

  // Static details + trackers: only when selection changes (not every 750ms tick).
  useEffect(() => {
    if (!selectedRef) {
      setDetail(null);
      setTrackers([]);
      return;
    }
    let cancelled = false;
    void torrentDetails(selectedRef)
      .then((v) => {
        if (!cancelled) {
          setDetail(v);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null);
          logErr("Load torrent details", e);
        }
      });
    void torrentTrackers(selectedRef)
      .then((v) => {
        if (!cancelled) {
          setTrackers(v);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setTrackers([]);
          logErr("Load trackers", e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRef, logErr]);

  // Live stats: poll while a torrent is selected (list payload is separate).
  useEffect(() => {
    if (!selectedRef) {
      setLiveStats(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      void torrentLiveStats(selectedRef)
        .then((v) => {
          if (!cancelled) {
            setLiveStats(v as Record<string, unknown>);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setLiveStats(null);
            logErr("Load live stats", e);
          }
        });
    };
    load();
    const id = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedRef, logErr]);

  useEffect(() => {
    if (!selectedInfoHash) {
      setPerTorrentDownLimit("");
      setPerTorrentUpLimit("");
      return;
    }
    let cancelled = false;
    void getTorrentBandwidthLimits(selectedInfoHash)
      .then((limits) => {
        if (cancelled) {
          return;
        }
        setPerTorrentDownLimit(
          limits.downloadLimitBps != null
            ? String(limits.downloadLimitBps)
            : "",
        );
        setPerTorrentUpLimit(
          limits.uploadLimitBps != null ? String(limits.uploadLimitBps) : "",
        );
      })
      .catch((e) => {
        if (cancelled) {
          return;
        }
        setPerTorrentDownLimit("");
        setPerTorrentUpLimit("");
        logErr("Load per-torrent limits", e);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedInfoHash, logErr]);

  useEffect(() => {
    if (tab !== "peers" || !selectedRef) {
      setPeerDump(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      void torrentPeerStats(selectedRef)
        .then((v) => {
          if (!cancelled) {
            setPeerDump(v as Record<string, unknown>);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setPeerDump(null);
            logErr("Load peer stats", e);
          }
        });
    };
    load();
    const id = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tab, selectedRef, logErr]);

  useEffect(() => {
    if (tab !== "pieces" || !selectedRef) {
      setPieceDump(null);
      return;
    }
    let cancelled = false;
    void torrentPieceDump(selectedRef)
      .then((v) => {
        if (!cancelled) {
          setPieceDump(v);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setPieceDump("(unavailable)");
          logErr("Load piece bitmap", e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, selectedRef, logErr]);

  useEffect(() => {
    if (!selectedInfoHash) {
      setPerTorrentLabel("");
      setLabelColorHex("#60a5fa");
      return;
    }
    setPerTorrentLabel(selectedLabel ?? "");
    setLabelColorHex(selectedLabelColor ?? "#60a5fa");
  }, [selectedInfoHash, selectedLabel, selectedLabelColor]);

  const batchRefs = useMemo(() => Array.from(selectedRefs), [selectedRefs]);
  const multiSelected = batchRefs.length > 1;
  const session = payload?.session;

  const handleRowClick = (
    e: React.MouseEvent,
    row: TorrentRow,
    index: number,
  ) => {
    setContextMenu(null);
    const ref = torrentRef(row);
    if (e.shiftKey && lastClickIndex.current != null) {
      const start = Math.min(lastClickIndex.current, index);
      const end = Math.max(lastClickIndex.current, index);
      const next = new Set(selectedRefs);
      for (let i = start; i <= end; i++) {
        const r = displayRows[i];
        if (r) {
          next.add(torrentRef(r));
        }
      }
      setSelectedRefs(next);
      setSelectedRef(ref);
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedRefs);
      if (next.has(ref)) {
        next.delete(ref);
        setSelectedRefs(next);
        const remaining = next.values().next().value as string | undefined;
        setSelectedRef(remaining ?? null);
      } else {
        next.add(ref);
        setSelectedRefs(next);
        setSelectedRef(ref);
      }
    } else {
      setSelectedRefs(new Set([ref]));
      setSelectedRef(ref);
    }
    lastClickIndex.current = index;
  };

  const handleRowContextMenu = (
    e: React.MouseEvent,
    row: TorrentRow,
    index: number,
  ) => {
    e.preventDefault();
    const ref = torrentRef(row);
    let refs: string[];
    if (selectedRefs.has(ref) && selectedRefs.size > 1) {
      refs = Array.from(selectedRefs);
    } else {
      refs = [ref];
      setSelectedRefs(new Set([ref]));
      setSelectedRef(ref);
      lastClickIndex.current = index;
    }
    setContextMenu({ x: e.clientX, y: e.clientY, refs });
  };

  const handleSortHeaderClick = useCallback((key: SortKey) => {
    setSortBy((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "name" || key === "state" ? "asc" : "desc");
      return key;
    });
  }, []);

  const runBatch = async (
    label: string,
    fn: (ref: string) => Promise<unknown>,
  ) => {
    try {
      for (const ref of batchRefs) {
        await fn(ref);
      }
      log(`${label}: ${batchRefs.length} torrent(s).`);
    } catch (e) {
      logErr(`Batch ${label.toLowerCase()}`, e);
    }
  };

  const savePerTorrentLimits = async () => {
    if (!selectedRow) {
      return;
    }
    const down = perTorrentDownLimit.trim()
      ? Number(perTorrentDownLimit)
      : null;
    const up = perTorrentUpLimit.trim() ? Number(perTorrentUpLimit) : null;
    if (
      (down != null && (!Number.isFinite(down) || down < 0)) ||
      (up != null && (!Number.isFinite(up) || up < 0))
    ) {
      log("Invalid bandwidth limit values.");
      return;
    }
    const applied = await runLogged("Save per-torrent limits", log, () =>
      setTorrentBandwidthLimits(
        selectedRow.info_hash,
        down != null && down > 0 ? Math.floor(down) : null,
        up != null && up > 0 ? Math.floor(up) : null,
      ),
    );
    if (!applied.ok) {
      return;
    }
    if (applied.value) {
      log("Per-torrent bandwidth limits applied to the running torrent.");
      setSelectedRef(null);
      setSelectedRefs(new Set());
      setDetail(null);
    } else {
      log(
        "Per-torrent bandwidth limits saved. Will apply fully once metadata is available (or on re-add).",
      );
    }
  };

  const applyBatchLabel = async () => {
    const v = batchLabelDraft.trim();
    try {
      let n = 0;
      for (const ref of batchRefs) {
        const row = rows.find((r) => torrentRef(r) === ref);
        if (row) {
          await setTorrentLabel(row.info_hash, v.length ? v : null);
          n += 1;
        }
      }
      log(`Label set on ${n} torrent(s).`);
    } catch (e) {
      logErr("Batch set label", e);
    }
  };

  const openAddTorrent = useCallback(() => {
    setPendingTorrentPath(null);
    setAddOpen(true);
  }, []);

  const openSettings = useCallback(async () => {
    const loaded = await runLogged(
      "Open settings",
      log,
      getNexttorrentSettings,
    );
    if (!loaded.ok) {
      return;
    }
    const s = loaded.value;
    setSettingsDraft({
      ...DEFAULT_NEXTTORRENT_SETTINGS,
      ...s,
      labelsByInfoHash: { ...s.labelsByInfoHash },
      labelColors: { ...s.labelColors },
      rssFeeds: [...(s.rssFeeds ?? [])],
      watchFolders: [...(s.watchFolders ?? [])],
      speedScheduler: {
        enabled: s.speedScheduler?.enabled ?? false,
        slots: (s.speedScheduler?.slots ?? []).map((x: SpeedSchedulerSlot) => ({
          ...x,
        })),
      },
    });
    setSettingsOpen(true);
    void listNetworkInterfaces()
      .then(setNetworkInterfaces)
      .catch((e) => {
        setNetworkInterfaces([]);
        logErr("List network interfaces", e);
      });
  }, [log, logErr]);

  const removeTorrents = useCallback(
    async (refs: string[], deleteFiles: boolean) => {
      if (refs.length === 0) {
        return;
      }
      const title = deleteFiles
        ? "Delete torrents and files?"
        : "Remove torrents from session?";
      const body = deleteFiles
        ? `Permanently delete ${refs.length} torrent(s) and their downloaded files? This cannot be undone.`
        : `Remove ${refs.length} torrent(s) from the session? Files on disk will be kept.`;
      const ok = await ask(body, { title, kind: "warning" });
      if (!ok) {
        return;
      }
      try {
        for (const ref of refs) {
          await torrentRemove(ref, deleteFiles);
        }
        log(
          deleteFiles
            ? `Deleted ${refs.length} torrent(s) with files.`
            : `Removed ${refs.length} torrent(s) from session.`,
        );
        setSelectedRefs(new Set());
        setSelectedRef(null);
        setDetail(null);
      } catch (e) {
        logErr(deleteFiles ? "Delete torrents" : "Remove torrents", e);
      }
    },
    [log, logErr],
  );

  const handleContextAction = useCallback(
    async (action: ContextMenuAction, refs: string[]) => {
      if (refs.length === 0) {
        return;
      }
      try {
        switch (action) {
          case "pause":
            for (const ref of refs) {
              await torrentPause(ref);
            }
            log(`Paused ${refs.length} torrent(s).`);
            break;
          case "resume":
            for (const ref of refs) {
              await torrentResume(ref);
            }
            log(`Resumed ${refs.length} torrent(s).`);
            break;
          case "openFolder":
            await torrentOpenFolder(refs[0]!);
            log("Opened download folder.");
            break;
          case "copyHash": {
            const row = rows.find((r) => torrentRef(r) === refs[0]);
            const hash = row?.info_hash ?? refs[0]!;
            await writeText(hash);
            log("Info hash copied.");
            break;
          }
          case "copyName": {
            const row = rows.find((r) => torrentRef(r) === refs[0]);
            const name = row?.name ?? row?.info_hash ?? refs[0]!;
            await writeText(name);
            log("Name copied.");
            break;
          }
          case "remove":
            await removeTorrents(refs, false);
            break;
          case "deleteFiles":
            await removeTorrents(refs, true);
            break;
        }
      } catch (e) {
        logErr(`Context action ${action}`, e);
      }
    },
    [log, logErr, removeTorrents, rows],
  );

  const exportBackup = async () => {
    try {
      const dest = await save({
        defaultPath: "nexttorrent-backup.zip",
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      });
      const path = normalizeDialogFilePath(dest);
      if (!path) {
        return;
      }
      await exportConfigurationBundle(path);
      log(`Configuration exported to ${path}`);
      void message("Settings and session data exported.", {
        title: "Backup complete",
      });
    } catch (e) {
      const msg = formatInvokeError(e);
      log(`Export failed: ${msg}`);
      void message(msg, { title: "Export failed" });
    }
  };

  const importBackup = async () => {
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      });
      const path = normalizeDialogFilePath(picked);
      if (!path) {
        return;
      }
      const ok = await ask(
        "Import replaces settings and the librqbit session. Restart Nexttorrent afterward.",
        { title: "Import configuration?", kind: "warning" },
      );
      if (!ok) {
        return;
      }
      await importConfigurationBundle(path);
      log("Configuration imported — restart recommended.");
      void message("Imported. Please restart Nexttorrent.", {
        title: "Import complete",
      });
    } catch (e) {
      const msg = formatInvokeError(e);
      log(`Import failed: ${msg}`);
      void message(msg, { title: "Import failed" });
    }
  };

  const openLogsFolderAction = async () => {
    const path = await runLogged("Open logs folder", log, openLogsFolder);
    if (path.ok && path.value) {
      log(`Opened logs folder: ${path.value}`);
    }
  };

  const copyAiBriefAction = async () => {
    const brief = await runLogged("Copy AI brief", log, getAiBrief);
    if (!brief.ok) {
      return;
    }
    try {
      await writeText(brief.value);
      log("AI brief copied to clipboard (also written to ai-brief.json).");
    } catch (e) {
      log(`Copy AI brief failed: ${formatInvokeError(e)}`);
    }
  };

  const exportAiDiagnosticsAction = async () => {
    const path = await runLogged(
      "Export AI diagnostics",
      log,
      exportAiDiagnostics,
    );
    if (path.ok && path.value) {
      log(`Exported AI diagnostics: ${path.value}`);
    }
  };

  const checkForUpdates = async () => {
    await checkForUpdatesAndApply({ log });
  };

  const saveSettings = async () => {
    if (!settingsDraft) {
      return;
    }
    const normalized: NexttorrentSettings = {
      ...settingsDraft,
      watchFolders: settingsDraft.watchFolders
        .map((s) => s.trim())
        .filter(Boolean),
      rssFeeds: settingsDraft.rssFeeds.map((f) => ({
        ...f,
        categorySavePaths: Object.fromEntries(
          Object.entries(f.categorySavePaths ?? {}).filter(
            ([k, v]) => k.trim() && v.trim(),
          ),
        ),
      })),
    };
    const saved = await runLogged("Save settings", log, () =>
      saveNexttorrentSettings(normalized),
    );
    if (!saved.ok) {
      return;
    }
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

  // OS file drag-and-drop (.torrent paths from Tauri webview).
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const off = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            setDragOver(true);
            return;
          }
          if (payload.type === "leave") {
            setDragOver(false);
            return;
          }
          if (payload.type === "drop") {
            setDragOver(false);
            const paths = payload.paths ?? [];
            const torrents = paths.filter((p) =>
              p.toLowerCase().endsWith(".torrent"),
            );
            if (torrents.length === 0) {
              if (paths.length > 0) {
                log("Drop ignored — only .torrent files are accepted.");
              }
              return;
            }
            void (async () => {
              let ok = 0;
              for (const path of torrents) {
                try {
                  await torrentAddFile(path, null, null, false);
                  ok += 1;
                } catch (e) {
                  logErr(`Add dropped ${path}`, e);
                }
              }
              if (ok > 0) {
                log(`Added ${ok} torrent file(s) from drop.`);
              }
            })();
          }
        });
        if (cancelled) {
          off();
          return;
        }
        unlisten = off;
      } catch {
        /* webview drag-drop may be unavailable in pure browser e2e */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [log, logErr]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      if (e.key === "Escape" && contextMenu) {
        e.preventDefault();
        setContextMenu(null);
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openAddTorrent();
        return;
      }
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        void openSettings();
        return;
      }
      if (
        e.key === "Escape" &&
        (selectedRef !== null || selectedRefs.size > 0)
      ) {
        e.preventDefault();
        closeDetailPane();
        return;
      }
      if (!selectedRef) {
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        const row = rows.find((r) => torrentRef(r) === selectedRef);
        const paused = String(row?.stats?.state ?? "")
          .toLowerCase()
          .includes("paused");
        void (paused ? torrentResume(selectedRef) : torrentPause(selectedRef))
          .then(() => log(paused ? "Resumed." : "Paused."))
          .catch((err) => logErr(paused ? "Resume" : "Pause", err));
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        const refs = batchRefs.length > 0 ? batchRefs : [selectedRef];
        void removeTorrents(refs, e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    batchRefs,
    closeDetailPane,
    contextMenu,
    log,
    logErr,
    openAddTorrent,
    openSettings,
    removeTorrents,
    rows,
    selectedRef,
    selectedRefs.size,
  ]);

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
    const path = normalizeDialogFilePath(d);
    if (path) {
      setAddOutputDir(path);
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
    const labelOk = await runLogged("Save torrent label", log, () =>
      setTorrentLabel(selectedRow.info_hash, v.length ? v : null),
    );
    if (!labelOk.ok) {
      return;
    }
    const base = await runLogged(
      "Reload settings",
      log,
      getNexttorrentSettings,
    );
    if (!base.ok) {
      return;
    }
    const next: NexttorrentSettings = {
      ...base.value,
      labelColors: { ...base.value.labelColors },
    };
    if (v.length && labelColorHex.trim()) {
      next.labelColors[v] = labelColorHex.trim();
    }
    const saved = await runLogged("Save label color", log, () =>
      saveNexttorrentSettings(next),
    );
    if (!saved.ok) {
      return;
    }
    log(`Label updated for ${selectedRow.info_hash}`);
  };

  return {
    workspaceRef,
    session,
    sessionCounts,
    sessionDownHist,
    sessionUpHist,
    log,
    tab,
    setTab,
    detail,
    setDetail,
    peerDump,
    pieceDump,
    activity,
    logsPanelOpen,
    setLogsPanelOpen,
    toggleLogsPanel,
    logLevelFilter,
    setLogLevelFilter,
    settingsOpen,
    setSettingsOpen,
    addOpen,
    setAddOpen,
    settingsDraft,
    setSettingsDraft,
    networkInterfaces,
    magnetDraft,
    setMagnetDraft,
    addOutputDir,
    setAddOutputDir,
    pendingTorrentPath,
    setPendingTorrentPath,
    filterQuery,
    setFilterQuery,
    sortBy,
    setSortBy,
    sortDir,
    handleSortHeaderClick,
    labelFilter,
    setLabelFilter,
    labelOptions,
    batchRefs,
    batchLabelDraft,
    setBatchLabelDraft,
    displayRows,
    selectedRefs,
    setSelectedRefs,
    selectedRef,
    liveStats,
    trackers,
    perTorrentLabel,
    setPerTorrentLabel,
    labelColorHex,
    setLabelColorHex,
    perTorrentDownLimit,
    setPerTorrentDownLimit,
    perTorrentUpLimit,
    setPerTorrentUpLimit,
    multiSelected,
    selectedRow,
    handleRowClick,
    handleRowContextMenu,
    contextMenu,
    setContextMenu,
    handleContextAction,
    dragOver,
    closeDetailPane,
    runBatch,
    applyBatchLabel,
    removeTorrents,
    openAddTorrent,
    openSettings,
    exportBackup,
    importBackup,
    openLogsFolderAction,
    copyAiBriefAction,
    exportAiDiagnosticsAction,
    checkForUpdates,
    saveSettings,
    pickTorrentFile,
    confirmAddTorrentFile,
    pickOutputDirectory,
    submitMagnet,
    saveLabel,
    savePerTorrentLimits,
  };
}
