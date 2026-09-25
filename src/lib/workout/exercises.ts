/**
 * Strength exercise catalog.
 *
 * `category` and `name` are FIT SDK profile identifiers (camelCase). They map
 * 1:1 to the FIT `exercise_category` / `<category>_exercise_name` enums and to
 * Garmin Training API values (UPPER_SNAKE_CASE), so devices show the exercise
 * with its animation and count reps automatically.
 */
export interface ExerciseDef {
  key: string;
  label: string;
  group: ExerciseGroup;
  category: string;
  name: string;
  /** Whether a load (kg) is typically used. */
  weighted: boolean;
}

export type ExerciseGroup = "Beine" | "Hüfte" | "Brust" | "Rücken" | "Schultern" | "Arme" | "Rumpf" | "Ganzkörper";

export const EXERCISES: ExerciseDef[] = [
  // Beine
  { key: "back-squat", label: "Kniebeuge (Langhantel)", group: "Beine", category: "squat", name: "barbellBackSquat", weighted: true },
  { key: "front-squat", label: "Frontkniebeuge", group: "Beine", category: "squat", name: "barbellFrontSquat", weighted: true },
  { key: "goblet-squat", label: "Goblet Squat", group: "Beine", category: "squat", name: "gobletSquat", weighted: true },
  { key: "air-squat", label: "Kniebeuge (Körpergewicht)", group: "Beine", category: "squat", name: "airSquat", weighted: false },
  { key: "split-squat", label: "Split Squat (Kurzhantel)", group: "Beine", category: "squat", name: "dumbbellSplitSquat", weighted: true },
  { key: "step-up", label: "Step-up", group: "Beine", category: "squat", name: "dumbbellStepUp", weighted: true },
  { key: "leg-press", label: "Beinpresse", group: "Beine", category: "squat", name: "legPress", weighted: true },
  { key: "lunge", label: "Ausfallschritt", group: "Beine", category: "lunge", name: "dumbbellLunge", weighted: true },
  { key: "walking-lunge", label: "Walking Lunge", group: "Beine", category: "lunge", name: "walkingLunge", weighted: false },
  { key: "leg-curl", label: "Beinbeuger", group: "Beine", category: "legCurl", name: "legCurl", weighted: true },
  { key: "calf-raise", label: "Wadenheben", group: "Beine", category: "calfRaise", name: "standingCalfRaise", weighted: true },
  // Hüfte
  { key: "deadlift", label: "Kreuzheben", group: "Hüfte", category: "deadlift", name: "barbellDeadlift", weighted: true },
  { key: "romanian-deadlift", label: "Rumänisches Kreuzheben", group: "Hüfte", category: "deadlift", name: "romanianDeadlift", weighted: true },
  { key: "single-leg-rdl", label: "Einbeiniges Kreuzheben", group: "Hüfte", category: "deadlift", name: "singleLegRomanianDeadliftWithDumbbell", weighted: true },
  { key: "hip-thrust", label: "Hip Thrust", group: "Hüfte", category: "hipRaise", name: "barbellHipThrustWithBench", weighted: true },
  { key: "glute-bridge", label: "Glute Bridge", group: "Hüfte", category: "hipRaise", name: "hipRaise", weighted: false },
  { key: "kettlebell-swing", label: "Kettlebell Swing", group: "Hüfte", category: "hipRaise", name: "kettlebellSwing", weighted: true },
  { key: "good-morning", label: "Good Morning", group: "Hüfte", category: "legCurl", name: "goodMorning", weighted: true },
  // Brust
  { key: "bench-press", label: "Bankdrücken (Langhantel)", group: "Brust", category: "benchPress", name: "barbellBenchPress", weighted: true },
  { key: "db-bench-press", label: "Bankdrücken (Kurzhantel)", group: "Brust", category: "benchPress", name: "dumbbellBenchPress", weighted: true },
  { key: "incline-bench", label: "Schrägbankdrücken", group: "Brust", category: "benchPress", name: "inclineDumbbellBenchPress", weighted: true },
  { key: "push-up", label: "Liegestütz", group: "Brust", category: "pushUp", name: "pushUp", weighted: false },
  { key: "dumbbell-flye", label: "Fliegende (Kurzhantel)", group: "Brust", category: "flye", name: "dumbbellFlye", weighted: true },
  // Rücken
  { key: "pull-up", label: "Klimmzug", group: "Rücken", category: "pullUp", name: "pullUp", weighted: false },
  { key: "chin-up", label: "Klimmzug (Untergriff)", group: "Rücken", category: "pullUp", name: "chinUp", weighted: false },
  { key: "lat-pulldown", label: "Latzug", group: "Rücken", category: "pullUp", name: "latPulldown", weighted: true },
  { key: "barbell-row", label: "Rudern (Langhantel)", group: "Rücken", category: "row", name: "barbellRow", weighted: true },
  { key: "dumbbell-row", label: "Rudern (Kurzhantel)", group: "Rücken", category: "row", name: "dumbbellRow", weighted: true },
  { key: "cable-row", label: "Rudern am Kabel", group: "Rücken", category: "row", name: "seatedCableRow", weighted: true },
  { key: "face-pull", label: "Face Pull", group: "Rücken", category: "row", name: "facePull", weighted: true },
  // Schultern
  { key: "overhead-press", label: "Schulterdrücken (Langhantel)", group: "Schultern", category: "shoulderPress", name: "overheadBarbellPress", weighted: true },
  { key: "db-shoulder-press", label: "Schulterdrücken (Kurzhantel)", group: "Schultern", category: "shoulderPress", name: "dumbbellShoulderPress", weighted: true },
  { key: "lateral-raise", label: "Seitheben", group: "Schultern", category: "lateralRaise", name: "dumbbellLateralRaise", weighted: true },
  // Arme
  { key: "biceps-curl", label: "Bizepscurl", group: "Arme", category: "curl", name: "dumbbellBicepsCurl", weighted: true },
  { key: "triceps-pushdown", label: "Trizepsdrücken am Kabel", group: "Arme", category: "tricepsExtension", name: "tricepsPressdown", weighted: true },
  { key: "dip", label: "Dips", group: "Arme", category: "tricepsExtension", name: "bodyWeightDip", weighted: false },
  // Rumpf
  { key: "plank", label: "Unterarmstütz", group: "Rumpf", category: "plank", name: "plank", weighted: false },
  { key: "side-plank", label: "Seitstütz", group: "Rumpf", category: "plank", name: "sidePlank", weighted: false },
  { key: "mountain-climber", label: "Mountain Climber", group: "Rumpf", category: "plank", name: "mountainClimber", weighted: false },
  { key: "dead-bug", label: "Dead Bug", group: "Rumpf", category: "hipStability", name: "deadBug", weighted: false },
  { key: "hanging-leg-raise", label: "Beinheben hängend", group: "Rumpf", category: "legRaise", name: "hangingLegRaise", weighted: false },
  { key: "russian-twist", label: "Russian Twist", group: "Rumpf", category: "core", name: "russianTwist", weighted: true },
  { key: "crunch", label: "Crunch", group: "Rumpf", category: "crunch", name: "crunch", weighted: false },
  // Ganzkörper
  { key: "burpee", label: "Burpee", group: "Ganzkörper", category: "totalBody", name: "burpee", weighted: false },
  { key: "box-jump", label: "Box Jump", group: "Ganzkörper", category: "plyo", name: "boxJump", weighted: false },
  { key: "jump-squat", label: "Sprungkniebeuge", group: "Ganzkörper", category: "plyo", name: "jumpSquat", weighted: false },
  { key: "farmers-carry", label: "Farmer's Walk", group: "Ganzkörper", category: "carry", name: "farmersWalk", weighted: true },
  { key: "power-clean", label: "Power Clean", group: "Ganzkörper", category: "olympicLift", name: "barbellPowerClean", weighted: true },
  { key: "wall-ball", label: "Wall Ball", group: "Ganzkörper", category: "squat", name: "wallBall", weighted: true },
  { key: "jump-rope", label: "Seilspringen", group: "Ganzkörper", category: "cardio", name: "jumpRope", weighted: false },
];

const BY_KEY = new Map(EXERCISES.map((e) => [e.key, e]));

export function getExercise(key: string): ExerciseDef | undefined {
  return BY_KEY.get(key);
}

export const EXERCISE_GROUPS: ExerciseGroup[] = ["Beine", "Hüfte", "Brust", "Rücken", "Schultern", "Arme", "Rumpf", "Ganzkörper"];

/** camelCase FIT identifier -> Garmin Training API UPPER_SNAKE_CASE. */
export function toUpperSnake(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/** Fuzzy lookup by label or key, used by the text parser and the AI coach. */
export function findExercise(query: string): ExerciseDef | undefined {
  const q = normalize(query);
  if (!q) return undefined;
  const exact = EXERCISES.find((e) => normalize(e.label) === q || e.key === q.replace(/\s+/g, "-"));
  if (exact) return exact;
  return EXERCISES.find((e) => normalize(e.label).startsWith(q)) ?? EXERCISES.find((e) => normalize(e.label).includes(q));
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
