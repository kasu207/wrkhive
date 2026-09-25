"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { coachMessages, scheduledWorkouts, trainingPlans, workouts } from "@/db/schema";
import { addDays, isISODate } from "@/lib/dates";
import { newId } from "@/lib/id";
import { requireUser, thresholdsOf } from "@/lib/server/auth";
import { clearCoachHistory, handleCoachMessage, handlePlanRequest } from "@/lib/server/coach";
import { summarize } from "@/lib/workout/metrics";
import type { ActionResult } from "./workouts";

export async function sendCoachMessage(message: string): Promise<ActionResult> {
  const user = await requireUser();
  const text = message.trim();
  if (!text) return { ok: false, error: "Schreib mir, was du brauchst." };
  if (text.length > 4000) return { ok: false, error: "Die Nachricht ist zu lang." };
  await handleCoachMessage(user, text);
  revalidatePath("/coach");
  return { ok: true };
}

const planInput = z.object({
  goal: z.string().max(120),
  sport: z.enum(["ride", "run", "strength", "mixed"]),
  eventDate: z.string().nullable(),
  weeks: z.number().int().min(3).max(24),
  hoursPerWeek: z.number().min(1).max(30),
  trainingDays: z.array(z.number().int().min(0).max(6)).min(2).max(7),
  longDay: z.number().int().min(0).max(6),
  strength: z.boolean(),
});

export async function requestPlan(input: z.input<typeof planInput>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = planInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Angaben." };
  if (parsed.data.eventDate && !isISODate(parsed.data.eventDate)) return { ok: false, error: "Ungültiges Wettkampfdatum." };
  await handlePlanRequest(user, parsed.data);
  revalidatePath("/coach");
  return { ok: true };
}

export async function clearCoach(): Promise<ActionResult> {
  const user = await requireUser();
  clearCoachHistory(user.id);
  revalidatePath("/coach");
  return { ok: true };
}

/** Saves a proposed workout to the library; optionally schedules it. */
export async function saveCoachWorkout(messageId: string, date: string | null): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const db = getDb();
  const msg = db.select().from(coachMessages).where(and(eq(coachMessages.id, messageId), eq(coachMessages.userId, user.id))).get();
  if (!msg?.payload || msg.payload.kind !== "workout") return { ok: false, error: "Vorschlag nicht gefunden." };
  let workoutId = msg.payload.savedWorkoutId;
  if (!workoutId || !db.select({ id: workouts.id }).from(workouts).where(eq(workouts.id, workoutId)).get()) {
    const w = msg.payload.workout;
    const s = summarize(w.structure, thresholdsOf(user));
    workoutId = newId();
    db.insert(workouts)
      .values({ id: workoutId, userId: user.id, name: w.name, description: w.description, sport: w.sport, structure: w.structure, durationSec: s.durationSec, distanceM: s.distanceM, tss: s.tss, source: "coach" })
      .run();
    db.update(coachMessages).set({ payload: { ...msg.payload, savedWorkoutId: workoutId } }).where(eq(coachMessages.id, messageId)).run();
  }
  if (date && isISODate(date)) db.insert(scheduledWorkouts).values({ id: newId(), userId: user.id, workoutId, date }).run();
  revalidatePath("/coach");
  revalidatePath("/workouts");
  revalidatePath("/calendar");
  return { ok: true, data: { id: workoutId } };
}

/** Turns a proposed plan into workouts and calendar entries. */
export async function acceptPlan(messageId: string): Promise<ActionResult<{ planId: string }>> {
  const user = await requireUser();
  const db = getDb();
  const msg = db.select().from(coachMessages).where(and(eq(coachMessages.id, messageId), eq(coachMessages.userId, user.id))).get();
  if (!msg?.payload || msg.payload.kind !== "plan") return { ok: false, error: "Plan nicht gefunden." };
  if (msg.payload.savedPlanId && db.select({ id: trainingPlans.id }).from(trainingPlans).where(eq(trainingPlans.id, msg.payload.savedPlanId)).get()) {
    return { ok: true, data: { planId: msg.payload.savedPlanId } };
  }
  const plan = msg.payload.plan;
  const t = thresholdsOf(user);
  const planId = newId();
  db.transaction((tx) => {
    tx.insert(trainingPlans)
      .values({
        id: planId,
        userId: user.id,
        name: plan.name,
        goal: plan.goal,
        sport: plan.sport,
        startDate: plan.startDate,
        endDate: plan.endDate,
        summary: plan.summary,
        weeks: plan.weeks.map((w) => ({ index: w.index, startDate: w.startDate, focus: w.focus, phase: w.phase, targetTss: w.targetTss })),
      })
      .run();
    for (const week of plan.weeks) {
      for (const s of week.sessions) {
        const sum = summarize(s.structure, t);
        const wid = newId();
        tx.insert(workouts)
          .values({ id: wid, userId: user.id, name: s.name, description: s.description, sport: s.sport, structure: s.structure, durationSec: sum.durationSec, distanceM: sum.distanceM, tss: sum.tss, source: "plan" })
          .run();
        tx.insert(scheduledWorkouts).values({ id: newId(), userId: user.id, workoutId: wid, planId, date: addDays(week.startDate, s.day) }).run();
      }
    }
    tx.update(coachMessages).set({ payload: { ...msg.payload!, savedPlanId: planId } as typeof msg.payload }).where(eq(coachMessages.id, messageId)).run();
  });
  revalidatePath("/coach");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true, data: { planId } };
}

/** Removes a plan with its generated workouts and calendar entries. */
export async function deletePlan(planId: string): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  db.transaction((tx) => {
    const rows = tx
      .select({ workoutId: scheduledWorkouts.workoutId })
      .from(scheduledWorkouts)
      .where(and(eq(scheduledWorkouts.planId, planId), eq(scheduledWorkouts.userId, user.id)))
      .all();
    for (const r of rows) tx.delete(workouts).where(and(eq(workouts.id, r.workoutId), eq(workouts.userId, user.id), eq(workouts.source, "plan"))).run();
    tx.delete(trainingPlans).where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, user.id))).run();
  });
  revalidatePath("/calendar");
  revalidatePath("/coach");
  revalidatePath("/dashboard");
  return { ok: true };
}
