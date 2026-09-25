"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { scheduledWorkouts, users, workouts } from "@/db/schema";
import { addDays, dayOfWeek } from "@/lib/dates";
import { newId } from "@/lib/id";
import { createSession, destroySession, thresholdsOf } from "@/lib/server/auth";
import { createConnection } from "@/lib/server/connections";
import { hashPassword, randomToken, verifyPassword } from "@/lib/server/crypto";
import { todayFor } from "@/lib/server/sync";
import { summarize } from "@/lib/workout/metrics";
import { TEMPLATES } from "@/lib/workout/templates";
import { parseWorkoutText } from "@/lib/workout/text";

export type AuthState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

const credentials = z.object({
  email: z.email("Bitte gib eine gültige E-Mail-Adresse ein.").transform((e) => e.toLowerCase().trim()),
  password: z.string().min(8, "Mindestens 8 Zeichen."),
});

let dummyHash: Promise<string> | null = null;

function validTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return "Europe/Berlin";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "Europe/Berlin";
  }
}

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.extend({ name: z.string().trim().min(1, "Wie dürfen wir dich nennen?").max(60) }).safeParse({
    email: form.get("email"),
    password: form.get("password"),
    name: form.get("name"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors };
  }
  const db = getDb();
  if (db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).get()) {
    return { fieldErrors: { email: "Für diese E-Mail gibt es bereits ein Konto." } };
  }
  const id = newId();
  db.insert(users)
    .values({ id, email: parsed.data.email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password), timeZone: validTimeZone(form.get("timeZone")) })
    .run();
  await createSession(id);
  redirect("/dashboard?welcome=1");
}

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "E-Mail oder Passwort ist falsch." };
  const user = getDb().select().from(users).where(eq(users.email, parsed.data.email)).get();
  // Always run the hash comparison to keep timing uniform.
  dummyHash ??= hashPassword(randomToken());
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) return { error: "E-Mail oder Passwort ist falsch." };
  await createSession(user.id);
  const next = form.get("next");
  redirect(typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/");
}

/** Creates a fully populated demo account and signs in. */
export async function startDemo(form: FormData) {
  const db = getDb();
  const id = newId();
  const timeZone = validTimeZone(form.get("timeZone"));
  db.insert(users)
    .values({
      id,
      email: `demo-${id}@demo.wrkhive.app`,
      name: "Alex",
      passwordHash: await hashPassword(randomToken()),
      ftp: 265,
      lthr: 168,
      maxHr: 189,
      restHr: 48,
      thresholdPace: 272,
      weightKg: 72,
      timeZone,
      isDemo: true,
    })
    .run();
  const user = db.select().from(users).where(eq(users.id, id)).get()!;
  await createConnection(user, "garmin", { mode: "demo" });

  // A small library and a planned week so every screen has something to show.
  const t = thresholdsOf(user);
  const picks = ["ride-sweetspot-2x20", "ride-vo2-5x4", "run-vo2-6x800", "run-long-90", "strength-legs", "ride-endurance-90"];
  const created: Record<string, string> = {};
  for (const tid of picks) {
    const tpl = TEMPLATES.find((x) => x.id === tid)!;
    const structure = parseWorkoutText(tpl.text, tpl.sport, t).structure;
    const s = summarize(structure, t);
    const wid = newId();
    created[tid] = wid;
    db.insert(workouts)
      .values({ id: wid, userId: id, name: tpl.name, description: tpl.description, sport: tpl.sport, structure, durationSec: s.durationSec, distanceM: s.distanceM, tss: s.tss, source: "template", favorite: tid === "ride-sweetspot-2x20" })
      .run();
  }
  const today = todayFor(user);
  const week: [number, string][] = [
    [1, "ride-vo2-5x4"],
    [2, "strength-legs"],
    [3, "ride-sweetspot-2x20"],
    [5, "ride-endurance-90"],
    [6, "run-long-90"],
    [8, "run-vo2-6x800"],
    [10, "ride-sweetspot-2x20"],
  ];
  for (const [offset, tid] of week) {
    const date = addDays(today, offset);
    if (dayOfWeek(date) === 0 && tid !== "strength-legs") continue; // keep Mondays as rest days
    db.insert(scheduledWorkouts).values({ id: newId(), userId: id, workoutId: created[tid], date }).run();
  }

  await createSession(id);
  redirect("/dashboard");
}
