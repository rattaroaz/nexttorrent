export function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

export function formatBps(n: number): string {
  if (n < 1) {
    return "0 B/s";
  }
  return `${formatBytes(n)}/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (
    seconds == null ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds === Infinity
  ) {
    return "—";
  }
  const s = Math.floor(seconds);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ${s % 60}s`;
  }
  const h = Math.floor(m / 60);
  if (h < 48) {
    return `${h}h ${m % 60}m`;
  }
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function ratioString(up: number, down: number): string {
  if (down <= 0) {
    return "—";
  }
  return (up / down).toFixed(2);
}

/** Visual tone for torrent lifecycle state badges. */
export type TorrentStateTone =
  | "downloading"
  | "seeding"
  | "paused"
  | "error"
  | "queued"
  | "idle";

export type TorrentStateDisplay = {
  label: string;
  tone: TorrentStateTone;
};

export type TorrentStateOpts = {
  finished?: boolean;
  error?: string | null;
  /** True when total size is still unknown (magnet metadata not fetched). */
  awaitingMetadata?: boolean;
  /** Connected / connecting / seen peer count when available. */
  peerCount?: number;
};

/**
 * Map raw librqbit / app state strings into short UI labels.
 * Prefer finished + live → Seeding; finished + paused → Done.
 */
export function formatTorrentState(
  state: string | null | undefined,
  opts?: TorrentStateOpts,
): TorrentStateDisplay {
  if (opts?.error) {
    return { label: "Error", tone: "error" };
  }
  const raw = (state ?? "").toLowerCase().trim();
  const finished = opts?.finished === true;

  if (raw.includes("error") || raw.includes("fail")) {
    return { label: "Error", tone: "error" };
  }
  if (raw.includes("paused") || raw === "paused") {
    return {
      label: finished ? "Done" : "Paused",
      tone: finished ? "seeding" : "paused",
    };
  }
  if (raw.includes("initializing") || opts?.awaitingMetadata) {
    return { label: "Fetching metadata", tone: "queued" };
  }
  if (raw.includes("queued")) {
    return { label: "Queued", tone: "queued" };
  }
  if (raw.includes("checking") || raw.includes("hash") || raw.includes("verify")) {
    return { label: "Checking", tone: "queued" };
  }
  if (finished || raw.includes("seed")) {
    return { label: "Seeding", tone: "seeding" };
  }
  if (
    raw.includes("live") ||
    raw.includes("download") ||
    raw.includes("active") ||
    raw.includes("running")
  ) {
    const peers = opts?.peerCount;
    if (peers != null && peers <= 0) {
      return { label: "Connecting", tone: "queued" };
    }
    return { label: "Downloading", tone: "downloading" };
  }
  if (!raw) {
    return { label: "—", tone: "idle" };
  }
  // Fallback: title-case the raw token
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  return { label, tone: "idle" };
}
