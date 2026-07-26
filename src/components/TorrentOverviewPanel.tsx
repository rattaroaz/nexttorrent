import type { TorrentDetails, TorrentRow } from "../ipc/contracts";
import {
  formatBytes,
  formatBps,
  formatEta,
  formatTorrentState,
  ratioString,
} from "../utils/format";

type LiveStats = {
  download_speed?: { mbps?: number; human_readable?: string };
  upload_speed?: { mbps?: number; human_readable?: string };
  snapshot?: {
    peer_stats?: {
      live?: number;
      connecting?: number;
      queued?: number;
      seen?: number;
    };
  };
  time_remaining?: { human_readable?: string };
};

function mbpsToBps(mbps: number): number {
  return mbps * 1024 * 1024;
}

type Props = {
  row: TorrentRow;
  detail: TorrentDetails | null;
  liveStats: LiveStats | null;
  trackers: string[];
};

export function TorrentOverviewPanel({
  row,
  detail,
  liveStats,
  trackers,
}: Props) {
  const stats = row.stats;
  const total = stats?.total_bytes ?? 0;
  const prog = stats?.progress_bytes ?? 0;
  const pct = total > 0 ? (100 * prog) / total : 0;
  const downMbps = liveStats?.download_speed?.mbps ?? 0;
  const upMbps = liveStats?.upload_speed?.mbps ?? 0;
  const down = mbpsToBps(downMbps);
  const eta =
    down > 0 && total > prog ? (total - prog) / down : null;
  const peers = liveStats?.snapshot?.peer_stats;

  const peerCount = peers
    ? (peers.live ?? 0) +
      (peers.connecting ?? 0) +
      (peers.queued ?? 0) +
      (peers.seen ?? 0)
    : undefined;
  const state = formatTorrentState(stats?.state, {
    finished: stats?.finished,
    error: stats?.error,
    awaitingMetadata:
      !stats?.finished &&
      (total === 0 ||
        (stats?.state ?? "").toLowerCase().includes("initializing")),
    peerCount,
  });

  const rows: Array<{ label: string; value: string }> = [
    { label: "State", value: state.label },
    { label: "Progress", value: `${pct.toFixed(1)}%` },
    {
      label: "Downloaded",
      value: `${formatBytes(prog)} / ${formatBytes(total)}`,
    },
    {
      label: "Uploaded",
      value: formatBytes(stats?.uploaded_bytes ?? 0),
    },
    {
      label: "Share ratio",
      value: ratioString(stats?.uploaded_bytes ?? 0, prog || 1),
    },
    { label: "Download speed", value: formatBps(down) },
    { label: "Upload speed", value: formatBps(mbpsToBps(upMbps)) },
    { label: "ETA", value: formatEta(eta) },
    {
      label: "Save path",
      value: detail?.output_folder ?? row.output_folder ?? "—",
    },
    { label: "Info hash", value: row.info_hash },
    { label: "Label", value: row.label ?? "—" },
    {
      label: "Peers (live / connecting / queued)",
      value: peers
        ? `${peers.live ?? 0} / ${peers.connecting ?? 0} / ${peers.queued ?? 0}`
        : "—",
    },
    {
      label: "Peers seen",
      value: peers?.seen != null ? String(peers.seen) : "—",
    },
    {
      label: "Time remaining",
      value: liveStats?.time_remaining?.human_readable ?? "—",
    },
  ];

  if (stats?.error) {
    rows.push({ label: "Error", value: stats.error });
  }

  return (
    <div className="detail-overview">
      <table className="kv-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 className="detail-subhead">Trackers</h4>
      {trackers.length === 0 ? (
        <p className="muted">No trackers listed.</p>
      ) : (
        <ul className="tracker-list">
          {trackers.map((t) => (
            <li key={t}>
              <code>{t}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
