import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/server/env";
import { syncAllConnections } from "@/lib/server/scheduler";

/**
 * Manual / external trigger for the periodic pull. The server also runs this
 * on its own schedule (see scheduler.ts). Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = env.cronSecret();
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const results = await syncAllConnections();
  return NextResponse.json({ synced: results.length, results: results.map(({ id, provider, ok, inserted }) => ({ id, provider, ok, inserted })) });
}
