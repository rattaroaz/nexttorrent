import { formatBytes } from "../utils/format";

type PeerEntry = {
  state?: string;
  counters?: {
    fetched_bytes?: number;
    connections?: number;
    errors?: number;
    fetched_chunks?: number;
  };
};

type Props = {
  peerDump: Record<string, PeerEntry> | null;
};

export function TorrentPeersPanel({ peerDump }: Props) {
  if (!peerDump || Object.keys(peerDump).length === 0) {
    return <p className="muted">No live peers.</p>;
  }

  const entries = Object.entries(peerDump).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="table-scroll-inner">
      <table className="data-table">
        <thead>
          <tr>
            <th>Address</th>
            <th>State</th>
            <th>Down</th>
            <th>Conns</th>
            <th>Chunks</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([addr, p]) => (
            <tr key={addr}>
              <td>
                <code>{addr}</code>
              </td>
              <td>{p.state ?? "—"}</td>
              <td>{formatBytes(p.counters?.fetched_bytes ?? 0)}</td>
              <td>{p.counters?.connections ?? 0}</td>
              <td>{p.counters?.fetched_chunks ?? 0}</td>
              <td>{p.counters?.errors ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
