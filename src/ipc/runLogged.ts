import { formatInvokeError } from "./invokeError";
import { logFrontendEvent } from "./client";

function newCorr(): string {
  const n = Math.floor(Math.random() * 0xffffffff);
  return n.toString(16).padStart(8, "0");
}

/** Run an async IPC action; log normalized errors instead of silent rejection. */
export async function runLogged<T>(
  action: string,
  log: (line: string) => void,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const corr = newCorr();
  try {
    return await fn();
  } catch (e) {
    const raw = formatInvokeError(e);
    const msg = `${action} failed: ${raw} corr=${corr}`;
    log(msg);
    void logFrontendEvent("ipc_invoke_failed", msg, corr, action).catch(
      () => undefined,
    );
    return undefined;
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
    const raw = formatInvokeError(e);
    const msg = `${action} failed: ${raw} corr=${corr}`;
    log(msg);
    void logFrontendEvent("ipc_invoke_failed", msg, corr, action).catch(
      () => undefined,
    );
  });
}
