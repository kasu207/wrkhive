import { z } from "zod";
import { getExercise } from "./exercises";
import { SPORTS, STEP_KINDS, type WorkoutStructure } from "./types";

const pct = z.number().min(10).max(300);

const target = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("power"), low: pct, high: pct }),
  z.object({ type: z.literal("hr"), low: pct, high: pct }),
  z.object({ type: z.literal("pace"), low: pct, high: pct }),
  z.object({ type: z.literal("rpe"), value: z.number().int().min(1).max(10) }),
]);

const duration = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time"), seconds: z.number().int().min(1).max(12 * 3600) }),
  z.object({ type: z.literal("distance"), meters: z.number().int().min(1).max(300_000) }),
  z.object({ type: z.literal("reps"), reps: z.number().int().min(1).max(500) }),
  z.object({ type: z.literal("open") }),
]);

const step = z.object({
  id: z.string().min(1).max(40),
  type: z.literal("step"),
  kind: z.enum(STEP_KINDS),
  name: z.string().max(80).optional(),
  duration,
  target,
  cadence: z.object({ low: z.number().int().min(20).max(220), high: z.number().int().min(20).max(220) }).optional(),
  exercise: z
    .object({
      key: z.string().refine((k) => !!getExercise(k), "Unbekannte Übung"),
      weightKg: z.number().min(0).max(500).optional(),
    })
    .optional(),
  notes: z.string().max(300).optional(),
});

const repeat = z.object({
  id: z.string().min(1).max(40),
  type: z.literal("repeat"),
  count: z.number().int().min(1).max(99),
  steps: z.array(step).min(1).max(20),
});

export const workoutStructureSchema = z
  .object({
    sport: z.enum(SPORTS),
    nodes: z.array(z.discriminatedUnion("type", [step, repeat])).min(1).max(100),
  })
  .superRefine((w, ctx) => {
    const all = w.nodes.flatMap((n) => (n.type === "step" ? [n] : n.steps));
    for (const s of all) {
      if ("low" in s.target && s.target.low > s.target.high) {
        ctx.addIssue({ code: "custom", message: "Zielbereich: unterer Wert größer als oberer." });
      }
      if (s.cadence && s.cadence.low > s.cadence.high) {
        ctx.addIssue({ code: "custom", message: "Trittfrequenz: unterer Wert größer als oberer." });
      }
      if (s.duration.type === "reps" && w.sport !== "strength") {
        ctx.addIssue({ code: "custom", message: "Wiederholungen gibt es nur im Krafttraining." });
      }
      if (s.duration.type === "distance" && w.sport === "strength") {
        ctx.addIssue({ code: "custom", message: "Distanzen gibt es im Krafttraining nicht." });
      }
      if (s.target.type === "pace" && w.sport !== "run") {
        ctx.addIssue({ code: "custom", message: "Pace-Ziele gibt es nur beim Laufen." });
      }
    }
  });

export function parseStructure(value: unknown): WorkoutStructure {
  return workoutStructureSchema.parse(value) as WorkoutStructure;
}
