/**
 * Training goals the athlete sets in the profile. The main goal (first in
 * the list) steers the rule-based coach and the plan generator; all goals go
 * to the AI coach as context.
 */
import type { Focus } from "./coach/generator";

export const GOALS = {
  muscle: { label: "Muskelaufbau", description: "Kraft und Muskelmasse, Ausdauer als Ergänzung." },
  endurance: { label: "Ausdauer verbessern", description: "Aerobe Basis, länger und leichter unterwegs sein." },
  performance: { label: "Wettkampf und Leistung", description: "Schneller werden, gezielt auf Rennen hin." },
  weight: { label: "Gewicht reduzieren", description: "Viel lockerer Umfang, Kraft erhält die Muskulatur." },
  health: { label: "Fit und gesund bleiben", description: "Regelmäßig, abwechslungsreich, ohne Überlastung." },
} as const;

export type GoalId = keyof typeof GOALS;

export const GOAL_IDS = Object.keys(GOALS) as GoalId[];

export const MAX_GOALS = 3;

/** Valid goals in stored order, main goal first. */
export function goalsOf(raw: unknown): GoalId[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((g): g is GoalId => typeof g === "string" && g in GOALS))].slice(0, MAX_GOALS);
}

/**
 * Adjusts a focus the coach picked from the form (not one the athlete asked
 * for) to the main goal: gentler for health, more aerobic for weight loss,
 * sharper for performance.
 */
export function focusForGoal(focus: Focus, goals: GoalId[]): Focus {
  switch (goals[0]) {
    case "health":
      return focus === "vo2" || focus === "anaerobic" || focus === "threshold" ? "tempo" : focus;
    case "weight":
      return focus === "anaerobic" ? "endurance" : focus === "vo2" ? "threshold" : focus;
    case "endurance":
      return focus === "anaerobic" ? "vo2" : focus;
    case "performance":
      return focus === "tempo" ? "threshold" : focus;
    default:
      return focus;
  }
}

/** Default session length in minutes when the athlete gives none. */
export function defaultMinutes(goals: GoalId[]): number {
  return goals[0] === "weight" || goals[0] === "endurance" ? 75 : 60;
}

/** Whether new plans include strength training by default. */
export function wantsStrength(goals: GoalId[]): boolean {
  return !goals.length || goals.some((g) => g === "muscle" || g === "weight" || g === "health");
}

/** One line for the coach's context. */
export function goalContext(goals: GoalId[], note: string | null | undefined): string | null {
  if (!goals.length && !note) return null;
  const parts = goals.map((g, i) => `${GOALS[g].label}${i === 0 ? " (Hauptziel)" : ""}`);
  return `Trainingsziele: ${parts.length ? parts.join(", ") : "keine gewählt"}${note ? `; in eigenen Worten: „${note}“` : ""}`;
}
