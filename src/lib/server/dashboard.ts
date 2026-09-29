import "server-only";
import { and, count, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, type User } from "@/db/schema";
import { bestOf, estimateFtp } from "@/lib/analytics/bests";
import { consistency, efficiencyChange, efficiencyPoints, intensitySplit, weeklyLowShare } from "@/lib/analytics/quality";
import { checkThresholds, usesDefaults } from "@/lib/analytics/threshold-check";
import { hrvTrend, metricTrend, recoveryFrom } from "@/lib/analytics/wellness";
import { DEFAULT_GOAL, type WidgetId } from "@/lib/dashboard";
import { addDays } from "@/lib/dates";
import { readinessFor } from "./adapt";
import { activitiesBetween, cyclingFitness, deviceVo2max, formCalibration, pmcFor, recentActivities, runningFitness, scheduledBetween, weeklyVolume } from "./training";
import { todayFor } from "./sync";
import { wellnessBetween } from "./wellness";

function lazy<T>(f: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = f();
      done = true;
    }
    return value;
  };
}

/**
 * Everything the dashboard widgets show, computed on first use: a widget the
 * athlete switched off costs no query.
 */
export function dashboardData(user: User) {
  const today = todayFor(user);
  const year = lazy(() => activitiesBetween(user.id, addDays(today, -364), today));
  const last28 = lazy(() => year().filter((a) => a.date >= addDays(today, -27)));
  const last90 = lazy(() => year().filter((a) => a.date >= addDays(today, -89)));
  const wellness = lazy(() => wellnessBetween(user.id, addDays(today, -59), today));
  const weight = lazy(() => metricTrend(wellness(), "weightKg", today));
  const bests = lazy(() => {
    const power90 = bestOf(last90(), "power");
    const powerYear = bestOf(year(), "power");
    const pace90 = bestOf(last90(), "pace");
    const paceYear = bestOf(year(), "pace");
    return { power90, powerYear, pace90, paceYear, eftp: estimateFtp(power90), weightKg: weight().latest?.value ?? user.weightKg };
  });
  return {
    user,
    today,
    year,
    last28,
    last90,
    wellness,
    weight,
    bests,
    readiness: lazy(() => readinessFor(user)),
    pmc: lazy(() => pmcFor(user, 365)),
    calibration: lazy(() => formCalibration(user)),
    weeks: lazy(() => weeklyVolume(user, 12)),
    recent: lazy(() => recentActivities(user.id, 6)),
    fitness: lazy(() => runningFitness(user)),
    cycling: lazy(() => cyclingFitness(user)),
    deviceVo2max: lazy(() => deviceVo2max(user)),
    upcoming: lazy(() => scheduledBetween(user.id, today, addDays(today, 6))),
    activityCount: lazy(() => getDb().select({ n: count() }).from(activities).where(eq(activities.userId, user.id)).get()?.n ?? 0),
    count28: lazy(() => getDb().select({ n: count() }).from(activities).where(and(eq(activities.userId, user.id), gte(activities.date, addDays(today, -27)))).get()?.n ?? 0),
    zoneSec: lazy(() => {
      const z = [0, 0, 0, 0, 0];
      for (const a of last28()) a.hrZoneSec?.forEach((s, i) => (z[i] += s));
      return z;
    }),
    restingHr: lazy(() => metricTrend(wellness(), "restingHr", today)),
    hrv: lazy(() => hrvTrend(wellness(), today)),
    sleep: lazy(() => metricTrend(wellness(), "sleepSec", today)),
    recovery: lazy(() => recoveryFrom(wellness(), today)),
    todayCheckin: lazy(() => wellness().find((w) => w.date === today) ?? null),
    intensity: lazy(() => intensitySplit(last28())),
    lowShare: lazy(() => weeklyLowShare(last90(), today, 12)),
    consistency: (goal = DEFAULT_GOAL) => consistency(year().map((a) => a.date), today, goal),
    efficiency: lazy(() =>
      (["ride", "run"] as const)
        .map((sport) => {
          const points = efficiencyPoints(last90(), sport, user.lthr);
          return { sport, points, change: efficiencyChange(points, today) };
        })
        .filter((e) => e.points.length > 0),
    ),
    thresholds: lazy(() => {
      const current = { ftp: user.ftp, lthr: user.lthr, maxHr: user.maxHr, restHr: user.restHr };
      const restingHr = wellness()
        .filter((w) => w.date > addDays(today, -30) && w.restingHr)
        .map((w) => w.restingHr as number);
      const suggestions = checkThresholds(current, { activities: year(), ftpFromCurve: bests().eftp, restingHr });
      return { current, suggestions, defaults: usesDefaults(current) };
    }),
  };
}

export type DashboardData = ReturnType<typeof dashboardData>;

/** Why a widget has nothing to show and how to change that, or null when it has data. */
export function emptyHint(id: WidgetId, d: DashboardData): string | null {
  const noActivities = d.activityCount() === 0;
  switch (id) {
    case "recovery":
      return d.recovery() ? null : "Braucht Ruhepuls, HRV oder Schlaf von Apple Health, Garmin oder intervals.icu, oder einen Morgen-Check-in.";
    case "restingHr":
      return d.restingHr().series.length ? null : "Kommt von Apple Health, Garmin oder intervals.icu, oder trag ihn im Morgen-Check-in ein.";
    case "hrv":
      return d.hrv().series.length ? null : "Kommt von Apple Watch, Garmin, Oura oder Whoop (über Apple Health oder intervals.icu), oder trag sie im Check-in ein.";
    case "sleep":
      return d.sleep().series.length ? null : "Kommt von Apple Health, Garmin oder intervals.icu, oder trag die Stunden im Check-in ein.";
    case "weight":
      return d.weight().series.length ? null : "Kommt von einer Waage über Apple Health, Garmin oder intervals.icu, oder trag es im Check-in ein.";
    case "intensity":
    case "zones":
      return d.zoneSec().some((s) => s > 0) ? null : "Braucht Einheiten mit Pulsaufzeichnung in den letzten 28 Tagen.";
    case "efficiency":
      return d.efficiency().length ? null : "Braucht lockere Einheiten ab 40 Minuten mit Puls, beim Radfahren zusätzlich mit Leistung.";
    case "bests":
      return Object.keys(d.bests().powerYear).length || Object.keys(d.bests().paceYear).length
        ? null
        : "Bestwerte entstehen aus Sekundendaten. Importiere FIT-Dateien (einzeln oder als Garmin-Connect-Export).";
    case "vo2max":
      return d.fitness() || d.cycling() || d.deviceVo2max()
        ? null
        : "Braucht zwei Läufe mit Puls in den letzten sechs Wochen, Radfahrten mit Leistungsdaten (FIT) und dein Gewicht, oder die VO2max deiner Uhr über Garmin, Apple Health oder intervals.icu.";
    case "predictions":
      return d.fitness() ? null : "Braucht mindestens zwei Läufe mit Puls in den letzten sechs Wochen.";
    case "thresholds":
    case "weekHours":
    case "weekLoad":
    case "weekDistance":
    case "count28":
    case "consistency":
    case "pmc":
    case "volume":
    case "recent":
      return noActivities ? "Erscheint, sobald Aktivitäten synchronisiert sind." : null;
    default:
      return null;
  }
}
