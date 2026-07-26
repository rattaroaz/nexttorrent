import { useEffect, useMemo, useState } from "react";

import { getActivityLog } from "../../ipc/client";
import {
  buildActivityLogText,
  type LogLevelFilter,
} from "../../utils/logFilter";

export type ActivityLogPanelProps = {
  sessionLines: string[];
  active: boolean;
  levelFilter?: LogLevelFilter;
  className?: string;
};

export function ActivityLogPanel({
  sessionLines,
  active,
  levelFilter = "all",
  className,
}: ActivityLogPanelProps) {
  const [traceLines, setTraceLines] = useState<string[]>([]);
  const [diagLines, setDiagLines] = useState<string[]>([]);
  const [sessionFileLines, setSessionFileLines] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    const load = () => {
      void getActivityLog(200)
        .then((snap) => {
          if (!cancelled) {
            setTraceLines(snap.traceLines);
            setDiagLines(snap.diagFileLines);
            setSessionFileLines(snap.sessionFileLines ?? []);
            setLoadError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setLoadError(
              e instanceof Error ? e.message : "Could not load backend logs",
            );
          }
        });
    };
    load();
    const id = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, sessionLines.length]);

  const text = useMemo(
    () =>
      buildActivityLogText(
        {
          sessionLines,
          traceLines,
          sessionFileLines,
          diagLines,
          loadError,
        },
        levelFilter,
      ),
    [
      sessionLines,
      traceLines,
      sessionFileLines,
      diagLines,
      loadError,
      levelFilter,
    ],
  );

  return (
    <pre
      className={className ?? "activity-log"}
      data-testid="activity-log"
    >
      {text}
    </pre>
  );
}
