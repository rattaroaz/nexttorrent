import { describe, expect, it } from "vitest";

import { formatInvokeError, isTorrentUnavailableError } from "./invokeError";

describe("formatInvokeError", () => {
  it("passes through strings", () => {
    expect(formatInvokeError("bad")).toBe("bad");
  });

  it("uses Error.message", () => {
    expect(formatInvokeError(new Error("oops"))).toBe("oops");
  });

  it("reads message from plain objects", () => {
    expect(formatInvokeError({ message: "from obj" })).toBe("from obj");
  });

  it("falls back to JSON for unknown shapes", () => {
    expect(formatInvokeError({ code: 42 })).toBe('{"code":42}');
  });
});

describe("isTorrentUnavailableError", () => {
  it("treats missing and initializing torrents as non-failures", () => {
    expect(isTorrentUnavailableError("torrent 3 not found")).toBe(true);
    expect(isTorrentUnavailableError("torrent not live")).toBe(true);
    expect(
      isTorrentUnavailableError(
        "no chunk tracker, torrent neither paused nor live",
      ),
    ).toBe(true);
  });

  it("does not swallow real torrent failures", () => {
    expect(
      isTorrentUnavailableError("can't pause torrent in error state"),
    ).toBe(false);
    expect(isTorrentUnavailableError("disk full")).toBe(false);
  });
});
