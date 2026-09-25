"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { scheduledWorkouts, workouts } from "@/db/schema";
import { isISODate } from "@/lib/dates";
import { newId } from "@/lib/id";
import { requireUser, thresholdsOf } from "@/lib/server/auth";
import { sendWorkoutToDevice } from "@/lib/server/sync";
import { summarize } from "@/lib/workout/metrics";
import { workoutStructureSchema } from "@/lib/workout/schema";
import { TEMPLATES } from "@/lib/workout/templates";
import { parseWorkoutText } from "@/lib/workout/text";
import type { WorkoutStructure } from "@/lib/workout/types";

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

const saveInput = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1, "Gib dem Workout einen Namen.").max(80),
  description: z.string().max(1000).default(""),
  structure: workoutStructureSchema,
});

export async function saveWorkout(input: z.input<typeof saveInput>): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = saveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültiges Workout." };
  const { id, name, description } = parsed.data;
  const structure = parsed.data.structure as WorkoutStructure;
  const s = summarize(structure, thresholdsOf(user));
  const db = getDb();
  const values = { name, description, sport: structure.sport, structure, durationSec: s.durationSec, distanceM: s.distanceM, tss: s.tss, updatedAt: new Date() };

  if (id) {
    const res = db.update(workouts).set(values).where(and(eq(workouts.id, id), eq(workouts.userId, user.id))).run();
    if (res.changes === 0) return { ok: false, error: "Workout nicht gefunden." };
    revalidatePath("/workouts");
    return { ok: true, data: { id } };
  }
  const newWorkoutId = newId();
  db.insert(workouts).values({ id: newWorkoutId, userId: user.id, source: "manual", ...values }).run();
  revalidatePath("/workouts");
  return { ok: true, data: { id: newWorkoutId } };
}

export async function deleteWorkout(id: string): Promise<ActionResult> {
  const user = await requireUser();
  getDb().delete(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, user.id))).run();
  revalidatePath("/workouts");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function duplicateWorkout(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const db = getDb();
  const w = db.select().from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, user.id))).get();
  if (!w) return { ok: false, error: "Workout nicht gefunden." };
  const copyId = newId();
  db.insert(workouts)
    .values({ ...w, id: copyId, name: `${w.name} (Kopie)`.slice(0, 80), favorite: false, source: "manual", createdAt: new Date(), updatedAt: new Date() })
    .run();
  revalidatePath("/workouts");
  return { ok: true, data: { id: copyId } };
}

export async function toggleFavorite(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const w = db.select({ favorite: workouts.favorite }).from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, user.id))).get();
  if (!w) return { ok: false, error: "Workout nicht gefunden." };
  db.update(workouts).set({ favorite: !w.favorite }).where(eq(workouts.id, id)).run();
  revalidatePath("/workouts");
  return { ok: true };
}

export async function createFromTemplate(templateId: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return { ok: false, error: "Vorlage nicht gefunden." };
  const t = thresholdsOf(user);
  const structure = parseWorkoutText(tpl.text, tpl.sport, t).structure;
  const s = summarize(structure, t);
  const id = newId();
  getDb()
    .insert(workouts)
    .values({ id, userId: user.id, name: tpl.name, description: tpl.description, sport: tpl.sport, structure, durationSec: s.durationSec, distanceM: s.distanceM, tss: s.tss, source: "template" })
    .run();
  revalidatePath("/workouts");
  return { ok: true, data: { id } };
}

// --- Calendar ---------------------------------------------------------------

export async function scheduleWorkout(workoutId: string, date: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!isISODate(date)) return { ok: false, error: "Ungültiges Datum." };
  const db = getDb();
  const w = db.select({ id: workouts.id }).from(workouts).where(and(eq(workouts.id, workoutId), eq(workouts.userId, user.id))).get();
  if (!w) return { ok: false, error: "Workout nicht gefunden." };
  db.insert(scheduledWorkouts).values({ id: newId(), userId: user.id, workoutId, date }).run();
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function moveScheduled(id: string, date: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!isISODate(date)) return { ok: false, error: "Ungültiges Datum." };
  getDb()
    .update(scheduledWorkouts)
    .set({ date, status: "planned", activityId: null })
    .where(and(eq(scheduledWorkouts.id, id), eq(scheduledWorkouts.userId, user.id)))
    .run();
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function setScheduledStatus(id: string, status: "planned" | "done" | "skipped"): Promise<ActionResult> {
  const user = await requireUser();
  getDb()
    .update(scheduledWorkouts)
    .set({ status, ...(status === "planned" ? { activityId: null } : {}) })
    .where(and(eq(scheduledWorkouts.id, id), eq(scheduledWorkouts.userId, user.id)))
    .run();
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function unschedule(id: string): Promise<ActionResult> {
  const user = await requireUser();
  getDb().delete(scheduledWorkouts).where(and(eq(scheduledWorkouts.id, id), eq(scheduledWorkouts.userId, user.id))).run();
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

// --- Send to device -------------------------------------------------------------

const sendInput = z.object({
  workoutId: z.string().min(1).max(40),
  provider: z.enum(["garmin", "wahoo", "intervals"]),
  date: z.string().nullable(),
  timeZone: z.string().max(64),
  indoor: z.boolean().optional(),
});

export async function sendToDevice(input: z.input<typeof sendInput>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ungültige Anfrage." };
  const { workoutId, provider, date, timeZone, indoor } = parsed.data;
  if (date !== null && !isISODate(date)) return { ok: false, error: "Ungültiges Datum." };
  const res = await sendWorkoutToDevice(user, workoutId, provider, date, timeZone || user.timeZone, { indoor });
  revalidatePath(`/workouts/${workoutId}`);
  return res.ok ? { ok: true, message: res.message } : { ok: false, error: res.message };
}
