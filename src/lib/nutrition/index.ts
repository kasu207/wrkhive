import { postTargets, preTargets } from "./pre-post";
import { buildSchedule } from "./schedule";
import { duringTargets } from "./targets";
import type { FuelPlan, FuelProduct, FuelProfile, SessionInput } from "./types";

export * from "./types";
export { CATALOG, DEFAULT_PANTRY, catalogProduct } from "./catalog";
export { progressionAdvice, type FuelLogEntry, type ProgressionAdvice } from "./progression";
export { estimateSweatRate, sweatRate, tempClassOf } from "./sweat";
export { sessionFromStructure } from "./workout";

/** Intensity presets for sessions without a structured workout. */
export const INTENSITY_PRESETS = [
  { value: "easy", label: "Locker", intensityFactor: 0.65 },
  { value: "moderate", label: "Mittel", intensityFactor: 0.75 },
  { value: "hard", label: "Hart", intensityFactor: 0.85 },
  { value: "race", label: "Wettkampf", intensityFactor: 0.9 },
] as const;

/** Complete plan: before, during (targets and timeline) and after. */
export function planFueling(input: SessionInput, profile: FuelProfile, pantry: FuelProduct[]): FuelPlan {
  const during = duringTargets(input, profile);
  return {
    input,
    pre: preTargets(input, profile),
    during,
    schedule: buildSchedule(input, during, pantry, profile),
    post: postTargets(input, profile, during),
  };
}
