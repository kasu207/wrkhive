"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isISODate } from "@/lib/dates";
import { requireUser } from "@/lib/server/auth";
import { confirmEntry as confirm, createEntries, deleteEntry as remove, moveEntry as move, reopenEntry as reopen, skipEntry as skip } from "@/lib/server/entries";
import type { ActionResult } from "./workouts";

function revalidate() {
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath("/activities");
}

const entryInput = z.object({
  date: z.string().refine(isISODate, "Ungültiges Datum."),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ungültige Uhrzeit.")
    .nullable(),
  name: z.string().trim().min(1, "Gib dem Termin einen Namen.").max(80),
  sport: z.enum(["ride", "run", "strength", "other"]),
  durationMin: z.number().int().min(5, "Mindestens 5 Minuten.").max(600, "Höchstens 10 Stunden."),
  rpe: z.number().int().min(1).max(10).nullable(),
  note: z.string().trim().max(300).nullable(),
  repeatWeeks: z.number().int().min(0).max(26),
});

/** Plans a session without a structured workout, optionally weekly. */
export async function createCalendarEntry(input: z.input<typeof entryInput>): Promise<ActionResult<{ count: number }>> {
  const user = await requireUser();
  const parsed = entryInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Angaben." };
  const rows = createEntries(user, { ...parsed.data, note: parsed.data.note || null });
  revalidate();
  return { ok: true, data: { count: rows.length } };
}

const ratingInput = z.object({
  durationMin: z.number().int().min(5, "Mindestens 5 Minuten.").max(600, "Höchstens 10 Stunden."),
  rpe: z.number().int().min(1, "Wähle die Anstrengung.").max(10),
});

/** The session took place: records it with the athlete's rating. */
export async function confirmCalendarEntry(id: string, input: z.input<typeof ratingInput>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = ratingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Angaben." };
  const r = confirm(user, id, parsed.data);
  if (!r.ok) return r;
  revalidate();
  return { ok: true, message: r.linked ? "Mit der Aufzeichnung deiner Uhr verknüpft." : `${Math.round(r.tss ?? 0)} TSS aus Session-RPE.` };
}

export async function skipCalendarEntry(id: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!skip(user.id, id)) return { ok: false, error: "Termin nicht gefunden." };
  revalidate();
  return { ok: true };
}

export async function reopenCalendarEntry(id: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!reopen(user.id, id)) return { ok: false, error: "Termin nicht gefunden." };
  revalidate();
  return { ok: true };
}

export async function moveCalendarEntry(id: string, date: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!move(user.id, id, date)) return { ok: false, error: "Nur offene Termine lassen sich verschieben." };
  revalidate();
  return { ok: true };
}

export async function deleteCalendarEntry(id: string, following = false): Promise<ActionResult> {
  const user = await requireUser();
  const n = remove(user.id, id, following);
  if (!n) return { ok: false, error: "Termin nicht gefunden." };
  revalidate();
  return { ok: true, message: n > 1 ? `${n} Termine gelöscht.` : undefined };
}
