"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, fuelLogs, fuelOverrides, fuelProducts, scheduledWorkouts, sweatTests, users } from "@/db/schema";
import { isISODate } from "@/lib/dates";
import { newId } from "@/lib/id";
import { DEFAULT_PANTRY, PRODUCT_KINDS, SWEAT_SODIUM, TEMP_CLASSES, sweatRate, tempClassOf } from "@/lib/nutrition";
import { CARB_CEILING, MIN_MAX_CARB } from "@/lib/nutrition/guidelines";
import { requireUser } from "@/lib/server/auth";
import { allProducts } from "@/lib/server/nutrition";
import { todayFor } from "@/lib/server/sync";
import type { ActionResult } from "./workouts";

function revalidate() {
  revalidatePath("/", "layout");
}

const settings = z.object({
  maxCarb: z.number().int().min(MIN_MAX_CARB, `Zwischen ${MIN_MAX_CARB} und ${CARB_CEILING} g/h.`).max(CARB_CEILING, `Zwischen ${MIN_MAX_CARB} und ${CARB_CEILING} g/h.`),
  sweatSodium: z.enum(SWEAT_SODIUM),
  caffeine: z.boolean(),
  preferNatural: z.boolean(),
});

export async function updateFuelSettings(input: z.input<typeof settings>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = settings.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  const s = parsed.data;
  getDb()
    .update(users)
    .set({ fuelMaxCarb: Math.round(s.maxCarb / 5) * 5, fuelSweatSodium: s.sweatSodium, fuelCaffeine: s.caffeine, fuelPreferNatural: s.preferNatural })
    .where(eq(users.id, user.id))
    .run();
  revalidate();
  return { ok: true, message: "Einstellungen gespeichert." };
}

/** Takes over the gut-training suggestion. */
export async function applyMaxCarb(value: number): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.number().int().min(MIN_MAX_CARB).max(CARB_CEILING).safeParse(value);
  if (!parsed.success) return { ok: false, error: "Ungültiger Wert." };
  getDb().update(users).set({ fuelMaxCarb: parsed.data }).where(eq(users.id, user.id)).run();
  revalidate();
  return { ok: true, message: `Neue Verträglichkeit: ${parsed.data} g/h.` };
}

export async function togglePantry(input: { productId: string; active: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.object({ productId: z.string().max(40), active: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ungültige Eingabe." };
  if (!allProducts(user.id).some((p) => p.id === parsed.data.productId)) return { ok: false, error: "Produkt nicht gefunden." };
  const current = new Set(user.fuelPantry ?? DEFAULT_PANTRY);
  if (parsed.data.active) current.add(parsed.data.productId);
  else current.delete(parsed.data.productId);
  getDb().update(users).set({ fuelPantry: [...current] }).where(eq(users.id, user.id)).run();
  revalidate();
  return { ok: true };
}

const product = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1, "Gib dem Produkt einen Namen.").max(60),
  kind: z.enum(PRODUCT_KINDS),
  carbsG: z.number().min(0, "Kohlenhydrate zwischen 0 und 150 g.").max(150, "Kohlenhydrate zwischen 0 und 150 g."),
  sodiumMg: z.number().int().min(0).max(2000, "Natrium höchstens 2000 mg."),
  caffeineMg: z.number().int().min(0).max(300, "Koffein höchstens 300 mg."),
  multiSource: z.boolean(),
  fluidMl: z.number().int().min(50).max(1000).nullable(),
  servingLabel: z.string().trim().min(1).max(40),
});

export async function saveProduct(input: z.input<typeof product>): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = product.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  const { id, ...p } = parsed.data;
  if (p.kind === "drink" && !p.fluidMl) return { ok: false, error: "Gib bei Getränken die Wassermenge pro Portion an." };
  if (p.kind !== "salt" && p.carbsG === 0 && p.sodiumMg === 0) return { ok: false, error: "Das Produkt braucht Kohlenhydrate oder Natrium." };
  const values = { ...p, fluidMl: p.kind === "drink" ? p.fluidMl : null };
  const db = getDb();
  if (id) {
    const res = db.update(fuelProducts).set(values).where(and(eq(fuelProducts.id, id), eq(fuelProducts.userId, user.id))).run();
    if (res.changes === 0) return { ok: false, error: "Produkt nicht gefunden." };
    revalidate();
    return { ok: true, data: { id }, message: "Produkt gespeichert." };
  }
  const newIdValue = `own-${newId(10)}`;
  db.insert(fuelProducts).values({ id: newIdValue, userId: user.id, ...values }).run();
  const pantry = new Set(user.fuelPantry ?? DEFAULT_PANTRY);
  pantry.add(newIdValue);
  db.update(users).set({ fuelPantry: [...pantry] }).where(eq(users.id, user.id)).run();
  revalidate();
  return { ok: true, data: { id: newIdValue }, message: "Produkt angelegt und in den Vorrat gelegt." };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const res = db.delete(fuelProducts).where(and(eq(fuelProducts.id, String(id)), eq(fuelProducts.userId, user.id))).run();
  if (res.changes === 0) return { ok: false, error: "Produkt nicht gefunden." };
  if (user.fuelPantry) db.update(users).set({ fuelPantry: user.fuelPantry.filter((p) => p !== id) }).where(eq(users.id, user.id)).run();
  revalidate();
  return { ok: true, message: "Produkt gelöscht." };
}

const sweat = z.object({
  date: z.string().refine(isISODate),
  sport: z.enum(["ride", "run", "strength"]),
  durationMin: z.number().int().min(30, "Mindestens 30 Minuten, sonst ist die Messung zu ungenau.").max(600),
  tempC: z.number().min(-20).max(50),
  preKg: z.number().min(25).max(300),
  postKg: z.number().min(25).max(300),
  fluidMl: z.number().int().min(0).max(10000),
  urineMl: z.number().int().min(0).max(3000),
  activityId: z.string().max(40).nullable().optional(),
  notes: z.string().max(500).optional(),
});

export async function saveSweatTest(input: z.input<typeof sweat>): Promise<ActionResult<{ rateLh: number }>> {
  const user = await requireUser();
  const parsed = sweat.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Bitte prüfe die Werte." };
  const s = parsed.data;
  if (s.date > todayFor(user)) return { ok: false, error: "Der Test liegt in der Zukunft." };
  const rateLh = sweatRate({ preKg: s.preKg, postKg: s.postKg, fluidMl: s.fluidMl, urineMl: s.urineMl, durationSec: s.durationMin * 60 });
  if (rateLh === null) return { ok: false, error: "Das Ergebnis ist unplausibel (unter 0,2 oder über 3,5 l/h). Prüfe Gewichte und Trinkmenge." };
  const activityId = s.activityId && ownsActivity(user.id, s.activityId) ? s.activityId : null;
  getDb()
    .insert(sweatTests)
    .values({
      id: newId(),
      userId: user.id,
      activityId,
      date: s.date,
      sport: s.sport,
      durationSec: s.durationMin * 60,
      tempC: s.tempC,
      tempClass: tempClassOf(s.tempC),
      preKg: s.preKg,
      postKg: s.postKg,
      fluidMl: s.fluidMl,
      urineMl: s.urineMl,
      rateLh,
      notes: s.notes?.trim() || null,
    })
    .run();
  revalidate();
  return { ok: true, data: { rateLh }, message: `Schweißrate ${rateLh.toLocaleString("de-DE")} l/h gespeichert. Deine Trinkpläne nutzen ab jetzt diesen Wert.` };
}

export async function deleteSweatTest(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const res = getDb().delete(sweatTests).where(and(eq(sweatTests.id, String(id)), eq(sweatTests.userId, user.id))).run();
  if (res.changes === 0) return { ok: false, error: "Test nicht gefunden." };
  revalidate();
  return { ok: true, message: "Test gelöscht." };
}

const score = z.number().int().min(1).max(5).nullable();
const log = z.object({
  date: z.string().refine(isISODate),
  sport: z.enum(["ride", "run", "strength", "other"]),
  durationMin: z.number().int().min(10).max(1440),
  targetCarbsPerHour: z.number().int().min(0).max(CARB_CEILING).default(0),
  carbsG: z.number().int().min(0, "Kohlenhydrate zwischen 0 und 2000 g.").max(2000, "Kohlenhydrate zwischen 0 und 2000 g."),
  fluidMl: z.number().int().min(0).max(15000).nullable(),
  gutScore: score,
  energyScore: score,
  activityId: z.string().max(40).nullable().optional(),
  notes: z.string().max(500).optional(),
});

export async function saveFuelLog(input: z.input<typeof log>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = log.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Bitte prüfe die Werte." };
  const l = parsed.data;
  if (l.date > todayFor(user)) return { ok: false, error: "Protokolliere nach der Einheit." };
  const activityId = l.activityId && ownsActivity(user.id, l.activityId) ? l.activityId : null;
  const db = getDb();
  // One log per activity: a second entry replaces the first.
  if (activityId) db.delete(fuelLogs).where(and(eq(fuelLogs.userId, user.id), eq(fuelLogs.activityId, activityId))).run();
  db.insert(fuelLogs)
    .values({
      id: newId(),
      userId: user.id,
      activityId,
      date: l.date,
      sport: l.sport,
      durationSec: l.durationMin * 60,
      targetCarbsPerHour: l.targetCarbsPerHour,
      carbsG: l.carbsG,
      fluidMl: l.fluidMl,
      gutScore: l.gutScore,
      energyScore: l.energyScore,
      notes: l.notes?.trim() || null,
    })
    .run();
  revalidate();
  return { ok: true, message: "Protokoll gespeichert." };
}

export async function deleteFuelLog(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const res = getDb().delete(fuelLogs).where(and(eq(fuelLogs.id, String(id)), eq(fuelLogs.userId, user.id))).run();
  if (res.changes === 0) return { ok: false, error: "Eintrag nicht gefunden." };
  revalidate();
  return { ok: true, message: "Eintrag gelöscht." };
}

const override = z.object({
  scheduledId: z.string().max(40),
  tempClass: z.enum(TEMP_CLASSES),
  flags: z.object({ key: z.boolean().optional(), race: z.boolean().optional(), fasted: z.boolean().optional() }),
});

/** Conditions of a planned session: temperature, race, train low. */
export async function saveFuelOverride(input: z.input<typeof override>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = override.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ungültige Eingabe." };
  const o = parsed.data;
  const db = getDb();
  const owned = db.select({ id: scheduledWorkouts.id }).from(scheduledWorkouts).where(and(eq(scheduledWorkouts.id, o.scheduledId), eq(scheduledWorkouts.userId, user.id))).get();
  if (!owned) return { ok: false, error: "Termin nicht gefunden." };
  const values = { tempClass: o.tempClass, flags: o.flags, updatedAt: new Date() };
  db.insert(fuelOverrides)
    .values({ scheduledWorkoutId: o.scheduledId, userId: user.id, ...values })
    .onConflictDoUpdate({ target: fuelOverrides.scheduledWorkoutId, set: values })
    .run();
  revalidate();
  return { ok: true };
}

function ownsActivity(userId: string, id: string): boolean {
  return !!getDb().select({ id: activities.id }).from(activities).where(and(eq(activities.id, id), eq(activities.userId, userId))).get();
}
