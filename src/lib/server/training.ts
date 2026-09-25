import "server-only";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, scheduledWorkouts, workouts, type User } from "@/db/schema";
import { performanceChart, predictRaceTime, type PmcPoint } from "@/lib/analytics/load";
import { addDays, startOfWeek, type ISODate } from "@/lib/dates";
import { todayFor } from "./sync";

export function dailyLoad(userId: string, from: ISODate, to: ISODate): Map<ISODate, number> {
  const rows = getDb()
    .select({ date: activities.date, tss: sql<number>`sum(${activities.tss})` })
    .from(activities)
    .where(and(eq(activities.userId, userId), gte(activities.date, from), lte(activities.date, to)))
    .groupBy(activities.date)
    .all();
  return new Map(rows.map((r) => [r.date, r.tss ?? 0]));
}

/** PMC for the last `days` days, warmed up with 120 extra days of history. */
export function pmcFor(user: User, days: number): PmcPoint[] {
  const today = todayFor(user);
  const from = addDays(today, -days + 1);
  const warm = addDays(from, -120);
  return performanceChart(dailyLoad(user.id, warm, today), from, today, warm);
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
  lines.push(`Schwellen: FTP ${user.ftp} W, Schwellenpuls ${user.lthr} bpm, Maximalpuls ${user.maxHr} bpm, Ruhepuls ${user.restHr} bpm, Schwellenpace ${Math.floor(user.thresholdPace / 60)}:${String(user.thresholdPace % 60).padStart(2, "0")} min/km${user.weightKg ? `, Gewicht ${user.weightKg} kg` : ""}`);
  if (now) {
    lines.push(`Fitness (CTL) ${now.ctl}, Ermüdung (ATL) ${now.atl}, Form (TSB) ${now.tsb}; CTL vor 7 Tagen ${weekAgo?.ctl ?? "?"}`);
  }
  if (fitness) lines.push(`Lauf-VO2max (effektiv) ${fitness.vo2max}`);
  lines.push(
    `Wochenumfang der letzten 6 Wochen (h Rad/Lauf/Kraft, TSS): ${weeks
      .map((w) => `${w.week}: ${w.ride.toFixed(1)}/${w.run.toFixed(1)}/${w.strength.toFixed(1)}, ${Math.round(w.tss)}`)
      .join("; ")}`,
  );
  lines.push("Letzte 14 Tage:");
  if (!recent.length) lines.push("- keine Aktivitäten");
  for (const a of recent) {
    lines.push(
      `- ${a.date} ${a.sport} „${a.name}“ ${Math.round(a.durationSec / 60)} min${a.distanceM ? `, ${(a.distanceM / 1000).toFixed(1)} km` : ""}${a.tss ? `, TSS ${Math.round(a.tss)}` : ""}${a.avgHr ? `, Ø ${a.avgHr} bpm` : ""}${a.normPower ? `, NP ${a.normPower} W` : ""}`,
    );
  }
  lines.push("Geplant (nächste 14 Tage):");
  if (!upcoming.length) lines.push("- nichts geplant");
  for (const u of upcoming) lines.push(`- ${u.scheduled.date} ${u.workout.sport} „${u.workout.name}“ ${Math.round(u.workout.durationSec / 60)} min, TSS ${u.workout.tss} (${u.scheduled.status})`);
  return lines.join("\n");
}
