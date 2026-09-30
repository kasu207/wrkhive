import { profileSegments, summarize } from "@/lib/workout/metrics";
import type { Thresholds, WorkoutStructure } from "@/lib/workout/types";
import type { FuelSegment, SessionFlags, SessionInput, TempClass } from "./types";

/** Session input from a structured workout: duration, intensity and the timeline for slot placement. */
export function sessionFromStructure(
  structure: WorkoutStructure,
  thresholds: Thresholds,
  extra: { tempClass?: TempClass; flags?: SessionFlags; hoursToNextSession?: number | null } = {},
): SessionInput {
  const summary = summarize(structure, thresholds);
  const segments: FuelSegment[] = profileSegments(structure, thresholds).map((s) => ({ start: s.start, duration: s.duration, zone: s.zone, kind: s.step.kind }));
  return {
    sport: structure.sport,
    durationSec: summary.durationSec,
    intensityFactor: summary.intensityFactor,
    tempClass: extra.tempClass ?? "mild",
    flags: extra.flags ?? {},
    segments,
    hoursToNextSession: extra.hoursToNextSession ?? null,
  };
}
