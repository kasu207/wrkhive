/**
 * Canonical workout model.
 *
 * Intensities are stored relative to the athlete's thresholds (FTP, threshold
 * heart rate, threshold pace) so a workout stays portable between athletes and
 * keeps working when thresholds change. Absolute values are only resolved at
 * export time.
 */

export const SPORTS = ["ride", "run", "strength"] as const;
export type Sport = (typeof SPORTS)[number];

export const STEP_KINDS = ["warmup", "active", "recovery", "rest", "cooldown"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export type Duration =
  | { type: "time"; seconds: number }
  | { type: "distance"; meters: number }
  | { type: "reps"; reps: number }
  | { type: "open" };

/**
 * Primary intensity target.
 * - power: percent of FTP
 * - hr:    percent of threshold heart rate (LTHR)
 * - pace:  percent of threshold speed (100 = threshold pace, higher = faster)
 * - rpe:   perceived exertion 1-10
 */
export type Target =
  | { type: "none" }
  | { type: "power"; low: number; high: number }
  | { type: "hr"; low: number; high: number }
  | { type: "pace"; low: number; high: number }
  | { type: "rpe"; value: number };

export type TargetType = Target["type"];

export interface CadenceRange {
  low: number;
  high: number;
}

export interface Exercise {
  /** Key into the exercise catalog (see exercises.ts). */
  key: string;
  weightKg?: number;
}

export interface Step {
  id: string;
  type: "step";
  kind: StepKind;
  name?: string;
  duration: Duration;
  target: Target;
  cadence?: CadenceRange;
  exercise?: Exercise;
  notes?: string;
}

export interface Repeat {
  id: string;
  type: "repeat";
  count: number;
  steps: Step[];
}

export type WorkoutNode = Step | Repeat;

export interface WorkoutStructure {
  sport: Sport;
  nodes: WorkoutNode[];
}

/** Athlete thresholds used to resolve relative targets. */
export interface Thresholds {
  ftp: number; // watts
  lthr: number; // bpm
  maxHr: number; // bpm
  thresholdPace: number; // seconds per km
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  ftp: 230,
  lthr: 165,
  maxHr: 188,
  thresholdPace: 285, // 4:45 /km
};

export const SPORT_LABEL: Record<Sport, string> = {
  ride: "Rad",
  run: "Laufen",
  strength: "Kraft",
};

export const STEP_KIND_LABEL: Record<StepKind, string> = {
  warmup: "Aufwärmen",
  active: "Belastung",
  recovery: "Erholung",
  rest: "Pause",
  cooldown: "Cool-down",
};
