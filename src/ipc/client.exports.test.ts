import { describe, expect, it } from "vitest";
import * as client from "./client";
import { IPC_COMMANDS } from "./contracts";

const COMMAND_TO_EXPORT: Record<string, keyof typeof client> = {
  [IPC_COMMANDS.quitApp]: "quitApp",
  [IPC_COMMANDS.getSessionSnapshot]: "getSessionSnapshot",
  [IPC_COMMANDS.resolveDownloadPath]: "resolveDownloadPath",
  [IPC_COMMANDS.torrentListFull]: "torrentListFull",
  [IPC_COMMANDS.torrentBuildUpdatePayload]: "torrentBuildUpdatePayload",
  [IPC_COMMANDS.torrentAddMagnet]: "torrentAddMagnet",
  [IPC_COMMANDS.torrentAddFile]: "torrentAddFile",
  [IPC_COMMANDS.torrentPause]: "torrentPause",
  [IPC_COMMANDS.torrentResume]: "torrentResume",
  [IPC_COMMANDS.torrentRemove]: "torrentRemove",
  [IPC_COMMANDS.torrentUpdateOnlyFiles]: "torrentUpdateOnlyFiles",
  [IPC_COMMANDS.torrentForceRecheck]: "torrentForceRecheck",
  [IPC_COMMANDS.torrentDetails]: "torrentDetails",
  [IPC_COMMANDS.torrentPeerStats]: "torrentPeerStats",
  [IPC_COMMANDS.torrentLiveStats]: "torrentLiveStats",
  [IPC_COMMANDS.torrentPieceBitmapDump]: "torrentPieceDump",
  [IPC_COMMANDS.torrentStats]: "torrentStats",
  [IPC_COMMANDS.sessionDhtStats]: "sessionDhtStats",
  [IPC_COMMANDS.getNexttorrentSettings]: "getNexttorrentSettings",
  [IPC_COMMANDS.saveNexttorrentSettings]: "saveNexttorrentSettings",
  [IPC_COMMANDS.setTorrentLabel]: "setTorrentLabel",
  [IPC_COMMANDS.exportConfigurationPaths]: "exportConfigurationPaths",
  [IPC_COMMANDS.exportConfigurationBundle]: "exportConfigurationBundle",
  [IPC_COMMANDS.importConfigurationBundle]: "importConfigurationBundle",
  [IPC_COMMANDS.listNetworkInterfaces]: "listNetworkInterfaces",
  [IPC_COMMANDS.torrentPauseAll]: "torrentPauseAll",
  [IPC_COMMANDS.torrentResumeAll]: "torrentResumeAll",
  [IPC_COMMANDS.torrentOpenFolder]: "torrentOpenFolder",
  [IPC_COMMANDS.torrentRevealFile]: "torrentRevealFile",
  [IPC_COMMANDS.torrentTrackers]: "torrentTrackers",
  [IPC_COMMANDS.getTorrentBandwidthLimits]: "getTorrentBandwidthLimits",
  [IPC_COMMANDS.setTorrentBandwidthLimits]: "setTorrentBandwidthLimits",
  [IPC_COMMANDS.rssPollFeeds]: "rssPollFeeds",
  [IPC_COMMANDS.diskFreeBytes]: "diskFreeBytes",
  [IPC_COMMANDS.watchPoll]: "watchPoll",
  [IPC_COMMANDS.getActivityLog]: "getActivityLog",
  [IPC_COMMANDS.openLogsFolder]: "openLogsFolder",
  [IPC_COMMANDS.updaterCheckFeed]: "updaterCheckFeed",
  [IPC_COMMANDS.updaterDownloadAndInstall]: "updaterDownloadAndInstall",
};

describe("client exports", () => {
  it("exposes a wrapper for every IPC command", () => {
    const commands = Object.values(IPC_COMMANDS);
    expect(commands).toHaveLength(Object.keys(COMMAND_TO_EXPORT).length);
    for (const cmd of commands) {
      const exportName = COMMAND_TO_EXPORT[cmd];
      expect(exportName, `missing mapping for ${cmd}`).toBeDefined();
      expect(typeof client[exportName!]).toBe("function");
    }
  });
});
