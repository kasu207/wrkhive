import "server-only";
import { and, asc, desc, eq, gte, lte, min, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, calendarEntries, scheduledWorkouts, wellness, workouts, type User } from "@/db/schema";
import { baselineDailyLoad, cyclingVo2max, FTP_OF_5MIN, performanceChart, predictRaceTime, type PmcPoint } from "@/lib/analytics/load";
import { readinessFromPmc } from "@/lib/analytics/readiness";
import { addDays, diffDays, startOfWeek, type ISODate } from "@/lib/dates";
import { goalContext, goalsOf } from "@/lib/goals";
import { DEFAULT_THRESHOLDS } from "@/lib/workout/types";
import { todayFor } from "./sync";
import { recoveryFor, wellnessBetween } from "./wellness";

export function dailyLoad(userId: string, from: ISODate, to: ISODate): Map<ISODate, number> {
  const rows = getDb()
    .select({ date: activities.date, tss: sql<number>`sum(${activities.tss})` })
    .from(activities)
    .where(and(eq(activities.userId, userId), gte(activities.date, from), lte(activities.date, to)))
    .groupBy(activities.date)
    .all();
  return new Map(rows.map((r) => [r.date, r.tss ?? 0]));
}

/** Day of the athlete's first recorded activity, if any. */
export function firstActivityDate(userId: string): ISODate | null {
  return getDb().select({ first: min(activities.date) }).from(activities).where(eq(activities.userId, userId)).get()?.first ?? null;
}

/** Days of history the load model needs before fitness and form mean something (CTL time constant). */
export const CALIBRATION_DAYS = 42;

/**
 * Whether fitness and form can be trusted: either the athlete stated their
 * training volume before Wrkhive (seeds the model) or there are at least six
 * weeks of history. Otherwise every session looks like overload.
 */
export function formCalibration(user: Pick<User, "id" | "timeZone" | "baselineWeeklyHours">): { reliable: boolean; historyDays: number; remainingDays: number } {
  const first = firstActivityDate(user.id);
  const historyDays = first ? diffDays(todayFor(user), first) + 1 : 0;
  const reliable = user.baselineWeeklyHours !== null || historyDays >= CALIBRATION_DAYS;
  return { reliable, historyDays, remainingDays: Math.max(0, CALIBRATION_DAYS - historyDays) };
}

/** PMC for the last `days` days, warmed up with 120 extra days of history and seeded with the stated baseline. */
export function pmcFor(user: User, days: number): PmcPoint[] {
  const today = todayFor(user);
  const from = addDays(today, -days + 1);
  const warm = addDays(from, -120);
  const first = user.baselineWeeklyHours ? firstActivityDate(user.id) : null;
  const seed = first && user.baselineWeeklyHours ? { date: first, load: baselineDailyLoad(user.baselineWeeklyHours) } : undefined;
  return performanceChart(dailyLoad(user.id, seed && seed.date < warm ? seed.date : warm, today), from, today, warm, seed);
}

export interface WeekVolume {
  week: ISODate;
  ride: number;
  run: number;
  strength: number;
  other: number;
  tss: number;
  distanceKm: number;
}

export function weeklyVolume(user: User, weeks: number): WeekVolume[] {
  const today = todayFor(user);
  const first = addDays(startOfWeek(today), -(weeks - 1) * 7);
  const rows = getDb()
    .select({ date: activities.date, sport: activities.sport, sec: activities.durationSec, tss: activities.tss, dist: activities.distanceM })
    .from(activities)
    .where(and(eq(activities.userId, user.id), gte(activities.date, first), lte(activities.date, today)))
    .all();
  const map = new Map<ISODate, WeekVolume>();
  for (let i = 0; i < weeks; i++) {
    const w = addDays(first, i * 7);
    map.set(w, { week: w, ride: 0, run: 0, strength: 0, other: 0, tss: 0, distanceKm: 0 });
  }
  for (const r of rows) {
    const v = map.get(startOfWeek(r.date));
    if (!v) continue;
    v[r.sport] += r.sec / 3600;
    v.tss += r.tss ?? 0;
    v.distanceKm += (r.dist ?? 0) / 1000;
  }
  return [...map.values()];
}

export function recentActivities(userId: string, limit = 10) {
  return getDb().select().from(activities).where(eq(activities.userId, userId)).orderBy(desc(activities.startTime)).limit(limit).all();
}

export function activitiesBetween(userId: string, from: ISODate, to: ISODate) {
  return getDb()
    .select()
    .from(activities)
    .where(and(eq(activities.userId, userId), gte(activities.date, from), lte(activities.date, to)))
    .orderBy(asc(activities.startTime))
    .all();
}

export function scheduledBetween(userId: string, from: ISODate, to: ISODate) {
  return getDb()
    .select({ scheduled: scheduledWorkouts, workout: workouts })
    .from(scheduledWorkouts)
    .innerJoin(workouts, eq(workouts.id, scheduledWorkouts.workoutId))
    .where(and(eq(scheduledWorkouts.userId, userId), gte(scheduledWorkouts.date, from), lte(scheduledWorkouts.date, to)))
    .orderBy(asc(scheduledWorkouts.date), asc(scheduledWorkouts.createdAt))
    .all();
}

export interface RunningFitness {
  vo2max: number;
  samples: number;
  predictions: { label: string; distanceM: number; seconds: number }[];
}

/**
 * Running fitness from the last 42 days (Runalyze-style): the effective
 * VO2max estimates of runs, weighted towards longer and more recent runs.
 */
export function runningFitness(user: User): RunningFitness | null {
  const today = todayFor(user);
  const rows = getDb()
    .select({ date: activities.date, vo2: activities.vo2maxEst, sec: activities.durationSec })
    .from(activities)
    .where(and(eq(activities.userId, user.id), eq(activities.sport, "run"), gte(activities.date, addDays(today, -42))))
    .all()
    .filter((r) => r.vo2 !== null);
  if (rows.length < 2) return null;
  let wSum = 0;
  let vSum = 0;
  for (const r of rows) {
    const ageDays = Math.max(0, (Date.parse(today) - Date.parse(r.date)) / 86_400_000);
    const w = Math.min(r.sec, 7200) * Math.exp(-ageDays / 30);
    wSum += w;
    vSum += w * (r.vo2 as number);
  }
  const vo2max = Math.round((vSum / wSum) * 10) / 10;
  const distances = [
    { label: "5 km", distanceM: 5000 },
    { label: "10 km", distanceM: 10000 },
    { label: "Halbmarathon", distanceM: 21097.5 },
    { label: "Marathon", distanceM: 42195 },
  ];
  return { vo2max, samples: rows.length, predictions: distances.map((d) => ({ ...d, seconds: predictRaceTime(vo2max, d.distanceM) })) };
}

export interface CyclingFitness {
  vo2max: number;
  /** Power the estimate is based on: best 5 minutes of the window, or derived from the FTP setting. */
  power5min: number;
  weightKg: number;
  basis: "power" | "ftp";
  /** Day of the best 5-minute effort (basis "power"). */
  date: ISODate | null;
}

/**
 * Cycling VO2max from the best 5-minute power of the last 42 days and the
 * current weight. Without a recorded power curve (bests come from FIT files)
 * the FTP setting stands in, as long as it is not the default value.
 */
export function cyclingFitness(user: User): CyclingFitness | null {
  const today = todayFor(user);
  const weightKg = latestWellness(user.id, "weightKg", addDays(today, -89), today)?.value ?? user.weightKg;
  if (!weightKg) return null;
  const rides = getDb()
    .select({ date: activities.date, bests: activities.bests })
    .from(activities)
    .where(and(eq(activities.userId, user.id), eq(activities.sport, "ride"), gte(activities.date, addDays(today, -41))))
    .all();
  let best: { watts: number; date: ISODate } | null = null;
  for (const r of rides) {
    const w = r.bests?.power?.["300"];
    if (w && (!best || w > best.watts)) best = { watts: w, date: r.date };
  }
  if (best) {
    const vo2max = cyclingVo2max(best.watts, weightKg);
    if (vo2max) return { vo2max, power5min: best.watts, weightKg, basis: "power", date: best.date };
  }
  if (user.ftp && user.ftp !== DEFAULT_THRESHOLDS.ftp) {
    const power5min = Math.round(user.ftp / FTP_OF_5MIN);
    const vo2max = cyclingVo2max(power5min, weightKg);
    if (vo2max) return { vo2max, power5min, weightKg, basis: "ftp", date: null };
  }
  return null;
}

export interface DeviceVo2max {
  /** Running (Garmin, Apple Watch) or general (intervals.icu) VO2max. */
  run: { value: number; date: ISODate } | null;
  ride: { value: number; date: ISODate } | null;
}

/** Latest VO2max the athlete's devices reported in the last 90 days (Garmin, Apple Health, intervals.icu). */
export function deviceVo2max(user: Pick<User, "id" | "timeZone">): DeviceVo2max | null {
  const today = todayFor(user);
  const from = addDays(today, -89);
  const run = latestWellness(user.id, "vo2max", from, today);
  const ride = latestWellness(user.id, "vo2maxRide", from, today);
  return run || ride ? { run, ride } : null;
}

function latestWellness(userId: string, field: "weightKg" | "vo2max" | "vo2maxRide", from: ISODate, to: ISODate): { value: number; date: ISODate } | null {
  const col = wellness[field];
  const row = getDb()
    .select({ date: wellness.date, value: col })
    .from(wellness)
    .where(and(eq(wellness.userId, userId), gte(wellness.date, from), lte(wellness.date, to), sql`${col} is not null`))
    .orderBy(desc(wellness.date))
    .limit(1)
    .get();
  return row?.value ? { value: row.value, date: row.date } : null;
}

/** Compact text summary of the athlete's situation for the coach. */
export function trainingContext(user: User): string {
  const today = todayFor(user);
  const pmc = pmcFor(user, 28);
  const now = pmc[pmc.length - 1];
  const weekAgo = pmc[pmc.length - 8];
  const recent = activitiesBetween(user.id, addDays(today, -13), today);
  const upcoming = scheduledBetween(user.id, today, addDays(today, 13));
  const weeks = weeklyVolume(user, 6);
  const fitness = runningFitness(user);

  const lines: string[] = [];
  lines.push(`Heute: ${today}`);
  const goals = goalContext(goalsOf(user.goals), user.goalNote);
  if (goals) lines.push(goals);
  lines.push(`Schwellen: FTP ${user.ftp} W, Schwellenpuls ${user.lthr} bpm, Maximalpuls ${user.maxHr} bpm, Ruhepuls ${user.restHr} bpm, Schwellenpace ${Math.floor(user.thresholdPace / 60)}:${String(user.thresholdPace % 60).padStart(2, "0")} min/km${user.weightKg ? `, Gewicht ${user.weightKg} kg` : ""}`);
  if (now) {
    lines.push(`Fitness (CTL) ${now.ctl}, Ermüdung (ATL) ${now.atl}, Form (TSB) ${now.tsb}; CTL vor 7 Tagen ${weekAgo?.ctl ?? "?"}`);
  }
  const calibration = formCalibration(user);
  if (!calibration.reliable) lines.push(`Verlauf erst ${calibration.historyDays} Tage, kein Trainingsumfang vor Wrkhive angegeben: Fitness und Form sind noch nicht aussagekräftig (Modell startet bei null). Nicht als Überlastung werten.`);
  else if (user.baselineWeeklyHours) lines.push(`Trainingsumfang vor Wrkhive laut Athlet: ${user.baselineWeeklyHours} h/Woche (Startwert der Fitness).`);
  const readiness = recent.length >= 3 && calibration.reliable ? readinessFromPmc(pmc) : null;
  if (readiness) lines.push(`Bereitschaft: ${readiness.label} (Form ${readiness.formPct} % der Fitness, Rampe ${readiness.ramp} CTL/Woche). ${readiness.advice}`);
  if (fitness) lines.push(`Lauf-VO2max (effektiv, aus Pace und Puls aller Läufe) ${fitness.vo2max}`);
  const cycling = cyclingFitness(user);
  if (cycling) lines.push(`Rad-VO2max (geschätzt) ${cycling.vo2max} aus ${cycling.basis === "power" ? "bester 5-min-Leistung" : "FTP-Einstellung, ca."} ${cycling.power5min} W bei ${cycling.weightKg} kg`);
  const device = deviceVo2max(user);
  if (device) {
    const parts = [device.run ? `${device.run.value} (Stand ${device.run.date})` : null, device.ride ? `Rad ${device.ride.value} (Stand ${device.ride.date})` : null].filter(Boolean);
    lines.push(`VO2max laut Uhr: ${parts.join(", ")}. Die Uhr sieht nur selbst aufgezeichnete Einheiten; bei Abweichung gelten die Wrkhive-Werte.`);
  }
  const recovery = recoveryFor(user);
  if (recovery) lines.push(`Erholung: ${recovery.label} (${recovery.signals.map((s) => `${s.label} ${s.text}`).join(", ")})`);
  const days = wellnessBetween(user.id, addDays(today, -6), today).filter((d) => d.restingHr || d.hrv || d.hrvSdnn || d.sleepSec);
  if (days.length) {
    lines.push("Tageswerte der letzten 7 Tage (Ruhepuls bpm / HRV ms / Schlaf h):");
    for (const d of days) lines.push(`- ${d.date}: ${d.restingHr ?? "–"} / ${d.hrv ?? (d.hrvSdnn ? `${d.hrvSdnn} (SDNN)` : "–")} / ${d.sleepSec ? (d.sleepSec / 3600).toFixed(1) : "–"}`);
  }
  lines.push(
    `Wochenumfang der letzten 6 Wochen (h Rad/Lauf/Kraft/Sonstiges, TSS): ${weeks
      .map((w) => `${w.week}: ${w.ride.toFixed(1)}/${w.run.toFixed(1)}/${w.strength.toFixed(1)}/${w.other.toFixed(1)}, ${Math.round(w.tss)}`)
      .join("; ")}`,
  );
  lines.push("Letzte 14 Tage:");
  if (!recent.length) lines.push("- keine Aktivitäten");
  for (const a of recent) {
    lines.push(
      `- ${a.date} ${a.sport === "other" ? "sonstiges" : a.sport} „${a.name}“ ${Math.round(a.durationSec / 60)} min${a.distanceM ? `, ${(a.distanceM / 1000).toFixed(1)} km` : ""}${a.tss ? `, TSS ${Math.round(a.tss)}` : ""}${a.avgHr ? `, Ø ${a.avgHr} bpm` : ""}${a.normPower ? `, NP ${a.normPower} W` : ""}${a.rpe ? `, RPE ${a.rpe}/10` : ""}`,
    );
  }
  lines.push("Geplant (nächste 14 Tage):");
  if (!upcoming.length) lines.push("- nichts geplant");
  for (const u of upcoming) lines.push(`- ${u.scheduled.date} ${u.workout.sport} „${u.workout.name}“ ${Math.round(u.workout.durationSec / 60)} min, TSS ${u.workout.tss} (${u.scheduled.status})`);
  const fixed = getDb()
    .select()
    .from(calendarEntries)
    .where(and(eq(calendarEntries.userId, user.id), gte(calendarEntries.date, today), lte(calendarEntries.date, addDays(today, 13)), eq(calendarEntries.status, "planned")))
    .orderBy(asc(calendarEntries.date))
    .all();
  if (fixed.length) {
    lines.push("Feste Termine ohne Workout (nächste 14 Tage, beim Planen berücksichtigen):");
    for (const e of fixed) lines.push(`- ${e.date}${e.time ? ` ${e.time}` : ""} ${e.sport} „${e.name}“ ${e.durationMin} min${e.rpe ? `, erwartete RPE ${e.rpe}` : ""}`);
  }
  return lines.join("\n");
}
