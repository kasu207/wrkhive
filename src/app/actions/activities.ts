"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { activities } from "@/db/schema";
import { requireUser } from "@/lib/server/auth";
import { releaseEntriesOf } from "@/lib/server/entries";
import { recordManualActivity } from "@/lib/server/manual-activity";
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
  const r = recordManualActivity(user, { name: p.name, sport: "other", startTime, utcOffsetSec: p.utcOffsetSec, durationSec: p.durationMin * 60, rpe: p.rpe });
  if (!r.ok) return { ok: false, error: `Zu dieser Zeit ist schon „${r.clash.name}“ erfasst.` };
  revalidate();
  return { ok: true, data: { id: r.id }, message: `${Math.round(r.tss)} TSS aus Session-RPE.` };
}

/** Deletes a manually recorded session. Synced and imported activities are never deleted here. */
export async function deleteManualActivity(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const res = getDb()
    .delete(activities)
    .where(and(eq(activities.id, id), eq(activities.userId, user.id), eq(activities.provider, "manual"), eq(activities.sourceApp, "manual")))
    .run();
  if (res.changes === 0) return { ok: false, error: "Einheit nicht gefunden." };
  // A confirmed calendar entry waits for confirmation again.
  releaseEntriesOf(user.id, id);
  revalidate();
  return { ok: true };
}
