import { and, eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { deviceConnections, users } from "@/db/schema";
import { env } from "@/lib/server/env";
import { normalizeWahooWorkout } from "@/lib/server/providers/wahoo";
import { upsertActivities } from "@/lib/server/sync";

/**
 * Wahoo workout_summary webhook. Requires the offline_data scope. Wahoo retries
 * non-200 deliveries, so we acknowledge everything we can parse and verify.
 */
export async function POST(request: NextRequest) {
  const expected = env.wahoo().webhookToken;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const token = typeof body.webhook_token === "string" ? body.webhook_token : "";
  if (!expected || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const event = body.event_type ?? body.event;
  if (event !== "workout_summary") return NextResponse.json({ ok: true });

  const wahooUserId = String((body.user as { id?: number } | undefined)?.id ?? "");
  const summary = body.workout_summary as (Record<string, unknown> & { workout?: Record<string, unknown> }) | undefined;
  if (!wahooUserId || !summary?.workout) return NextResponse.json({ ok: true });

  const db = getDb();
  const conn = db
    .select()
    .from(deviceConnections)
    .where(and(eq(deviceConnections.provider, "wahoo"), eq(deviceConnections.externalUserId, wahooUserId)))
    .get();
  if (!conn || !conn.autoSync) return NextResponse.json({ ok: true });
  const user = db.select().from(users).where(eq(users.id, conn.userId)).get();
  if (!user) return NextResponse.json({ ok: true });

  const w = summary.workout as { id: number; starts: string; minutes?: number; name?: string; workout_type_id: number };
  const activity = normalizeWahooWorkout({ ...w, workout_summary: summary });
  if (activity) upsertActivities(user, conn, [activity]);
  return NextResponse.json({ ok: true });
}
