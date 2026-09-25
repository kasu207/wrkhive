import Link from "next/link";
import { SportTile } from "@/components/brand";
import type { Activity } from "@/db/schema";
import { displayDate } from "@/lib/dates";
import { formatDateShort, formatDistance, formatDuration, formatPace, formatSpeedKmh, formatWeekday } from "@/lib/format";

export function activityMetrics(a: Pick<Activity, "sport" | "durationSec" | "movingSec" | "distanceM" | "avgSpeed" | "avgPower" | "normPower" | "avgHr">) {
  const parts: string[] = [formatDuration(a.durationSec, { compact: true })];
  if (a.distanceM) parts.push(formatDistance(a.distanceM));
  if (a.sport === "run" && a.distanceM) parts.push(`${formatPace((a.movingSec ?? a.durationSec) / (a.distanceM / 1000))} /km`);
  if (a.sport === "ride" && a.avgSpeed) parts.push(formatSpeedKmh(a.avgSpeed));
  if (a.sport === "ride" && (a.normPower || a.avgPower)) parts.push(`${a.normPower ?? a.avgPower} W${a.normPower ? " NP" : ""}`);
  return parts;
}

export function ActivityRow({ a, href }: { a: Activity; href?: string }) {
  const content = (
    <>
      <SportTile sport={a.sport} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[14px] font-medium text-ink">{a.name}</span>
          <span className="shrink-0 text-[12px] text-ink-3">
            {formatWeekday(displayDate(a.date))}, {formatDateShort(displayDate(a.date))}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-3 text-[12px] text-ink-3 tabular">
          <span className="truncate">{activityMetrics(a).join(" · ")}</span>
          {a.tss && Math.round(a.tss) > 0 ? <span className="shrink-0 font-medium text-ink-2">{Math.round(a.tss)} TSS</span> : null}
        </div>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/70">
      {content}
    </Link>
  ) : (
    <div className="flex items-center gap-3 px-5 py-3">{content}</div>
  );
}
