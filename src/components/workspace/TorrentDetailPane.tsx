import { useMemo } from "react";

import type { TorrentRow } from "../../ipc/contracts";
import {
  torrentDetails,
  torrentForceRecheck,
  torrentOpenFolder,
  torrentPause,
  torrentResume,
  torrentRevealFile,
  torrentUpdateOnlyFiles,
} from "../../ipc/client";
import { runLoggedVoid } from "../../ipc/runLogged";
import { formatBytes } from "../../utils/format";
import { TorrentOverviewPanel } from "../TorrentOverviewPanel";
import { TorrentPeersPanel } from "../TorrentPeersPanel";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { torrentRef, type TabId } from "./shared";

type Detail = Awaited<ReturnType<typeof torrentDetails>>;

type Props = {
  multiSelected: boolean;
  batchCount: number;
  selectedRow: TorrentRow | null;
  tab: TabId;
  onTabChange: (tab: TabId) => void;
  detail: Detail | null;
  onDetailChange: (detail: Detail | null) => void;
  liveStats: Record<string, unknown> | null;
  trackers: string[];
  peerDump: Record<string, unknown> | null;
  pieceDump: string | null;
  activity: string[];
  perTorrentLabel: string;
  onPerTorrentLabelChange: (value: string) => void;
  labelColorHex: string;
  onLabelColorHexChange: (value: string) => void;
  perTorrentDownLimit: string;
  onPerTorrentDownLimitChange: (value: string) => void;
  perTorrentUpLimit: string;
  onPerTorrentUpLimitChange: (value: string) => void;
  onSaveLabel: () => void;
  onSavePerTorrentLimits: () => void;
  onRemove: (deleteFiles: boolean) => void;
  onLog: (msg: string) => void;
  onClose: () => void;
};

export function TorrentDetailPane({
  multiSelected,
  batchCount,
  selectedRow,
  tab,
  onTabChange,
  detail,
  onDetailChange,
  liveStats,
  trackers,
  peerDump,
  pieceDump,
  activity,
  perTorrentLabel,
  onPerTorrentLabelChange,
  labelColorHex,
  onLabelColorHexChange,
  perTorrentDownLimit,
  onPerTorrentDownLimitChange,
  perTorrentUpLimit,
  onPerTorrentUpLimitChange,
  onSaveLabel,
  onSavePerTorrentLimits,
  onRemove,
  onLog,
  onClose,
}: Props) {
  const peerMap = useMemo(() => {
    if (!peerDump) {
      return null;
    }
    const nested = peerDump.peers;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<
        string,
        {
          state?: string;
          counters?: {
            fetched_bytes?: number;
            connections?: number;
            errors?: number;
            fetched_chunks?: number;
          };
        }
      >;
    }
    return peerDump as Record<
      string,
      {
        state?: string;
        counters?: {
          fetched_bytes?: number;
          connections?: number;
          errors?: number;
          fetched_chunks?: number;
        };
      }
    >;
  }, [peerDump]);

  return (
    <section className="detail-pane" data-testid="torrent-detail-pane">
      {multiSelected ? (
        <div className="batch-detail">
          <div className="detail-title-row">
            <h2>{batchCount} torrents selected</h2>
            <button
              type="button"
              className="detail-close"
              onClick={onClose}
              aria-label="Close detail panel"
              data-testid="detail-pane-close"
            >
              Close
            </button>
          </div>
          <p className="muted">
            Use the batch bar above or Ctrl/Shift+click to change selection.
          </p>
        </div>
      ) : !selectedRow ? (
        <p className="muted">Select a torrent to inspect details.</p>
      ) : (
        <>
          <div className="detail-head">
            <div className="detail-title-row">
              <h2>{selectedRow.name ?? selectedRow.info_hash}</h2>
              <button
                type="button"
                className="detail-close"
                onClick={onClose}
                aria-label="Close detail panel"
                data-testid="detail-pane-close"
              >
                Close
              </button>
            </div>
            <div className="detail-actions">
              <button
                type="button"
                onClick={() => {
                  runLoggedVoid("Pause torrent", onLog, () =>
                    torrentPause(torrentRef(selectedRow)).then(() =>
                      onLog("Paused."),
                    ),
                  );
                }}
              >
                Pause
              </button>
              <button
                type="button"
                onClick={() => {
                  runLoggedVoid("Resume torrent", onLog, () =>
                    torrentResume(torrentRef(selectedRow)).then(() =>
                      onLog("Resumed."),
                    ),
                  );
                }}
              >
                Resume
              </button>
              <button
                type="button"
                onClick={() => {
                  runLoggedVoid("Force recheck", onLog, () =>
                    torrentForceRecheck(torrentRef(selectedRow)).then(() =>
                      onLog("Force recheck (pause/resume)."),
                    ),
                  );
                }}
              >
                Recheck
              </button>
              <button
                type="button"
                onClick={() => {
                  runLoggedVoid("Open download folder", onLog, () =>
                    torrentOpenFolder(torrentRef(selectedRow)).then(() =>
                      onLog("Opened download folder."),
                    ),
                  );
                }}
              >
                Open folder
              </button>
              <button type="button" onClick={() => void onRemove(false)}>
                Remove
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void onRemove(true)}
              >
                Delete files
              </button>
            </div>
            <div className="label-row">
              <input
                value={perTorrentLabel}
                onChange={(e) => onPerTorrentLabelChange(e.target.value)}
                placeholder="Label"
              />
              <input
                className="color-swatch"
                value={labelColorHex}
                onChange={(e) => onLabelColorHexChange(e.target.value)}
                placeholder="#rrggbb"
                aria-label="Label color"
              />
              <button type="button" onClick={() => void onSaveLabel()}>
                Save label
              </button>
            </div>
            <div className="label-row limits-row">
              <label>
                Down limit (B/s)
                <input
                  value={perTorrentDownLimit}
                  onChange={(e) => onPerTorrentDownLimitChange(e.target.value)}
                  placeholder="session default"
                />
              </label>
              <label>
                Up limit (B/s)
                <input
                  value={perTorrentUpLimit}
                  onChange={(e) => onPerTorrentUpLimitChange(e.target.value)}
                  placeholder="session default"
                />
              </label>
              <button
                type="button"
                onClick={() => void onSavePerTorrentLimits()}
              >
                Save limits
              </button>
            </div>
            <p className="hint limits-hint">
              Limits are saved and re-applied to the running torrent when
              metadata is available (brief reconnect; files stay on disk). Leave
              blank for session default.
            </p>
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
                onClick={() => onTabChange(t)}
              >
                {t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>

          <div className="tab-body">
            {tab === "overview" && (
              <TorrentOverviewPanel
                row={selectedRow}
                detail={detail}
                liveStats={liveStats}
                trackers={trackers}
              />
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
                          runLoggedVoid("Update included files", onLog, () =>
                            torrentUpdateOnlyFiles(
                              torrentRef(selectedRow),
                              indices,
                            ).then(() =>
                              torrentDetails(torrentRef(selectedRow)).then(
                                onDetailChange,
                              ),
                            ),
                          );
                        }}
                      />
                      {f.name} ({formatBytes(f.length)})
                    </label>
                    <button
                      type="button"
                      className="file-reveal"
                      onClick={() => {
                        runLoggedVoid("Reveal file", onLog, () =>
                          torrentRevealFile(torrentRef(selectedRow), i),
                        );
                      }}
                    >
                      Reveal
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {tab === "peers" && <TorrentPeersPanel peerDump={peerMap} />}
            {tab === "trackers" &&
              (trackers.length === 0 ? (
                <p className="muted">No trackers listed for this torrent.</p>
              ) : (
                <ul className="tracker-list">
                  {trackers.map((t) => (
                    <li key={t}>
                      <code>{t}</code>
                    </li>
                  ))}
                </ul>
              ))}
            {tab === "pieces" && (
              <pre className="piece-dump">{pieceDump ?? "…"}</pre>
            )}
            {tab === "activity" && (
              <ActivityLogPanel
                sessionLines={activity}
                active={tab === "activity"}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
