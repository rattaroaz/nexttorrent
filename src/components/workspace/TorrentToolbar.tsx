type Props = {
  onAddTorrent: () => void;
  onOpenSettings: () => void;
  onToggleLogs: () => void;
  logsOpen: boolean;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onPollRss: () => void;
  onScanWatchFolders: () => void;
  onQuit: () => void;
};

export function TorrentToolbar({
  onAddTorrent,
  onOpenSettings,
  onToggleLogs,
  logsOpen,
  onPauseAll,
  onResumeAll,
  onPollRss,
  onScanWatchFolders,
  onQuit,
}: Props) {
  return (
    <header className="toolbar">
      <div className="brand">Nexttorrent</div>
      <button
        type="button"
        data-testid="toolbar-add-torrent"
        onClick={onAddTorrent}
      >
        Add torrent
      </button>
      <button
        type="button"
        data-testid="toolbar-settings"
        onClick={onOpenSettings}
      >
        Settings
      </button>
      <button
        type="button"
        data-testid="toolbar-view-logs"
        onClick={onToggleLogs}
        aria-pressed={logsOpen}
      >
        {logsOpen ? "Hide logs" : "View logs"}
      </button>
      <button type="button" onClick={onPauseAll}>
        Pause all
      </button>
      <button type="button" onClick={onResumeAll}>
        Resume all
      </button>
      <button type="button" onClick={onPollRss}>
        Poll RSS
      </button>
      <button type="button" onClick={onScanWatchFolders}>
        Scan watch folders
      </button>
      <button type="button" onClick={onQuit}>
        Quit
      </button>
    </header>
  );
}
