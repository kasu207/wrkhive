/**
 * Smart-trainer (ERG) suitability of a ride workout. A head unit such as a
 * Wahoo ELEMNT drives the trainer in ERG mode from the power targets of a
 * planned workout; steps without a power target leave the trainer without
 * resistance control, and very short efforts are over before the trainer has
 * settled on the new load.
 */
import { flattenSteps } from "./metrics";
import type { WorkoutStructure } from "./types";

/**
 * Hard efforts up to this length ride poorly in ERG mode: trainers need 5-15 s
 * to settle on a new load, so the effort starts too light and the drop into
 * the recovery releases the resistance while the legs still spin fast.
 */
export const ERG_MIN_EFFORT_SECONDS = 60;

export interface ErgCheck {
  /** Steps (counted once, not per repeat) without a power target. */
  withoutPower: number;
  /** Hard power steps (above threshold) of at most ERG_MIN_EFFORT_SECONDS. */
  shortEfforts: number;
  /** Distance-based steps: they end by distance, which on a trainer is virtual speed. */
  distanceSteps: number;
}

export function ergCheck(structure: WorkoutStructure): ErgCheck {
  const steps = new Map(flattenSteps(structure.nodes).map(({ step }) => [step.id, step]));
  let withoutPower = 0;
  let shortEfforts = 0;
  let distanceSteps = 0;
  for (const s of steps.values()) {
    if (s.target.type !== "power") withoutPower++;
    else if (s.duration.type === "time" && s.duration.seconds <= ERG_MIN_EFFORT_SECONDS && s.target.high >= 106) shortEfforts++;
    if (s.duration.type === "distance") distanceSteps++;
  }
  return { withoutPower, shortEfforts, distanceSteps };
}

/** Human-readable hints for riding the workout on a smart trainer, or [] if it is ERG ready. */
export function ergHints(structure: WorkoutStructure): string[] {
  if (structure.sport !== "ride") return [];
  const c = ergCheck(structure);
  const hints: string[] = [];
  if (c.withoutPower) {
    hints.push(
      c.withoutPower === 1
        ? "Ein Schritt hat kein Leistungsziel. Dort steuert der Radcomputer den Rollentrainer nicht (kein ERG)."
        : `${c.withoutPower} Schritte haben kein Leistungsziel. Dort steuert der Radcomputer den Rollentrainer nicht (kein ERG).`,
    );
  }
  if (c.shortEfforts) {
    hints.push(
      "Kurze harte Intervalle (bis 1 Minute) regelt ein Rollentrainer im ERG-Modus verzögert: Der Widerstand baut sich erst nach einigen Sekunden auf und fällt zur Erholung abrupt ab, bei hoher Trittfrequenz tritt man dann kurz ins Leere. Kleines Kettenblatt und ein mittleres bis großes Ritzel fahren, die Trittfrequenz zum Intervallende langsam senken und für Sprints ERG am Radcomputer pausieren.",
    );
  }
  if (c.distanceSteps) hints.push("Schritte nach Distanz enden auf der Rolle nach virtueller Geschwindigkeit. Für ERG-Training besser Zeitangaben verwenden.");
  return hints;
}
