import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, workouts, type User } from "@/db/schema";
import { activityLoad, effectiveVo2max } from "@/lib/analytics/load";
import { summarize } from "@/lib/workout/metrics";
import { thresholdsOf } from "./auth";

/** Re-derives workout estimates and activity load after the athlete's thresholds changed. */
export function recomputeLoads(userId: string, next: Pick<User, "ftp" | "lthr" | "maxHr" | "restHr" | "thresholdPace">) {
  const db = getDb();
  const t = thresholdsOf(next);
  db.transaction((tx) => {
    for (const w of tx.select().from(workouts).where(eq(workouts.userId, userId)).all()) {
      const s = summarize(w.structure, t);
      tx.update(workouts).set({ durationSec: s.durationSec, distanceM: s.distanceM, tss: s.tss }).where(eq(workouts.id, w.id)).run();
    }
    const model = { ...t, restHr: next.restHr };
    for (const a of tx.select().from(activities).where(eq(activities.userId, userId)).all()) {
      const load = activityLoad(a, model);
      const vo2 = a.sport === "run" && a.distanceM ? effectiveVo2max({ distanceM: a.distanceM, durationSec: a.movingSec ?? a.durationSec, avgHr: a.avgHr }, next.maxHr) : null;
      tx.update(activities).set({ tss: load.tss, tssMethod: load.method, vo2maxEst: vo2 }).where(eq(activities.id, a.id)).run();
    }
  });
}
