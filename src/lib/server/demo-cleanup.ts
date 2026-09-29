import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, deliveries, deviceConnections, users, wellness } from "@/db/schema";
import { demoEnabled } from "./access";

/**
 * Removes sample data from real accounts on installations with the demo
 * switched off. Earlier versions created a demo connection when a provider
 * had no API credentials ("Mit Garmin verbinden" on a personal server); it
 * generated sample training every day, so fitness and form never reflected
 * the athlete's real load or rest.
 *
 * Real sessions that were merged into a sample record are restored by
 * re-reading the full history of the athlete's live connections.
 */
export function purgeStrayDemoData(): { users: number; connections: number; activities: number } {
  const none = { users: 0, connections: 0, activities: 0 };
  if (demoEnabled()) return none;
  const db = getDb();
  const conns = db
    .select({ id: deviceConnections.id, userId: deviceConnections.userId, provider: deviceConnections.provider })
    .from(deviceConnections)
    .innerJoin(users, eq(users.id, deviceConnections.userId))
    .where(and(eq(deviceConnections.mode, "demo"), eq(users.isDemo, false)))
    .all();
  const sampleOwners = db
    .selectDistinct({ userId: activities.userId })
    .from(activities)
    .innerJoin(users, eq(users.id, activities.userId))
    .where(and(eq(activities.sourceApp, "demo"), eq(users.isDemo, false)))
    .all()
    .map((r) => r.userId);
  const userIds = [...new Set([...conns.map((c) => c.userId), ...sampleOwners])];
  if (!userIds.length) return none;

  let removed = 0;
  db.transaction((tx) => {
    for (const userId of userIds) {
      const mine = conns.filter((c) => c.userId === userId);
      const ids = mine.map((c) => c.id);
      removed += tx
        .delete(activities)
        .where(and(eq(activities.userId, userId), ids.length ? or(eq(activities.sourceApp, "demo"), inArray(activities.connectionId, ids)) : eq(activities.sourceApp, "demo")))
        .run().changes;
      tx.delete(wellness).where(and(eq(wellness.userId, userId), eq(wellness.source, "demo"))).run();
      for (const c of mine) tx.delete(deliveries).where(and(eq(deliveries.userId, userId), eq(deliveries.provider, c.provider))).run();
      if (ids.length) tx.delete(deviceConnections).where(inArray(deviceConnections.id, ids)).run();
      tx.update(deviceConnections).set({ lastSyncAt: null }).where(and(eq(deviceConnections.userId, userId), eq(deviceConnections.mode, "live"))).run();
    }
  });
  return { users: userIds.length, connections: conns.length, activities: removed };
}
