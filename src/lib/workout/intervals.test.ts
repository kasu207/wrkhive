import { describe, expect, it } from "vitest";
import { encodeIntervalsWorkout, intervalsCompatibility, intervalsMovingTime } from "./export/intervals";
import { parseWorkoutText } from "./text";
import { ergCheck, ergHints } from "./trainer";
import type { Thresholds, WorkoutStructure } from "./types";

const T: Thresholds = { ftp: 250, lthr: 170, maxHr: 190, thresholdPace: 300 };

function parse(text: string, sport: "ride" | "run" | "strength" = "ride"): WorkoutStructure {
  const r = parseWorkoutText(text, sport, T);
  expect(r.errors).toEqual([]);
  return r.structure;
}

describe("intervals.icu workout text", () => {
  it("encodes warmup, repeats and cooldown as sections", () => {
    const text = encodeIntervalsWorkout(parse("10min 50-65%, 5x (3min 110%, 2min 55%), 10min 50%"));
    expect(text).toBe(["Warmup", "- 10m 50-65%", "", "5x", "- 3m 110%", "- 2m 55%", "", "Cooldown", "- 10m 50%", ""].join("\n"));
  });

  it("writes seconds, metres, kilometres, heart rate, pace and cadence without ambiguity", () => {
    const ride = parse("15min GA1\n4x 45s 150% 100-110rpm / 90s Pause\n10min KB");
    const text = encodeIntervalsWorkout(ride);
    expect(text).toContain("- 45s 150% 100-110rpm");
    expect(text).toContain("- 90s");
    const run = encodeIntervalsWorkout(parse("2km locker, 6x (800m 105-110% Pace, 400m locker), 2km locker", "run"));
    expect(run).toContain("- 800mtr 105-110% Pace");
    expect(run).toContain("- 2km");
    // "m" alone would mean minutes: distances must never be written like that.
    expect(run).not.toMatch(/\d+m(?!tr)\b/);
    const hr = encodeIntervalsWorkout(parse("30min 80-88% LTHR", "run"));
    expect(hr).toContain("- 30m 80-88% LTHR");
  });

  it("never emits digits or keywords in cue text", () => {
    const w: WorkoutStructure = {
      sport: "ride",
      nodes: [{ id: "a", type: "step", kind: "active", name: "Ramp 5m Z2 Block", duration: { type: "time", seconds: 300 }, target: { type: "power", low: 90, high: 90 } }],
    };
    expect(encodeIntervalsWorkout(w)).toBe("- 5m 90% Block\n");
  });

  it("maps RPE to words and leaves untargeted steps free", () => {
    const w: WorkoutStructure = {
      sport: "run",
      nodes: [
        { id: "a", type: "step", kind: "active", duration: { type: "time", seconds: 600 }, target: { type: "rpe", value: 7 } },
        { id: "b", type: "step", kind: "rest", duration: { type: "time", seconds: 120 }, target: { type: "none" } },
      ],
    };
    expect(encodeIntervalsWorkout(w)).toBe("- 10m hart\n- 2m\n");
  });

  it("rejects strength and lap-button steps", () => {
    expect(intervalsCompatibility({ sport: "strength", nodes: [] })).toHaveLength(1);
    const open: WorkoutStructure = { sport: "ride", nodes: [{ id: "a", type: "step", kind: "active", duration: { type: "open" }, target: { type: "none" } }] };
    expect(intervalsCompatibility(open)).toHaveLength(1);
    expect(() => encodeIntervalsWorkout(open)).toThrow();
  });

  it("estimates moving time", () => {
    expect(intervalsMovingTime(parse("10min 60%, 3x (5min 100%, 5min 50%)"), T)).toBe(40 * 60);
  });
});

describe("ERG suitability", () => {
  it("accepts a pure power workout", () => {
    expect(ergHints(parse("10min 60%, 3x (8min 95-100%, 4min 55%), 10min 50%"))).toEqual([]);
  });
  it("flags steps without power, short hard efforts and distance steps", () => {
    const w = parse("10min GA1\n6x 20s 170% / 2min 50%\n20min 75% LTHR");
    const c = ergCheck(w);
    expect(c.withoutPower).toBe(1);
    expect(c.shortEfforts).toBe(1);
    expect(ergHints(w)).toHaveLength(2);
  });
  it("only applies to rides", () => {
    expect(ergHints(parse("30min 80% LTHR", "run"))).toEqual([]);
  });
});
