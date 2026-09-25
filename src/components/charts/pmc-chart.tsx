"use client";

import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { useMemo, useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { displayDate } from "@/lib/dates";
import { formatDate, formatNumber } from "@/lib/format";
import type { PmcPoint } from "@/lib/analytics/load";
import { useWidth } from "./use-width";

const CTL = "var(--sport-ride)";
const ATL = "#e87ba4";
const TSS_BAR = "#d9d8d2";

type Range = "90" | "180" | "365";

function niceMax(v: number) {
  const steps = [20, 25, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 100) * 100;
}

/**
 * Performance management chart as two aligned panels sharing the time axis:
 * fitness / fatigue with daily load (same unit), and form (TSB) around zero.
 * Two panels instead of a dual axis.
 */
export function PmcChart({ data }: { data: PmcPoint[] }) {
  const [range, setRange] = useState<Range>("180");
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo(() => data.slice(-Number(range)), [data, range]);
  const padL = 36;
  const padR = 12;
  const topH = 200;
  const bottomH = 90;
  const gap = 18;
  const axisH = 22;
  const height = topH + gap + bottomH + axisH;
  const plotW = Math.max(0, width - padL - padR);

  const dates = points.map((p) => displayDate(p.date));
  const x = scaleTime()
    .domain([dates[0] ?? new Date(), dates[dates.length - 1] ?? new Date()])
    .range([padL, padL + plotW]);
  const yMax = niceMax(Math.max(40, ...points.map((p) => Math.max(p.ctl, p.atl, Math.min(p.tss, 250)))));
  const y = scaleLinear().domain([0, yMax]).range([topH, 8]);
  const tsbExtent = Math.max(20, ...points.map((p) => Math.abs(p.tsb)));
  const tsbMax = Math.ceil(tsbExtent / 10) * 10;
  const yForm = scaleLinear()
    .domain([-tsbMax, tsbMax])
    .range([topH + gap + bottomH, topH + gap]);

  const ctlPath = line<PmcPoint>()
    .x((_, i) => x(dates[i]))
    .y((p) => y(p.ctl))
    .curve(curveMonotoneX)(points);
  const atlPath = line<PmcPoint>()
    .x((_, i) => x(dates[i]))
    .y((p) => y(p.atl))
    .curve(curveMonotoneX)(points);
  const formArea = area<PmcPoint>()
    .x((_, i) => x(dates[i]))
    .y0(yForm(0))
    .y1((p) => yForm(p.tsb))
    .curve(curveMonotoneX)(points);
  const formLine = line<PmcPoint>()
    .x((_, i) => x(dates[i]))
    .y((p) => yForm(p.tsb))
    .curve(curveMonotoneX)(points);

  const barW = Math.max(1, plotW / Math.max(points.length, 1) - 1);
  const monthTicks = x.ticks(width < 520 ? 4 : 7);
  const h = hover !== null ? points[hover] : null;
  const last = points[points.length - 1];

  const onMove = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    if (px < padL || px > padL + plotW || !points.length) return setHover(null);
    const t = x.invert(px).getTime();
    let best = 0;
    let bestD = Infinity;
    dates.forEach((d, i) => {
      const dd = Math.abs(d.getTime() - t);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
          <Legend color={CTL} label="Fitness (CTL)" kind="line" />
          <Legend color={ATL} label="Ermüdung (ATL)" kind="line" />
          <Legend color={TSS_BAR} label="Tagesbelastung (TSS)" kind="bar" />
          <Legend color="var(--ink-3)" label="Form (TSB)" kind="area" />
        </div>
        <Segmented
          size="sm"
          value={range}
          onChange={setRange}
          label="Zeitraum"
          options={[
            { value: "90", label: "90 T" },
            { value: "180", label: "6 M" },
            { value: "365", label: "1 J" },
          ]}
        />
      </div>
      <div ref={ref} className="relative px-2" style={{ height }}>
        {width > 0 && points.length > 1 ? (
          <svg
            width={width}
            height={height}
            className="block touch-pan-y"
            role="img"
            aria-label={`Leistungsdiagramm: Fitness ${last ? Math.round(last.ctl) : "–"}, Ermüdung ${last ? Math.round(last.atl) : "–"}, Form ${last ? Math.round(last.tsb) : "–"}`}
            onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)}
          >
            {/* grid top */}
            {y.ticks(4).map((v) => (
              <g key={`g${v}`}>
                <line x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--axis)" : "var(--grid)"} />
                <text x={padL - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[10px] tabular">
                  {v}
                </text>
              </g>
            ))}
            {/* daily TSS */}
            {points.map((p, i) =>
              p.tss > 0 ? (
                <rect key={p.date} x={x(dates[i]) - barW / 2} y={y(Math.min(p.tss, yMax))} width={barW} height={topH - y(Math.min(p.tss, yMax))} fill={TSS_BAR} opacity={hover === null || hover === i ? 1 : 0.7} />
              ) : null,
            )}
            <path d={atlPath ?? undefined} fill="none" stroke={ATL} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={ctlPath ?? undefined} fill="none" stroke={CTL} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />

            {/* form panel */}
            <text x={padL} y={topH + gap - 5} className="fill-ink-3 text-[10px] font-medium">
              Form (TSB)
            </text>
            {[-tsbMax, 0, tsbMax].map((v) => (
              <g key={`f${v}`}>
                <line x1={padL} x2={padL + plotW} y1={yForm(v)} y2={yForm(v)} stroke={v === 0 ? "var(--axis)" : "var(--grid)"} />
                <text x={padL - 8} y={yForm(v)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[10px] tabular">
                  {v > 0 ? `+${v}` : v}
                </text>
              </g>
            ))}
            <defs>
              <clipPath id="pmc-pos">
                <rect x={padL} y={topH + gap} width={plotW} height={yForm(0) - topH - gap} />
              </clipPath>
              <clipPath id="pmc-neg">
                <rect x={padL} y={yForm(0)} width={plotW} height={topH + gap + bottomH - yForm(0)} />
              </clipPath>
            </defs>
            <path d={formArea ?? undefined} fill="var(--sport-ride)" opacity={0.14} clipPath="url(#pmc-pos)" />
            <path d={formArea ?? undefined} fill="var(--critical)" opacity={0.12} clipPath="url(#pmc-neg)" />
            <path d={formLine ?? undefined} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} />

            {/* x axis */}
            {monthTicks.map((d) => (
              <text key={d.getTime()} x={x(d)} y={height - 6} textAnchor="middle" className="fill-ink-3 text-[10px]">
                {new Intl.DateTimeFormat("de-DE", { month: "short" }).format(d).replace(".", "")}
              </text>
            ))}

            {/* end markers */}
            {last ? (
              <>
                <circle cx={x(dates[dates.length - 1])} cy={y(last.ctl)} r={4} fill={CTL} stroke="var(--surface)" strokeWidth={2} />
                <circle cx={x(dates[dates.length - 1])} cy={y(last.atl)} r={4} fill={ATL} stroke="var(--surface)" strokeWidth={2} />
              </>
            ) : null}

            {h ? (
              <g>
                <line x1={x(dates[hover!])} x2={x(dates[hover!])} y1={8} y2={topH + gap + bottomH} stroke="var(--ink)" strokeOpacity={0.2} />
                <circle cx={x(dates[hover!])} cy={y(h.ctl)} r={4} fill={CTL} stroke="var(--surface)" strokeWidth={2} />
                <circle cx={x(dates[hover!])} cy={y(h.atl)} r={4} fill={ATL} stroke="var(--surface)" strokeWidth={2} />
                <circle cx={x(dates[hover!])} cy={yForm(h.tsb)} r={3.5} fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={2} />
              </g>
            ) : null}
          </svg>
        ) : null}
        {h ? (
          <div
            className="pointer-events-none absolute top-0 z-10 w-44 rounded-xl border border-border bg-surface px-3 py-2 text-[12px] shadow-raised"
            style={{ left: Math.min(Math.max(8, x(dates[hover!]) - 88), Math.max(8, width - 184)) }}
          >
            <div className="mb-1 font-semibold text-ink">{formatDate(displayDate(h.date))}</div>
            <Row color={CTL} label="Fitness" value={formatNumber(h.ctl, 0)} />
            <Row color={ATL} label="Ermüdung" value={formatNumber(h.atl, 0)} />
            <Row color="var(--ink-3)" label="Form" value={`${h.tsb > 0 ? "+" : ""}${formatNumber(h.tsb, 0)}`} />
            <Row color={TSS_BAR} label="TSS" value={formatNumber(h.tss, 0)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-ink-2">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="font-medium text-ink tabular">{value}</span>
    </div>
  );
}

function Legend({ color, label, kind }: { color: string; label: string; kind: "line" | "bar" | "area" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === "line" ? <span className="h-[3px] w-3.5 rounded-full" style={{ background: color }} /> : kind === "bar" ? <span className="h-2.5 w-2 rounded-[2px]" style={{ background: color }} /> : <span className="h-2 w-3.5 rounded-[2px] border-t-[1.5px]" style={{ borderColor: color, background: "rgb(42 120 214 / 0.14)" }} />}
      {label}
    </span>
  );
}
