import "server-only";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, deliveries, scheduledWorkouts, users, workouts, type User } from "@/db/schema";
import { readinessFromPmc, type Readiness } from "@/lib/analytics/readiness";
import { addDays, type ISODate } from "@/lib/dates";
import { newId } from "@/lib/id";
import { adaptWorkout } from "@/lib/workout/adapt";
import { summarize } from "@/lib/workout/metrics";
import { thresholdsOf } from "./auth";
import { PROVIDERS, todayFor } from "./sync";
import { pmcFor } from "./training";

/**
 * Readiness for today, or null without enough recent data to judge (a
 * missing sync must not look like three weeks of rest).
 */
export function readinessFor(user: User): Readiness | null {
  const today = todayFor(user);
  const recent =
    getDb()
      .select({ n: count() })
      .from(activities)
      .where(and(eq(activities.userId, user.id), gte(activities.date, addDays(today, -21))))
      .get()?.n ?? 0;
  if (recent < 3) return null;
  return readinessFromPmc(pmcFor(user, 14));
}

/** Providers the workout was already sent to for that day (a changed version must be re-sent there). */
export function sentTo(userId: string, workoutId: string, date: ISODate): string[] {
  const rows = getDb()
    .select({ provider: deliveries.provider })
    .from(deliveries)
    .where(and(eq(deliveries.userId, userId), eq(deliveries.workoutId, workoutId), eq(deliveries.status, "sent"), eq(deliveries.scheduledDate, date)))
    .all();
  return [...new Set(rows.map((r) => PROVIDERS[r.provider].name))];
}

export type AdaptResult = { ok: true; note: string; workoutId: string; resendTo: string[] } | { ok: false; error: string };

/** Replaces today's planned workout with a version adapted to the current load. */
export function adaptScheduled(user: User, scheduledId: string, readiness: Readiness | null = readinessFor(user)): AdaptResult {
  const db = getDb();
  const row = db
    .select({ s: scheduledWorkouts, w: workouts })
    .from(scheduledWorkouts)
    .innerJoin(workouts, eq(workouts.id, scheduledWorkouts.workoutId))
    .where(and(eq(scheduledWorkouts.id, scheduledId), eq(scheduledWorkouts.userId, user.id)))
    .get();
  if (!row) return { ok: false, error: "Geplantes Workout nicht gefunden." };
  const { s, w } = row;
  if (s.status !== "planned") return { ok: false, error: "Das Workout ist bereits erledigt." };
  if (s.originalWorkoutId) return { ok: false, error: "Das Workout ist bereits angepasst." };
  if (s.date !== todayFor(user)) return { ok: false, error: "Angepasst wird nur das Workout von heute, weil sich die Form täglich ändert." };
  if (!readiness) return { ok: false, error: "Für eine Anpassung fehlen aktuelle Aktivitäten." };

  const t = thresholdsOf(user);
  const adaptation = adaptWorkout(w.structure, readiness.mode, t);
  if (!adaptation) return { ok: false, error: "Keine Anpassung nötig: Das Workout passt zu deiner aktuellen Form." };

  const sum = summarize(adaptation.structure, t);
  const id = newId();
  db.transaction((tx) => {
    tx.insert(workouts)
      .values({
        id,
        userId: user.id,
        name: `${w.name.slice(0, 68)} (angepasst)`,
        description: `An deine Belastung angepasst (${readiness.label}): ${adaptation.note}${w.description ? `\n\n${w.description}` : ""}`.slice(0, 1000),
        sport: w.sport,
        structure: adaptation.structure,
        durationSec: sum.durationSec,
        distanceM: sum.distanceM,
        tss: sum.tss,
        // Calendar-only copy: kept out of the workout library like plan sessions.
        source: "plan",
      })
      .run();
    tx.update(scheduledWorkouts).set({ workoutId: id, originalWorkoutId: w.id, adaptNote: adaptation.note }).where(eq(scheduledWorkouts.id, s.id)).run();
  });
  return { ok: true, note: adaptation.note, workoutId: id, resendTo: sentTo(user.id, w.id, s.date) };
}

/** Puts the original workout back. The adapted copy is removed unless it was already sent somewhere. */
export function restoreScheduled(user: User, scheduledId: string): { ok: true; resendTo: string[] } | { ok: false; error: string } {
  const db = getDb();
  const s = db
    .select()
    .from(scheduledWorkouts)
    .where(and(eq(scheduledWorkouts.id, scheduledId), eq(scheduledWorkouts.userId, user.id)))
    .get();
  if (!s || !s.originalWorkoutId) return { ok: false, error: "Keine Anpassung zum Zurücksetzen." };
  const adaptedId = s.workoutId;
  const resendTo = sentTo(user.id, adaptedId, s.date);
  db.transaction((tx) => {
    tx.update(scheduledWorkouts).set({ workoutId: s.originalWorkoutId!, originalWorkoutId: null, adaptNote: null }).where(eq(scheduledWorkouts.id, s.id)).run();
    const stillUsed = tx.select({ n: count() }).from(scheduledWorkouts).where(eq(scheduledWorkouts.workoutId, adaptedId)).get()?.n ?? 0;
    if (!stillUsed && !resendTo.length) tx.delete(workouts).where(and(eq(workouts.id, adaptedId), eq(workouts.userId, user.id))).run();
  });
  return { ok: true, resendTo };
}

/**
 * Automatic mode: adapts today's planned workouts that were not sent to a
 * device yet (a sent workout is never changed behind the athlete's back).
 * Idempotent; returns the number of adapted sessions.
 */
export function autoAdaptToday(user: User): number {
  if (!user.autoAdapt) return 0;
  const readiness = readinessFor(user);
  if (!readiness || readiness.mode === "keep") return 0;
  const today = todayFor(user);
  const rows = getDb()
    .select()
    .from(scheduledWorkouts)
    .where(and(eq(scheduledWorkouts.userId, user.id), eq(scheduledWorkouts.date, today), eq(scheduledWorkouts.status, "planned"), isNull(scheduledWorkouts.originalWorkoutId)))
    .all();
  let adapted = 0;
  for (const s of rows) {
    if (sentTo(user.id, s.workoutId, today).length) continue;
    if (adaptScheduled(user, s.id, readiness).ok) adapted++;
  }
  return adapted;
}

/** Runs the automatic mode for every athlete who enabled it (background scheduler). */
export function autoAdaptAll(): number {
  const list = getDb().select().from(users).where(eq(users.autoAdapt, true)).all();
  let n = 0;
  for (const u of list) {
    try {
      n += autoAdaptToday(u);
    } catch (e) {
      console.error("[adapt] auto adaptation failed", e);
    }
  }
  return n;
}
