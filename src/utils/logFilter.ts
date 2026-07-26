export type LogLevelFilter = "all" | "info" | "warn" | "error";

export type ActivityLogSnapshotInput = {
  sessionLines: string[];
  traceLines: string[];
  sessionFileLines: string[];
  diagLines: string[];
  loadError: string | null;
};

export const LOG_LEVEL_OPTIONS: { value: LogLevelFilter; label: string }[] = [
  { value: "all", label: "All levels" },
  { value: "info", label: "Info and above" },
  { value: "warn", label: "Warn and above" },
  { value: "error", label: "Errors only" },
];

/** Strip leading ISO-ish timestamps so severity tokens can be matched. */
export function stripLeadingTimestamp(line: string): string {
  // 2026-07-09T12:34:56.789 or 2026-07-09T12:34:56
  return line.replace(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+/,
    "",
  );
}

/** Infer severity from a backend trace line, UI session line, or diag entry. */
export function inferLineSeverity(
  line: string,
): "info" | "warn" | "error" | null {
  if (line.startsWith("===") || !line.trim()) {
    return null;
  }
  const body = stripLeadingTimestamp(line);
  const upper = body.toUpperCase();

  const isDiagBang =
    body.includes(" ! ") || body.startsWith("! ") || /^\S+\s+!\s+/.test(body);

  if (
    body.startsWith("ERROR") ||
    upper.startsWith("ERROR ") ||
    isDiagBang ||
    /\bfailed\b/i.test(body) ||
    /\berror\b/i.test(body)
  ) {
    // Prefer explicit level tokens over substring matches when present.
    if (body.startsWith("WARN") || upper.startsWith("WARN ")) {
      return "warn";
    }
    if (body.startsWith("INFO") || upper.startsWith("INFO ")) {
      // e.g. "INFO … error=…" still counts as info-level event unless it's a failure line
      if (/\bfailed\b/i.test(body) || isDiagBang) {
        return "error";
      }
      return "info";
    }
    return "error";
  }
  if (body.startsWith("WARN") || upper.startsWith("WARN ")) {
    return "warn";
  }
  if (body.startsWith("INFO") || upper.startsWith("INFO ")) {
    return "info";
  }
  // UI session clock lines: "3:04:05 PM — …"
  if (/\bfailed\b/i.test(body) || /\berror\b/i.test(body)) {
    return "error";
  }
  return "info";
}

function severityRank(severity: "info" | "warn" | "error"): number {
  return severity === "info" ? 0 : severity === "warn" ? 1 : 2;
}

export function lineMatchesLevel(line: string, filter: LogLevelFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (line.startsWith("===")) {
    return false;
  }
  const severity = inferLineSeverity(line);
  if (severity === null) {
    return false;
  }
  const minRank =
    filter === "info" ? 0 : filter === "warn" ? 1 : /* error */ 2;
  return severityRank(severity) >= minRank;
}

export function filterLogLines(
  lines: string[],
  filter: LogLevelFilter,
): string[] {
  if (filter === "all") {
    return lines;
  }
  return lines.filter((line) => lineMatchesLevel(line, filter));
}

/** Normalize for de-dupe: drop leading timestamp + collapse whitespace. */
export function normalizeLogLineForCompare(line: string): string {
  return stripLeadingTimestamp(line).replace(/\s+/g, " ").trim();
}

/**
 * If the session file is just a disk mirror of the in-memory ring (same tail),
 * omit it from the UI so users don't see the same events twice.
 */
export function shouldShowSessionFile(
  traceLines: string[],
  sessionFileLines: string[],
): boolean {
  if (sessionFileLines.length === 0) {
    return false;
  }
  if (traceLines.length === 0) {
    return true;
  }
  const fileNorm = sessionFileLines.map(normalizeLogLineForCompare);
  const ringNorm = new Set(traceLines.map(normalizeLogLineForCompare));
  // Show file only if it has content not already present in the ring.
  const uniqueInFile = fileNorm.filter((l) => l && !ringNorm.has(l));
  return uniqueInFile.length > 0;
}

export function buildActivityLogText(
  snapshot: ActivityLogSnapshotInput,
  filter: LogLevelFilter,
): string {
  const sections: string[] = [];

  const addSection = (title: string, lines: string[]) => {
    const filtered = filterLogLines(lines, filter);
    if (filtered.length === 0) {
      return;
    }
    if (filter === "all") {
      sections.push(`=== ${title} ===`);
    }
    sections.push(...filtered);
    if (filter === "all") {
      sections.push("");
    }
  };

  if (snapshot.loadError && (filter === "all" || filter === "error")) {
    if (filter === "all") {
      sections.push("=== Backend log error ===");
    }
    sections.push(snapshot.loadError);
    if (filter === "all") {
      sections.push("");
    }
  }

  addSection("Session", snapshot.sessionLines);
  addSection("Backend trace", snapshot.traceLines);
  if (shouldShowSessionFile(snapshot.traceLines, snapshot.sessionFileLines)) {
    addSection("nexttorrent.log (extra)", snapshot.sessionFileLines);
  }
  // Diag stays failure-only surface (even though some lines also enter the ring).
  addSection("nexttorrent-diag.log", snapshot.diagLines);

  if (sections.length === 0) {
    return filter === "all"
      ? "No activity yet."
      : `No log lines at ${filter} level or above.`;
  }

  return sections.join("\n").trimEnd();
}
