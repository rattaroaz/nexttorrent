import { invoke } from "@tauri-apps/api/core";

import {
  IPC_COMMANDS,
  type NexttorrentSettings,
  type RssPollResult,
  type SessionSnapshot,
  type TorrentDetails,
  type TorrentRow,
  type TorrentsUpdatePayload,
} from "./contracts";

export async function quitApp(): Promise<void> {
  return invoke(IPC_COMMANDS.quitApp);
}

export async function getSessionSnapshot(): Promise<SessionSnapshot> {
  return invoke(IPC_COMMANDS.getSessionSnapshot);
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

export async function rssPollFeeds(): Promise<RssPollResult> {
  return invoke(IPC_COMMANDS.rssPollFeeds);
}

export async function diskFreeBytes(path: string): Promise<number> {
  return invoke(IPC_COMMANDS.diskFreeBytes, { path });
}

export async function watchPoll(): Promise<number> {
  return invoke(IPC_COMMANDS.watchPoll);
}
