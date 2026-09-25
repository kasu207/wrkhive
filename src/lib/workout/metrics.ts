import type { Duration, Sport, Step, Thresholds, WorkoutNode, WorkoutStructure } from "./types";
import { relativeIntensity, targetZone, type ZoneIndex } from "./zones";

/** Assumed length of a lap-button ("open") step for estimates. */
const OPEN_STEP_SECONDS = 300;
/** Assumed seconds per repetition for strength sets. */
const SECONDS_PER_REP = 3;

/** Flatten repeats into the linear sequence the athlete actually performs. */
export function flattenSteps(nodes: WorkoutNode[]): { step: Step; round?: number; of?: number }[] {
  const out: { step: Step; round?: number; of?: number }[] = [];
  for (const node of nodes) {
    if (node.type === "step") {
      out.push({ step: node });
    } else {
      for (let r = 1; r <= node.count; r++) {
        for (const s of node.steps) out.push({ step: s, round: r, of: node.count });
      }
    }
  }
  return out;
}

/** Estimated speed in m/s for a step (used to convert distance <-> time). */
export function estimateSpeed(step: Step, sport: Sport, t: Thresholds): number {
  const intensity = Math.max(0.3, relativeIntensity(step.target, step.kind) || 0.5);
  if (sport === "run") {
    const thresholdSpeed = 1000 / t.thresholdPace;
    if (step.target.type === "pace") return thresholdSpeed * ((step.target.low + step.target.high) / 200);
    // Rough mapping from relative intensity to running speed.
    return thresholdSpeed * Math.min(1.2, 0.55 + 0.45 * intensity);
  }
  if (sport === "ride") {
    // Aerodynamic drag dominates: speed ~ cube root of power. 8.3 m/s (30 km/h) at 75 % FTP.
    return 8.3 * Math.cbrt(intensity / 0.75);
  }
  return 1;
}

export function stepSeconds(step: Step, sport: Sport, t: Thresholds): number {
  return durationSeconds(step.duration, step, sport, t);
}

function durationSeconds(d: Duration, step: Step, sport: Sport, t: Thresholds): number {
  switch (d.type) {
    case "time":
      return d.seconds;
    case "distance":
      return d.meters / estimateSpeed(step, sport, t);
    case "reps":
      return d.reps * SECONDS_PER_REP;
    case "open":
      return OPEN_STEP_SECONDS;
  }
}

export function stepMeters(step: Step, sport: Sport, t: Thresholds): number {
  if (sport === "strength") return 0;
  if (step.duration.type === "distance") return step.duration.meters;
  if (step.kind === "rest") return 0;
  return stepSeconds(step, sport, t) * estimateSpeed(step, sport, t);
}

export interface WorkoutSummary {
  durationSec: number;
  distanceM: number;
  /** Training Stress Score estimate (TSS / rTSS / hrTSS-equivalent). */
  tss: number;
  /** Intensity factor (normalized intensity relative to threshold). */
  intensityFactor: number;
  /** True when any step is open or distance based, i.e. numbers are estimates. */
  estimated: boolean;
  stepCount: number;
  /** Seconds spent per zone 1..7. */
  zoneSeconds: Record<ZoneIndex, number>;
  /** Strength: total sets and reps. */
  sets: number;
  reps: number;
}

export function summarize(structure: WorkoutStructure, t: Thresholds): WorkoutSummary {
  const flat = flattenSteps(structure.nodes);
  let total = 0;
  let meters = 0;
  let weighted4 = 0;
  let estimated = false;
  let sets = 0;
  let reps = 0;
  const zoneSeconds: Record<ZoneIndex, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };

  for (const { step } of flat) {
    const sec = stepSeconds(step, structure.sport, t);
    total += sec;
    meters += stepMeters(step, structure.sport, t);
    if (step.duration.type === "open" || step.duration.type === "distance") estimated = true;
    if (step.duration.type === "reps") {
      sets += 1;
      reps += step.duration.reps;
    }
    let intensity = relativeIntensity(step.target, step.kind);
    if (structure.sport === "strength" && step.exercise) {
      // Strength work: moderate systemic load independent of the (absent) target.
      intensity = Math.max(intensity, 0.75);
    }
    weighted4 += sec * intensity ** 4;
    zoneSeconds[targetZone(step.target, step.kind)] += sec;
  }

  // Normalized intensity: 4th-power mean, the same idea as Normalized Power.
  const intensityFactor = total > 0 ? (weighted4 / total) ** 0.25 : 0;
  const tss = (total / 3600) * intensityFactor ** 2 * 100;

  return {
    durationSec: Math.round(total),
    distanceM: Math.round(meters),
    tss: Math.round(tss),
    intensityFactor: Math.round(intensityFactor * 100) / 100,
    estimated,
    stepCount: flat.length,
    zoneSeconds,
    sets,
    reps,
  };
}

/** Segments for the workout profile chart. */
export interface ProfileSegment {
  stepId: string;
  start: number;
  duration: number;
  /** Bar height, relative intensity (fraction of threshold). */
  low: number;
  high: number;
  zone: ZoneIndex;
  step: Step;
  round?: number;
  of?: number;
}

export function profileSegments(structure: WorkoutStructure, t: Thresholds): ProfileSegment[] {
  const out: ProfileSegment[] = [];
  let cursor = 0;
  for (const { step, round, of } of flattenSteps(structure.nodes)) {
    const duration = Math.max(1, stepSeconds(step, structure.sport, t));
    let low: number;
    let high: number;
    if (step.target.type === "power" || step.target.type === "pace") {
      low = step.target.low / 100;
      high = step.target.high / 100;
    } else {
      const i = relativeIntensity(step.target, step.kind);
      const base = structure.sport === "strength" && step.exercise ? 0.75 : i;
      low = high = step.kind === "rest" ? 0.12 : Math.max(0.2, base);
    }
    out.push({ stepId: step.id, start: cursor, duration, low, high, zone: targetZone(step.target, step.kind), step, round, of });
    cursor += duration;
  }
  return out;
}
