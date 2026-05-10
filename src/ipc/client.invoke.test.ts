import { beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  diskFreeBytes,
  quitApp,
  setTorrentLabel,
  torrentAddFile,
  torrentAddMagnet,
  torrentPause,
  torrentRemove,
  torrentUpdateOnlyFiles,
} from "./client";
import { IPC_COMMANDS } from "./contracts";

beforeEach(() => {
  vi.mocked(core.invoke).mockReset();
});

describe("ipc invoke payloads (camelCase for Tauri 2)", () => {
  it("torrentAddFile passes camelCase keys", async () => {
    vi.mocked(core.invoke).mockResolvedValue({});
    await torrentAddFile("/abs/a.torrent", "/out", [1, 2], true);
    expect(core.invoke).toHaveBeenCalledWith(IPC_COMMANDS.torrentAddFile, {
      torrentPath: "/abs/a.torrent",
      outputFolder: "/out",
      onlyFiles: [1, 2],
      paused: true,
    });
  });

  it("torrentAddMagnet passes camelCase keys", async () => {
    vi.mocked(core.invoke).mockResolvedValue({});
    const m =
      "magnet:?xt=urn:btih:cab507494d02ebb1178b38f2e9d7be299c86b862";
    await torrentAddMagnet(m, null, null, false);
    expect(core.invoke).toHaveBeenCalledWith(IPC_COMMANDS.torrentAddMagnet, {
      magnet: m,
      outputFolder: null,
      onlyFiles: null,
      paused: false,
    });
  });

  it("torrentPause passes torrentRef", async () => {
    vi.mocked(core.invoke).mockResolvedValue(undefined);
    await torrentPause("42");
    expect(core.invoke).toHaveBeenCalledWith(IPC_COMMANDS.torrentPause, {
      torrentRef: "42",
    });
  });

  it("setTorrentLabel passes infoHash and label", async () => {
    vi.mocked(core.invoke).mockResolvedValue(undefined);
    await setTorrentLabel("deadbeef", "movies");
    expect(core.invoke).toHaveBeenCalledWith(IPC_COMMANDS.setTorrentLabel, {
      infoHash: "deadbeef",
      label: "movies",
    });
  });

  it("torrentRemove passes torrentRef and deleteFiles", async () => {
    vi.mocked(core.invoke).mockResolvedValue(undefined);
    await torrentRemove("7", true);
    expect(core.invoke).toHaveBeenCalledWith(IPC_COMMANDS.torrentRemove, {
      torrentRef: "7",
      deleteFiles: true,
    });
  });

  it("torrentUpdateOnlyFiles passes torrentRef and fileIndices", async () => {
    vi.mocked(core.invoke).mockResolvedValue(undefined);
    await torrentUpdateOnlyFiles("9", [0, 2]);
    expect(core.invoke).toHaveBeenCalledWith(
      IPC_COMMANDS.torrentUpdateOnlyFiles,
      {
        torrentRef: "9",
        fileIndices: [0, 2],
      },
    );
  });

  it("diskFreeBytes passes path", async () => {
    vi.mocked(core.invoke).mockResolvedValue(123);
    await diskFreeBytes("/tmp");
    expect(core.invoke).toHaveBeenCalledWith(IPC_COMMANDS.diskFreeBytes, {
      path: "/tmp",
    });
  });

  it("quitApp invokes without payload", async () => {
    vi.mocked(core.invoke).mockResolvedValue(undefined);
    await quitApp();
    expect(core.invoke).toHaveBeenCalledWith(IPC_COMMANDS.quitApp);
  });
});
