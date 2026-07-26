import { useEffect, useRef, useState } from "react";

type Props = {
  magnetDraft: string;
  onMagnetDraftChange: (value: string) => void;
  addOutputDir: string | null;
  onAddOutputDirChange: (value: string | null) => void;
  pendingTorrentPath: string | null;
  onPendingTorrentPathChange: (value: string | null) => void;
  onPickOutputDirectory: () => void;
  onPickTorrentFile: () => void;
  onConfirmAddTorrentFile: () => void;
  onSubmitMagnet: () => void;
  onClose: () => void;
};

export function AddTorrentDialog({
  magnetDraft,
  onMagnetDraftChange,
  addOutputDir,
  onAddOutputDirChange,
  pendingTorrentPath,
  onPendingTorrentPathChange,
  onPickOutputDirectory,
  onPickTorrentFile,
  onConfirmAddTorrentFile,
  onSubmitMagnet,
  onClose,
}: Props) {
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const dragRef = useRef(drag);
  const pointerDrag = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    originDx: number;
    originDy: number;
  } | null>(null);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  return (
    <dialog
      open
      className="modal modal-draggable"
      style={{
        transform: `translate(calc(-50% + ${drag.dx}px), calc(-50% + ${drag.dy}px))`,
      }}
    >
      <h3
        className="modal-drag-handle"
        onPointerDown={(e) => {
          if (e.button !== 0) {
            return;
          }
          e.preventDefault();
          const cur = dragRef.current;
          pointerDrag.current = {
            dragging: true,
            startX: e.clientX,
            startY: e.clientY,
            originDx: cur.dx,
            originDy: cur.dy,
          };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = pointerDrag.current;
          if (!d?.dragging) {
            return;
          }
          setDrag({
            dx: d.originDx + (e.clientX - d.startX),
            dy: d.originDy + (e.clientY - d.startY),
          });
        }}
        onPointerUp={(e) => {
          const d = pointerDrag.current;
          if (d) {
            d.dragging = false;
          }
          pointerDrag.current = null;
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            /* already released */
          }
        }}
        onPointerCancel={(e) => {
          const d = pointerDrag.current;
          if (d) {
            d.dragging = false;
          }
          pointerDrag.current = null;
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            /* already released */
          }
        }}
      >
        Add torrent
      </h3>
      <p className="hint">
        Optional output folder (default: session download directory).
      </p>
      <div className="modal-actions" style={{ marginBottom: 8 }}>
        <button type="button" onClick={() => void onPickOutputDirectory()}>
          Choose save folder…
        </button>
        {addOutputDir ? (
          <span className="muted" style={{ flex: 1, fontSize: 12 }}>
            {addOutputDir}
          </span>
        ) : null}
        {addOutputDir ? (
          <button type="button" onClick={() => onAddOutputDirChange(null)}>
            Clear
          </button>
        ) : null}
      </div>
      <textarea
        data-testid="magnet-input"
        value={magnetDraft}
        onChange={(e) => onMagnetDraftChange(e.target.value)}
        placeholder="magnet:?xt=urn:btih:…"
        rows={4}
      />
      {pendingTorrentPath ? (
        <div className="pending-file-box">
          <p className="hint">Selected file</p>
          <code className="pending-path">{pendingTorrentPath}</code>
          <div className="modal-actions">
            <button
              type="button"
              onClick={() => void onConfirmAddTorrentFile()}
            >
              Add to session
            </button>
            <button type="button" onClick={() => void onPickTorrentFile()}>
              Choose different file…
            </button>
            <button
              type="button"
              onClick={() => onPendingTorrentPathChange(null)}
            >
              Clear selection
            </button>
          </div>
        </div>
      ) : (
        <div className="modal-actions">
          <button type="button" onClick={() => void onPickTorrentFile()}>
            Choose .torrent file…
          </button>
        </div>
      )}
      <div className="modal-actions">
        <button
          type="button"
          data-testid="add-magnet-submit"
          onClick={() => void onSubmitMagnet()}
        >
          Add magnet
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
