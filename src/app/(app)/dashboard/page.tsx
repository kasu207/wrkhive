import { and, count, eq, gte, isNull, ne, or } from "drizzle-orm";
import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardEditor } from "@/components/dashboard/editor";
import { PendingEntries } from "@/components/pending-entries";
import { Widget } from "@/components/dashboard/widgets";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db";
import { activities, deliveries, deviceConnections, workouts } from "@/db/schema";
import { cn } from "@/lib/cn";
import { layoutOf, WIDGET_IDS, WIDGETS, type WidgetId } from "@/lib/dashboard";
import { addDays, displayDate } from "@/lib/dates";
import { formatDayLong, relativeTime } from "@/lib/format";
import { autoAdaptToday } from "@/lib/server/adapt";
import { requireUser } from "@/lib/server/auth";
import { dashboardData, emptyHint } from "@/lib/server/dashboard";
import { dueEntries, entryView } from "@/lib/server/entries";
import { PROVIDERS } from "@/lib/server/sync";

export const metadata: Metadata = { title: "Übersicht" };

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("de-DE", { hour: "numeric", hour12: false, timeZone }).format(new Date()));
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Hallo";
  return "Guten Abend";
}

export default async function DashboardPage() {
  const user = await requireUser();
  if (!user.onboardedAt && !user.isDemo) redirect("/welcome");
  const db = getDb();
  // Automatic mode: adapt today's not yet sent workouts before rendering them.
  autoAdaptToday(user);
  const d = dashboardData(user);
  const today = d.today;
  const layout = layoutOf(user.dashboard);
  const connections = db.select().from(deviceConnections).where(eq(deviceConnections.userId, user.id)).all();
  const hasData = d.activityCount() > 0;
  // Before the first activity only what works without training history; the rest would be empty cards.
  const shown = hasData ? layout : layout.filter((i) => WIDGETS[i.id].group === "today" || WIDGETS[i.id].group === "recovery");
  const hints = Object.fromEntries(WIDGET_IDS.map((id) => [id, emptyHint(id, d)]).filter(([, h]) => h)) as Partial<Record<WidgetId, string>>;

  // A real athlete with a demo connection sees sample training in fitness and form.
  const sampleLoad = user.isDemo
    ? 0
    : (db.select({ n: count() }).from(activities).where(and(eq(activities.userId, user.id), eq(activities.sourceApp, "demo"), gte(activities.date, addDays(today, -42)))).get()?.n ?? 0);
  // Activation checklist (hidden for the demo and once everything is done).
  const setup = user.isDemo
    ? null
    : (() => {
        const live = connections.some((c) => c.mode === "live" && c.status !== "revoked") || !!user.appleHealthKeyHash;
        const realActivities = db.select({ n: count() }).from(activities).where(and(eq(activities.userId, user.id), or(isNull(activities.sourceApp), ne(activities.sourceApp, "demo")))).get()?.n ?? 0;
        const built = db.select({ n: count() }).from(workouts).where(and(eq(workouts.userId, user.id), ne(workouts.source, "plan"))).get()?.n ?? 0;
        const sent = db.select({ n: count() }).from(deliveries).where(and(eq(deliveries.userId, user.id), eq(deliveries.status, "sent"))).get()?.n ?? 0;
        const steps = [
          { label: "Apps und Geräte verbinden", hint: "Wahoo, Garmin, intervals.icu oder Apple Health", href: "/devices", done: live },
          { label: "Aktivitäten synchronisiert", hint: "Kommen nach dem Verbinden automatisch", href: "/activities", done: realActivities > 0 },
          { label: "Erstes Workout gebaut", hint: "Selbst, aus einer Vorlage oder vom Coach", href: "/workouts/new", done: built > 0 },
          { label: "Workout aufs Gerät gesendet", hint: "Im Workout auf „An Gerät senden“", href: "/workouts", done: sent > 0 },
        ];
        return { steps, done: steps.filter((x) => x.done).length };
      })();

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-ink-3">{formatDayLong(displayDate(today))}</p>
          <h1 className="mt-0.5 text-[28px] font-semibold tracking-[-0.025em] sm:text-[30px]">
            {greeting(user.timeZone)}, {user.name.split(" ")[0]}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connections.map((c) => (
            <Link key={c.id} href="/devices" className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-surface px-3 text-[12px] text-ink-2 shadow-card hover:border-border-strong">
              <span className={c.status === "connected" ? "size-2 rounded-full bg-good" : "size-2 rounded-full bg-critical"} />
              {PROVIDERS[c.provider].name}
              {c.mode === "demo" ? " (Demo)" : ""}
              <span className="text-ink-3">· {c.lastSyncAt ? relativeTime(c.lastSyncAt) : "noch nicht synchronisiert"}</span>
            </Link>
          ))}
          <DashboardEditor layout={layout} hints={hints} />
        </div>
      </div>

      <PendingEntries entries={dueEntries(user).map((e) => entryView(e, today, user.timeZone))} />

      {setup && setup.done < setup.steps.length ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Einrichtung</h2>
            <span className="text-[13px] text-ink-3 tabular">
              {setup.done} von {setup.steps.length} erledigt
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-good transition-[width]" style={{ width: `${(setup.done / setup.steps.length) * 100}%` }} />
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {setup.steps.map((st) => (
              <li key={st.label}>
                <Link
                  href={st.href}
                  className={cn(
                    "flex h-full items-start gap-2.5 rounded-xl border p-3 text-[13px] transition-colors",
                    st.done ? "border-transparent bg-good-soft/60 text-ink-2" : "border-border hover:border-border-strong hover:bg-surface-2/50",
                  )}
                >
                  {st.done ? <CheckCircle2 className="mt-px size-4 shrink-0 text-good-ink" /> : <span className="mt-px size-4 shrink-0 rounded-full border-2 border-border-strong" />}
                  <span>
                    <span className={cn("block font-medium", st.done ? "text-ink-2" : "text-ink")}>{st.label}</span>
                    {!st.done ? <span className="block text-ink-3">{st.hint}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {shown.length ? (
        <div className="grid grid-flow-row-dense grid-cols-2 gap-4 lg:grid-cols-4">
          {shown.map((item) => (
            <Widget key={item.id} item={item} d={d} sampleLoad={sampleLoad} />
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center">
          <p className="text-[15px] font-semibold">Deine Übersicht ist leer</p>
          <p className="mt-1 text-[14px] text-ink-2">Über „Anpassen“ wählst du, welche Werte du sehen willst.</p>
        </Card>
      )}
    </div>
  );
}
