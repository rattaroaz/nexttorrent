import { describe, expect, it } from "vitest";

import { IPC_COMMANDS, IPC_EVENTS } from "./contracts";

describe("ipc contracts", () => {
  it("uses stable quit command", () => {
    expect(IPC_COMMANDS.quitApp).toBe("quit_app");
  });

  it("uses stable invoke names for torrent commands", () => {
    expect(IPC_COMMANDS.torrentAddMagnet).toBe("torrent_add_magnet");
    expect(IPC_COMMANDS.torrentPause).toBe("torrent_pause");
    expect(IPC_COMMANDS.getNexttorrentSettings).toBe("get_nexttorrent_settings");
    expect(IPC_COMMANDS.torrentPauseAll).toBe("torrent_pause_all");
    expect(IPC_COMMANDS.rssPollFeeds).toBe("rss_poll_feeds");
    expect(IPC_COMMANDS.diskFreeBytes).toBe("disk_free_bytes");
    expect(IPC_COMMANDS.watchPoll).toBe("watch_poll");
  });

  it("uses stable event channel names", () => {
    expect(IPC_EVENTS.sessionReady).toBe("session:ready");
    expect(IPC_EVENTS.torrentsUpdate).toBe("torrents:update");
  });
});
