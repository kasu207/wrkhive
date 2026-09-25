"use client";

import { useState } from "react";
import { ZONE_COLOR } from "@/lib/workout/display";
import { formatDuration } from "@/lib/format";

const NAMES = ["Erholung", "Grundlage", "Tempo", "Schwelle", "VO2max"];
// Heart-rate zones 1-5 reuse the first five zone colors.
const COLORS = [ZONE_COLOR[1], ZONE_COLOR[2], ZONE_COLOR[3], ZONE_COLOR[4], ZONE_COLOR[5]];

/** Time in heart-rate zones as horizontal bars with value labels. */
export function ZoneBars({ seconds }: { seconds: number[] }) {
  const total = seconds.reduce((a, b) => a + b, 0);
  const max = Math.max(...seconds, 1);
  const [hover, setHover] = useState<number | null>(null);
  if (!total) return <p className="px-5 pb-5 text-sm text-ink-3">Noch keine Pulsdaten im Zeitraum.</p>;
  const easy = (seconds[0] + seconds[1]) / total;

  return (
    <div className="px-5 pb-5">
      <div className="space-y-2.5" onPointerLeave={() => setHover(null)}>
        {seconds.map((s, i) => (
          <div key={i} className="grid grid-cols-[100px_1fr_auto] items-center gap-3 text-[13px]" onPointerEnter={() => setHover(i)}>
            <span className="text-ink-2">
              <span className="font-medium text-ink">Z{i + 1}</span> {NAMES[i]}
            </span>
            <div className="h-3 rounded-full bg-surface-2">
              <div
                className="h-3 origin-left animate-[grow-x_600ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-full"
                style={{ width: `${Math.max(1.5, (s / max) * 100)}%`, background: COLORS[i], opacity: hover === null || hover === i ? 1 : 0.5, transition: "opacity 150ms", animationDelay: `${i * 60}ms` }}
              />
            </div>
            <span className="whitespace-nowrap text-right text-ink-2 tabular">
              {Math.round((s / total) * 100)} % <span className="text-ink-3">· {formatDuration(s, { compact: true })}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-ink-2">
        <span className="font-semibold text-ink">{Math.round(easy * 100)} %</span> deiner Zeit in Z1–Z2.{" "}
        {easy >= 0.75 ? "Eine solide, polarisierte Verteilung." : easy >= 0.6 ? "Etwas mehr lockeres Training würde die Erholung verbessern." : "Viel Zeit im mittleren und harten Bereich. Achte auf genug lockere Einheiten."}
      </p>
    </div>
  );
}
