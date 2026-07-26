import { formatInvokeError } from "./invokeError";

/** Run an async IPC action; log normalized errors instead of silent rejection. */
export async function runLogged<T>(
  action: string,
  log: (line: string) => void,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    log(`${action} failed: ${formatInvokeError(e)}`);
    return undefined;
  }
}

/** Fire-and-forget with activity log on failure. */
export function runLoggedVoid(
  action: string,
  log: (line: string) => void,
  fn: () => Promise<unknown>,
): void {
  void fn().catch((e) => {
    log(`${action} failed: ${formatInvokeError(e)}`);
  });
}
