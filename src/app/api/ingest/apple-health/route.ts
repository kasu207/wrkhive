import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { parseAutoExportPayload } from "@/lib/apple-health";
import { importAppleWorkouts, userByAppleHealthKey } from "@/lib/server/apple-health";
import { rateLimit } from "@/lib/server/rate-limit";

export const maxDuration = 120;

const MAX_BYTES = 50 * 1024 * 1024;

function keyOf(request: NextRequest): string {
  const header = request.headers.get("api-key") ?? request.headers.get("x-api-key");
  if (header) return header.trim();
  const auth = request.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

/**
 * Webhook for the iOS app "Health Auto Export" (REST API automation, JSON).
 * Authenticated with the per-user key from the devices page, sent as header
 * "api-key". Health metrics in the payload are ignored; only workouts count.
 */
export async function POST(request: NextRequest) {
  const key = keyOf(request);
  const limited = rateLimit(`apple-health:${key.slice(0, 16) || request.headers.get("x-forwarded-for") || "anon"}`, 120, 60 * 60_000);
  if (!limited.ok) return NextResponse.json({ error: "Zu viele Anfragen." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } });
  const user = key ? userByAppleHealthKey(key) : null;
  if (!user) return NextResponse.json({ error: "Ungültiger Schlüssel." }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return NextResponse.json({ error: "Zu groß. In Health Auto Export nur Workouts ohne Routen senden und Batch Requests aktivieren." }, { status: 413 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON. Exportformat JSON wählen." }, { status: 400 });
  }
  const { workouts, skipped, metricsOnly } = parseAutoExportPayload(json);
  const result = importAppleWorkouts(user, workouts);
  getDb().update(users).set({ appleHealthLastAt: new Date() }).where(eq(users.id, user.id)).run();
  return NextResponse.json({
    ok: true,
    workouts: workouts.length,
    inserted: result.inserted,
    updated: result.updated,
    merged: result.merged,
    skipped: skipped + result.skipped,
    ...(metricsOnly ? { note: "Keine Workouts im Paket. In der Automation den Datentyp Workouts wählen." } : {}),
  });
}
