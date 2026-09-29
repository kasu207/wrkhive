import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { users, type User } from "@/db/schema";
import { appleSport, appleWorkoutName, type AppleDaily, type AppleWorkout } from "@/lib/apple-health";
import { detectSourceApp } from "@/lib/apps";
import { randomToken, sha256 } from "./crypto";
import type { NormalizedActivity } from "./providers/types";
import { upsertActivities } from "./sync";
import { upsertWellness } from "./wellness";

const optionalNumber = (max: number) => z.number().min(0).max(max).nullish();

/** Wire format posted by the browser import (validated, never trusted). */
export const appleWorkoutSchema = z.object({
  type: z.string().trim().min(1).max(80),
  start: z.iso.datetime({ offset: true }),
  utcOffsetSec: z
    .number()
    .int()
    .min(-14 * 3600)
    .max(14 * 3600)
    .nullable(),
  durationSec: z.number().min(0).max(7 * 86400),
  distanceM: optionalNumber(2_000_000),
  calories: optionalNumber(50_000),
  avgHr: optionalNumber(260),
  maxHr: optionalNumber(260),
  avgPower: optionalNumber(3000),
  elevationGainM: optionalNumber(30_000),
  indoor: z.boolean().nullish(),
  source: z.string().max(200).nullish(),
  id: z.string().max(100).nullish(),
});

/** Daily health values (wire format, validated; plausibility is checked again when stored). */
export const appleDailySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  restingHr: optionalNumber(300),
  hrvSdnn: optionalNumber(1000),
  sleepSec: optionalNumber(86_400),
  weightKg: optionalNumber(500),
  vo2max: optionalNumber(100),
});

export function importAppleDaily(user: Pick<User, "id">, list: AppleDaily[]): number {
  return list.length ? upsertWellness(user.id, list, "apple") : 0;
}

/** Shorter recordings are accidental starts. */
const MIN_DURATION_SEC = 60;

export function toNormalizedActivity(w: AppleWorkout): NormalizedActivity | null {
  if (w.durationSec < MIN_DURATION_SEC) return null;
  const start = new Date(w.start);
  if (Number.isNaN(start.getTime())) return null;
  const { sport } = appleSport(w.type);
  const source = w.source?.trim() || null;
  const avgSpeed = w.distanceM && w.durationSec ? w.distanceM / w.durationSec : null;
  return {
    // HealthKit UUID when known; otherwise start and sport identify the workout across re-imports.
    externalId: w.id ? `hk-${w.id}` : `apple-${Math.round(start.getTime() / 1000)}-${sport}`,
    sport,
    name: appleWorkoutName(w),
    startTime: start,
    utcOffsetSec: w.utcOffsetSec,
    durationSec: Math.round(w.durationSec),
    distanceM: w.distanceM || null,
    elevationGainM: w.elevationGainM || null,
    avgHr: w.avgHr ? Math.round(w.avgHr) : null,
    maxHr: w.maxHr ? Math.round(w.maxHr) : null,
    avgPower: w.avgPower ? Math.round(w.avgPower) : null,
    avgSpeed: sport === "ride" || sport === "run" ? avgSpeed : null,
    calories: w.calories ? Math.round(w.calories) : null,
    deviceName: source,
    // Other apps write their workouts into Apple Health too (Garmin Connect, Zwift, Freeletics).
    sourceApp: detectSourceApp({ hints: [source], fallback: "apple" }),
  };
}

export function importAppleWorkouts(user: User, list: AppleWorkout[]) {
  const activities = list.map(toNormalizedActivity).filter((a): a is NormalizedActivity => a !== null);
  const r = activities.length ? upsertActivities(user, { id: null, provider: "apple" }, activities) : { inserted: 0, updated: 0, merged: 0 };
  return { ...r, skipped: list.length - activities.length };
}

/** Creates (or replaces) the webhook key. Returns the key once; only its hash is stored. */
export function rotateAppleHealthKey(userId: string): string {
  const key = `wh_${randomToken(24)}`;
  getDb().update(users).set({ appleHealthKeyHash: sha256(key), appleHealthLastAt: null }).where(eq(users.id, userId)).run();
  return key;
}

export function revokeAppleHealthKey(userId: string) {
  getDb().update(users).set({ appleHealthKeyHash: null, appleHealthLastAt: null }).where(eq(users.id, userId)).run();
}

export function userByAppleHealthKey(key: string): User | null {
  if (!key.startsWith("wh_") || key.length > 100) return null;
  return getDb().select().from(users).where(eq(users.appleHealthKeyHash, sha256(key))).get() ?? null;
}
