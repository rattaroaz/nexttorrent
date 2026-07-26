import { useEffect, useRef } from "react";

export type ContextMenuAction =
  | "pause"
  | "resume"
  | "openFolder"
  | "copyHash"
  | "copyName"
  | "remove"
  | "deleteFiles";

type Props = {
  x: number;
  y: number;
  count: number;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
};

export function TorrentContextMenu({ x, y, count, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    el.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    el.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const item = (
    action: ContextMenuAction,
    label: string,
    opts?: { danger?: boolean },
  ) => (
    <button
      type="button"
      className={opts?.danger ? "ctx-item danger" : "ctx-item"}
      role="menuitem"
      onClick={() => {
        onAction(action);
        onClose();
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: x, top: y }}
      data-testid="torrent-context-menu"
    >
      <div className="ctx-header">
        {count > 1 ? `${count} torrents` : "Torrent"}
      </div>
      {item("pause", "Pause")}
      {item("resume", "Resume")}
      <div className="ctx-sep" />
      {item("openFolder", "Open folder")}
      {item("copyHash", "Copy info hash")}
      {item("copyName", "Copy name")}
      <div className="ctx-sep" />
      {item("remove", "Remove from session")}
      {item("deleteFiles", "Delete data…", { danger: true })}
    </div>
  );
}
