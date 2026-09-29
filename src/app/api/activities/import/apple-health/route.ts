import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { appleDailySchema, appleWorkoutSchema, importAppleDaily, importAppleWorkouts } from "@/lib/server/apple-health";
import { getCurrentUser } from "@/lib/server/auth";

export const maxDuration = 120;

/** Largest batch the browser sends; the export is split client-side. */
const MAX_WORKOUTS = 1000;
const MAX_DAYS = 1000;

const body = z.object({ workouts: z.array(appleWorkoutSchema).max(MAX_WORKOUTS).default([]), daily: z.array(appleDailySchema).max(MAX_DAYS).default([]) });

/**
 * Receives the workouts and daily health values the browser extracted from an
 * Apple Health export (see lib/apple-health.ts). The export itself is never uploaded.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Workout-Daten." }, { status: 400 });
  return NextResponse.json({ ...importAppleWorkouts(user, parsed.data.workouts), days: importAppleDaily(user, parsed.data.daily) });
}
