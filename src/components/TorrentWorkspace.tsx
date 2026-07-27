import {
  quitApp,
  rssPollFeeds,
  torrentPause,
  torrentPauseAll,
  torrentResume,
  torrentResumeAll,
  watchPoll,
} from "../ipc/client";
import { runLoggedVoid } from "../ipc/runLogged";
import { formatBytes, formatBps } from "../utils/format";
import { RateGraph } from "./RateGraph";
import { AddTorrentDialog } from "./workspace/AddTorrentDialog";
import { SettingsDialog } from "./workspace/SettingsDialog";
import { TorrentContextMenu } from "./workspace/TorrentContextMenu";
import { TorrentDetailPane } from "./workspace/TorrentDetailPane";
import { TorrentListPane } from "./workspace/TorrentListPane";
import { TorrentToolbar } from "./workspace/TorrentToolbar";
import { LogsSidePanel } from "./workspace/LogsSidePanel";
import { mbpsToApproxBps } from "./workspace/shared";
import { useTorrentWorkspace } from "./workspace/useTorrentWorkspace";

export function TorrentWorkspace() {
  const ws = useTorrentWorkspace();
  const detailOpen = ws.selectedRef !== null || ws.selectedRefs.size > 0;

  const listPaneProps = {
    filterQuery: ws.filterQuery,
    onFilterQueryChange: ws.setFilterQuery,
    sortBy: ws.sortBy,
    sortDir: ws.sortDir,
    onSortByChange: ws.setSortBy,
    onSortHeaderClick: ws.handleSortHeaderClick,
    labelFilter: ws.labelFilter,
    onLabelFilterChange: ws.setLabelFilter,
    labelOptions: ws.labelOptions,
    batchRefs: ws.batchRefs,
    batchLabelDraft: ws.batchLabelDraft,
    onBatchLabelDraftChange: ws.setBatchLabelDraft,
    onBatchPause: () => void ws.runBatch("Paused", torrentPause),
    onBatchResume: () => void ws.runBatch("Resumed", torrentResume),
    onBatchRemove: () => void ws.removeTorrents(ws.batchRefs, false),
    onApplyBatchLabel: () => void ws.applyBatchLabel(),
    onClearSelection: () => ws.closeDetailPane(),
    displayRows: ws.displayRows,
    selectedRefs: ws.selectedRefs,
    onRowClick: ws.handleRowClick,
    onRowContextMenu: ws.handleRowContextMenu,
    onAddTorrent: ws.openAddTorrent,
  };

  return (
    <div
      className={`workspace${ws.dragOver ? " drag-over" : ""}`}
      ref={ws.workspaceRef}
      tabIndex={-1}
    >
      {ws.dragOver ? (
        <div className="drop-overlay" data-testid="torrent-drop-overlay">
          <p>Drop .torrent files to add</p>
        </div>
      ) : null}

      <TorrentToolbar
        onAddTorrent={ws.openAddTorrent}
        onOpenSettings={() => void ws.openSettings()}
        onToggleLogs={ws.toggleLogsPanel}
        logsOpen={ws.logsPanelOpen}
        onPauseAll={() => {
          runLoggedVoid("Pause all torrents", ws.log, () =>
            torrentPauseAll().then(() => ws.log("Paused all torrents.")),
          );
        }}
        onResumeAll={() => {
          runLoggedVoid("Resume all torrents", ws.log, () =>
            torrentResumeAll().then(() => ws.log("Resumed all torrents.")),
          );
        }}
        onPollRss={() => {
          runLoggedVoid("Poll RSS feeds", ws.log, () =>
            rssPollFeeds().then((r) =>
              ws.log(
                `RSS: added ${r.magnetsAdded}; ${r.messages.slice(0, 3).join("; ")}`,
              ),
            ),
          );
        }}
        onScanWatchFolders={() => {
          runLoggedVoid("Scan watch folders", ws.log, () =>
            watchPoll().then((n) => ws.log(`Watch folders: ${n} new.`)),
          );
        }}
        onQuit={() => {
          runLoggedVoid("Quit application", ws.log, quitApp);
        }}
      />

      <TorrentListPane section="filters" {...listPaneProps} />

      <div
        className={`main-split${detailOpen ? " detail-open" : ""}${ws.logsPanelOpen ? " logs-open" : ""}`}
      >
        <TorrentListPane section="list" {...listPaneProps} />

        {detailOpen ? (
          <TorrentDetailPane
            multiSelected={ws.multiSelected}
            batchCount={ws.batchRefs.length}
            selectedRow={ws.selectedRow}
            tab={ws.tab}
            onTabChange={ws.setTab}
            detail={ws.detail}
            onDetailChange={ws.setDetail}
            liveStats={ws.liveStats}
            trackers={ws.trackers}
            peerDump={ws.peerDump}
            pieceDump={ws.pieceDump}
            activity={ws.activity}
            perTorrentLabel={ws.perTorrentLabel}
            onPerTorrentLabelChange={ws.setPerTorrentLabel}
            labelColorHex={ws.labelColorHex}
            onLabelColorHexChange={ws.setLabelColorHex}
            perTorrentDownLimit={ws.perTorrentDownLimit}
            onPerTorrentDownLimitChange={ws.setPerTorrentDownLimit}
            perTorrentUpLimit={ws.perTorrentUpLimit}
            onPerTorrentUpLimitChange={ws.setPerTorrentUpLimit}
            onSaveLabel={() => void ws.saveLabel()}
            onSavePerTorrentLimits={() => void ws.savePerTorrentLimits()}
            onRemove={(deleteFiles) => {
              const ref = ws.selectedRef;
              if (ref) {
                void ws.removeTorrents([ref], deleteFiles);
              }
            }}
            onLog={ws.log}
            onClose={ws.closeDetailPane}
          />
        ) : null}

        {ws.logsPanelOpen ? (
          <LogsSidePanel
            active
            sessionLines={ws.activity}
            level={ws.logLevelFilter}
            onLevelChange={ws.setLogLevelFilter}
            onCopyAiBrief={() => void ws.copyAiBriefAction()}
            onExportAiDiagnostics={() => void ws.exportAiDiagnosticsAction()}
            onOpenLogsFolder={() => void ws.openLogsFolderAction()}
            onClose={() => ws.setLogsPanelOpen(false)}
          />
        ) : null}
      </div>

      <div className="graph-strip">
        <RateGraph
          downSeries={ws.sessionDownHist}
          upSeries={ws.sessionUpHist}
        />
      </div>

      <footer className="status-bar">
        <span>
          ↓{" "}
          {ws.session
            ? formatBps(mbpsToApproxBps(ws.session.download_speed.mbps))
            : "—"}
        </span>
        <span>
          ↑{" "}
          {ws.session
            ? formatBps(mbpsToApproxBps(ws.session.upload_speed.mbps))
            : "—"}
        </span>
        <span title="Active / seeding / paused / total">
          {ws.sessionCounts.downloading}↓ · {ws.sessionCounts.seeding}↑ ·{" "}
          {ws.sessionCounts.paused}⏸ · {ws.sessionCounts.total} total
          {ws.sessionCounts.errored > 0
            ? ` · ${ws.sessionCounts.errored} error`
            : ""}
        </span>
        <span>
          Session: {ws.session ? formatBytes(ws.session.fetched_bytes) : "—"}{" "}
          fetched
          {ws.session
            ? ` · ${formatBytes(ws.session.uploaded_bytes)} sent`
            : ""}
        </span>
      </footer>

      {ws.addOpen ? (
        <AddTorrentDialog
          magnetDraft={ws.magnetDraft}
          onMagnetDraftChange={ws.setMagnetDraft}
          addOutputDir={ws.addOutputDir}
          onAddOutputDirChange={ws.setAddOutputDir}
          pendingTorrentPath={ws.pendingTorrentPath}
          onPendingTorrentPathChange={ws.setPendingTorrentPath}
          onPickOutputDirectory={() => void ws.pickOutputDirectory()}
          onPickTorrentFile={() => void ws.pickTorrentFile()}
          onConfirmAddTorrentFile={() => void ws.confirmAddTorrentFile()}
          onSubmitMagnet={() => void ws.submitMagnet()}
          onClose={() => {
            ws.setPendingTorrentPath(null);
            ws.setAddOpen(false);
          }}
        />
      ) : null}

      {ws.settingsOpen && ws.settingsDraft ? (
        <SettingsDialog
          settingsDraft={ws.settingsDraft}
          onSettingsDraftChange={ws.setSettingsDraft}
          networkInterfaces={ws.networkInterfaces}
          onSave={() => void ws.saveSettings()}
          onCancel={() => ws.setSettingsOpen(false)}
          onExportBackup={() => void ws.exportBackup()}
          onImportBackup={() => void ws.importBackup()}
          onCheckForUpdates={() => void ws.checkForUpdates()}
          onOpenLogsFolder={() => void ws.openLogsFolderAction()}
        />
      ) : null}

      {ws.contextMenu ? (
        <TorrentContextMenu
          x={ws.contextMenu.x}
          y={ws.contextMenu.y}
          count={ws.contextMenu.refs.length}
          onAction={(action) => {
            const refs = ws.contextMenu?.refs ?? [];
            void ws.handleContextAction(action, refs);
          }}
          onClose={() => ws.setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}
