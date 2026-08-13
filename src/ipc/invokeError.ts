/** Normalize Tauri invoke errors (not always `Error` instances). */
export function formatInvokeError(e: unknown): string {
  if (typeof e === "string") {
    return e;
  }
  if (e instanceof Error) {
    return e.message;
  }
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string") {
      return o.message;
    }
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Missing, initializing, or not-live torrent — expected while polling, not a failure. */
export function isTorrentUnavailableError(e: unknown): boolean {
  const m = formatInvokeError(e).toLowerCase();
  return (
    (m.includes("torrent") && m.includes("not found")) ||
    m.includes("torrent not live") ||
    m.includes("not live") ||
    m.includes("no chunk tracker") ||
    m.includes("neither paused nor live") ||
    m.includes("metadata is available") ||
    m.includes("metadata not ready")
  );
}
