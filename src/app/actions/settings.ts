"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { deviceConnections, users } from "@/db/schema";
import { destroySession, requireUser } from "@/lib/server/auth";
import { decrypt } from "@/lib/server/crypto";
import { PROVIDERS } from "@/lib/server/sync";
import { recomputeLoads } from "@/lib/server/thresholds";
import type { ActionResult } from "./workouts";

const profile = z.object({
  name: z.string().trim().min(1).max(60),
  ftp: z.coerce.number().int().min(50, "FTP zwischen 50 und 600 W").max(600, "FTP zwischen 50 und 600 W"),
  lthr: z.coerce.number().int().min(100).max(220),
  maxHr: z.coerce.number().int().min(120).max(230),
  restHr: z.coerce.number().int().min(30).max(100),
  thresholdPaceMin: z.coerce.number().int().min(2).max(12),
  thresholdPaceSec: z.coerce.number().int().min(0).max(59),
  weightKg: z.union([z.literal(""), z.coerce.number().min(30).max(250)]),
  baselineWeeklyHours: z.union([z.literal(""), z.coerce.number().min(0, "Trainingsumfang zwischen 0 und 40 h").max(40, "Trainingsumfang zwischen 0 und 40 h")]).default(""),
  timeZone: z.string().max(64),
});

export async function updateProfile(input: Record<string, string>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = profile.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  const p = parsed.data;
  if (p.lthr >= p.maxHr) return { ok: false, error: "Die Schwellenherzfrequenz muss unter dem Maximalpuls liegen." };
  if (p.restHr >= p.lthr) return { ok: false, error: "Der Ruhepuls muss unter der Schwellenherzfrequenz liegen." };
  let timeZone = user.timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: p.timeZone });
    timeZone = p.timeZone;
  } catch {
    /* keep previous */
  }
  const next = {
    name: p.name,
    ftp: p.ftp,
    lthr: p.lthr,
    maxHr: p.maxHr,
    restHr: p.restHr,
    thresholdPace: p.thresholdPaceMin * 60 + p.thresholdPaceSec,
    weightKg: p.weightKg === "" ? null : p.weightKg,
    timeZone,
  };
  const baselineWeeklyHours = p.baselineWeeklyHours === "" ? null : Math.round(p.baselineWeeklyHours * 2) / 2;
  getDb().update(users).set({ ...next, baselineWeeklyHours }).where(eq(users.id, user.id)).run();

  // Thresholds changed: re-derive load metrics for workouts and activities.
  recomputeLoads(user.id, next);
  revalidatePath("/", "layout");
  return { ok: true, message: "Gespeichert. Belastungswerte wurden neu berechnet." };
}

/** Permanently deletes the account and all data (cascades), after revoking provider access. */
export async function deleteAccount(confirmation: string): Promise<ActionResult> {
  const user = await requireUser();
  if (confirmation.trim().toLowerCase() !== "löschen") return { ok: false, error: "Bitte tippe „löschen“ zur Bestätigung." };
  const db = getDb();
  for (const c of db.select().from(deviceConnections).where(eq(deviceConnections.userId, user.id)).all()) {
    if (c.mode === "live" && c.accessToken) {
      try {
        await PROVIDERS[c.provider].revoke(decrypt(c.accessToken));
      } catch {
        /* best effort */
      }
    }
  }
  db.delete(users).where(eq(users.id, user.id)).run();
  await destroySession();
  redirect("/");
}

const baseline = z.number().min(0, "Zwischen 0 und 40 Stunden.").max(40, "Zwischen 0 und 40 Stunden.").nullable();

/** Weekly training hours before Wrkhive; seeds fitness so a short history is not read as overload. */
export async function setBaselineHours(hours: number | null): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = baseline.safeParse(hours);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  getDb().update(users).set({ baselineWeeklyHours: parsed.data === null ? null : Math.round(parsed.data * 2) / 2 }).where(eq(users.id, user.id)).run();
  revalidatePath("/", "layout");
  return { ok: true, message: parsed.data === null ? "Startwert entfernt." : "Fitness und Form wurden neu berechnet." };
}
