import { and, count, eq, gte } from "drizzle-orm";
import { ArrowRight, CalendarDays, CheckCircle2, CircleAlert, Plus, TrendingDown, TrendingUp, Watch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActivityRow } from "@/components/activity-row";
import { SportTile } from "@/components/brand";
import { PmcChart } from "@/components/charts/pmc-chart";
import { VolumeChart } from "@/components/charts/volume-chart";
import { ZoneBars } from "@/components/charts/zone-bars";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { WorkoutSparkline } from "@/components/workout/workout-chart";
import { getDb } from "@/db";
import { activities, deviceConnections } from "@/db/schema";
import { addDays, displayDate, startOfWeek } from "@/lib/dates";
import { formatDayLong, formatDuration, formatNumber, relativeTime } from "@/lib/format";
import { requireUser, thresholdsOf } from "@/lib/server/auth";
import { PROVIDERS, todayFor } from "@/lib/server/sync";
import { activitiesBetween, pmcFor, recentActivities, runningFitness, scheduledBetween, weeklyVolume } from "@/lib/server/training";

export const metadata: Metadata = { title: "Übersicht" };

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("de-DE", { hour: "numeric", hour12: false, timeZone }).format(new Date()));
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Hallo";
  return "Guten Abend";
}

function formState(tsb: number): { label: string; text: string; tone: "good" | "info" | "warning" | "critical" } {
  if (tsb > 25) return { label: "Sehr frisch", text: "Du bist ausgeruht. Bleibt die Belastung länger so niedrig, sinkt deine Fitness.", tone: "info" };
  if (tsb > 5) return { label: "Frisch", text: "Beste Voraussetzungen für harte Intervalle oder einen Wettkampf.", tone: "good" };
  if (tsb > -10) return { label: "Ausgeglichen", text: "Belastung und Erholung halten sich die Waage.", tone: "good" };
  if (tsb > -30) return { label: "Produktiv ermüdet", text: "Hier entsteht Trainingswirkung. Plane die nächste Entlastung ein.", tone: "warning" };
  return { label: "Überlastungsrisiko", text: "Sehr hohe Ermüdung. Ein paar lockere Tage bringen dich zurück.", tone: "critical" };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const db = getDb();
  const t = thresholdsOf(user);
  const today = todayFor(user);
  const pmc = pmcFor(user, 365);
  const now = pmc[pmc.length - 1];
  const weekAgo = pmc[pmc.length - 8];
  const weeks = weeklyVolume(user, 12);
  const thisWeek = weeks[weeks.length - 1];
  const lastWeek = weeks[weeks.length - 2];
  const hours = (w?: (typeof weeks)[number]) => (w ? w.ride + w.run + w.strength + w.other : 0);
  const recent = recentActivities(user.id, 6);
  const fitness = runningFitness(user);
  const upcoming = scheduledBetween(user.id, today, addDays(today, 6));
  const todays = upcoming.filter((u) => u.scheduled.date === today);
  const next = upcoming.filter((u) => u.scheduled.date > today && u.scheduled.status === "planned").slice(0, 4);
  const connections = db.select().from(deviceConnections).where(eq(deviceConnections.userId, user.id)).all();
  const activityCount = db.select({ n: count() }).from(activities).where(eq(activities.userId, user.id)).get()?.n ?? 0;
  const count28 = db.select({ n: count() }).from(activities).where(and(eq(activities.userId, user.id), gte(activities.date, addDays(today, -27)))).get()?.n ?? 0;

  const zoneSec = [0, 0, 0, 0, 0];
  for (const a of activitiesBetween(user.id, addDays(today, -27), today)) a.hrZoneSec?.forEach((s, i) => (zoneSec[i] += s));

  const hasData = activityCount > 0;
  const form = now && hasData ? formState(now.tsb) : null;
  const ctlDelta = now && weekAgo ? now.ctl - weekAgo.ctl : 0;
  const weekStart = startOfWeek(today);
  const weekDays = Math.min(7, Math.round((Date.parse(today) - Date.parse(weekStart)) / 86_400_000) + 1);

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
        </div>
      </div>

      {!connections.length ? (
        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand-ink">
            <Watch className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold">Verbinde Garmin oder Wahoo</h2>
            <p className="mt-0.5 text-[14px] text-ink-2">Dann landen deine Workouts mit einem Klick auf dem Gerät und deine Aktivitäten fließen automatisch in diese Übersicht.</p>
          </div>
          <ButtonLink href="/devices" variant="primary">
            Gerät verbinden
          </ButtonLink>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        {/* Today */}
        <Card className="flex flex-col">
          <CardHeader
            title="Heute"
            action={
              <Link href="/calendar" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
                Kalender <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <div className="flex flex-1 flex-col px-5 pb-5 pt-3">
            {todays.length ? (
              <div className="space-y-3">
                {todays.map(({ scheduled, workout }) => (
                  <Link key={scheduled.id} href={`/workouts/${workout.id}`} className="block rounded-xl border border-border p-3.5 transition-colors hover:border-border-strong hover:bg-surface-2/50">
                    <div className="flex items-center gap-3">
                      <SportTile sport={workout.sport} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold">{workout.name}</div>
                        <div className="text-[13px] text-ink-3 tabular">
                          {formatDuration(workout.durationSec, { compact: true })} · {workout.tss} TSS
                        </div>
                      </div>
                      {scheduled.status === "done" ? (
                        <Badge tone="good">
                          <CheckCircle2 /> Erledigt
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Geplant</Badge>
                      )}
                    </div>
                    <div className="mt-3">
                      <WorkoutSparkline structure={workout.structure} thresholds={t} height={38} />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[150px] flex-1 flex-col items-start justify-center gap-3 rounded-xl bg-surface-2/70 p-5">
                <div>
                  <p className="text-[15px] font-semibold">Nichts geplant</p>
                  <p className="mt-0.5 text-[14px] text-ink-2">{form ? `Deine Form: ${form.label.toLowerCase()}. ` : ""}Lass dir vom Coach eine passende Einheit bauen oder plane selbst.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ButtonLink href="/coach" size="sm">
                    Coach fragen
                  </ButtonLink>
                  <ButtonLink href="/workouts/new" size="sm" variant="secondary">
                    <Plus /> Workout
                  </ButtonLink>
                </div>
              </div>
            )}
            {next.length ? (
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-[12px] font-medium text-ink-3">Als Nächstes</p>
                <ul className="space-y-1.5">
                  {next.map(({ scheduled, workout }) => (
                    <li key={scheduled.id}>
                      <Link href={`/workouts/${workout.id}`} className="flex items-center gap-2.5 rounded-lg py-1 text-[13px] hover:text-ink">
                        <span className="w-16 shrink-0 text-ink-3">{new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric" }).format(displayDate(scheduled.date))}</span>
                        <SportTile sport={workout.sport} size="sm" className="size-5 rounded-md [&_svg]:size-3" />
                        <span className="truncate font-medium text-ink-2">{workout.name}</span>
                        <span className="ml-auto shrink-0 text-ink-3 tabular">{formatDuration(workout.durationSec, { compact: true })}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>

        {/* Form (hero) */}
        <Card className="flex flex-col p-5">
          <div className="flex items-start justify-between">
            <h2 className="text-[15px] font-semibold">Form</h2>
            {form ? (
              <Badge tone={form.tone === "critical" ? "critical" : form.tone === "warning" ? "warning" : form.tone === "info" ? "info" : "good"}>
                {form.tone === "critical" || form.tone === "warning" ? <CircleAlert /> : <CheckCircle2 />}
                {form.label}
              </Badge>
            ) : null}
          </div>
          {form && now ? (
            <>
              <div className="mt-3 text-[52px] font-semibold leading-none tracking-[-0.04em]">
                {now.tsb > 0 ? "+" : ""}
                {Math.round(now.tsb)}
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{form.text}</p>
              <div className="mt-auto grid grid-cols-2 gap-3 pt-5">
                <MiniStat label="Fitness (CTL)" value={formatNumber(now.ctl, 0)} delta={ctlDelta} deltaLabel="in 7 Tagen" upIsGood />
                <MiniStat label="Ermüdung (ATL)" value={formatNumber(now.atl, 0)} />
              </div>
            </>
          ) : (
            <p className="mt-3 text-[14px] text-ink-2">Sobald Aktivitäten synchronisiert sind, siehst du hier Fitness, Ermüdung und Form.</p>
          )}
        </Card>
      </div>

      {hasData ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Diese Woche" value={`${formatNumber(hours(thisWeek), 1)} h`} sub={`${weekDays === 7 ? "Vorwoche" : `nach ${weekDays} Tagen, Vorwoche`} ${formatNumber(hours(lastWeek), 1)} h`} />
            <StatTile label="Belastung Woche" value={`${Math.round(thisWeek?.tss ?? 0)} TSS`} sub={`Vorwoche ${Math.round(lastWeek?.tss ?? 0)} TSS`} />
            <StatTile label="Aktivitäten" value={`${count28}`} sub="letzte 28 Tage" />
            {fitness ? <StatTile label="VO2max (Lauf)" value={formatNumber(fitness.vo2max, 1)} sub={`aus ${fitness.samples} Läufen`} /> : <StatTile label="Distanz Woche" value={`${formatNumber(thisWeek?.distanceKm ?? 0, 0)} km`} sub={`Vorwoche ${formatNumber(lastWeek?.distanceKm ?? 0, 0)} km`} />}
          </div>

          <Card className="pb-3">
            <CardHeader title="Leistungsentwicklung" description="Fitness steigt mit regelmäßiger Belastung, Form zeigt, wie frisch du bist." className="mb-3" />
            <PmcChart data={pmc} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="pb-3">
              <CardHeader title="Wochenumfang" description="Stunden pro Woche nach Sportart" className="mb-3" />
              <VolumeChart weeks={weeks} />
            </Card>
            <Card>
              <CardHeader title="Pulszonen" description="Zeitverteilung der letzten 28 Tage" className="mb-4" />
              <ZoneBars seconds={zoneSec} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader
                title="Letzte Aktivitäten"
                action={
                  <Link href="/activities" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
                    Alle <ArrowRight className="size-3.5" />
                  </Link>
                }
              />
              <div className="mt-2 divide-y divide-border pb-2">
                {recent.map((a) => (
                  <ActivityRow key={a.id} a={a} href={`/activities?open=${a.id}`} />
                ))}
              </div>
            </Card>
            {fitness ? (
              <Card>
                <CardHeader title="Laufprognosen" description={`Aus deiner effektiven VO2max von ${formatNumber(fitness.vo2max, 1)}`} />
                <div className="mt-3 divide-y divide-border pb-2">
                  {fitness.predictions.map((p) => (
                    <div key={p.label} className="flex items-center justify-between px-5 py-3 text-[14px]">
                      <span className="text-ink-2">{p.label}</span>
                      <span className="font-semibold tabular">{formatDuration(p.seconds)}</span>
                    </div>
                  ))}
                </div>
                <p className="px-5 pb-5 text-[12px] leading-relaxed text-ink-3">Schätzung nach Daniels/Gilbert aus Pace und Puls deiner Läufe der letzten sechs Wochen. Voraussetzung ist passendes Training für die Distanz.</p>
              </Card>
            ) : (
              <Card>
                <CardHeader title="Diese Woche geplant" />
                <div className="mt-3 space-y-2 px-5 pb-5">
                  {upcoming.length ? (
                    upcoming.map(({ scheduled, workout }) => (
                      <div key={scheduled.id} className="flex items-center gap-2.5 text-[13px]">
                        <CalendarDays className="size-4 text-ink-3" />
                        <span className="w-14 text-ink-3">{new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(displayDate(scheduled.date))}</span>
                        <span className="truncate font-medium">{workout.name}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-[14px] text-ink-2">Noch nichts geplant.</p>
                  )}
                </div>
              </Card>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MiniStat({ label, value, delta, deltaLabel, upIsGood }: { label: string; value: string; delta?: number; deltaLabel?: string; upIsGood?: boolean }) {
  const up = (delta ?? 0) >= 0;
  const good = upIsGood ? up : !up;
  return (
    <div className="rounded-xl bg-surface-2/70 px-3.5 py-3">
      <div className="text-[12px] font-medium text-ink-3">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-[22px] font-semibold tracking-[-0.02em]">{value}</span>
        {delta !== undefined && Math.round(delta) !== 0 ? (
          <span className={`inline-flex items-center gap-0.5 text-[12px] font-medium ${good ? "text-good-ink" : "text-critical-ink"}`}>
            {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {`${up ? "+" : "−"}${Math.abs(Math.round(delta))}`}
            {deltaLabel ? <span className="ml-1 font-normal text-ink-3">{deltaLabel}</span> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="text-[12px] font-medium text-ink-3">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[12px] text-ink-3">{sub}</div> : null}
    </Card>
  );
}
