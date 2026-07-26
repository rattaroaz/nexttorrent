import { describe, expect, it } from "vitest";

import {
  buildActivityLogText,
  filterLogLines,
  inferLineSeverity,
  lineMatchesLevel,
  shouldShowSessionFile,
  stripLeadingTimestamp,
} from "./logFilter";

describe("logFilter", () => {
  it("infers severity from trace and diag lines", () => {
    expect(inferLineSeverity("INFO crate::foo — started")).toBe("info");
    expect(inferLineSeverity("WARN crate::foo — slow")).toBe("warn");
    expect(inferLineSeverity("ERROR crate::foo — failed")).toBe("error");
    expect(inferLineSeverity("2025-01-01T12:00:00.000 ! cmd — oops")).toBe(
      "error",
    );
    expect(inferLineSeverity("12:00:00 — Added magnet")).toBe("info");
    expect(inferLineSeverity("=== Session ===")).toBeNull();
  });

  it("strips leading timestamps before severity tokens", () => {
    expect(
      stripLeadingTimestamp("2026-07-09T12:00:00.123 INFO nexttorrent — ready"),
    ).toBe("INFO nexttorrent — ready");
    expect(
      inferLineSeverity("2026-07-09T12:00:00.123 WARN nexttorrent — slow"),
    ).toBe("warn");
  });

  it("treats UI session failures as errors", () => {
    expect(inferLineSeverity("3:04:05 PM — Add magnet failed: bad uri")).toBe(
      "error",
    );
    expect(
      inferLineSeverity("12:00:00 — Load peer stats failed: timeout"),
    ).toBe("error");
    expect(inferLineSeverity("12:00:00 — disk error while writing")).toBe(
      "error",
    );
  });

  it("filters with inclusive minimum level", () => {
    const lines = [
      "INFO one",
      "WARN two",
      "ERROR three",
      "12:00 — ui ok",
      "12:00 — Add torrent failed: x",
    ];
    expect(filterLogLines(lines, "error")).toEqual([
      "ERROR three",
      "12:00 — Add torrent failed: x",
    ]);
    expect(filterLogLines(lines, "warn")).toEqual([
      "WARN two",
      "ERROR three",
      "12:00 — Add torrent failed: x",
    ]);
    expect(filterLogLines(lines, "info")).toEqual(lines);
  });

  it("lineMatchesLevel respects hierarchy", () => {
    expect(lineMatchesLevel("WARN x", "warn")).toBe(true);
    expect(lineMatchesLevel("INFO x", "warn")).toBe(false);
    expect(lineMatchesLevel("ERROR x", "warn")).toBe(true);
  });

  it("omits session file when it mirrors the ring", () => {
    const ring = [
      "2026-01-01T00:00:00.000 INFO a — one",
      "2026-01-01T00:00:01.000 WARN a — two",
    ];
    const file = [
      "2026-01-01T00:00:00.000 INFO a — one",
      "2026-01-01T00:00:01.000 WARN a — two",
    ];
    expect(shouldShowSessionFile(ring, file)).toBe(false);
    expect(
      shouldShowSessionFile(ring, [
        ...file,
        "2026-01-01T00:00:02.000 INFO a — only on disk",
      ]),
    ).toBe(true);
  });

  it("buildActivityLogText omits empty sections when filtered", () => {
    const text = buildActivityLogText(
      {
        sessionLines: ["12:00 — hello"],
        traceLines: ["WARN backend — issue"],
        sessionFileLines: [],
        diagLines: [],
        loadError: null,
      },
      "error",
    );
    expect(text).toBe("No log lines at error level or above.");

    const warnText = buildActivityLogText(
      {
        sessionLines: ["12:00 — hello"],
        traceLines: ["WARN backend — issue", "ERROR backend — boom"],
        sessionFileLines: [],
        diagLines: [],
        loadError: null,
      },
      "warn",
    );
    expect(warnText).toContain("WARN backend — issue");
    expect(warnText).toContain("ERROR backend — boom");
    expect(warnText).not.toContain("===");
  });

  it("buildActivityLogText de-dupes nexttorrent.log when mirrored", () => {
    const shared = "2026-01-01T00:00:00.000 INFO app — ready";
    const text = buildActivityLogText(
      {
        sessionLines: [],
        traceLines: [shared],
        sessionFileLines: [shared],
        diagLines: [],
        loadError: null,
      },
      "all",
    );
    expect(text).toContain("Backend trace");
    expect(text).not.toContain("nexttorrent.log");
  });
});
