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
