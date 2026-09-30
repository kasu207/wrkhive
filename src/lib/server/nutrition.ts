import "server-only";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, fuelLogs, fuelOverrides, fuelProducts, scheduledWorkouts, sweatTests, workouts, type FuelProductRow, type User } from "@/db/schema";
import { addDays, type ISODate } from "@/lib/dates";
import {
  CATALOG,
  DEFAULT_PANTRY,
  planFueling,
  progressionAdvice,
  type FuelLogEntry,
  type FuelPlan,
  type FuelProduct,
  type FuelProfile,
  sessionFromStructure,
  type SessionFlags,
  type TempClass,
} from "@/lib/nutrition";
import { FALLBACK_WEIGHT_KG } from "@/lib/nutrition/guidelines";
import type { Workout } from "@/db/schema";
import { thresholdsOf } from "./auth";
import { todayFor } from "./sync";
import { latestWellness } from "./training";

/** Sweat tests older than this no longer describe the athlete (fitness, acclimatization). */
const SWEAT_TEST_DAYS = 730;

export function toProduct(row: FuelProductRow): FuelProduct {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    carbsG: row.carbsG,
    sodiumMg: row.sodiumMg,
    caffeineMg: row.caffeineMg,
    multiSource: row.multiSource,
    fluidMl: row.fluidMl,
    servingLabel: row.servingLabel,
    custom: true,
  };
}

/** Catalog and own products, all of them. */
export function allProducts(userId: string): FuelProduct[] {
  const own = getDb().select().from(fuelProducts).where(eq(fuelProducts.userId, userId)).all().map(toProduct);
  return [...CATALOG, ...own];
}

/** Products the athlete has in the pantry; own products count as in the pantry unless removed. */
export function pantryOf(user: Pick<User, "id" | "fuelPantry">): FuelProduct[] {
  const all = allProducts(user.id);
  const ids = new Set(user.fuelPantry ?? DEFAULT_PANTRY);
  return all.filter((p) => ids.has(p.id));
}

export function fuelProfileOf(user: User): FuelProfile {
  const today = todayFor(user);
  const measured = latestWellness(user.id, "weightKg", addDays(today, -89), today)?.value ?? user.weightKg;
  const samples = getDb()
    .select({ sport: sweatTests.sport, tempClass: sweatTests.tempClass, rateLh: sweatTests.rateLh })
    .from(sweatTests)
    .where(and(eq(sweatTests.userId, user.id), gte(sweatTests.date, addDays(today, -SWEAT_TEST_DAYS))))
    .all();
  return {
    weightKg: measured ?? FALLBACK_WEIGHT_KG,
    weightKnown: !!measured,
    maxCarbPerHour: user.fuelMaxCarb,
    sweatSodium: user.fuelSweatSodium,
    sweatSamples: samples,
    caffeine: user.fuelCaffeine,
    preferNatural: user.fuelPreferNatural,
  };
}

export interface ScheduledFuelPlan {
  scheduledId: string;
  date: ISODate;
  workout: { id: string; name: string; sport: Workout["sport"] };
  tempClass: TempClass;
  flags: SessionFlags;
  plan: FuelPlan;
}

/**
 * Plan for a calendar entry. Scheduled workouts carry no time of day: a
 * second session on the same day counts as 6 h later, one on the next day as
 * 22 h later.
 */
export function planForScheduled(user: User, scheduledId: string): ScheduledFuelPlan | null {
  const db = getDb();
  const row = db
    .select({ scheduled: scheduledWorkouts, workout: workouts })
    .from(scheduledWorkouts)
    .innerJoin(workouts, eq(workouts.id, scheduledWorkouts.workoutId))
    .where(and(eq(scheduledWorkouts.id, scheduledId), eq(scheduledWorkouts.userId, user.id)))
    .get();
  if (!row) return null;
  const override = db.select().from(fuelOverrides).where(eq(fuelOverrides.scheduledWorkoutId, scheduledId)).get();
  const around = db
    .select({ id: scheduledWorkouts.id, date: scheduledWorkouts.date, createdAt: scheduledWorkouts.createdAt })
    .from(scheduledWorkouts)
    .where(and(eq(scheduledWorkouts.userId, user.id), gte(scheduledWorkouts.date, row.scheduled.date)))
    .all()
    .filter((s) => s.date <= addDays(row.scheduled.date, 1) && s.id !== scheduledId);
  const sameDayLater = around.some((s) => s.date === row.scheduled.date && s.createdAt > row.scheduled.createdAt);
  const nextDay = around.some((s) => s.date !== row.scheduled.date);
  const hoursToNextSession = sameDayLater ? 6 : nextDay ? 22 : null;
  const tempClass = override?.tempClass ?? "mild";
  const flags = override?.flags ?? {};
  const input = sessionFromStructure(row.workout.structure, thresholdsOf(user), { tempClass, flags, hoursToNextSession });
  return {
    scheduledId,
    date: row.scheduled.date,
    workout: { id: row.workout.id, name: row.workout.name, sport: row.workout.sport },
    tempClass,
    flags,
    plan: planFueling(input, fuelProfileOf(user), pantryOf(user)),
  };
}

export function fuelLogsOf(userId: string, limit = 30) {
  return getDb().select().from(fuelLogs).where(eq(fuelLogs.userId, userId)).orderBy(desc(fuelLogs.date), desc(fuelLogs.createdAt)).limit(limit).all();
}

export function sweatTestsOf(userId: string, limit = 30) {
  return getDb().select().from(sweatTests).where(eq(sweatTests.userId, userId)).orderBy(desc(sweatTests.date), desc(sweatTests.createdAt)).limit(limit).all();
}

export function progressionFor(user: User) {
  const entries: FuelLogEntry[] = fuelLogsOf(user.id, 10).map((l) => ({
    date: l.date,
    durationSec: l.durationSec,
    targetCarbsPerHour: l.targetCarbsPerHour,
    carbsG: l.carbsG,
    gutScore: l.gutScore,
  }));
  return progressionAdvice(entries, user.fuelMaxCarb);
}

/** Short text for the coach: tolerance, sweat rate, recent gut feedback. */
export function fuelContext(user: User): string {
  const profile = fuelProfileOf(user);
  const lines = [`Verpflegung: verträgt ${profile.maxCarbPerHour} g Kohlenhydrate pro Stunde, Schweiß-Salzgehalt ${{ low: "niedrig", average: "durchschnittlich", high: "hoch" }[profile.sweatSodium]}${profile.caffeine ? ", nutzt Koffein" : ""}${profile.preferNatural ? ", bevorzugt natürliche Lebensmittel" : ""}.`];
  if (profile.sweatSamples.length) {
    lines.push(`Gemessene Schweißraten: ${profile.sweatSamples.map((s) => `${s.sport} ${s.tempClass} ${s.rateLh} l/h`).join(", ")}.`);
  }
  const logs = fuelLogsOf(user.id, 5);
  if (logs.length) {
    lines.push(`Letzte Verpflegungsprotokolle: ${logs.map((l) => `${l.date} ${Math.round(l.durationSec / 60)} min, ${Math.round(l.carbsG / (l.durationSec / 3600))} g/h, Magen ${l.gutScore ?? "?"}/5`).join("; ")}.`);
  }
  const pantry = pantryOf(user).map((p) => p.name);
  if (pantry.length) lines.push(`Vorrat: ${pantry.join(", ")}.`);
  return lines.join("\n");
}

/**
 * For the dashboard: the plan for the next planned session today or
 * tomorrow, and a recent long session that still lacks a fueling log.
 */
export function fuelingToday(user: User): { next: ScheduledFuelPlan | null; unlogged: { id: string; name: string; date: ISODate; durationSec: number } | null } {
  const today = todayFor(user);
  const db = getDb();
  const nextRow = db
    .select({ id: scheduledWorkouts.id, date: scheduledWorkouts.date })
    .from(scheduledWorkouts)
    .where(and(eq(scheduledWorkouts.userId, user.id), eq(scheduledWorkouts.status, "planned"), gte(scheduledWorkouts.date, today)))
    .orderBy(scheduledWorkouts.date, scheduledWorkouts.createdAt)
    .limit(1)
    .get();
  const next = nextRow && nextRow.date <= addDays(today, 1) ? planForScheduled(user, nextRow.id) : null;
  const logged = new Set(
    db
      .select({ id: fuelLogs.activityId })
      .from(fuelLogs)
      .where(and(eq(fuelLogs.userId, user.id), isNotNull(fuelLogs.activityId), gte(fuelLogs.date, addDays(today, -2))))
      .all()
      .map((r) => r.id),
  );
  const recent = db
    .select({ id: activities.id, name: activities.name, date: activities.date, durationSec: activities.durationSec })
    .from(activities)
    .where(and(eq(activities.userId, user.id), gte(activities.date, addDays(today, -1)), gte(activities.durationSec, 75 * 60)))
    .orderBy(desc(activities.startTime))
    .all()
    .find((a) => !logged.has(a.id));
  return { next, unlogged: recent ?? null };
}
