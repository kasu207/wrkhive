"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { activities } from "@/db/schema";
import { activityLoad } from "@/lib/analytics/load";
import { newId } from "@/lib/id";
import { requireUser } from "@/lib/server/auth";
import { isSameSession, localDate, matchPlannedWorkouts } from "@/lib/server/sync";
import type { ActionResult } from "./workouts";

const manualInput = z.object({
  name: z.string().trim().min(1, "Gib der Einheit einen Namen.").max(120),
  startsAt: z.iso.datetime({ offset: true }),
  utcOffsetSec: z
    .number()
    .int()
    .min(-14 * 3600)
    .max(14 * 3600),
  durationMin: z.number().int().min(5, "Mindestens 5 Minuten.").max(360, "Höchstens 6 Stunden."),
  rpe: z.number().int().min(1, "Wähle die Anstrengung.").max(10),
});

function revalidate() {
  revalidatePath("/activities");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
}

/**
 * Records a session without a device (e.g. Brazilian Jiu-Jitsu) from its
 * duration and Session-RPE. Training load follows RPE_TSS_PER_HOUR.
 */
export async function createManualActivity(input: z.input<typeof manualInput>): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = manualInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  const p = parsed.data;
  const startTime = new Date(p.startsAt);
  if (startTime.getTime() > Date.now() + 3600_000) return { ok: false, error: "Der Beginn liegt in der Zukunft. Erfasse die Einheit nach dem Training." };
  const durationSec = p.durationMin * 60;

  const db = getDb();
  // A recording of the same session (watch, app) must not be counted twice.
  const clash = db
    .select({ name: activities.name, startTime: activities.startTime, durationSec: activities.durationSec })
    .from(activities)
    .where(and(eq(activities.userId, user.id), gte(activities.startTime, new Date(startTime.getTime() - 12 * 3600_000)), lte(activities.startTime, new Date(startTime.getTime() + durationSec * 1000))))
    .all()
    .find((a) => isSameSession(a, { startTime, durationSec }));
  if (clash) return { ok: false, error: `Zu dieser Zeit ist schon „${clash.name}“ erfasst.` };

  const model = { ftp: user.ftp, lthr: user.lthr, maxHr: user.maxHr, restHr: user.restHr, thresholdPace: user.thresholdPace };
  const load = activityLoad({ sport: "other", durationSec, rpe: p.rpe }, model);
  const id = newId();
  const date = localDate(startTime, user.timeZone, p.utcOffsetSec);
  db.insert(activities)
    .values({
      id,
      userId: user.id,
      connectionId: null,
      provider: "manual",
      externalId: `manual-${newId()}`,
      sport: "other",
      name: p.name,
      startTime,
      date,
      durationSec,
      rpe: p.rpe,
      tss: load.tss,
      tssMethod: load.method,
      sourceApp: "manual",
    })
    .run();
  matchPlannedWorkouts(user.id, [date]);
  revalidate();
  return { ok: true, data: { id }, message: `${Math.round(load.tss)} TSS aus Session-RPE.` };
}

/** Deletes a manually recorded session. Synced and imported activities are never deleted here. */
export async function deleteManualActivity(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const res = getDb()
    .delete(activities)
    .where(and(eq(activities.id, id), eq(activities.userId, user.id), eq(activities.provider, "manual"), eq(activities.sourceApp, "manual")))
    .run();
  if (res.changes === 0) return { ok: false, error: "Einheit nicht gefunden." };
  revalidate();
  return { ok: true };
}
