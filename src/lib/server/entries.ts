import "server-only";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, calendarEntries, type CalendarEntry, type User } from "@/db/schema";
import { RPE_TSS_PER_HOUR } from "@/lib/analytics/load";
import { addDays, isISODate, type ISODate } from "@/lib/dates";
import { newId } from "@/lib/id";
import { isManualEntry, recordManualActivity } from "./manual-activity";
import { localInstant } from "./providers/http";
import { matchPlannedWorkouts, todayFor } from "./sync";

/** Session-RPE assumed for the planned load when the athlete gives none. */
export const DEFAULT_ENTRY_RPE = 5;

export interface EntryInput {
  date: ISODate;
  time: string | null;
  name: string;
  sport: CalendarEntry["sport"];
  durationMin: number;
  rpe: number | null;
  note: string | null;
  /** Additional weekly repetitions after the first date (0 = single entry). */
  repeatWeeks: number;
}

/** Planned load of an entry in TSS, from duration and expected Session-RPE. */
export function entryTss(e: Pick<CalendarEntry, "durationMin" | "rpe">): number {
  return Math.round((e.durationMin / 60) * RPE_TSS_PER_HOUR[e.rpe ?? DEFAULT_ENTRY_RPE]);
}

export function createEntries(user: Pick<User, "id">, input: EntryInput): CalendarEntry[] {
  const db = getDb();
  const seriesId = input.repeatWeeks > 0 ? newId() : null;
  const rows = Array.from({ length: input.repeatWeeks + 1 }, (_, i) => ({
    id: newId(),
    userId: user.id,
    date: addDays(input.date, i * 7),
    time: input.time,
    name: input.name,
    sport: input.sport,
    durationMin: input.durationMin,
    rpe: input.rpe,
    note: input.note,
    seriesId,
  }));
  db.insert(calendarEntries).values(rows).run();
  return db.select().from(calendarEntries).where(inArray(calendarEntries.id, rows.map((r) => r.id))).orderBy(asc(calendarEntries.date)).all();
}

export function entriesBetween(userId: string, from: ISODate, to: ISODate): CalendarEntry[] {
  return getDb()
    .select()
    .from(calendarEntries)
    .where(and(eq(calendarEntries.userId, userId), gte(calendarEntries.date, from), lte(calendarEntries.date, to)))
    .orderBy(asc(calendarEntries.date), asc(calendarEntries.time), asc(calendarEntries.createdAt))
    .all();
}

export function getEntry(userId: string, id: string): CalendarEntry | null {
  return getDb().select().from(calendarEntries).where(and(eq(calendarEntries.id, id), eq(calendarEntries.userId, userId))).get() ?? null;
}

/** Whether a planned entry lies behind the athlete: an earlier day, or today after its end time. */
export function isDue(e: Pick<CalendarEntry, "date" | "time" | "durationMin" | "status">, today: ISODate, now: Date, timeZone: string): boolean {
  if (e.status !== "planned") return false;
  if (e.date < today) return true;
  if (e.date > today || !e.time) return false;
  return localInstant(e.date, e.time, timeZone).getTime() + e.durationMin * 60_000 <= now.getTime();
}

/** Planned entries that took place and still wait for confirmation (last 30 days). */
export function dueEntries(user: Pick<User, "id" | "timeZone">, now = new Date()): CalendarEntry[] {
  const today = todayFor(user);
  return getDb()
    .select()
    .from(calendarEntries)
    .where(and(eq(calendarEntries.userId, user.id), eq(calendarEntries.status, "planned"), gte(calendarEntries.date, addDays(today, -30)), lte(calendarEntries.date, today)))
    .orderBy(asc(calendarEntries.date), asc(calendarEntries.time))
    .all()
    .filter((e) => isDue(e, today, now, user.timeZone));
}

export type ConfirmResult = { ok: true; activityId: string; tss: number | null; linked: boolean } | { ok: false; error: string };

/**
 * Confirms that an entry took place and rates it. Records a manual activity
 * from duration and Session-RPE, or links the recording that already covers
 * the session (a watch recorded it after all).
 */
export function confirmEntry(user: User, id: string, rating: { durationMin: number; rpe: number }): ConfirmResult {
  const e = getEntry(user.id, id);
  if (!e) return { ok: false, error: "Termin nicht gefunden." };
  if (e.status === "done") return { ok: false, error: "Der Termin ist schon bestätigt." };
  if (e.date > todayFor(user)) return { ok: false, error: "Der Termin liegt in der Zukunft." };
  const startTime = localInstant(e.date, e.time ?? "18:00", user.timeZone);
  const db = getDb();
  const session = { name: e.name, sport: e.sport, startTime, durationSec: rating.durationMin * 60, rpe: rating.rpe };
  let r = recordManualActivity(user, session, { match: false });
  // Without a planned time the start is a placeholder: an overlap with another sport says nothing.
  if (!r.ok && r.clash.sport !== e.sport && !e.time) r = recordManualActivity(user, session, { match: false, ignoreClash: true });
  if (!r.ok && r.clash.sport !== e.sport) return { ok: false, error: `Zu dieser Zeit ist schon „${r.clash.name}“ erfasst. Passe die Uhrzeit des Termins an.` };
  if (!r.ok) {
    db.update(calendarEntries).set({ status: "done", activityId: r.clash.id, completion: "synced", rpe: rating.rpe }).where(eq(calendarEntries.id, e.id)).run();
    matchPlannedWorkouts(user.id, [e.date]);
    return { ok: true, activityId: r.clash.id, tss: null, linked: true };
  }
  db.update(calendarEntries).set({ status: "done", activityId: r.id, completion: "rated", rpe: rating.rpe, durationMin: rating.durationMin }).where(eq(calendarEntries.id, e.id)).run();
  // A recording of that day that arrived earlier replaces the manual record right away.
  matchPlannedWorkouts(user.id, [e.date]);
  const after = getEntry(user.id, e.id)!;
  return { ok: true, activityId: after.activityId!, tss: after.completion === "rated" ? r.tss : null, linked: after.completion === "synced" };
}

export function skipEntry(userId: string, id: string): boolean {
  return getDb().update(calendarEntries).set({ status: "skipped" }).where(and(eq(calendarEntries.id, id), eq(calendarEntries.userId, userId), eq(calendarEntries.status, "planned"))).run().changes > 0;
}

/** Opens a completed or skipped entry again; a manual record created by the rating is removed. */
export function reopenEntry(userId: string, id: string): boolean {
  const e = getEntry(userId, id);
  if (!e || e.status === "planned") return false;
  const db = getDb();
  db.transaction((tx) => {
    if (e.completion === "rated" && e.activityId) {
      const a = tx.select({ provider: activities.provider, sourceApp: activities.sourceApp }).from(activities).where(eq(activities.id, e.activityId)).get();
      if (a && isManualEntry(a)) tx.delete(activities).where(and(eq(activities.id, e.activityId), eq(activities.userId, userId))).run();
    }
    tx.update(calendarEntries).set({ status: "planned", activityId: null, completion: null }).where(eq(calendarEntries.id, e.id)).run();
  });
  return true;
}

export function moveEntry(userId: string, id: string, date: ISODate): boolean {
  if (!isISODate(date)) return false;
  return getDb().update(calendarEntries).set({ date }).where(and(eq(calendarEntries.id, id), eq(calendarEntries.userId, userId), eq(calendarEntries.status, "planned"))).run().changes > 0;
}

/**
 * Deletes an entry, or with `following` the open entries of its series from
 * that date on. Recorded activities stay in the training history.
 */
export function deleteEntry(userId: string, id: string, following = false): number {
  const e = getEntry(userId, id);
  if (!e) return 0;
  const db = getDb();
  if (following && e.seriesId) {
    return db
      .delete(calendarEntries)
      .where(and(eq(calendarEntries.userId, userId), eq(calendarEntries.seriesId, e.seriesId), gte(calendarEntries.date, e.date), eq(calendarEntries.status, "planned")))
      .run().changes + (e.status === "planned" ? 0 : db.delete(calendarEntries).where(eq(calendarEntries.id, e.id)).run().changes);
  }
  return db.delete(calendarEntries).where(eq(calendarEntries.id, e.id)).run().changes;
}

/** Resets entries whose activity was deleted (e.g. a manual session removed on the activities page). */
export function releaseEntriesOf(userId: string, activityId: string) {
  getDb()
    .update(calendarEntries)
    .set({ status: "planned", activityId: null, completion: null })
    .where(and(eq(calendarEntries.userId, userId), eq(calendarEntries.activityId, activityId)))
    .run();
}

/** Plain view of an entry for the calendar and the confirmation prompt. */
export function entryView(e: CalendarEntry, today: ISODate, timeZone: string, now = new Date()) {
  return {
    id: e.id,
    date: e.date,
    time: e.time,
    name: e.name,
    sport: e.sport,
    durationMin: e.durationMin,
    rpe: e.rpe,
    note: e.note,
    status: e.status,
    completion: e.completion,
    activityId: e.activityId,
    seriesId: e.seriesId,
    due: isDue(e, today, now, timeZone),
    tss: entryTss(e),
  };
}
