export function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

export function formatBps(n: number): string {
  if (n < 1) {
    return "0 B/s";
  }
  return `${formatBytes(n)}/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0 || seconds === Infinity) {
    return "—";
  }
  const s = Math.floor(seconds);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ${s % 60}s`;
  }
  const h = Math.floor(m / 60);
  if (h < 48) {
    return `${h}h ${m % 60}m`;
  }
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function ratioString(up: number, down: number): string {
  if (down <= 0) {
    return "—";
  }
  return (up / down).toFixed(2);
}
