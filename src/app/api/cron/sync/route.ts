import { eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { deviceConnections } from "@/db/schema";
import { env } from "@/lib/server/env";
import { syncConnection } from "@/lib/server/sync";

/**
 * Periodic pull for connections with continuous sync enabled. Call from any
 * scheduler (cron, systemd timer, Vercel cron) with `Authorization: Bearer $CRON_SECRET`.
 * Webhooks deliver new activities in real time; this is the safety net.
 */
export async function GET(request: NextRequest) {
  const secret = env.cronSecret();
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const conns = getDb().select().from(deviceConnections).where(eq(deviceConnections.autoSync, true)).all();
  const results = [];
  for (const c of conns) {
    if (c.status === "revoked") continue;
    const r = await syncConnection(c);
    results.push({ id: c.id, provider: c.provider, ok: r.ok, inserted: r.inserted });
  }
  return NextResponse.json({ synced: results.length, results });
}
