/**
 * FIT workout file encoder (Garmin FIT SDK).
 *
 * The resulting .fit file can be copied to a Garmin device (GARMIN/NewFiles),
 * imported in Garmin Connect, or loaded on other FIT-capable head units.
 *
 * Note: the FIT JavaScript SDK encoder ignores sub-fields, so all values are
 * written to the main fields in their raw representation:
 *   - duration time:      milliseconds
 *   - duration distance:  centimeters
 *   - custom power:       watts + 1000   (0..1000 would mean % FTP)
 *   - custom heart rate:  bpm + 100      (0..100 would mean % max HR)
 *   - custom speed:       m/s * 1000
 *   - repeat step:        durationValue = index of first repeated step,
 *                         targetValue   = total number of repetitions
 */
import { Encoder, Profile, type FileCreatorMesg, type FileIdMesg, type WorkoutMesg, type WorkoutStepMesg } from "@garmin/fitsdk";
import { getExercise } from "../exercises";
import { flattenSteps } from "../metrics";
import { resolveCadence, resolveTarget, type AbsoluteTarget } from "../resolve";
import type { Sport, Step, StepKind, Thresholds, WorkoutStructure } from "../types";

const INTENSITY: Record<StepKind, string> = {
  warmup: "warmup",
  active: "active",
  recovery: "recovery",
  rest: "rest",
  cooldown: "cooldown",
};

const FIT_SPORT: Record<Sport, { sport: string; subSport: string }> = {
  ride: { sport: "cycling", subSport: "generic" },
  run: { sport: "running", subSport: "generic" },
  strength: { sport: "training", subSport: "strengthTraining" },
};

/** Maximum lengths Garmin devices handle gracefully. */
const MAX_NAME = 32;
const MAX_NOTES = 120;

type Mesg = Record<string, unknown>;

function enumValue(typeName: string, name: string): number {
  const table = (Profile.types as Record<string, Record<string, string>>)[typeName];
  for (const [k, v] of Object.entries(table)) if (v === name) return Number(k);
  throw new Error(`Unknown FIT ${typeName} value: ${name}`);
}

function targetFields(target: AbsoluteTarget, prefix: "" | "secondary"): Mesg {
  const key = (name: string) => (prefix ? `secondary${name[0].toUpperCase()}${name.slice(1)}` : name);
  const set = (type: string, low: number, high: number): Mesg => ({
    [key("targetType")]: type,
    [key("targetValue")]: 0,
    [key("customTargetValueLow")]: Math.round(low),
    [key("customTargetValueHigh")]: Math.round(high),
  });
  switch (target.type) {
    case "power":
      return set("power", target.watts[0] + 1000, target.watts[1] + 1000);
    case "hr":
      return set("heartRate", target.bpm[0] + 100, target.bpm[1] + 100);
    case "pace":
      return set("speed", target.speed[0] * 1000, target.speed[1] * 1000);
    case "cadence":
      return set("cadence", target.rpm[0], target.rpm[1]);
    case "rpe":
    case "none":
      return prefix ? {} : { targetType: "open", targetValue: 0 };
  }
}

function durationFields(step: Step): Mesg {
  const d = step.duration;
  switch (d.type) {
    case "time":
      return { durationType: "time", durationValue: Math.round(d.seconds * 1000) };
    case "distance":
      return { durationType: "distance", durationValue: Math.round(d.meters * 100) };
    case "reps":
      return { durationType: "reps", durationValue: d.reps };
    case "open":
      return { durationType: "open", durationValue: 0 };
  }
}

function stepName(step: Step): string | undefined {
  const exercise = step.exercise ? getExercise(step.exercise.key) : undefined;
  const name = step.name ?? exercise?.label;
  return name ? name.slice(0, MAX_NAME) : undefined;
}

function stepNotes(step: Step): string | undefined {
  const parts: string[] = [];
  if (step.target.type === "rpe") parts.push(`RPE ${step.target.value}`);
  if (step.notes) parts.push(step.notes);
  const text = parts.join(" · ");
  return text ? text.slice(0, MAX_NOTES) : undefined;
}

function stepMesg(step: Step, index: number, t: Thresholds): Mesg {
  const primary = resolveTarget(step.target, t);
  const cadence = step.cadence ? resolveCadence(step.cadence) : null;
  const usesCadenceAsPrimary = cadence && (primary.type === "none" || primary.type === "rpe");

  const mesg: Mesg = {
    messageIndex: index,
    intensity: INTENSITY[step.kind],
    ...durationFields(step),
    ...targetFields(usesCadenceAsPrimary ? cadence : primary, ""),
  };
  if (cadence && !usesCadenceAsPrimary) Object.assign(mesg, targetFields(cadence, "secondary"));

  const name = stepName(step);
  if (name) mesg.wktStepName = name;
  const notes = stepNotes(step);
  if (notes) mesg.notes = notes;

  if (step.exercise) {
    const ex = getExercise(step.exercise.key);
    if (ex) {
      mesg.exerciseCategory = enumValue("exerciseCategory", ex.category);
      mesg.exerciseName = enumValue(`${ex.category}ExerciseName`, ex.name);
      if (step.exercise.weightKg !== undefined) {
        mesg.exerciseWeight = step.exercise.weightKg;
        mesg.weightDisplayUnit = enumValue("fitBaseUnit", "kilogram");
      }
    }
  }
  return mesg;
}

export interface FitWorkoutInput {
  name: string;
  description?: string;
  structure: WorkoutStructure;
  thresholds: Thresholds;
  createdAt?: Date;
}

export function encodeFitWorkout(input: FitWorkoutInput): Uint8Array {
  const { structure, thresholds } = input;
  const steps: Mesg[] = [];

  for (const node of structure.nodes) {
    if (node.type === "step") {
      steps.push(stepMesg(node, steps.length, thresholds));
      continue;
    }
    const first = steps.length;
    for (const s of node.steps) steps.push(stepMesg(s, steps.length, thresholds));
    steps.push({
      messageIndex: steps.length,
      durationType: "repeatUntilStepsCmplt",
      durationValue: first,
      targetType: "open",
      targetValue: node.count,
      intensity: "active",
    });
  }

  if (steps.length === 0) throw new Error("Workout has no steps");
  if (flattenSteps(structure.nodes).length === 0) throw new Error("Workout has no steps");

  const encoder = new Encoder();
  const created = input.createdAt ?? new Date();
  const fileId = {
    type: "workout",
    manufacturer: "development",
    product: 0,
    serialNumber: (created.getTime() / 1000) >>> 0,
    timeCreated: created,
  };
  encoder.onMesg(Profile.MesgNum.FILE_ID, fileId as unknown as FileIdMesg);
  encoder.onMesg(Profile.MesgNum.FILE_CREATOR, { softwareVersion: 100 } as FileCreatorMesg);

  const { sport, subSport } = FIT_SPORT[structure.sport];
  const workout: Mesg = {
    wktName: input.name.slice(0, MAX_NAME),
    sport,
    subSport,
    numValidSteps: steps.length,
  };
  if (input.description) workout.wktDescription = input.description.slice(0, MAX_NOTES);
  encoder.onMesg(Profile.MesgNum.WORKOUT, workout as unknown as WorkoutMesg);

  for (const s of steps) encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, s as unknown as WorkoutStepMesg);
  return encoder.close();
}
