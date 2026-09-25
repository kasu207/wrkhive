"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { durationLabel, stepTitle, stepZoneLabel, targetAbsolute, targetRelative, ZONE_COLOR } from "@/lib/workout/display";
import { profileSegments, type ProfileSegment } from "@/lib/workout/metrics";
import type { Thresholds, WorkoutStructure } from "@/lib/workout/types";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function tickStep(totalSec: number): number {
  const candidates = [60, 120, 300, 600, 900, 1800, 3600, 7200];
  for (const c of candidates) if (totalSec / c <= 8) return c;
  return 7200;
}

function roundedTopRect(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function WorkoutChart({
  structure,
  thresholds,
  height = 180,
  axis = true,
  selectedStepId,
  onSelectStep,
  animate = true,
  className,
}: {
  structure: WorkoutStructure;
  thresholds: Thresholds;
  height?: number;
  axis?: boolean;
  selectedStepId?: string | null;
  onSelectStep?: (id: string) => void;
  animate?: boolean;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const segments = useMemo(() => profileSegments(structure, thresholds), [structure, thresholds]);
  const total = segments.length ? segments[segments.length - 1].start + segments[segments.length - 1].duration : 0;

  const padL = axis ? 40 : 0;
  const padR = axis ? 8 : 0;
  const padT = 8;
  const padB = axis ? 22 : 0;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const maxRel = Math.min(2.2, Math.max(1.25, ...segments.map((s) => s.high)) * 1.06);
  const y = (rel: number) => padT + plotH - (Math.min(rel, maxRel) / maxRel) * plotH;
  const x = (sec: number) => padL + (total ? (sec / total) * plotW : 0);
  const referenceLabel = structure.sport === "ride" ? "FTP" : structure.sport === "run" ? "Schwelle" : null;

  const locate = useCallback(
    (clientX: number, rect: DOMRect) => {
      const px = clientX - rect.left - padL;
      if (px < 0 || px > plotW || !total) return null;
      const sec = (px / plotW) * total;
      const i = segments.findIndex((s) => sec >= s.start && sec < s.start + s.duration);
      return i === -1 ? segments.length - 1 : i;
    },
    [padL, plotW, total, segments],
  );

  const hovered: ProfileSegment | null = hover !== null ? segments[hover] ?? null : null;
  const ticks: number[] = [];
  if (axis && total) {
    const step = tickStep(total);
    for (let s = 0; s <= total + 1; s += step) ticks.push(s);
  }
  const yTicks = axis ? [0.5, 1, 1.5, 2].filter((v) => v < maxRel) : [];

  return (
    <div ref={ref} className={cn("relative w-full select-none", className)} style={{ height }}>
      {width > 0 && total > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Workout-Profil, ${formatDuration(total, { compact: true })}, ${segments.length} Abschnitte`}
          className="block touch-pan-y"
          onPointerMove={(e) => setHover(locate(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const i = locate(e.clientX, e.currentTarget.getBoundingClientRect());
            if (i !== null && onSelectStep) onSelectStep(segments[i].stepId);
          }}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke={v === 1 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
              <text x={padL - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[10px] tabular">
                {Math.round(v * 100)}%
              </text>
            </g>
          ))}
          {axis ? <line x1={padL} x2={width - padR} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} /> : null}

          {segments.map((s, i) => {
            const x0 = x(s.start);
            const w = Math.max(1, x(s.start + s.duration) - x0 - (x(s.start + s.duration) - x0 > 4 ? 1.5 : 0.5));
            const yLow = y(s.low);
            const yHigh = y(s.high);
            const base = y(0);
            const selected = selectedStepId === s.stepId;
            const dim = (hover !== null && hover !== i && segments[hover].stepId !== s.stepId) || (selectedStepId && !selected && hover === null);
            const color = ZONE_COLOR[s.zone];
            return (
              <g
                key={i}
                className={animate ? "animate-grow" : undefined}
                style={{ transformBox: "fill-box", transformOrigin: "bottom", animationDelay: animate ? `${Math.min(i * 14, 420)}ms` : undefined, opacity: dim ? 0.45 : 1, transition: "opacity 150ms" }}
              >
                <path d={roundedTopRect(x0, yLow, w, base - yLow, s.high === s.low ? 3 : 0)} fill={color} />
                {s.high > s.low ? <path d={roundedTopRect(x0, yHigh, w, yLow - yHigh, 3)} fill={color} opacity={0.42} /> : null}
                {selected ? <path d={roundedTopRect(x0, yHigh, w, base - yHigh, 3)} fill="none" stroke="var(--ink)" strokeWidth={1.5} /> : null}
              </g>
            );
          })}

          {referenceLabel && axis ? (
            <text x={width - padR} y={y(1) - 4} textAnchor="end" className="fill-ink-3 text-[10px] font-medium">
              {referenceLabel}
            </text>
          ) : null}

          {ticks.map((sec) => {
            const nearEnd = x(sec) > width - padR - 18;
            const label = total >= 3 * 3600 ? `${Math.floor(sec / 3600)}:${String(Math.round((sec % 3600) / 60)).padStart(2, "0")} h` : `${Math.round(sec / 60)}′`;
            return (
              <text key={sec} x={x(sec)} y={height - 6} textAnchor={sec === 0 ? "start" : nearEnd ? "end" : "middle"} className="fill-ink-3 text-[10px] tabular">
                {label}
              </text>
            );
          })}

          {hovered ? <line x1={x(hovered.start + hovered.duration / 2)} x2={x(hovered.start + hovered.duration / 2)} y1={padT} y2={y(0)} stroke="var(--ink)" strokeOpacity={0.18} /> : null}
        </svg>
      ) : null}

      {hovered ? (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-[240px] animate-fade-in rounded-xl border border-border bg-surface px-3 py-2 shadow-raised"
          style={{
            left: Math.min(Math.max(8, x(hovered.start + hovered.duration / 2) - 90), Math.max(8, width - 200)),
            top: 4,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: ZONE_COLOR[hovered.zone] }} />
            <span className="text-[13px] font-semibold text-ink">{stepTitle(hovered.step)}</span>
            {hovered.of ? <span className="text-[12px] text-ink-3">{hovered.round}/{hovered.of}</span> : null}
          </div>
          <div className="mt-1 space-y-0.5 text-[12px] text-ink-2 tabular">
            <div>
              {durationLabel(hovered.step.duration)}
              {targetAbsolute(hovered.step.target, structure.sport, thresholds) ? ` · ${targetAbsolute(hovered.step.target, structure.sport, thresholds)}` : ""}
            </div>
            {targetRelative(hovered.step.target) ? <div className="text-ink-3">{targetRelative(hovered.step.target)}</div> : null}
            {stepZoneLabel(hovered.step) ? <div className="text-ink-3">{stepZoneLabel(hovered.step)}</div> : null}
            {hovered.step.cadence ? <div className="text-ink-3">{hovered.step.cadence.low === hovered.step.cadence.high ? hovered.step.cadence.low : `${hovered.step.cadence.low}–${hovered.step.cadence.high}`} rpm</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Compact, non-interactive profile for cards and lists. */
export function WorkoutSparkline({ structure, thresholds, height = 40, className }: { structure: WorkoutStructure; thresholds: Thresholds; height?: number; className?: string }) {
  const segments = useMemo(() => profileSegments(structure, thresholds), [structure, thresholds]);
  const total = segments.length ? segments[segments.length - 1].start + segments[segments.length - 1].duration : 1;
  const maxRel = Math.min(2.2, Math.max(1.2, ...segments.map((s) => s.high)));
  const W = 300;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className={cn("block w-full", className)} style={{ height }} aria-hidden>
      {segments.map((s, i) => {
        const x0 = (s.start / total) * W;
        const w = Math.max(0.8, (s.duration / total) * W - 0.8);
        const h = (Math.min(s.high, maxRel) / maxRel) * height;
        return <rect key={i} x={x0} y={height - h} width={w} height={h} rx={0.8} fill={ZONE_COLOR[s.zone]} />;
      })}
    </svg>
  );
}
