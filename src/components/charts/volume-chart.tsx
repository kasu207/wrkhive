"use client";

import { scaleBand, scaleLinear } from "d3-scale";
import { useState } from "react";
import { SPORT_COLOR } from "@/components/brand";
import { displayDate, isoWeekNumber } from "@/lib/dates";
import { formatDateShort, formatNumber } from "@/lib/format";
import { useWidth } from "./use-width";

export interface VolumeWeek {
  week: string;
  ride: number;
  run: number;
  strength: number;
  other: number;
  tss: number;
}

const SERIES = [
  { key: "ride", label: "Rad" },
  { key: "run", label: "Laufen" },
  { key: "strength", label: "Kraft" },
  { key: "other", label: "Sonstiges" },
] as const;

/** Weekly training hours, stacked by sport. */
export function VolumeChart({ weeks }: { weeks: VolumeWeek[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 220;
  const padL = 32;
  const padR = 8;
  const padB = 22;
  const top = 10;
  const totals = weeks.map((w) => w.ride + w.run + w.strength + w.other);
  const max = Math.max(4, Math.ceil(Math.max(...totals, 0) / 2) * 2);
  const x = scaleBand<number>()
    .domain(weeks.map((_, i) => i))
    .range([padL, Math.max(padL, width - padR)])
    .paddingInner(0.28)
    .paddingOuter(0.1);
  const y = scaleLinear().domain([0, max]).range([height - padB, top]);
  const bw = Math.min(24, x.bandwidth());
  const present = SERIES.filter((s) => weeks.some((w) => w[s.key] > 0));
  const hw = hover !== null ? weeks[hover] : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 px-5 text-[12px] text-ink-2">
        {present.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: SPORT_COLOR[s.key] }} />
            {s.label}
          </span>
        ))}
      </div>
      <div ref={ref} className="relative px-2" style={{ height }}>
        {width > 0 ? (
          <svg width={width} height={height} className="block" role="img" aria-label="Wöchentlicher Trainingsumfang in Stunden nach Sportart" onPointerLeave={() => setHover(null)}>
            {y.ticks(4).map((v) => (
              <g key={v}>
                <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--axis)" : "var(--grid)"} />
                <text x={padL - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[10px] tabular">
                  {v} h
                </text>
              </g>
            ))}
            {weeks.map((w, i) => {
              const cx = (x(i) ?? 0) + x.bandwidth() / 2;
              let acc = 0;
              const segs = present
                .map((s) => ({ s, v: w[s.key] }))
                .filter((d) => d.v > 0)
                .map((d) => {
                  const y0 = y(acc);
                  acc += d.v;
                  return { ...d, y0, y1: y(acc) };
                });
              return (
                <g key={w.week} onPointerEnter={() => setHover(i)} opacity={hover === null || hover === i ? 1 : 0.55} style={{ transition: "opacity 150ms" }}>
                  <rect x={x(i)} y={top} width={x.bandwidth()} height={height - padB - top} fill="transparent" />
                  {segs.map((d, j) => {
                    const isTop = j === segs.length - 1;
                    const h = Math.max(0, d.y0 - d.y1 - (isTop ? 0 : 2));
                    const r = isTop ? Math.min(4, h, bw / 2) : 0;
                    const x0 = cx - bw / 2;
                    return (
                      <path
                        key={d.s.key}
                        d={`M${x0},${d.y1 + (isTop ? 0 : 2) + h}V${d.y1 + (isTop ? 0 : 2) + r}Q${x0},${d.y1 + (isTop ? 0 : 2)} ${x0 + r},${d.y1 + (isTop ? 0 : 2)}H${x0 + bw - r}Q${x0 + bw},${d.y1 + (isTop ? 0 : 2)} ${x0 + bw},${d.y1 + (isTop ? 0 : 2) + r}V${d.y1 + (isTop ? 0 : 2) + h}Z`}
                        fill={SPORT_COLOR[d.s.key]}
                      />
                    );
                  })}
                  {i % Math.ceil(weeks.length / 6) === 0 || i === weeks.length - 1 ? (
                    <text x={cx} y={height - 6} textAnchor="middle" className="fill-ink-3 text-[10px] tabular">
                      KW {isoWeekNumber(w.week)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        ) : null}
        {hw ? (
          <div
            className="pointer-events-none absolute top-0 z-10 w-44 rounded-xl border border-border bg-surface px-3 py-2 text-[12px] shadow-raised"
            style={{ left: Math.min(Math.max(8, (x(hover!) ?? 0) + x.bandwidth() / 2 - 88), Math.max(8, width - 184)) }}
          >
            <div className="mb-1 font-semibold text-ink">
              KW {isoWeekNumber(hw.week)} · ab {formatDateShort(displayDate(hw.week))}
            </div>
            {present.map((s) =>
              hw[s.key] > 0 ? (
                <div key={s.key} className="flex items-center justify-between py-0.5 text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: SPORT_COLOR[s.key] }} />
                    {s.label}
                  </span>
                  <span className="font-medium text-ink tabular">{formatNumber(hw[s.key], 1)} h</span>
                </div>
              ) : null,
            )}
            <div className="mt-1 flex justify-between border-t border-border pt-1 text-ink-2">
              <span>Gesamt</span>
              <span className="font-medium text-ink tabular">
                {formatNumber(hw.ride + hw.run + hw.strength + hw.other, 1)} h · {Math.round(hw.tss)} TSS
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
