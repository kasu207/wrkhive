import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe used by the Docker health check. */
export function GET() {
  try {
    getDb().run(sql`select 1`);
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    return NextResponse.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
