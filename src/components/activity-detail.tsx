"use client";

import { useRouter } from "next/navigation";
import { ZoneBars } from "@/components/charts/zone-bars";
import { SportTile } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import type { Activity } from "@/db/schema";
import { formatDistance, formatDuration, formatNumber, formatPace, formatSpeedKmh } from "@/lib/format";

const METHOD: Record<string, string> = {
  power: "aus Leistung (NP / FTP)",
  pace: "aus Pace (rTSS)",
  hr: "aus Herzfrequenz (hrTSS)",
  estimate: "geschätzt aus Dauer",
};

export function ActivityDetail({ activity: a, closeHref, lthr }: { activity: Activity; closeHref: string; lthr: number }) {
  const router = useRouter();
  const moving = a.movingSec ?? a.durationSec;
  const metrics: [string, string][] = [["Dauer", formatDuration(a.durationSec)]];
  if (a.movingSec && a.movingSec !== a.durationSec) metrics.push(["Bewegungszeit", formatDuration(a.movingSec)]);
  if (a.distanceM) metrics.push(["Distanz", formatDistance(a.distanceM)]);
  if (a.sport === "run" && a.distanceM) metrics.push(["Ø Pace", `${formatPace(moving / (a.distanceM / 1000))} /km`]);
  if (a.sport === "ride" && a.avgSpeed) metrics.push(["Ø Geschwindigkeit", formatSpeedKmh(a.avgSpeed)]);
  if (a.elevationGainM) metrics.push(["Höhenmeter", `${formatNumber(a.elevationGainM, 0)} m`]);
  if (a.avgPower) metrics.push(["Ø Leistung", `${a.avgPower} W`]);
  if (a.normPower) metrics.push(["Normalized Power", `${a.normPower} W`]);
  if (a.avgHr) metrics.push(["Ø Puls", `${a.avgHr} bpm${lthr ? ` (${Math.round((a.avgHr / lthr) * 100)} % LTHR)` : ""}`]);
  if (a.maxHr) metrics.push(["Max. Puls", `${a.maxHr} bpm`]);
  if (a.avgCadence) metrics.push([a.sport === "run" ? "Schrittfrequenz" : "Trittfrequenz", `${a.avgCadence} ${a.sport === "run" ? "spm" : "rpm"}`]);
  if (a.calories) metrics.push(["Kalorien", `${formatNumber(a.calories, 0)} kcal`]);
  if (a.vo2maxEst) metrics.push(["VO2max (effektiv)", formatNumber(a.vo2maxEst, 1)]);

  return (
    <Dialog
      open
      onClose={() => router.push(closeHref, { scroll: false })}
      title={a.name}
      description={new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(a.startTime)}
      size="lg"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SportTile sport={a.sport} size="sm" />
        {a.tss ? (
          <Badge tone="brand">
            {Math.round(a.tss)} TSS {a.tssMethod ? `· ${METHOD[a.tssMethod]}` : ""}
          </Badge>
        ) : null}
        {a.deviceName ? <Badge>{a.deviceName}</Badge> : null}
        <Badge>{a.provider === "garmin" ? "Garmin" : a.provider === "wahoo" ? "Wahoo" : a.provider === "intervals" ? "intervals.icu" : "Manuell"}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        {metrics.map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="text-[12px] text-ink-3">{k}</dt>
            <dd className="mt-0.5 text-[16px] font-semibold tabular">{v}</dd>
          </div>
        ))}
      </dl>
      {a.hrZoneSec?.some((s) => s > 0) ? (
        <div className="mt-5 rounded-xl border border-border pt-4">
          <h3 className="mb-3 px-5 text-[14px] font-semibold">Pulszonen</h3>
          <ZoneBars seconds={a.hrZoneSec} />
        </div>
      ) : null}
    </Dialog>
  );
}
