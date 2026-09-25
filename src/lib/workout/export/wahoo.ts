/**
 * Wahoo Cloud API plan file (plan.json).
 *
 * Format notes (verified against production integrations):
 *  - header.workout_type_family: 0 = cycling, 1 = running
 *  - header.workout_type_location: 0 = indoor, 1 = outdoor
 *  - relative targets use the header references (ftp, threshold_hr,
 *    threshold_speed) with fractional low/high values (0.9 = 90 %)
 *  - every non-repeat interval needs a non-empty targets array
 *  - repeat intervals encode the repetitions *after* the first pass
 *    (exit_trigger_value = count - 1)
 *  - the header description is required by the production validator
 *  - only time and distance exit triggers are supported
 */
import { stepSeconds, flattenSteps } from "../metrics";
import type { Step, StepKind, Thresholds, WorkoutStructure } from "../types";

export interface WahooPlanTarget {
  type: "rpm" | "rpe" | "watts" | "hr" | "speed" | "ftp" | "threshold_hr" | "max_hr" | "threshold_speed";
  low: number;
  high: number;
}

export interface WahooPlanInterval {
  name?: string;
  exit_trigger_type: "time" | "distance" | "repeat";
  exit_trigger_value: number;
  intensity_type?: "active" | "wu" | "cd" | "recover" | "rest";
  targets?: WahooPlanTarget[];
  intervals?: WahooPlanInterval[];
}

export interface WahooPlan {
  header: {
    name: string;
    version: "1.0.0";
    description: string;
    workout_type_family: 0 | 1;
    workout_type_location: 0 | 1;
    ftp?: number;
    threshold_hr?: number;
    threshold_speed?: number;
  };
  intervals: WahooPlanInterval[];
}

const INTENSITY: Record<StepKind, WahooPlanInterval["intensity_type"]> = {
  warmup: "wu",
  active: "active",
  recovery: "recover",
  rest: "rest",
  cooldown: "cd",
};

export class WahooUnsupportedError extends Error {}

/** Returns human-readable reasons why a workout cannot be sent to Wahoo, or [] if it can. */
export function wahooCompatibility(structure: WorkoutStructure): string[] {
  const issues: string[] = [];
  if (structure.sport === "strength") issues.push("Wahoo-Geräte unterstützen kein strukturiertes Krafttraining.");
  const flat = flattenSteps(structure.nodes);
  if (flat.some(({ step }) => step.duration.type === "open")) issues.push("Wahoo kennt keine Schritte mit Runden-Taste (offene Dauer).");
  if (flat.some(({ step }) => step.duration.type === "reps")) issues.push("Wahoo kennt keine Wiederholungs-Schritte.");
  return issues;
}

function r3(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function encodeWahooPlan(input: {
  name: string;
  description?: string;
  structure: WorkoutStructure;
  thresholds: Thresholds;
  indoor?: boolean;
}): WahooPlan {
  const { structure, thresholds: t } = input;
  const issues = wahooCompatibility(structure);
  if (issues.length) throw new WahooUnsupportedError(issues.join(" "));

  const refs: WahooPlan["header"] = {
    name: input.name.slice(0, 100),
    version: "1.0.0",
    description: (input.description?.trim() || input.name).slice(0, 5000),
    workout_type_family: structure.sport === "ride" ? 0 : 1,
    workout_type_location: input.indoor ? 0 : 1,
  };

  const interval = (s: Step): WahooPlanInterval => {
    const targets: WahooPlanTarget[] = [];
    switch (s.target.type) {
      case "power":
        refs.ftp = t.ftp;
        targets.push({ type: "ftp", low: r3(s.target.low / 100), high: r3(s.target.high / 100) });
        break;
      case "hr":
        refs.threshold_hr = t.lthr;
        targets.push({ type: "threshold_hr", low: r3(s.target.low / 100), high: r3(s.target.high / 100) });
        break;
      case "pace":
        refs.threshold_speed = r3(1000 / t.thresholdPace);
        targets.push({ type: "threshold_speed", low: r3(s.target.low / 100), high: r3(s.target.high / 100) });
        break;
      case "rpe":
        targets.push({ type: "rpe", low: s.target.value, high: s.target.value });
        break;
      case "none":
        break;
    }
    if (s.cadence) targets.push({ type: "rpm", low: s.cadence.low, high: s.cadence.high });
    // An untargeted interval keeps the full RPE domain so it imposes no constraint.
    if (targets.length === 0) targets.push({ type: "rpe", low: 1, high: 10 });

    const trigger =
      s.duration.type === "distance"
        ? { exit_trigger_type: "distance" as const, exit_trigger_value: s.duration.meters }
        : { exit_trigger_type: "time" as const, exit_trigger_value: s.duration.type === "time" ? s.duration.seconds : 0 };

    return {
      ...(s.name ? { name: s.name.slice(0, 60) } : {}),
      ...trigger,
      intensity_type: INTENSITY[s.kind],
      targets,
    };
  };

  const intervals: WahooPlanInterval[] = structure.nodes.map((node) =>
    node.type === "step"
      ? interval(node)
      : { exit_trigger_type: "repeat", exit_trigger_value: node.count - 1, intervals: node.steps.map(interval) },
  );

  return { header: refs, intervals };
}

/** Planned duration in whole minutes for the Wahoo workout record. */
export function wahooMinutes(structure: WorkoutStructure, t: Thresholds): number {
  const seconds = flattenSteps(structure.nodes).reduce((acc, { step }) => acc + stepSeconds(step, structure.sport, t), 0);
  return Math.max(1, Math.round(seconds / 60));
}
