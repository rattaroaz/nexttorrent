import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatBps,
  formatEta,
  formatTorrentState,
  ratioString,
} from "./format";

describe("formatBytes", () => {
  it("formats small and large values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});

describe("formatBps", () => {
  it("shows zero for tiny rates", () => {
    expect(formatBps(0)).toBe("0 B/s");
    expect(formatBps(0.5)).toBe("0 B/s");
  });
});

describe("formatEta", () => {
  it("handles edge cases", () => {
    expect(formatEta(null)).toBe("—");
    expect(formatEta(Infinity)).toBe("—");
    expect(formatEta(45)).toBe("45s");
    expect(formatEta(125)).toBe("2m 5s");
  });
});

describe("ratioString", () => {
  it("formats ratio or dash", () => {
    expect(ratioString(100, 0)).toBe("—");
    expect(ratioString(200, 100)).toBe("2.00");
  });
});

describe("formatTorrentState", () => {
  it("maps common states", () => {
    expect(
      formatTorrentState("live", { finished: false, peerCount: 3 }).label,
    ).toBe("Downloading");
    expect(formatTorrentState("live", { finished: true }).label).toBe(
      "Seeding",
    );
    expect(formatTorrentState("paused", { finished: false }).label).toBe(
      "Paused",
    );
    expect(formatTorrentState("paused", { finished: true }).label).toBe("Done");
    expect(formatTorrentState("live", { error: "disk full" }).tone).toBe(
      "error",
    );
  });

  it("clarifies wait states", () => {
    expect(formatTorrentState("initializing").label).toBe("Fetching metadata");
    expect(
      formatTorrentState("live", { finished: false, peerCount: 0 }).label,
    ).toBe("Connecting");
    expect(formatTorrentState("live", { awaitingMetadata: true }).label).toBe(
      "Fetching metadata",
    );
  });
});
