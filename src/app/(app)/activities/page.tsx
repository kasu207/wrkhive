import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ActivityDetail } from "@/components/activity-detail";
import { ActivityRow } from "@/components/activity-row";
import { ImportButton } from "@/components/import-button";
import { SportIcon } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { getDb } from "@/db";
import { activities } from "@/db/schema";
import { cn } from "@/lib/cn";
import { displayDate } from "@/lib/dates";
import { formatDistance, formatDuration, formatNumber } from "@/lib/format";
import { requireUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Aktivitäten" };

const FILTERS = [
  { value: "all", label: "Alle" },
  { value: "ride", label: "Rad" },
  { value: "run", label: "Laufen" },
  { value: "strength", label: "Kraft" },
] as const;

export default async function ActivitiesPage(props: PageProps<"/activities">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const sport = typeof sp.sport === "string" && ["ride", "run", "strength"].includes(sp.sport) ? (sp.sport as "ride" | "run" | "strength") : null;
  const limit = Math.min(2000, Math.max(50, Number(sp.limit) || 100));
  const db = getDb();
  const rows = db
    .select()
    .from(activities)
    .where(sport ? and(eq(activities.userId, user.id), eq(activities.sport, sport)) : eq(activities.userId, user.id))
    .orderBy(desc(activities.startTime))
    .limit(limit + 1)
    .all();
  const more = rows.length > limit;
  const list = rows.slice(0, limit);
  const openId = typeof sp.open === "string" ? sp.open : null;
  const open = openId ? db.select().from(activities).where(and(eq(activities.id, openId), eq(activities.userId, user.id))).get() : undefined;

  const groups = new Map<string, typeof list>();
  for (const a of list) {
    const key = a.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const q = (params: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const merged = { sport, ...params };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, String(v));
    const s = u.toString();
    return s ? `/activities?${s}` : "/activities";
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Aktivitäten"
        description="Alles, was deine Geräte aufgezeichnet haben, mit Belastung und Kennzahlen."
        actions={<ImportButton />}
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = (f.value === "all" && !sport) || f.value === sport;
          return (
            <Link
              key={f.value}
              href={q({ sport: f.value === "all" ? null : f.value })}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                active ? "border-ink bg-ink text-white" : "border-border-strong bg-surface text-ink-2 hover:text-ink",
              )}
            >
              {f.value !== "all" ? <SportIcon sport={f.value} className="size-4" /> : null}
              {f.label}
            </Link>
          );
        })}
      </div>

      {list.length ? (
        <div className="space-y-5">
          {[...groups.entries()].map(([month, items]) => {
            const sec = items.reduce((a, x) => a + x.durationSec, 0);
            const dist = items.reduce((a, x) => a + (x.distanceM ?? 0), 0);
            const tss = items.reduce((a, x) => a + (x.tss ?? 0), 0);
            return (
              <Card key={month}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
                  <h2 className="text-[15px] font-semibold">{new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(displayDate(`${month}-15`))}</h2>
                  <span className="text-[12px] text-ink-3 tabular">
                    {items.length} {items.length === 1 ? "Aktivität" : "Aktivitäten"} · {formatDuration(sec, { compact: true })}
                    {dist > 0 ? ` · ${formatDistance(dist)}` : ""}
                    {tss >= 1 ? ` · ${formatNumber(tss, 0)} TSS` : ""}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {items.map((a) => (
                    <ActivityRow key={a.id} a={a} href={q({ open: a.id, limit: limit !== 100 ? String(limit) : null })} />
                  ))}
                </div>
              </Card>
            );
          })}
          {more ? (
            <div className="flex justify-center">
              <ButtonLink href={q({ limit: String(limit + 200) })} variant="secondary" scroll={false}>
                Mehr laden
              </ButtonLink>
            </div>
          ) : null}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="Noch keine Aktivitäten"
            description="Verbinde Garmin oder Wahoo für den Dauer-Sync, oder importiere FIT-Dateien direkt von Uhr und Radcomputer."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/devices">Gerät verbinden</ButtonLink>
                <ImportButton />
              </div>
            }
          />
        </Card>
      )}

      {open ? <ActivityDetail activity={open} closeHref={q({ open: null, limit: limit !== 100 ? String(limit) : null })} lthr={user.lthr} /> : null}
    </div>
  );
}
