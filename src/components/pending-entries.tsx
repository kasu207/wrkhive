"use client";

import { CircleAlert } from "lucide-react";
import { SportTile } from "@/components/brand";
import { RateEntryForm, type CalEntry } from "@/components/calendar/entry-dialogs";
import { Card } from "@/components/ui/card";
import { displayDate } from "@/lib/dates";
import { formatDayLong } from "@/lib/format";

/** Planned sessions that took place and still need the athlete's confirmation and rating. */
export function PendingEntries({ entries }: { entries: CalEntry[] }) {
  if (!entries.length) return null;
  return (
    <Card className="border-[#f5dca6] p-5">
      <div className="mb-3 flex items-start gap-2.5">
        <CircleAlert className="mt-0.5 size-[18px] shrink-0 text-warning-ink" />
        <div>
          <h2 className="text-[15px] font-semibold">{entries.length === 1 ? "Ein Termin wartet auf deine Freigabe" : `${entries.length} Termine warten auf deine Freigabe`}</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">Bestätige Dauer und Anstrengung, damit die Einheit in deine Belastung einfließt. Hat deine Uhr sie aufgezeichnet, übernimmt Wrkhive das automatisch.</p>
        </div>
      </div>
      <div className="divide-y divide-border">
        {entries.map((e) => (
          <div key={e.id} className="py-3 first:pt-1 last:pb-0">
            <div className="mb-2 flex items-center gap-2.5">
              <SportTile sport={e.sport} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold">{e.name}</div>
                <div className="text-[12px] text-ink-3">
                  {formatDayLong(displayDate(e.date))}
                  {e.time ? `, ${e.time} Uhr` : ""}
                </div>
              </div>
            </div>
            <RateEntryForm entry={e} compact />
          </div>
        ))}
      </div>
    </Card>
  );
}
