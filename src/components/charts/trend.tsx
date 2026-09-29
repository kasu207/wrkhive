import { scaleLinear } from "d3-scale";
import { curveMonotoneX, line } from "d3-shape";
import { diffDays, type ISODate } from "@/lib/dates";

/**
 * Daily values over time with the athlete's normal range as a band and the
 * 7-day average as the line (raw days as dots). Static SVG, stretched to the
 * container width.
 */
export function TrendChart({
  series,
  from,
  to,
  band,
  height = 64,
  color = "var(--sport-ride)",
  dots = true,
  label,
}: {
  series: { date: ISODate; value: number }[];
  from: ISODate;
  to: ISODate;
  band?: { low: number; high: number } | null;
  height?: number;
  color?: string;
  dots?: boolean;
  label: string;
}) {
  if (series.length < 2) return <div style={{ height }} />;
  const width = 300;
  const days = Math.max(1, diffDays(to, from));
  const values = series.map((p) => p.value);
  const lo = Math.min(...values, band?.low ?? Infinity);
  const hi = Math.max(...values, band?.high ?? -Infinity);
  const pad = (hi - lo) * 0.12 || 1;
  const x = scaleLinear().domain([0, days]).range([2, width - 2]);
  const y = scaleLinear()
    .domain([lo - pad, hi + pad])
    .range([height - 2, 2]);
  const xOf = (d: ISODate) => x(diffDays(d, from));
  // 7-day rolling mean of the available days.
  const rolling = series.map((p, i) => {
    const window = series.slice(0, i + 1).filter((q) => diffDays(p.date, q.date) < 7);
    return { date: p.date, value: window.reduce((a, b) => a + b.value, 0) / window.length };
  });
  const path = line<{ date: ISODate; value: number }>()
    .x((p) => xOf(p.date))
    .y((p) => y(p.value))
    .curve(curveMonotoneX)(rolling);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-label={label}>
      {band ? <rect x={0} width={width} y={y(band.high)} height={Math.max(1, y(band.low) - y(band.high))} fill="var(--good-soft)" /> : null}
      {dots
        ? series.map((p) => (
            // Zero-length round-capped line: stays a circle although the SVG is stretched.
            <line key={p.date} x1={xOf(p.date)} x2={xOf(p.date)} y1={y(p.value)} y2={y(p.value)} stroke="var(--axis)" strokeWidth={3.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))
        : null}
      {path ? <path d={path} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinecap="round" /> : null}
    </svg>
  );
}
