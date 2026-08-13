import { formatInvokeError, isTorrentUnavailableError } from "./invokeError";
import { logFrontendEvent } from "./client";

function newCorr(): string {
  const n = Math.floor(Math.random() * 0xffffffff);
  return n.toString(16).padStart(8, "0");
}

type LoggedResult<T> = { ok: true; value: T } | { ok: false };

/** Run an async IPC action; log normalized errors instead of silent rejection. */
export async function runLogged<T>(
  action: string,
  log: (line: string) => void,
  fn: () => Promise<T>,
): Promise<LoggedResult<T>> {
  const corr = newCorr();
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (isTorrentUnavailableError(e)) {
      return { ok: false };
    }
    const raw = formatInvokeError(e);
    const msg = `${action} failed: ${raw} corr=${corr}`;
    log(msg);
    void logFrontendEvent("ipc_invoke_failed", msg, corr, action).catch(
      () => undefined,
    );
    return { ok: false };
  }
}

/** Fire-and-forget with activity log on failure. */
export function runLoggedVoid(
  action: string,
  log: (line: string) => void,
  fn: () => Promise<unknown>,
): void {
  const corr = newCorr();
  void fn().catch((e) => {
    if (isTorrentUnavailableError(e)) {
      return;
    }
    const raw = formatInvokeError(e);
    const msg = `${action} failed: ${raw} corr=${corr}`;
    log(msg);
    void logFrontendEvent("ipc_invoke_failed", msg, corr, action).catch(
      () => undefined,
    );
  });
}
