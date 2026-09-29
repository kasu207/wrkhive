import { describe, expect, it } from "vitest";
import { summarize } from "../workout/metrics";
import { parseStructure } from "../workout/schema";
import { generatePlan, generateWorkout, interpretRequest, planPhases, type Focus } from "./generator";

const T = { ftp: 250, lthr: 170, maxHr: 190, thresholdPace: 300 };

describe("workout generator", () => {
  const foci: Focus[] = ["recovery", "endurance", "tempo", "threshold", "vo2", "anaerobic"];
  for (const sport of ["ride", "run"] as const) {
    for (const focus of foci) {
      for (const minutes of [30, 45, 60, 90, 150]) {
        it(`${sport} ${focus} ${minutes}min is valid and close to the requested length`, () => {
          const w = generateWorkout(sport, focus, minutes, T);
          expect(() => parseStructure(w.structure)).not.toThrow();
          const s = summarize(w.structure, T);
          const tolerance = focus === "anaerobic" || focus === "vo2" ? 0.35 : 0.2;
          expect(Math.abs(s.durationSec / 60 - Math.max(20, minutes)) / minutes).toBeLessThanOrEqual(tolerance);
        });
      }
    }
  }
});

describe("request interpretation", () => {
  it("reads sport, duration and focus", () => {
    expect(interpretRequest("Gib mir 45 Minuten Intervalle auf der Rolle")).toEqual({ sport: "ride", minutes: 45, focus: "vo2" });
    expect(interpretRequest("1,5h lockerer Lauf")).toMatchObject({ sport: "run", minutes: 90, focus: "endurance" });
    expect(interpretRequest("Kraft für die Beine")).toMatchObject({ sport: "strength", focus: "strength-legs" });
  });
});

describe("plan generator", () => {
  it("builds a periodized plan ending on the event", () => {
    const plan = generatePlan(
      { goal: "Halbmarathon", sport: "run", eventDate: "2026-12-06", weeks: 0, hoursPerWeek: 5, trainingDays: [1, 3, 5, 6], longDay: 6, strength: true, startDate: "2026-09-28" },
      T,
    );
    expect(plan.startDate).toBe("2026-09-28");
    expect(plan.endDate).toBe("2026-12-06");
    expect(plan.weeks[plan.weeks.length - 1].phase).toBe("race");
    expect(plan.weeks.some((w) => w.phase === "recovery")).toBe(true);
    const last = plan.weeks[plan.weeks.length - 1];
    expect(last.sessions[last.sessions.length - 1].name).toBe("Halbmarathon");
    for (const w of plan.weeks) for (const s of w.sessions) expect(() => parseStructure(s.structure)).not.toThrow();
    // No session after the event
    for (const w of plan.weeks) expect(w.startDate <= "2026-12-06").toBe(true);
  });

  it("uses 3:1 loading", () => {
    expect(planPhases(12, false)).toEqual(["base", "base", "base", "recovery", "base", "build", "build", "recovery", "build", "build", "build", "build"]);
  });

  it("mixed plans alternate sports", () => {
    const plan = generatePlan({ goal: "", sport: "mixed", eventDate: null, weeks: 4, hoursPerWeek: 8, trainingDays: [1, 2, 3, 5, 6], longDay: 5, strength: false, startDate: "2026-09-28" }, T);
    const sports = new Set(plan.weeks.flatMap((w) => w.sessions.map((s) => s.sport)));
    expect(sports.has("ride")).toBe(true);
    expect(sports.has("run")).toBe(true);
  });

  it("follows the athlete's goals", () => {
    const base = { goal: "", sport: "ride" as const, eventDate: null, weeks: 8, hoursPerWeek: 7, trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 6, strength: true, startDate: "2026-09-28" };
    const count = (plan: ReturnType<typeof generatePlan>, pred: (name: string, sport: string) => boolean) => plan.weeks.flatMap((w) => w.sessions).filter((s) => pred(s.name, s.sport)).length;
    const plain = generatePlan(base, T);
    const muscle = generatePlan({ ...base, goals: ["muscle"] }, T);
    expect(count(muscle, (_, sport) => sport === "strength")).toBeGreaterThan(count(plain, (_, sport) => sport === "strength"));
    const health = generatePlan({ ...base, goals: ["health"] }, T);
    expect(count(plain, (name) => name.startsWith("VO2max"))).toBeGreaterThan(0);
    expect(count(health, (name) => name.startsWith("VO2max"))).toBe(0);
  });
});

describe("goals", async () => {
  const { focusForGoal, goalsOf, wantsStrength, goalContext } = await import("../goals");
  it("reads stored goals and steers the focus", () => {
    expect(goalsOf(["weight", "bogus", "weight", "muscle"])).toEqual(["weight", "muscle"]);
    expect(goalsOf(null)).toEqual([]);
    expect(focusForGoal("vo2", ["health"])).toBe("tempo");
    expect(focusForGoal("vo2", ["weight"])).toBe("threshold");
    expect(focusForGoal("tempo", ["performance"])).toBe("threshold");
    expect(focusForGoal("vo2", [])).toBe("vo2");
    expect(wantsStrength(["performance"])).toBe(false);
    expect(wantsStrength([])).toBe(true);
    expect(goalContext(["muscle", "endurance"], "Klimmzüge schaffen")).toBe("Trainingsziele: Muskelaufbau (Hauptziel), Ausdauer verbessern; in eigenen Worten: „Klimmzüge schaffen“");
  });
});
