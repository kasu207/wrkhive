import { ArrowRight, CalendarDays, CheckCircle2, CircleAlert, Plus, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityRow } from "@/components/activity-row";
import { AdaptStrip } from "@/components/adapt-strip";
import { BaselineForm } from "@/components/baseline-form";
import { SportTile } from "@/components/brand";
import { PmcChart } from "@/components/charts/pmc-chart";
import { TrendChart } from "@/components/charts/trend";
import { VolumeChart } from "@/components/charts/volume-chart";
import { ZoneBars } from "@/components/charts/zone-bars";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { WorkoutSparkline } from "@/components/workout/workout-chart";
import { PACE_DISTANCES, PACE_LABEL, POWER_DURATIONS, POWER_LABEL } from "@/lib/analytics/bests";
import type { MetricTrend } from "@/lib/analytics/wellness";
import { cn } from "@/lib/cn";
import { WIDGETS, type LayoutItem, type WidgetId } from "@/lib/dashboard";
import { addDays, displayDate, startOfWeek } from "@/lib/dates";
import { formatDateShort, formatDuration, formatNumber, formatPace } from "@/lib/format";
import { thresholdsOf } from "@/lib/server/auth";
import { emptyHint, type DashboardData } from "@/lib/server/dashboard";
import { adaptWorkout } from "@/lib/workout/adapt";
import { CheckinForm } from "./checkin-form";
import { ThresholdSuggestions } from "./threshold-suggestions";

/** Grid span per size: tiles take a quarter, cards half, wide cards the full row. */
export const SIZE_CLASS: Record<LayoutItem["size"], string> = {
  s: "col-span-1",
  m: "col-span-2",
  l: "col-span-2 lg:col-span-4",
};

/** Form relative to fitness, on the same scale as the readiness model (analytics/readiness.ts). */
function formState(formPct: number): { label: string; text: string; tone: "good" | "info" | "warning" | "critical" } {
  if (formPct > 25) return { label: "Sehr frisch", text: "Du bist ausgeruht. Bleibt die Belastung länger so niedrig, sinkt deine Fitness.", tone: "info" };
  if (formPct > 5) return { label: "Frisch", text: "Beste Voraussetzungen für harte Intervalle oder einen Wettkampf.", tone: "good" };
  if (formPct > -10) return { label: "Ausgeglichen", text: "Belastung und Erholung halten sich die Waage.", tone: "good" };
  if (formPct >= -30) return { label: "Produktiv ermüdet", text: "Hier entsteht Trainingswirkung. Plane die nächste Entlastung ein.", tone: "warning" };
  if (formPct >= -40) return { label: "Stark belastet", text: "Die Ermüdung ist hoch. Harte Einheiten besser etwas kürzer und leichter.", tone: "warning" };
  return { label: "Überlastungsrisiko", text: "Sehr hohe Ermüdung. Ein paar lockere Tage bringen dich zurück.", tone: "critical" };
}

export function formOf(d: DashboardData) {
  const pmc = d.pmc();
  const now = pmc[pmc.length - 1];
  const formPct = now ? Math.round((now.tsb / Math.max(now.ctl, 20)) * 100) : 0;
  const form = now && d.activityCount() > 0 && d.calibration().reliable ? formState(formPct) : null;
  return { now, weekAgo: pmc[pmc.length - 8], formPct, form };
}

const TONE_BADGE = { good: "good", info: "info", warning: "warning", critical: "critical" } as const;

function EmptyHint({ text }: { text: string }) {
  return <p className="px-5 pb-5 pt-2 text-[13px] leading-relaxed text-ink-3">{text}</p>;
}

function Arrow({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
      {label} <ArrowRight className="size-3.5" />
    </Link>
  );
}

/** Renders one widget of the athlete's layout. */
export function Widget({ item, d, sampleLoad }: { item: LayoutItem; d: DashboardData; sampleLoad: number }) {
  const hint = emptyHint(item.id, d);
  const meta = WIDGETS[item.id];
  const content = hint ? null : renderContent(item, d, sampleLoad);
  if (content) return <div className={SIZE_CLASS[item.size]}>{content}</div>;
  // Without data: title and how to get it, never an empty chart.
  return (
    <div className={SIZE_CLASS[item.size]}>
      <Card className="h-full">
        <CardHeader title={meta.title} />
        <EmptyHint text={hint ?? "Noch keine Daten."} />
      </Card>
    </div>
  );
}

function renderContent(item: LayoutItem, d: DashboardData, sampleLoad: number): ReactNode {
  const id: WidgetId = item.id;
  switch (id) {
    case "today":
      return <TodayCard d={d} />;
    case "form":
      return <FormCard d={d} sampleLoad={sampleLoad} />;
    case "recovery":
      return <RecoveryCard d={d} />;
    case "checkin": {
      const c = d.todayCheckin();
      return (
        <Card className="h-full">
          <CardHeader title="Morgen-Check-in" description="Wie fühlst du dich heute? Fließt in deine Erholung ein." />
          <CheckinForm date={d.today} initial={{ legs: c?.legs ?? null, sleepFeel: c?.sleepFeel ?? null, motivation: c?.motivation ?? null }} />
        </Card>
      );
    }
    case "restingHr":
      return <MetricWidget size={item.size} title="Ruhepuls" trend={d.restingHr()} today={d.today} format={(v) => `${Math.round(v)}`} unit="bpm" goodDirection="down" />;
    case "hrv": {
      const t = d.hrv();
      return <MetricWidget size={item.size} title={t.metric === "hrvSdnn" ? "HRV (SDNN)" : "HRV"} trend={t} today={d.today} format={(v) => `${Math.round(v)}`} unit="ms" goodDirection="up" />;
    }
    case "sleep":
      return <MetricWidget size={item.size} title="Schlafdauer" trend={d.sleep()} today={d.today} format={(v) => formatDuration(v, { compact: true })} unit="" goodDirection="up" />;
    case "weight":
      return <MetricWidget size={item.size} title="Gewicht" trend={d.weight()} today={d.today} format={(v) => formatNumber(v, 1)} unit="kg" goodDirection={null} />;
    case "weekHours": {
      const { thisWeek, lastWeek, weekDays } = weekStats(d);
      return <StatTile label="Diese Woche" value={`${formatNumber(hours(thisWeek), 1)} h`} sub={`${weekDays === 7 ? "Vorwoche" : `nach ${weekDays} Tagen, Vorwoche`} ${formatNumber(hours(lastWeek), 1)} h`} />;
    }
    case "weekLoad": {
      const { thisWeek, lastWeek } = weekStats(d);
      return <StatTile label="Belastung Woche" value={`${Math.round(thisWeek?.tss ?? 0)} TSS`} sub={`Vorwoche ${Math.round(lastWeek?.tss ?? 0)} TSS`} />;
    }
    case "weekDistance": {
      const { thisWeek, lastWeek } = weekStats(d);
      return <StatTile label="Distanz Woche" value={`${formatNumber(thisWeek?.distanceKm ?? 0, 0)} km`} sub={`Vorwoche ${formatNumber(lastWeek?.distanceKm ?? 0, 0)} km`} />;
    }
    case "count28":
      return <StatTile label="Aktivitäten" value={`${d.count28()}`} sub="letzte 28 Tage" />;
    case "consistency":
      return <ConsistencyWidget d={d} item={item} />;
    case "vo2max": {
      const f = d.fitness();
      return f ? <StatTile label="VO2max (Lauf)" value={formatNumber(f.vo2max, 0)} sub={`Schätzung aus ${f.samples} Läufen`} /> : null;
    }
    case "pmc":
      return (
        <Card className="h-full pb-3">
          <CardHeader title="Leistungsentwicklung" description="Fitness steigt mit regelmäßiger Belastung, Form zeigt, wie frisch du bist." className="mb-3" />
          <PmcChart data={d.pmc()} />
        </Card>
      );
    case "volume":
      return (
        <Card className="h-full pb-3">
          <CardHeader title="Wochenumfang" description="Stunden pro Woche nach Sportart" className="mb-3" />
          <VolumeChart weeks={d.weeks()} />
        </Card>
      );
    case "zones":
      return (
        <Card className="h-full">
          <CardHeader title="Pulszonen" description="Zeitverteilung der letzten 28 Tage" className="mb-4" />
          <ZoneBars seconds={d.zoneSec()} />
        </Card>
      );
    case "intensity":
      return <IntensityCard d={d} />;
    case "thresholds":
      return <ThresholdCard d={d} />;
    case "efficiency":
      return <EfficiencyCard d={d} />;
    case "bests":
      return <BestsCard d={d} />;
    case "predictions": {
      const f = d.fitness();
      if (!f) return null;
      return (
        <Card className="h-full">
          <CardHeader title="Laufprognosen" description={`Aus deiner effektiven VO2max von ${formatNumber(f.vo2max, 1)}`} />
          <div className="mt-3 divide-y divide-border pb-2">
            {f.predictions.map((p) => (
              <div key={p.label} className="flex items-center justify-between px-5 py-3 text-[14px]">
                <span className="text-ink-2">{p.label}</span>
                <span className="font-semibold tabular">{formatDuration(p.seconds)}</span>
              </div>
            ))}
          </div>
          <p className="px-5 pb-5 text-[12px] leading-relaxed text-ink-3">Schätzung nach Daniels/Gilbert aus Pace und Puls deiner Läufe der letzten sechs Wochen. Voraussetzung ist passendes Training für die Distanz.</p>
        </Card>
      );
    }
    case "recent":
      return (
        <Card className="h-full">
          <CardHeader title="Letzte Aktivitäten" action={<Arrow href="/activities" label="Alle" />} />
          <div className="mt-2 divide-y divide-border pb-2">
            {d.recent().map((a) => (
              <ActivityRow key={a.id} a={a} href={`/activities?open=${a.id}`} />
            ))}
          </div>
        </Card>
      );
    case "planned": {
      const upcoming = d.upcoming();
      return (
        <Card className="h-full">
          <CardHeader title="Diese Woche geplant" action={<Arrow href="/calendar" label="Kalender" />} />
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
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Today and form

function TodayCard({ d }: { d: DashboardData }) {
  const t = thresholdsOf(d.user);
  const readiness = d.readiness();
  const upcoming = d.upcoming();
  const todays = upcoming.filter((u) => u.scheduled.date === d.today);
  const next = upcoming.filter((u) => u.scheduled.date > d.today && u.scheduled.status === "planned").slice(0, 4);
  const { form } = formOf(d);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Heute" action={<Arrow href="/calendar" label="Kalender" />} />
      <div className="flex flex-1 flex-col px-5 pb-5 pt-3">
        {todays.length ? (
          <div className="space-y-3">
            {todays.map(({ scheduled, workout }) => {
              const suggestion = scheduled.status === "planned" && !scheduled.originalWorkoutId && readiness && readiness.mode !== "keep" ? adaptWorkout(workout.structure, readiness.mode, t) : null;
              return (
                <div key={scheduled.id}>
                  <Link href={`/workouts/${workout.id}`} className="block rounded-xl border border-border p-3.5 transition-colors hover:border-border-strong hover:bg-surface-2/50">
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
                  {scheduled.originalWorkoutId && scheduled.adaptNote && scheduled.status === "planned" ? (
                    <AdaptStrip scheduledId={scheduled.id} workoutId={workout.id} state="adapted" note={scheduled.adaptNote} reason="" />
                  ) : suggestion && readiness ? (
                    <AdaptStrip scheduledId={scheduled.id} workoutId={workout.id} state="suggest" note={suggestion.note} reason={readiness.advice} />
                  ) : null}
                </div>
              );
            })}
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
  );
}

function FormCard({ d, sampleLoad }: { d: DashboardData; sampleLoad: number }) {
  const { now, weekAgo, formPct, form } = formOf(d);
  const calibration = d.calibration();
  const hasData = d.activityCount() > 0;
  const ctlDelta = now && weekAgo ? now.ctl - weekAgo.ctl : 0;
  const stats = now ? (
    <div className="mt-auto grid grid-cols-2 gap-3 pt-5">
      <MiniStat label="Fitness (CTL)" value={formatNumber(now.ctl, 0)} delta={ctlDelta} deltaLabel="in 7 Tagen" upIsGood />
      <MiniStat label="Ermüdung (ATL)" value={formatNumber(now.atl, 0)} />
    </div>
  ) : null;
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between">
        <h2 className="text-[15px] font-semibold">Form</h2>
        {form ? (
          <Badge tone={TONE_BADGE[form.tone]}>
            {form.tone === "critical" || form.tone === "warning" ? <CircleAlert /> : <CheckCircle2 />}
            {form.label}
          </Badge>
        ) : null}
      </div>
      {form && now ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[52px] font-semibold leading-none tracking-[-0.04em]">
              {now.tsb > 0 ? "+" : ""}
              {Math.round(now.tsb)}
            </span>
            <span className="text-[14px] font-medium text-ink-3 tabular">
              {formPct > 0 ? "+" : ""}
              {formPct} % der Fitness
            </span>
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{form.text}</p>
          {sampleLoad ? (
            <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] leading-relaxed text-warning-ink">
              Enthält {sampleLoad} Beispieleinheiten einer Demo-Verbindung.{" "}
              <Link href="/devices" className="font-medium underline">
                Demo-Verbindung trennen
              </Link>{" "}
              und dabei die importierten Aktivitäten löschen, damit Fitness und Form nur dein Training zeigen.
            </p>
          ) : null}
          {stats}
        </>
      ) : hasData && now ? (
        <>
          <Badge tone="info" className="mt-3 self-start">
            Kalibrierung, noch {calibration.remainingDays} {calibration.remainingDays === 1 ? "Tag" : "Tage"}
          </Badge>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
            Wrkhive kennt dein Training erst seit {calibration.historyDays} {calibration.historyDays === 1 ? "Tag" : "Tagen"}. Ohne Vorgeschichte startet die Fitness bei null, und jede Einheit wirkt wie Überlastung. Gib an, wie viel du bisher trainiert hast, dann stimmt die Form sofort.
          </p>
          <div className="mt-3">
            <BaselineForm />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
            Genauer geht es mit echter Historie:{" "}
            <Link href="/devices" className="font-medium text-ink-2 underline">
              ältere Aktivitäten importieren
            </Link>{" "}
            (z. B. Garmin-Connect-Export als ZIP). Bis dahin werden Workouts nicht automatisch angepasst.
          </p>
          {stats}
        </>
      ) : (
        <p className="mt-3 text-[14px] text-ink-2">Sobald Aktivitäten synchronisiert sind, siehst du hier Fitness, Ermüdung und Form.</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recovery and health

const SIGNAL_DOT = { good: "bg-good", normal: "bg-border-strong", negative: "bg-critical" } as const;

function RecoveryCard({ d }: { d: DashboardData }) {
  const r = d.recovery();
  if (!r) return null;
  const readiness = d.readiness();
  const tone = r.level === "impaired" ? "critical" : r.level === "slightly" ? "warning" : "good";
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Erholung</h2>
        <Badge tone={tone}>
          {tone === "good" ? <CheckCircle2 /> : <CircleAlert />}
          {r.label}
        </Badge>
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{r.advice}</p>
      <ul className="mt-4 space-y-2">
        {r.signals.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 text-[13px]">
            <span className={cn("size-2 shrink-0 rounded-full", SIGNAL_DOT[s.state])} aria-hidden />
            <span className="w-20 shrink-0 font-medium">{s.label}</span>
            <span className="text-ink-2">{s.text}</span>
          </li>
        ))}
      </ul>
      {r.level === "impaired" && readiness?.mode !== "keep" && d.user.autoAdapt ? (
        <p className="mt-auto pt-4 text-[12px] leading-relaxed text-ink-3">Harte Einheiten von heute werden automatisch angepasst, solange sie noch nicht aufs Gerät gesendet sind.</p>
      ) : (
        <p className="mt-auto pt-4 text-[12px] leading-relaxed text-ink-3">7-Tage-Schnitt gegen deinen Normalbereich der letzten 60 Tage. Einzelne Tage schwanken zu stark, um allein etwas zu sagen.</p>
      )}
    </Card>
  );
}

function statusText(t: MetricTrend, goodDirection: "up" | "down" | null): { text: string; tone: "good" | "neutral" | "warning" } {
  if (!t.baseline) return { text: `Normalbereich ab ${14 - t.series.length > 0 ? `${14 - t.series.length} weiteren` : "14"} Messungen`, tone: "neutral" };
  if (!t.status) return { text: "Zu wenige Werte in den letzten 7 Tagen", tone: "neutral" };
  if (t.status === "normal") return { text: "im Normalbereich", tone: "good" };
  const above = t.status === "high";
  const good = goodDirection === null ? null : (goodDirection === "up") === above;
  return { text: above ? "über deinem Normalbereich" : "unter deinem Normalbereich", tone: good === false ? "warning" : "neutral" };
}

function MetricWidget({
  size,
  title,
  trend,
  today,
  format,
  unit,
  goodDirection,
}: {
  size: LayoutItem["size"];
  title: string;
  trend: MetricTrend;
  today: string;
  format: (v: number) => string;
  unit: string;
  goodDirection: "up" | "down" | null;
}) {
  const value = trend.avg7 ?? trend.latest?.value ?? null;
  if (value === null) return null;
  const status = statusText(trend, goodDirection);
  const statusClass = status.tone === "warning" ? "text-warning-ink" : status.tone === "good" ? "text-good-ink" : "text-ink-3";
  const from = addDays(today, size === "s" ? -29 : -59);
  const series = trend.series.filter((p) => p.date >= from);
  const valueLabel = trend.avg7 !== null ? "7-Tage-Schnitt" : `zuletzt ${formatDateShort(displayDate(trend.latest!.date))}`;
  if (size === "s") {
    return (
      <Card className="flex h-full flex-col px-4 py-3.5">
        <div className="text-[12px] font-medium text-ink-3">{title}</div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-[22px] font-semibold tracking-[-0.02em] tabular">{format(value)}</span>
          {unit ? <span className="text-[13px] text-ink-3">{unit}</span> : null}
        </div>
        <div className={cn("mt-0.5 truncate text-[12px]", statusClass)}>{status.text}</div>
        <div className="mt-auto pt-2">
          <TrendChart series={series} from={from} to={today} band={trend.baseline} height={32} dots={false} label={`${title}, letzte 30 Tage`} />
        </div>
      </Card>
    );
  }
  return (
    <Card className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className={cn("text-[13px] font-medium", statusClass)}>{status.text}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[30px] font-semibold tracking-[-0.03em] tabular">{format(value)}</span>
        {unit ? <span className="text-[14px] text-ink-3">{unit}</span> : null}
        <span className="ml-1 text-[13px] text-ink-3">{valueLabel}</span>
      </div>
      <div className="mt-3">
        <TrendChart series={series} from={from} to={today} band={trend.baseline} height={88} label={`${title}, letzte 60 Tage`} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12px] text-ink-3">
        <span>
          {trend.baseline ? (
            <>
              <span className="mr-1 inline-block size-2.5 rounded-sm bg-good-soft align-[-1px] ring-1 ring-inset ring-[#c9e9c9]" /> Normalbereich {format(trend.baseline.low)}–{format(trend.baseline.high)}
              {unit ? ` ${unit}` : ""}
            </>
          ) : (
            "Normalbereich ab 14 Messungen"
          )}
        </span>
        {trend.latest ? (
          <span>
            Letzte Messung {format(trend.latest.value)}
            {unit ? ` ${unit}` : ""}, {formatDateShort(displayDate(trend.latest.date))}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Load and consistency

const hours = (w?: { ride: number; run: number; strength: number; other: number }) => (w ? w.ride + w.run + w.strength + w.other : 0);

function weekStats(d: DashboardData) {
  const weeks = d.weeks();
  const weekStart = startOfWeek(d.today);
  return {
    thisWeek: weeks[weeks.length - 1],
    lastWeek: weeks[weeks.length - 2],
    weekDays: Math.min(7, Math.round((Date.parse(d.today) - Date.parse(weekStart)) / 86_400_000) + 1),
  };
}

function ConsistencyWidget({ d, item }: { d: DashboardData; item: LayoutItem }) {
  const c = d.consistency(item.goal);
  const weeks = item.size === "s" ? c.weeks.slice(-8) : c.weeks;
  const dots = (
    <div className="flex items-end gap-1" aria-hidden>
      {weeks.map((w) => (
        <span
          key={w.week}
          title={`Woche ab ${formatDateShort(displayDate(w.week))}: ${w.sessions} Einheiten`}
          className={cn("h-2.5 flex-1 rounded-full", w.met ? "bg-good" : w.current ? "bg-surface-3 ring-1 ring-inset ring-border-strong" : w.sessions ? "bg-warning" : "bg-surface-3")}
        />
      ))}
    </div>
  );
  const current = c.weeks[c.weeks.length - 1];
  const sub = item.size === "s" ? `Ziel ${c.goal}/Woche${current.met ? "" : ` · jetzt ${current.sessions}`}` : `Ziel ${c.goal} ${c.goal === 1 ? "Einheit" : "Einheiten"} pro Woche${current.met ? "" : `, diese Woche bisher ${current.sessions}`}`;
  if (item.size === "s") {
    return (
      <Card className="flex h-full flex-col px-4 py-3.5">
        <div className="text-[12px] font-medium text-ink-3">Regelmäßigkeit</div>
        <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
          {c.streak} {c.streak === 1 ? "Woche" : "Wochen"}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-ink-3">{sub}</div>
        <div className="mt-auto pt-2.5">{dots}</div>
      </Card>
    );
  }
  const met = c.weeks.filter((w) => w.met && !w.current).length;
  return (
    <Card className="h-full p-5">
      <h2 className="text-[15px] font-semibold">Regelmäßigkeit</h2>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[30px] font-semibold tracking-[-0.03em]">{c.streak}</span>
        <span className="text-[14px] text-ink-2">{c.streak === 1 ? "Woche" : "Wochen"} in Folge</span>
      </div>
      <p className="mt-1 text-[13px] text-ink-3">{sub}</p>
      <div className="mt-4">{dots}</div>
      <p className="mt-3 text-[12px] text-ink-3">
        Ziel in {met} der letzten {c.weeks.length - 1} Wochen erreicht. Die laufende Woche zählt, sobald das Ziel erreicht ist.
      </p>
    </Card>
  );
}

function IntensityCard({ d }: { d: DashboardData }) {
  const s = d.intensity();
  const total = s.low + s.mid + s.high;
  if (!total) return null;
  const pct = (v: number) => Math.round((v / total) * 100);
  const low = pct(s.low);
  const parts = [
    { key: "low", label: "Locker", sub: "Z1–Z2", pct: low, color: "var(--zone-2)" },
    { key: "mid", label: "Mittel", sub: "Z3–Z4", pct: pct(s.mid), color: "var(--zone-4)" },
    { key: "high", label: "Hart", sub: "Z5", pct: 100 - low - pct(s.mid), color: "var(--zone-6)" },
  ];
  const verdict =
    low >= 75
      ? "Solide Grundlage: der größte Teil deines Trainings ist locker, das trägt die harten Einheiten."
      : low >= 60
        ? "Etwas viel mittlere Intensität. Lockere Einheiten lockerer fahren oder laufen bringt meist mehr als noch eine zügige."
        : "Viel Zeit im mittleren und harten Bereich. Mehr lockeres Training verbessert Erholung und Grundlage.";
  const weeks = d.lowShare();
  return (
    <Card className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Intensitätsverteilung</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">Letzte 28 Tage, {s.sessions} Einheiten mit Puls</p>
        </div>
        <span className="text-[30px] font-semibold leading-none tracking-[-0.03em] tabular">{low} %</span>
      </div>
      <div className="relative mt-4">
        <div className="flex h-3 overflow-hidden rounded-full">
          {parts.map((p) => (p.pct > 0 ? <div key={p.key} style={{ width: `${p.pct}%`, background: p.color }} /> : null))}
        </div>
        <div className="absolute -top-1 h-5 w-0.5 rounded bg-ink" style={{ left: "80%" }} title="Ziel etwa 80 % locker" />
      </div>
      <div className="mt-2 grid grid-cols-3 text-[12px]">
        {parts.map((p) => (
          <div key={p.key} className={p.key === "mid" ? "text-center" : p.key === "high" ? "text-right" : ""}>
            <span className="font-medium text-ink">{p.label}</span> <span className="text-ink-3">{p.sub} · {p.pct} %</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{verdict}</p>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[12px] text-ink-3">
          <span>Anteil locker pro Woche</span>
          <span>12 Wochen</span>
        </div>
        <div className="flex h-10 items-end gap-1">
          {weeks.map((w) => (
            <div key={w.week} className="flex h-full flex-1 items-end rounded-sm bg-surface-2" title={w.share === null ? "keine Pulsdaten" : `${Math.round(w.share * 100)} % locker`}>
              {w.share !== null ? <div className="w-full rounded-sm" style={{ height: `${Math.max(4, w.share * 100)}%`, background: w.share >= 0.75 ? "var(--zone-2)" : "var(--zone-4)" }} /> : null}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Performance

function ThresholdCard({ d }: { d: DashboardData }) {
  const { current, suggestions, defaults } = d.thresholds();
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Schwellen-Check" description="Alle Belastungswerte und Zonen hängen an diesen Schwellen." action={<Arrow href="/settings" label="Einstellungen" />} />
      <div className="flex flex-1 flex-col px-5 pb-5 pt-3">
        {defaults ? (
          <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-[13px] leading-relaxed text-warning-ink">
            Du nutzt noch die Standardwerte. Trag deine eigenen Schwellen ein oder übernimm die Vorschläge, sonst sind TSS, Fitness und Form nur grob geschätzt.
          </p>
        ) : null}
        {suggestions.length ? (
          <ThresholdSuggestions suggestions={suggestions} />
        ) : (
          <p className="text-[14px] text-ink-2">Deine Aufzeichnungen passen zu den eingestellten Schwellen.</p>
        )}
        <div className="mt-auto grid grid-cols-4 gap-2 pt-4 text-center">
          {(
            [
              ["FTP", `${current.ftp} W`],
              ["Schwelle", `${current.lthr}`],
              ["Max", `${current.maxHr}`],
              ["Ruhe", `${current.restHr}`],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg bg-surface-2/70 px-1 py-2">
              <div className="text-[11px] text-ink-3">{label}</div>
              <div className="text-[14px] font-semibold tabular">{value}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-3">Puls in bpm. Vorschläge gehen nur nach oben, wenn eine Einheit es belegt; der Ruhepuls folgt deinen Messungen.</p>
      </div>
    </Card>
  );
}

const SPORT_LABEL = { ride: "Rad", run: "Lauf" } as const;

function decouplingText(pct: number): { text: string; className: string } {
  if (pct < 5) return { text: "stabil", className: "text-good-ink" };
  if (pct < 10) return { text: "leichte Drift", className: "text-warning-ink" };
  return { text: "starke Drift", className: "text-critical-ink" };
}

function EfficiencyCard({ d }: { d: DashboardData }) {
  const list = d.efficiency();
  if (!list.length) return null;
  const from = addDays(d.today, -89);
  return (
    <Card className="h-full p-5">
      <h2 className="text-[15px] font-semibold">Aerobe Effizienz</h2>
      <p className="mt-0.5 text-[13px] text-ink-3">Leistung pro Herzschlag in lockeren Einheiten ab 40 Minuten, letzte 90 Tage</p>
      <div className="mt-4 space-y-5">
        {list.map(({ sport, points, change }) => {
          const latest = points.filter((p) => p.decouplingPct !== null).slice(-3).reverse();
          return (
            <div key={sport}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">{SPORT_LABEL[sport]}</span>
                {change ? (
                  <span className={cn("inline-flex items-center gap-1 text-[13px] font-medium", change.pct >= 0 ? "text-good-ink" : "text-critical-ink")}>
                    {change.pct >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                    {change.pct > 0 ? "+" : ""}
                    {formatNumber(change.pct, 1)} % <span className="font-normal text-ink-3">gegen die 4 Wochen davor</span>
                  </span>
                ) : (
                  <span className="text-[12px] text-ink-3">Trend ab je zwei Einheiten in zwei 4-Wochen-Blöcken</span>
                )}
              </div>
              <div className="mt-2">
                <TrendChart series={points.map((p) => ({ date: p.date, value: p.ef }))} from={from} to={d.today} height={48} color={sport === "ride" ? "var(--sport-ride)" : "var(--sport-run)"} label={`Effizienz ${SPORT_LABEL[sport]}`} />
              </div>
              {latest.length ? (
                <ul className="mt-2 space-y-1 text-[12px]">
                  {latest.map((p) => {
                    const dc = decouplingText(p.decouplingPct as number);
                    return (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="w-14 shrink-0 text-ink-3">{formatDateShort(displayDate(p.date))}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-2">{p.name}</span>
                        <span className="shrink-0 tabular">
                          Entkopplung {formatNumber(p.decouplingPct as number, 1)} % <span className={dc.className}>{dc.text}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-ink-3">Steigende Effizienz heißt: gleiche Leistung bei niedrigerem Puls. Entkopplung unter 5 % zeigt, dass die Grundlage für diese Dauer trägt. Hitze und Müdigkeit verschieben beide Werte.</p>
    </Card>
  );
}

function BestsCard({ d }: { d: DashboardData }) {
  const b = d.bests();
  const hasPower = Object.keys(b.powerYear).length > 0;
  const hasPace = Object.keys(b.paceYear).length > 0;
  if (!hasPower && !hasPace) return null;
  const ftp = d.user.ftp;
  return (
    <Card className="h-full p-5">
      <h2 className="text-[15px] font-semibold">Bestwerte</h2>
      <p className="mt-0.5 text-[13px] text-ink-3">Letzte 90 Tage, dahinter das Beste der letzten 12 Monate</p>
      {hasPower ? (
        <table className="mt-3 w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th className="py-1 font-medium">Leistung</th>
              <th className="py-1 text-right font-medium">90 Tage</th>
              {b.weightKg ? <th className="py-1 text-right font-medium">W/kg</th> : null}
              <th className="py-1 text-right font-medium">12 Monate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {POWER_DURATIONS.filter((s) => b.powerYear[String(s)]).map((s) => {
              const recent = b.power90[String(s)];
              const year = b.powerYear[String(s)];
              return (
                <tr key={s}>
                  <td className="py-1.5 text-ink-2">{POWER_LABEL[s]}</td>
                  <td className="py-1.5 text-right font-semibold tabular">{recent ? `${recent.value} W` : "–"}</td>
                  {b.weightKg ? <td className="py-1.5 text-right text-ink-2 tabular">{recent ? formatNumber(recent.value / b.weightKg, 1) : "–"}</td> : null}
                  <td className="py-1.5 text-right text-ink-3 tabular">{year.value} W</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      {b.eftp ? (
        <p className="mt-2 text-[13px] text-ink-2">
          Geschätzte FTP <span className="font-semibold text-ink tabular">{b.eftp} W</span>
          {Math.abs(b.eftp - ftp) >= ftp * 0.03 ? <span className="text-ink-3"> (eingestellt {ftp} W)</span> : <span className="text-ink-3"> passt zu deiner FTP</span>}
        </p>
      ) : null}
      {hasPace ? (
        <table className="mt-4 w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th className="py-1 font-medium">Laufen</th>
              <th className="py-1 text-right font-medium">90 Tage</th>
              <th className="py-1 text-right font-medium">Pace</th>
              <th className="py-1 text-right font-medium">12 Monate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {PACE_DISTANCES.filter((m) => b.paceYear[String(m)]).map((m) => {
              const recent = b.pace90[String(m)];
              const year = b.paceYear[String(m)];
              return (
                <tr key={m}>
                  <td className="py-1.5 text-ink-2">{PACE_LABEL[m]}</td>
                  <td className="py-1.5 text-right font-semibold tabular">{recent ? formatDuration(recent.value) : "–"}</td>
                  <td className="py-1.5 text-right text-ink-2 tabular">{recent ? `${formatPace(recent.value / (m / 1000))} /km` : "–"}</td>
                  <td className="py-1.5 text-right text-ink-3 tabular">{formatDuration(year.value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">Aus den Sekundendaten importierter FIT-Dateien. Bestwerte aus Trainingseinheiten liegen meist unter einem echten Test.</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Building blocks

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
    <Card className="h-full px-4 py-3.5">
      <div className="text-[12px] font-medium text-ink-3">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[12px] text-ink-3">{sub}</div> : null}
    </Card>
  );
}
