import { ActivityLogPanel } from "./ActivityLogPanel";
import { LOG_LEVEL_OPTIONS, type LogLevelFilter } from "../../utils/logFilter";

type Props = {
  sessionLines: string[];
  active: boolean;
  level: LogLevelFilter;
  onLevelChange: (level: LogLevelFilter) => void;
  onOpenLogsFolder?: () => void;
  onCopyAiBrief?: () => void;
  onExportAiDiagnostics?: () => void;
  onClose: () => void;
};

export function LogsSidePanel({
  sessionLines,
  active,
  level,
  onLevelChange,
  onOpenLogsFolder,
  onCopyAiBrief,
  onExportAiDiagnostics,
  onClose,
}: Props) {
  return (
    <aside className="logs-side-panel" data-testid="logs-side-panel">
      <header className="logs-side-panel__head">
        <h2>Logs</h2>
        <label className="logs-level-picker">
          <span className="sr-only">Log level</span>
          <select
            data-testid="logs-level-select"
            value={level}
            onChange={(e) => onLevelChange(e.target.value as LogLevelFilter)}
            aria-label="Log level"
          >
            {LOG_LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {onCopyAiBrief ? (
          <button
            type="button"
            onClick={onCopyAiBrief}
            data-testid="logs-copy-ai-brief"
            title="Copy ai-brief.json for an AI assistant"
          >
            Copy AI brief
          </button>
        ) : null}
        {onExportAiDiagnostics ? (
          <button
            type="button"
            onClick={onExportAiDiagnostics}
            data-testid="logs-export-ai"
            title="Export zip with ai-brief.json and event logs"
          >
            Export for AI
          </button>
        ) : null}
        {onOpenLogsFolder ? (
          <button
            type="button"
            onClick={onOpenLogsFolder}
            data-testid="logs-open-folder"
            title="Open folder containing logs and ai-brief.json"
          >
            Open folder
          </button>
        ) : null}
        <button type="button" onClick={onClose} data-testid="logs-panel-close">
          Close
        </button>
      </header>
      <ActivityLogPanel
        sessionLines={sessionLines}
        active={active}
        levelFilter={level}
        className="activity-log logs-side-panel__body"
      />
    </aside>
  );
}
