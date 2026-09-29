import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, type User } from "@/db/schema";
import { activityLoad } from "@/lib/analytics/load";
import { newId } from "@/lib/id";
import { isSameSession, localDate, matchPlannedWorkouts } from "./sync";

export interface ManualSession {
  name: string;
  sport: "ride" | "run" | "strength" | "other";
  startTime: Date;
  /** Offset of the athlete's clock at the start; the account time zone otherwise. */
  utcOffsetSec?: number | null;
  durationSec: number;
  rpe: number;
}

export type ManualResult = { ok: true; id: string; tss: number } | { ok: false; clash: { id: string; name: string; sport: string } };

/**
 * Records a session without a device from its duration and Session-RPE.
 * A recording of the same session (watch, app) is never counted twice: the
 * clash is returned instead.
 */
export function recordManualActivity(user: User, s: ManualSession, opts: { match?: boolean; ignoreClash?: boolean } = {}): ManualResult {
  const db = getDb();
  const clash = db
    .select({ id: activities.id, name: activities.name, sport: activities.sport, startTime: activities.startTime, durationSec: activities.durationSec })
    .from(activities)
    .where(and(eq(activities.userId, user.id), gte(activities.startTime, new Date(s.startTime.getTime() - 12 * 3600_000)), lte(activities.startTime, new Date(s.startTime.getTime() + s.durationSec * 1000))))
    .all()
    .find((a) => isSameSession(a, { startTime: s.startTime, durationSec: s.durationSec }));
  if (clash && !opts.ignoreClash) return { ok: false, clash: { id: clash.id, name: clash.name, sport: clash.sport } };

  const model = { ftp: user.ftp, lthr: user.lthr, maxHr: user.maxHr, restHr: user.restHr, thresholdPace: user.thresholdPace };
  const load = activityLoad({ sport: s.sport, durationSec: s.durationSec, rpe: s.rpe }, model);
  const id = newId();
  const date = localDate(s.startTime, user.timeZone, s.utcOffsetSec);
  db.insert(activities)
    .values({
      id,
      userId: user.id,
      connectionId: null,
      provider: "manual",
      externalId: `manual-${newId()}`,
      sport: s.sport,
      name: s.name,
      startTime: s.startTime,
      date,
      durationSec: s.durationSec,
      rpe: s.rpe,
      tss: load.tss,
      tssMethod: load.method,
      sourceApp: "manual",
    })
    .run();
  if (opts.match !== false) matchPlannedWorkouts(user.id, [date]);
  return { ok: true, id, tss: load.tss };
}

/** Whether an activity was entered by hand in Wrkhive (not synced or imported). */
export const isManualEntry = (a: { provider: string; sourceApp: string | null }) => a.provider === "manual" && a.sourceApp === "manual";
