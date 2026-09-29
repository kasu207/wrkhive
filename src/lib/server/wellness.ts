import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { wellness, type User } from "@/db/schema";
import { recoveryFrom, type Recovery, type WellnessDay } from "@/lib/analytics/wellness";
import { addDays, isISODate, type ISODate } from "@/lib/dates";
import type { WellnessInput } from "./providers/types";
import { todayFor } from "./sync";

export type WellnessSource = "apple" | "garmin" | "wahoo" | "intervals" | "manual" | "demo";

/** Plausible ranges; values outside are measurement errors and dropped. */
const RANGE = {
  restingHr: [25, 120],
  hrv: [3, 300],
  hrvSdnn: [3, 300],
  sleepSec: [30 * 60, 16 * 3600],
  weightKg: [25, 300],
  vo2max: [15, 95],
  vo2maxRide: [15, 95],
} as const;

type Field = keyof typeof RANGE;
const FIELDS = Object.keys(RANGE) as Field[];

function clean(field: Field, v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const [lo, hi] = RANGE[field];
  if (v < lo || v > hi) return null;
  return field === "restingHr" || field === "sleepSec" ? Math.round(v) : Math.round(v * 10) / 10;
}

/**
 * Stores daily values. A new value replaces the stored one for that field;
 * fields the delivery does not carry stay untouched. Sample data (demo) never
 * overwrites a day that holds real values.
 */
export function upsertWellness(userId: string, rows: WellnessInput[], source: WellnessSource): number {
  const db = getDb();
  let written = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      if (!isISODate(r.date)) continue;
      const values: Partial<Record<Field, number>> = {};
      for (const f of FIELDS) {
        const v = clean(f, r[f]);
        if (v !== null) values[f] = v;
      }
      if (!Object.keys(values).length) continue;
      const existing = tx.select({ source: wellness.source }).from(wellness).where(and(eq(wellness.userId, userId), eq(wellness.date, r.date))).get();
      if (existing && source === "demo" && existing.source !== "demo") continue;
      if (existing) tx.update(wellness).set({ ...values, source, updatedAt: new Date() }).where(and(eq(wellness.userId, userId), eq(wellness.date, r.date))).run();
      else tx.insert(wellness).values({ userId, date: r.date, ...values, source }).run();
      written++;
    }
  });
  return written;
}

export interface CheckinInput {
  date: ISODate;
  legs: number | null;
  sleepFeel: number | null;
  motivation: number | null;
  restingHr?: number | null;
  hrv?: number | null;
  sleepSec?: number | null;
  weightKg?: number | null;
}

/** Morning check-in: the three feelings replace the day's check-in, measured values only when given. */
export function saveCheckin(userId: string, c: CheckinInput) {
  const db = getDb();
  const measured: Partial<Record<Field, number>> = {};
  for (const f of ["restingHr", "hrv", "sleepSec", "weightKg"] as const) {
    const v = clean(f, c[f]);
    if (v !== null) measured[f] = v;
  }
  const feelings = { legs: c.legs, sleepFeel: c.sleepFeel, motivation: c.motivation };
  const existing = db.select().from(wellness).where(and(eq(wellness.userId, userId), eq(wellness.date, c.date))).get();
  if (existing) {
    db.update(wellness)
      .set({ ...feelings, ...measured, source: Object.keys(measured).length || existing.source === "demo" ? "manual" : existing.source, updatedAt: new Date() })
      .where(and(eq(wellness.userId, userId), eq(wellness.date, c.date)))
      .run();
  } else db.insert(wellness).values({ userId, date: c.date, ...feelings, ...measured, source: "manual" }).run();
}

export function wellnessBetween(userId: string, from: ISODate, to: ISODate): WellnessDay[] {
  return getDb()
    .select({
      date: wellness.date,
      restingHr: wellness.restingHr,
      hrv: wellness.hrv,
      hrvSdnn: wellness.hrvSdnn,
      sleepSec: wellness.sleepSec,
      weightKg: wellness.weightKg,
      legs: wellness.legs,
      sleepFeel: wellness.sleepFeel,
      motivation: wellness.motivation,
    })
    .from(wellness)
    .where(and(eq(wellness.userId, userId), gte(wellness.date, from), lte(wellness.date, to)))
    .orderBy(asc(wellness.date))
    .all();
}

/** Recovery for today from the last 60 days, or null without any signal. */
export function recoveryFor(user: Pick<User, "id" | "timeZone">): Recovery | null {
  const today = todayFor(user);
  return recoveryFrom(wellnessBetween(user.id, addDays(today, -59), today), today);
}
