"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { adaptScheduled, restoreScheduled } from "@/lib/server/adapt";
import { requireUser } from "@/lib/server/auth";
import type { ActionResult } from "./workouts";

function refresh() {
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
}

const resendHint = (to: string[]) => (to.length ? ` Bereits an ${to.join(" und ")} gesendet: Sende die neue Version erneut, damit sie auf dem Gerät ankommt.` : "");

export async function adaptToday(scheduledId: string): Promise<ActionResult<{ workoutId: string; resendTo: string[] }>> {
  const user = await requireUser();
  if (typeof scheduledId !== "string" || scheduledId.length > 40) return { ok: false, error: "Ungültige Anfrage." };
  const r = adaptScheduled(user, scheduledId);
  refresh();
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, message: `${r.note}${resendHint(r.resendTo)}`, data: { workoutId: r.workoutId, resendTo: r.resendTo } };
}

export async function restoreOriginal(scheduledId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (typeof scheduledId !== "string" || scheduledId.length > 40) return { ok: false, error: "Ungültige Anfrage." };
  const r = restoreScheduled(user, scheduledId);
  refresh();
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, message: `Das ursprüngliche Workout ist wieder geplant.${resendHint(r.resendTo)}` };
}

export async function setAutoAdapt(enabled: boolean): Promise<ActionResult> {
  const user = await requireUser();
  getDb().update(users).set({ autoAdapt: Boolean(enabled) }).where(eq(users.id, user.id)).run();
  refresh();
  revalidatePath("/settings");
  return { ok: true };
}
