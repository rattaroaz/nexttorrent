/** Minimal sparkline for session or per-torrent speeds (Mbps samples). */

type Props = {
  downSeries: number[];
  upSeries: number[];
  height?: number;
};

export function RateGraph({ downSeries, upSeries, height = 56 }: Props) {
  const w = 320;
  const pad = 4;
  const innerW = w - pad * 2;
  const innerH = height - pad * 2;
  const all = [...downSeries, ...upSeries];
  const max = Math.max(0.000_001, ...all.map((x) => Math.abs(x)));
  const n = Math.max(downSeries.length, upSeries.length, 2);
  const xAt = (i: number) => pad + (innerW * i) / (n - 1);

  const line = (series: number[]) => {
    if (series.length === 0) {
      return "";
    }
    const pts = series.map((v, i) => {
      const x = xAt(i);
      const y = pad + innerH - (Math.abs(v) / max) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return pts.join(" ");
  };

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="rate-graph"
      aria-hidden
    >
      <rect
        x={0}
        y={0}
        width={w}
        height={height}
        fill="var(--surface)"
        stroke="var(--border)"
        rx={6}
      />
      <path
        d={line(downSeries)}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={line(upSeries)}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
