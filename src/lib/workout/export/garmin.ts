/**
 * Garmin Connect Training API (Workout V2) payload.
 * POST https://apis.garmin.com/workoutportal/workout/v2
 */
import { getExercise, toUpperSnake } from "../exercises";
import { resolveCadence, resolveTarget, type AbsoluteTarget } from "../resolve";
import type { Sport, Step, StepKind, Thresholds, WorkoutStructure } from "../types";

type GarminTargetType = "POWER" | "HEART_RATE" | "PACE" | "SPEED" | "CADENCE" | "OPEN";

export interface GarminStep {
  type: "WorkoutStep";
  stepOrder: number;
  intensity: "REST" | "WARMUP" | "COOLDOWN" | "RECOVERY" | "ACTIVE";
  description: string;
  durationType: "TIME" | "DISTANCE" | "OPEN" | "REPS";
  durationValue: number | null;
  durationValueType: "METER" | null;
  targetType: GarminTargetType | null;
  targetValue: null;
  targetValueLow: number | null;
  targetValueHigh: number | null;
  targetValueType: null;
  secondaryTargetType: Exclude<GarminTargetType, "OPEN"> | null;
  secondaryTargetValue: null;
  secondaryTargetValueLow: number | null;
  secondaryTargetValueHigh: number | null;
  secondaryTargetValueType: null;
  exerciseCategory?: string;
  exerciseName?: string;
  weightValue?: number;
  weightDisplayUnit?: "KILOGRAM";
}

export interface GarminRepeatStep {
  type: "WorkoutRepeatStep";
  stepOrder: number;
  repeatType: "REPEAT_UNTIL_STEPS_CMPLT";
  repeatValue: number;
  skipLastRestStep: boolean;
  steps: GarminStep[];
}

export interface GarminWorkout {
  workoutName: string;
  description: string;
  sport: "CYCLING" | "RUNNING" | "STRENGTH_TRAINING";
  workoutProvider: string;
  workoutSourceId: string;
  isSessionTransitionEnabled: false;
  segments: [
    {
      segmentOrder: 1;
      sport: GarminWorkout["sport"];
      poolLength: null;
      poolLengthUnit: null;
      steps: (GarminStep | GarminRepeatStep)[];
    },
  ];
}

const SPORT: Record<Sport, GarminWorkout["sport"]> = { ride: "CYCLING", run: "RUNNING", strength: "STRENGTH_TRAINING" };

const INTENSITY: Record<StepKind, GarminStep["intensity"]> = {
  warmup: "WARMUP",
  active: "ACTIVE",
  recovery: "RECOVERY",
  rest: "REST",
  cooldown: "COOLDOWN",
};

function range(target: AbsoluteTarget): { type: Exclude<GarminTargetType, "OPEN">; low: number; high: number } | null {
  switch (target.type) {
    case "power":
      return { type: "POWER", low: target.watts[0], high: target.watts[1] };
    case "hr":
      return { type: "HEART_RATE", low: target.bpm[0], high: target.bpm[1] };
    case "pace":
      return { type: "PACE", low: target.speed[0], high: target.speed[1] };
    case "cadence":
      return { type: "CADENCE", low: target.rpm[0], high: target.rpm[1] };
    default:
      return null;
  }
}

function step(s: Step, order: number, t: Thresholds): GarminStep {
  const primary = range(resolveTarget(s.target, t));
  const cadence = s.cadence ? range(resolveCadence(s.cadence)) : null;
  const main = primary ?? cadence;
  const secondary = primary ? cadence : null;

  const d = s.duration;
  const duration: Pick<GarminStep, "durationType" | "durationValue" | "durationValueType"> =
    d.type === "time"
      ? { durationType: "TIME", durationValue: d.seconds, durationValueType: null }
      : d.type === "distance"
        ? { durationType: "DISTANCE", durationValue: d.meters, durationValueType: "METER" }
        : d.type === "reps"
          ? { durationType: "REPS", durationValue: d.reps, durationValueType: null }
          : { durationType: "OPEN", durationValue: null, durationValueType: null };

  const descriptionParts = [s.name, s.target.type === "rpe" ? `RPE ${s.target.value}` : undefined, s.notes].filter(Boolean);

  const out: GarminStep = {
    type: "WorkoutStep",
    stepOrder: order,
    intensity: INTENSITY[s.kind],
    description: descriptionParts.join(" · ").slice(0, 512),
    ...duration,
    targetType: main?.type ?? "OPEN",
    targetValue: null,
    targetValueLow: main?.low ?? null,
    targetValueHigh: main?.high ?? null,
    targetValueType: null,
    secondaryTargetType: secondary?.type ?? null,
    secondaryTargetValue: null,
    secondaryTargetValueLow: secondary?.low ?? null,
    secondaryTargetValueHigh: secondary?.high ?? null,
    secondaryTargetValueType: null,
  };

  if (s.exercise) {
    const ex = getExercise(s.exercise.key);
    if (ex) {
      out.exerciseCategory = toUpperSnake(ex.category);
      out.exerciseName = toUpperSnake(ex.name);
      if (s.exercise.weightKg !== undefined) {
        out.weightValue = s.exercise.weightKg;
        out.weightDisplayUnit = "KILOGRAM";
      }
    }
  }
  return out;
}

export function encodeGarminWorkout(input: {
  name: string;
  description?: string;
  structure: WorkoutStructure;
  thresholds: Thresholds;
}): GarminWorkout {
  const { structure, thresholds } = input;
  let order = 0;
  const steps = structure.nodes.map((node) => {
    order += 1;
    if (node.type === "step") return step(node, order, thresholds);
    const repeatOrder = order;
    const children = node.steps.map((s) => {
      order += 1;
      return step(s, order, thresholds);
    });
    return {
      type: "WorkoutRepeatStep" as const,
      stepOrder: repeatOrder,
      repeatType: "REPEAT_UNTIL_STEPS_CMPLT" as const,
      repeatValue: node.count,
      skipLastRestStep: false,
      steps: children,
    };
  });

  const sport = SPORT[structure.sport];
  return {
    workoutName: input.name.slice(0, 80),
    description: (input.description ?? "").slice(0, 1024),
    sport,
    workoutProvider: "Wrkhive",
    workoutSourceId: "Wrkhive",
    isSessionTransitionEnabled: false,
    segments: [{ segmentOrder: 1, sport, poolLength: null, poolLengthUnit: null, steps }],
  };
}
