import type { SessionSnapshot } from "../ipc/contracts";

type DebugOverlayProps = {
  snapshot: SessionSnapshot | null;
};

export function DebugOverlay({ snapshot }: DebugOverlayProps) {
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <aside
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        maxWidth: 420,
        padding: "10px 12px",
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.45,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas",
        background: "rgba(15, 23, 42, 0.82)",
        color: "#e2e8f0",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Dev debug</div>
      <div>Build: {import.meta.env.MODE}</div>
      <div style={{ marginTop: 6 }}>
        Rust logs follow <code>RUST_LOG</code> (snapshot reports{" "}
        <code>{snapshot?.logFilter ?? "…"}</code>). rqbit{" "}
        <code>{snapshot?.rqbitVersion ?? "…"}</code>
      </div>
      {snapshot?.effectiveDownloadDir ? (
        <div style={{ marginTop: 6, wordBreak: "break-all" }}>
          Effective DL: {snapshot.effectiveDownloadDir}
        </div>
      ) : null}
      {snapshot ? (
        <dl style={{ margin: "8px 0 0", display: "grid", rowGap: 4 }}>
          <dt style={{ opacity: 0.75 }}>Download dir</dt>
          <dd style={{ margin: 0, wordBreak: "break-all" }}>
            {snapshot.downloadDir}
          </dd>
          <dt style={{ opacity: 0.75 }}>Config dir</dt>
          <dd style={{ margin: 0, wordBreak: "break-all" }}>
            {snapshot.configDir}
          </dd>
          <dt style={{ opacity: 0.75 }}>Cache dir</dt>
          <dd style={{ margin: 0, wordBreak: "break-all" }}>
            {snapshot.cacheDir}
          </dd>
        </dl>
      ) : (
        <div style={{ marginTop: 8, opacity: 0.85 }}>
          Waiting for <code>session:ready</code>…
        </div>
      )}
    </aside>
  );
}
