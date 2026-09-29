"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { sanitizeLayout } from "@/lib/dashboard";
import { addDays, isISODate } from "@/lib/dates";
import { requireUser } from "@/lib/server/auth";
import { todayFor } from "@/lib/server/sync";
import { recomputeLoads } from "@/lib/server/thresholds";
import { saveCheckin } from "@/lib/server/wellness";
import type { ActionResult } from "./workouts";

/** Stores the athlete's own dashboard: visible widgets, order and sizes. */
export async function saveDashboard(layout: unknown): Promise<ActionResult> {
  const user = await requireUser();
  if (!Array.isArray(layout) || layout.length > 60) return { ok: false, error: "Ungültiges Layout." };
  getDb().update(users).set({ dashboard: sanitizeLayout(layout) }).where(eq(users.id, user.id)).run();
  revalidatePath("/dashboard");
  return { ok: true, message: "Übersicht gespeichert." };
}

export async function resetDashboard(): Promise<ActionResult> {
  const user = await requireUser();
  getDb().update(users).set({ dashboard: null }).where(eq(users.id, user.id)).run();
  revalidatePath("/dashboard");
  return { ok: true, message: "Standard-Übersicht wiederhergestellt." };
}

const scale = z.number().int().min(1).max(5).nullable();
const optional = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

const checkin = z.object({
  date: z.string().refine(isISODate),
  legs: scale,
  sleepFeel: scale,
  motivation: scale,
  restingHr: optional(25, 120),
  hrv: optional(3, 300),
  sleepHours: optional(0.5, 16),
  weightKg: optional(25, 300),
});

/** Morning check-in: three feelings, optionally measured values for athletes without a synced wearable. */
export async function submitCheckin(input: z.input<typeof checkin>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = checkin.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bitte prüfe die Werte." };
  const c = parsed.data;
  // Today or yesterday only: the check-in describes the morning, not the past.
  const today = todayFor(user);
  if (c.date > today || c.date < addDays(today, -1)) return { ok: false, error: "Nur für heute oder gestern." };
  if (c.legs === null && c.sleepFeel === null && c.motivation === null && c.restingHr == null && c.hrv == null && c.sleepHours == null && c.weightKg == null) {
    return { ok: false, error: "Mindestens einen Wert angeben." };
  }
  saveCheckin(user.id, {
    date: c.date,
    legs: c.legs,
    sleepFeel: c.sleepFeel,
    motivation: c.motivation,
    restingHr: c.restingHr,
    hrv: c.hrv,
    sleepSec: c.sleepHours ? Math.round(c.sleepHours * 3600) : null,
    weightKg: c.weightKg,
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Check-in gespeichert." };
}

const threshold = z.object({ field: z.enum(["ftp", "lthr", "maxHr", "restHr"]), value: z.number().int() });
const LIMITS = { ftp: [50, 600], lthr: [100, 220], maxHr: [120, 230], restHr: [30, 100] } as const;

/** Takes over a suggested threshold and re-derives all load values. */
export async function applyThreshold(input: z.input<typeof threshold>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = threshold.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ungültiger Wert." };
  const { field, value } = parsed.data;
  const [lo, hi] = LIMITS[field];
  if (value < lo || value > hi) return { ok: false, error: "Wert außerhalb des gültigen Bereichs." };
  const next = { ftp: user.ftp, lthr: user.lthr, maxHr: user.maxHr, restHr: user.restHr, thresholdPace: user.thresholdPace, [field]: value };
  if (next.lthr >= next.maxHr) return { ok: false, error: "Die Schwellenherzfrequenz muss unter dem Maximalpuls liegen. Passe zuerst den Maximalpuls an." };
  if (next.restHr >= next.lthr) return { ok: false, error: "Der Ruhepuls muss unter der Schwellenherzfrequenz liegen." };
  getDb().update(users).set({ [field]: value }).where(eq(users.id, user.id)).run();
  recomputeLoads(user.id, next);
  revalidatePath("/", "layout");
  return { ok: true, message: "Übernommen. Belastungswerte wurden neu berechnet." };
}
