import type { RssFeedEntry, TorrentRow } from "../../ipc/contracts";

export type TabId =
  | "overview"
  | "files"
  | "peers"
  | "trackers"
  | "pieces"
  | "activity";

export type SortKey =
  | "name"
  | "progress"
  | "size"
  | "eta"
  | "down"
  | "up"
  | "ratio"
  | "state";

export type SortDir = "asc" | "desc";

export const SORT_COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> =
  [
    { key: "name", label: "Name" },
    { key: "progress", label: "Progress", numeric: true },
    { key: "size", label: "Size", numeric: true },
    { key: "eta", label: "ETA", numeric: true },
    { key: "down", label: "Down", numeric: true },
    { key: "up", label: "Up", numeric: true },
    { key: "ratio", label: "Ratio", numeric: true },
    { key: "state", label: "State" },
  ];

export function torrentRef(row: TorrentRow): string {
  if (row.id != null) {
    return String(row.id);
  }
  return row.info_hash;
}

export function mbpsToApproxBps(mbps: number): number {
  return mbps * 1024 * 1024;
}

export function categoryPathsToText(
  map: Record<string, string> | undefined,
): string {
  if (!map) {
    return "";
  }
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function textToCategoryPaths(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (key && val) {
      out[key] = val;
    }
  }
  return out;
}

export function defaultRssFeed(id: string): RssFeedEntry {
  return {
    id,
    url: "",
    name: null,
    kind: "rss",
    apiKey: null,
    enabled: true,
    autoAdd: false,
    lastSeenIds: [],
    titleRegex: null,
    excludeRegex: null,
    qualityFilter: null,
    categorySavePaths: {},
    defaultSavePath: null,
  };
}
