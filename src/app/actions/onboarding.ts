"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { APPS } from "@/lib/apps";
import { requireUser } from "@/lib/server/auth";
import { recomputeLoads } from "@/lib/server/thresholds";
import type { ActionResult } from "./workouts";

const APP_IDS = APPS.map((a) => a.id) as [string, ...string[]];

const input = z.object({
  apps: z.array(z.enum(APP_IDS)).max(APP_IDS.length),
  ftp: z.number().int().min(50).max(600).nullable(),
  lthr: z.number().int().min(100).max(220).nullable(),
  thresholdPace: z.number().int().min(120).max(720).nullable(),
  autoAdapt: z.boolean(),
});

/** Saves the answers of the welcome flow; unknown thresholds keep their defaults. */
export async function completeOnboarding(values: z.input<typeof input>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = input.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Bitte prüfe deine Angaben." };
  const v = parsed.data;
  const lthr = v.lthr ?? user.lthr;
  if (lthr >= user.maxHr && v.lthr !== null) return { ok: false, error: `Die Schwellenherzfrequenz muss unter deinem Maximalpuls (${user.maxHr} bpm) liegen. Den Maximalpuls kannst du später in den Einstellungen ändern.` };
  const next = { ftp: v.ftp ?? user.ftp, lthr, maxHr: user.maxHr, restHr: user.restHr, thresholdPace: v.thresholdPace ?? user.thresholdPace };
  getDb()
    .update(users)
    .set({ ...next, apps: [...new Set(v.apps)], autoAdapt: v.autoAdapt, onboardedAt: new Date() })
    .where(eq(users.id, user.id))
    .run();
  recomputeLoads(user.id, next);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function skipOnboarding(): Promise<ActionResult> {
  const user = await requireUser();
  getDb().update(users).set({ onboardedAt: new Date() }).where(eq(users.id, user.id)).run();
  revalidatePath("/", "layout");
  return { ok: true };
}
