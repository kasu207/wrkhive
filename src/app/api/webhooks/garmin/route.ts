import { and, eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { deviceConnections, users, type DeviceConnection } from "@/db/schema";
import { env } from "@/lib/server/env";
import { fetchGarminCallback, normalizeGarminActivity, type GarminActivitySummary } from "@/lib/server/providers/garmin";
import { accessTokenFor, upsertActivities } from "@/lib/server/sync";

/**
 * Garmin Health/Activity API notifications. Configure this URL (with
 * ?token=$GARMIN_WEBHOOK_TOKEN) in the Garmin developer portal for "Activities" (push or ping), "Deregistrations" and
 * "User Permissions Change". Garmin expects a fast 200 response.
 */
type Ping = { userId: string; callbackURL: string };
type ActivityItem = GarminActivitySummary | Ping;

function connectionFor(garminUserId: string): DeviceConnection | undefined {
  return getDb()
    .select()
    .from(deviceConnections)
    .where(and(eq(deviceConnections.provider, "garmin"), eq(deviceConnections.externalUserId, garminUserId)))
    .get();
}

export async function POST(request: NextRequest) {
  // Garmin does not sign notifications: require a secret token in the
  // configured callback URL (…/api/webhooks/garmin?token=…).
  const expected = env.garmin().webhookToken;
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!expected || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const db = getDb();

  for (const d of (body.deregistrations as { userId: string }[] | undefined) ?? []) {
    db.update(deviceConnections)
      .set({ status: "revoked", statusMessage: "Verbindung wurde in Garmin Connect getrennt." })
      .where(and(eq(deviceConnections.provider, "garmin"), eq(deviceConnections.externalUserId, d.userId)))
      .run();
  }

  const items = [...((body.activities as ActivityItem[] | undefined) ?? []), ...((body.manuallyUpdatedActivities as ActivityItem[] | undefined) ?? [])];
  const byUser = new Map<string, ActivityItem[]>();
  for (const item of items) {
    if (!item.userId) continue;
    byUser.set(item.userId, [...(byUser.get(item.userId) ?? []), item]);
  }

  for (const [garminUserId, list] of byUser) {
    const conn = connectionFor(garminUserId);
    if (!conn || conn.status === "revoked") continue;
    const user = db.select().from(users).where(eq(users.id, conn.userId)).get();
    if (!user) continue;
    try {
      const summaries: GarminActivitySummary[] = [];
      for (const item of list) {
        if ("callbackURL" in item && item.callbackURL) {
          summaries.push(...(await fetchGarminCallback(item.callbackURL, await accessTokenFor(conn))));
        } else if ("summaryId" in item) {
          summaries.push(item);
        }
      }
      upsertActivities(user, conn, summaries.map(normalizeGarminActivity));
      db.update(deviceConnections).set({ lastSyncAt: new Date() }).where(eq(deviceConnections.id, conn.id)).run();
    } catch (e) {
      console.error("[garmin] webhook processing failed", e);
    }
  }
  return NextResponse.json({ ok: true });
}
