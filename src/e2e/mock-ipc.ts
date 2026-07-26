/**
 * IPC mocks for Playwright smoke tests (browser-only, no Tauri shell).
 */
import { mockIPC } from "@tauri-apps/api/mocks";

import {
  DEFAULT_NEXTTORRENT_SETTINGS,
  type NexttorrentSettings,
  type TorrentsUpdatePayload,
} from "../ipc/contracts";

const emptyPayload: TorrentsUpdatePayload = {
  torrents: [],
  session: {
    fetched_bytes: 0,
    uploaded_bytes: 0,
    download_speed: { mbps: 0, human_readable: "0 B/s" },
    upload_speed: { mbps: 0, human_readable: "0 B/s" },
    peers: null,
    uptime_seconds: 0,
  },
};

let settingsStore: NexttorrentSettings = {
  ...DEFAULT_NEXTTORRENT_SETTINGS,
};

const magnetCalls: string[] = [];
const saveCalls: NexttorrentSettings[] = [];

export function e2eMagnetCalls(): string[] {
  return [...magnetCalls];
}

export function e2eSaveCalls(): NexttorrentSettings[] {
  return [...saveCalls];
}

export function installE2eMocks(): void {
  mockIPC(
    (cmd, args) => {
    switch (cmd) {
      case "get_session_snapshot":
        return {
          downloadDir: "/downloads",
          effectiveDownloadDir: "/downloads",
          configDir: "/config",
          cacheDir: "/cache",
          logFilter: "info",
          rqbitVersion: "8.1.1",
        };
      case "get_nexttorrent_settings":
        return { ...settingsStore };
      case "save_nexttorrent_settings": {
        const next = (args as { settings: NexttorrentSettings }).settings;
        settingsStore = { ...next };
        saveCalls.push({ ...next });
        return null;
      }
      case "torrent_build_update_payload":
        return emptyPayload;
      case "torrent_add_magnet": {
        const magnet = (args as { magnet: string }).magnet;
        magnetCalls.push(magnet);
        return {
          id: 1,
          details: {
            info_hash: "a".repeat(40),
            name: "E2E magnet",
            output_folder: "/downloads",
          },
        };
      }
      case "open_logs_folder":
        return "C:\\mock\\config";
      case "get_activity_log":
        return { traceLines: ["INFO e2e — mock trace"], diagFileLines: [], sessionFileLines: [] };
      case "list_network_interfaces":
        return [{ name: "eth0", receivedBytes: 0, transmittedBytes: 0 }];
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);
}

// Expose for Playwright assertions
(
  window as unknown as {
    __NEXTTORRENT_E2E__: {
      magnetCalls: () => string[];
      saveCalls: () => NexttorrentSettings[];
    };
  }
).__NEXTTORRENT_E2E__ = {
  magnetCalls: e2eMagnetCalls,
  saveCalls: e2eSaveCalls,
};
