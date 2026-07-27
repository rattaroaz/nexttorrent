import { invoke } from "@tauri-apps/api/core";

import {
  IPC_COMMANDS,
  type ActivityLogSnapshot,
  type NexttorrentSettings,
  type NetworkInterfaceInfo,
  type PathsSnapshot,
  type PerTorrentBandwidthLimits,
  type RssPollResult,
  type SessionSnapshot,
  type TorrentDetails,
  type TorrentRow,
  type TorrentsUpdatePayload,
  type UpdaterCheckResult,
} from "./contracts";

export async function quitApp(): Promise<void> {
  return invoke(IPC_COMMANDS.quitApp);
}

export async function getSessionSnapshot(): Promise<SessionSnapshot> {
  return invoke(IPC_COMMANDS.getSessionSnapshot);
}

export async function resolveDownloadPath(
  relativePath: string,
): Promise<string> {
  return invoke(IPC_COMMANDS.resolveDownloadPath, { relativePath });
}

export async function torrentListFull(): Promise<{ torrents: TorrentRow[] }> {
  return invoke(IPC_COMMANDS.torrentListFull);
}

export async function torrentBuildUpdatePayload(): Promise<TorrentsUpdatePayload> {
  return invoke(IPC_COMMANDS.torrentBuildUpdatePayload);
}

export async function torrentAddMagnet(
  magnet: string,
  outputFolder: string | null,
  onlyFiles: number[] | null,
  paused: boolean,
): Promise<unknown> {
  return invoke(IPC_COMMANDS.torrentAddMagnet, {
    magnet,
    outputFolder,
    onlyFiles,
    paused,
  });
}

export async function torrentAddFile(
  torrentPath: string,
  outputFolder: string | null,
  onlyFiles: number[] | null,
  paused: boolean,
): Promise<unknown> {
  return invoke(IPC_COMMANDS.torrentAddFile, {
    torrentPath,
    outputFolder,
    onlyFiles,
    paused,
  });
}

export async function torrentPause(torrentRef: string): Promise<void> {
  return invoke(IPC_COMMANDS.torrentPause, { torrentRef });
}

export async function torrentResume(torrentRef: string): Promise<void> {
  return invoke(IPC_COMMANDS.torrentResume, { torrentRef });
}

export async function torrentRemove(
  torrentRef: string,
  deleteFiles: boolean,
): Promise<void> {
  return invoke(IPC_COMMANDS.torrentRemove, {
    torrentRef,
    deleteFiles,
  });
}

export async function torrentUpdateOnlyFiles(
  torrentRef: string,
  fileIndices: number[],
): Promise<void> {
  return invoke(IPC_COMMANDS.torrentUpdateOnlyFiles, {
    torrentRef,
    fileIndices,
  });
}

export async function torrentForceRecheck(torrentRef: string): Promise<void> {
  return invoke(IPC_COMMANDS.torrentForceRecheck, {
    torrentRef,
  });
}

export async function torrentDetails(
  torrentRef: string,
): Promise<TorrentDetails> {
  return invoke(IPC_COMMANDS.torrentDetails, { torrentRef });
}

export async function torrentPeerStats(
  torrentRef: string,
): Promise<Record<string, unknown>> {
  return invoke(IPC_COMMANDS.torrentPeerStats, {
    torrentRef,
  });
}

export async function torrentPieceDump(torrentRef: string): Promise<string> {
  return invoke(IPC_COMMANDS.torrentPieceBitmapDump, {
    torrentRef,
  });
}

export async function getNexttorrentSettings(): Promise<NexttorrentSettings> {
  return invoke(IPC_COMMANDS.getNexttorrentSettings);
}

export async function saveNexttorrentSettings(
  settings: NexttorrentSettings,
): Promise<void> {
  return invoke(IPC_COMMANDS.saveNexttorrentSettings, { settings });
}

export async function setTorrentLabel(
  infoHash: string,
  label: string | null,
): Promise<void> {
  return invoke(IPC_COMMANDS.setTorrentLabel, { infoHash, label });
}

export async function torrentPauseAll(): Promise<void> {
  return invoke(IPC_COMMANDS.torrentPauseAll);
}

export async function torrentResumeAll(): Promise<void> {
  return invoke(IPC_COMMANDS.torrentResumeAll);
}

export async function torrentOpenFolder(torrentRef: string): Promise<void> {
  return invoke(IPC_COMMANDS.torrentOpenFolder, { torrentRef });
}

export async function torrentRevealFile(
  torrentRef: string,
  fileIndex: number,
): Promise<void> {
  return invoke(IPC_COMMANDS.torrentRevealFile, { torrentRef, fileIndex });
}

export async function torrentTrackers(torrentRef: string): Promise<string[]> {
  return invoke(IPC_COMMANDS.torrentTrackers, { torrentRef });
}

export async function torrentLiveStats(torrentRef: string): Promise<unknown> {
  return invoke(IPC_COMMANDS.torrentLiveStats, { torrentRef });
}

export async function torrentStats(torrentRef: string): Promise<unknown> {
  return invoke(IPC_COMMANDS.torrentStats, { torrentRef });
}

export async function sessionDhtStats(): Promise<unknown> {
  return invoke(IPC_COMMANDS.sessionDhtStats);
}

export async function getTorrentBandwidthLimits(
  infoHash: string,
): Promise<PerTorrentBandwidthLimits> {
  return invoke(IPC_COMMANDS.getTorrentBandwidthLimits, { infoHash });
}

/** Persist limits and re-apply to a running torrent when possible. Returns whether live re-apply ran. */
export async function setTorrentBandwidthLimits(
  infoHash: string,
  downloadLimitBps: number | null,
  uploadLimitBps: number | null,
): Promise<boolean> {
  return invoke(IPC_COMMANDS.setTorrentBandwidthLimits, {
    infoHash,
    downloadLimitBps,
    uploadLimitBps,
  });
}

export async function rssPollFeeds(): Promise<RssPollResult> {
  return invoke(IPC_COMMANDS.rssPollFeeds);
}

export async function diskFreeBytes(path: string): Promise<number> {
  return invoke(IPC_COMMANDS.diskFreeBytes, { path });
}

export async function getActivityLog(
  maxLines?: number,
): Promise<ActivityLogSnapshot> {
  return invoke(IPC_COMMANDS.getActivityLog, { maxLines });
}

/** Open the OS config directory that holds nexttorrent.log / nexttorrent-diag.log. */
export async function openLogsFolder(): Promise<string> {
  return invoke(IPC_COMMANDS.openLogsFolder);
}

export async function updaterCheckFeed(): Promise<UpdaterCheckResult> {
  return invoke(IPC_COMMANDS.updaterCheckFeed);
}

export async function updaterDownloadAndInstall(
  downloadUrl: string,
  signature: string,
  version: string,
): Promise<void> {
  return invoke(IPC_COMMANDS.updaterDownloadAndInstall, {
    downloadUrl,
    signature,
    version,
  });
}

export async function getAiBrief(): Promise<string> {
  return invoke(IPC_COMMANDS.getAiBrief);
}

export async function exportAiDiagnostics(): Promise<string> {
  return invoke(IPC_COMMANDS.exportAiDiagnostics);
}

export async function logFrontendEvent(
  event: string,
  message: string,
  corr?: string | null,
  command?: string | null,
): Promise<void> {
  return invoke(IPC_COMMANDS.logFrontendEvent, {
    event,
    message,
    corr: corr ?? null,
    command: command ?? null,
  });
}

export async function watchPoll(): Promise<number> {
  return invoke(IPC_COMMANDS.watchPoll);
}

export async function exportConfigurationPaths(): Promise<PathsSnapshot> {
  return invoke(IPC_COMMANDS.exportConfigurationPaths);
}

export async function exportConfigurationBundle(
  destZip: string,
): Promise<void> {
  return invoke(IPC_COMMANDS.exportConfigurationBundle, { destZip });
}

export async function importConfigurationBundle(srcZip: string): Promise<void> {
  return invoke(IPC_COMMANDS.importConfigurationBundle, { srcZip });
}

export async function listNetworkInterfaces(): Promise<NetworkInterfaceInfo[]> {
  return invoke(IPC_COMMANDS.listNetworkInterfaces);
}
