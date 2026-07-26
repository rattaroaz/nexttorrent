import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import type { TorrentRow } from "../../ipc/contracts";
import {
  formatBytes,
  formatBps,
  formatEta,
  formatTorrentState,
  ratioString,
} from "../../utils/format";
import {
  mbpsToApproxBps,
  SORT_COLUMNS,
  torrentRef,
  type SortDir,
  type SortKey,
} from "./shared";

type Props = {
  section?: "all" | "filters" | "list";
  filterQuery: string;
  onFilterQueryChange: (value: string) => void;
  sortBy: SortKey;
  sortDir: SortDir;
  onSortByChange: (value: SortKey) => void;
  onSortHeaderClick: (key: SortKey) => void;
  labelFilter: string | null;
  onLabelFilterChange: (value: string | null) => void;
  labelOptions: string[];
  batchRefs: string[];
  batchLabelDraft: string;
  onBatchLabelDraftChange: (value: string) => void;
  onBatchPause: () => void;
  onBatchResume: () => void;
  onBatchRemove: () => void;
  onApplyBatchLabel: () => void;
  onClearSelection: () => void;
  displayRows: TorrentRow[];
  selectedRefs: Set<string>;
  onRowClick: (e: React.MouseEvent, row: TorrentRow, index: number) => void;
  onRowContextMenu: (
    e: React.MouseEvent,
    row: TorrentRow,
    index: number,
  ) => void;
  onAddTorrent?: () => void;
};

export function TorrentListPane({
  section = "all",
  filterQuery,
  onFilterQueryChange,
  sortBy,
  sortDir,
  onSortByChange,
  onSortHeaderClick,
  labelFilter,
  onLabelFilterChange,
  labelOptions,
  batchRefs,
  batchLabelDraft,
  onBatchLabelDraftChange,
  onBatchPause,
  onBatchResume,
  onBatchRemove,
  onApplyBatchLabel,
  onClearSelection,
  displayRows,
  selectedRefs,
  onRowClick,
  onRowContextMenu,
  onAddTorrent,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });

  const filters = (
    <>
      <div className="toolbar filter-bar">
        <label className="grow">
          Filter
          <input
            value={filterQuery}
            onChange={(e) => onFilterQueryChange(e.target.value)}
            placeholder="name, label, hash…"
          />
        </label>
        <label>
          Sort
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as SortKey)}
          >
            {SORT_COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Label
          <select
            value={labelFilter ?? ""}
            onChange={(e) => onLabelFilterChange(e.target.value || null)}
          >
            <option value="">All</option>
            <option value="__none__">Unlabeled</option>
            {labelOptions.map((lab) => (
              <option key={lab} value={lab}>
                {lab}
              </option>
            ))}
          </select>
        </label>
      </div>

      {labelOptions.length > 0 ? (
        <div className="label-chips">
          <button
            type="button"
            className={labelFilter == null ? "chip active" : "chip"}
            onClick={() => onLabelFilterChange(null)}
          >
            All
          </button>
          {labelOptions.map((lab) => (
            <button
              key={lab}
              type="button"
              className={labelFilter === lab ? "chip active" : "chip"}
              onClick={() => onLabelFilterChange(lab)}
            >
              {lab}
            </button>
          ))}
        </div>
      ) : null}

      {batchRefs.length > 1 ? (
        <div className="toolbar batch-bar">
          <span>{batchRefs.length} selected</span>
          <button type="button" onClick={onBatchPause}>
            Pause
          </button>
          <button type="button" onClick={onBatchResume}>
            Resume
          </button>
          <button type="button" onClick={onBatchRemove}>
            Remove
          </button>
          <input
            value={batchLabelDraft}
            onChange={(e) => onBatchLabelDraftChange(e.target.value)}
            placeholder="Batch label"
            aria-label="Batch label"
          />
          <button type="button" onClick={onApplyBatchLabel}>
            Set label
          </button>
          <button type="button" onClick={onClearSelection}>
            Clear selection
          </button>
        </div>
      ) : null}
    </>
  );

  const list = (
    <div className="list-pane">
      <div className="table-head" role="row">
        {SORT_COLUMNS.map((col) => {
          const active = sortBy === col.key;
          const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
          return (
            <button
              key={col.key}
              type="button"
              className={`table-head-btn${col.key === "name" ? "" : " col-num"}${active ? " active" : ""}`}
              onClick={() => onSortHeaderClick(col.key)}
              title={`Sort by ${col.label}`}
            >
              {col.label}
              {arrow}
            </button>
          );
        })}
      </div>
      {displayRows.length === 0 ? (
        <div className="empty-list" data-testid="torrent-list-empty">
          <p className="empty-list-title">No torrents yet</p>
          <p className="muted">
            Add a magnet, drop a .torrent file here, or use Add torrent.
            {filterQuery.trim() || labelFilter
              ? " Nothing matches the current filter."
              : null}
          </p>
          {onAddTorrent && !filterQuery.trim() && !labelFilter ? (
            <button type="button" className="primary" onClick={onAddTorrent}>
              Add torrent
            </button>
          ) : null}
          <p className="hint">
            Tips: Ctrl+O · drag &amp; drop · right-click a row
          </p>
        </div>
      ) : (
        <div ref={parentRef} className="table-scroll">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = displayRows[vi.index]!;
              const ref = torrentRef(row);
              const stats = row.stats;
              const selected = selectedRefs.has(ref);
              const total = stats?.total_bytes ?? 0;
              const prog = stats?.progress_bytes ?? 0;
              const pct = total > 0 ? (100 * prog) / total : 0;
              const live = stats?.live as
                | {
                    download_speed?: { mbps?: number };
                    upload_speed?: { mbps?: number };
                    snapshot?: {
                      peer_stats?: {
                        live?: number;
                        connecting?: number;
                        queued?: number;
                        seen?: number;
                      };
                    };
                  }
                | undefined;
              const downMbps = live?.download_speed?.mbps ?? 0;
              const upMbps = live?.upload_speed?.mbps ?? 0;
              const down = mbpsToApproxBps(downMbps);
              const up = mbpsToApproxBps(upMbps);
              const eta =
                down > 0 && total > prog ? (total - prog) / down : null;
              const stripe = row.labelColor ?? undefined;
              const peerStats = live?.snapshot?.peer_stats;
              const peerCount = peerStats
                ? (peerStats.live ?? 0) +
                  (peerStats.connecting ?? 0) +
                  (peerStats.queued ?? 0) +
                  (peerStats.seen ?? 0)
                : undefined;
              const state = formatTorrentState(stats?.state, {
                finished: stats?.finished,
                error: stats?.error,
                awaitingMetadata:
                  !stats?.finished &&
                  (total === 0 ||
                    (stats?.state ?? "")
                      .toLowerCase()
                      .includes("initializing")),
                peerCount,
              });
              return (
                <button
                  key={ref}
                  type="button"
                  className={`table-row ${selected ? "selected" : ""}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${vi.size}px`,
                    transform: `translateY(${vi.start}px)`,
                    borderLeft: stripe ? `4px solid ${stripe}` : undefined,
                  }}
                  onClick={(e) => onRowClick(e, row, vi.index)}
                  onContextMenu={(e) => onRowContextMenu(e, row, vi.index)}
                >
                  <span className="col-name">
                    {row.label ? (
                      <span
                        className="row-label-pill"
                        style={
                          stripe
                            ? {
                                borderColor: stripe,
                                background: `color-mix(in srgb, ${stripe} 18%, transparent)`,
                              }
                            : undefined
                        }
                      >
                        {row.label}
                      </span>
                    ) : null}
                    {row.name ?? row.info_hash.slice(0, 8)}
                  </span>
                  <span className="col-num col-progress">
                    <span className="progress-track" aria-hidden>
                      <span
                        className="progress-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, pct))}%`,
                        }}
                      />
                    </span>
                    <span className="progress-pct">{pct.toFixed(1)}%</span>
                  </span>
                  <span className="col-num">{formatBytes(total)}</span>
                  <span className="col-num">{formatEta(eta)}</span>
                  <span className="col-num">{formatBps(down)}</span>
                  <span className="col-num">{formatBps(up)}</span>
                  <span className="col-num">
                    {ratioString(stats?.uploaded_bytes ?? 0, prog || 1)}
                  </span>
                  <span className="col-num">
                    <span className={`state-badge state-${state.tone}`}>
                      {state.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  if (section === "filters") {
    return filters;
  }
  if (section === "list") {
    return list;
  }
  return (
    <>
      {filters}
      {list}
    </>
  );
}
