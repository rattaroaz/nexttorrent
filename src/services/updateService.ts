import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

import { APP_NAME, APP_VERSION } from "../lib/constants";
import { isVersionNewer } from "../lib/semver";
import { formatInvokeError } from "../ipc/invokeError";
import {
  closeUpdateDialog,
  openUpdateDialog,
  setUpdateDialog,
} from "./updateUi";

export const UPDATE_FEED_UNAVAILABLE_MESSAGE =
  `No update feed is published yet for ${APP_NAME}.\n\n` +
  `Publish a GitHub Release that includes latest.json (signed installers), ` +
  `or verify plugins.updater.endpoints in tauri.conf.json points at:\n` +
  `https://github.com/<ORG>/<REPO>/releases/latest/download/latest.json`;

function upToDateMessage(): string {
  return `You are on the latest version (${APP_VERSION}).`;
}

export function isUpdateFeedUnavailable(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("could not fetch a valid release json") ||
    m.includes("failed to fetch") ||
    m.includes("404") ||
    m.includes("not found")
  );
}

export type CheckForUpdatesOptions = {
  /** Optional activity-log sink (Settings / View logs). */
  log?: (line: string) => void;
};

/**
 * Manual update check: fetch signed latest.json, confirm, download, install, relaunch.
 * Never runs automatically on startup.
 */
export async function checkForUpdatesAndApply(
  options: CheckForUpdatesOptions = {},
): Promise<void> {
  const log = options.log ?? (() => undefined);

  if (import.meta.env.VITE_E2E_MOCK === "1") {
    openUpdateDialog(upToDateMessage());
    setUpdateDialog({ phase: "up_to_date", message: upToDateMessage() });
    log(`E2E: update check skipped (installed ${APP_VERSION}).`);
    return;
  }

  openUpdateDialog("Checking for updates…");
  log(`Checking for updates (installed ${APP_VERSION})…`);

  try {
    const update = await check({ allowDowngrades: false });

    if (!update || !isVersionNewer(update.version, APP_VERSION)) {
      const msg = upToDateMessage();
      setUpdateDialog({ phase: "up_to_date", message: msg });
      log(msg);
      return;
    }

    const ok = await ask(
      `Version ${update.version} is available` +
        (update.date ? ` (${update.date})` : "") +
        `. Download and install now?\n\n${APP_NAME} will restart after install.`,
      { title: "Update available", kind: "info" },
    );
    if (!ok) {
      closeUpdateDialog();
      log("Update declined.");
      return;
    }

    setUpdateDialog({
      phase: "downloading",
      message: `Downloading ${update.version}…`,
    });
    log(`Downloading update ${update.version}…`);

    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        log("Update download started.");
      } else if (event.event === "Finished") {
        log("Update download finished.");
      }
    });

    setUpdateDialog({
      phase: "installing",
      message: "Installing update and restarting…",
    });
    log(`Update ${update.version} installed — relaunching.`);
    await relaunch();
  } catch (e) {
    const raw = formatInvokeError(e);
    const message = isUpdateFeedUnavailable(raw)
      ? UPDATE_FEED_UNAVAILABLE_MESSAGE
      : raw;
    setUpdateDialog({ phase: "error", message });
    log(`Update check failed: ${raw}`);
  }
}
