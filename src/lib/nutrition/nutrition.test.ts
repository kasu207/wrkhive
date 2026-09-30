import { describe, expect, it } from "vitest";
import { CATALOG, DEFAULT_PANTRY, planFueling, progressionAdvice, sweatRate, tempClassOf } from ".";
import { estimateSweatRate } from "./sweat";
import { duringTargets } from "./targets";
import type { FuelProfile, FuelSegment, SessionInput } from "./types";

const PROFILE: FuelProfile = { weightKg: 70, weightKnown: true, maxCarbPerHour: 90, sweatSodium: "average", sweatSamples: [], caffeine: false, preferNatural: false };
const PANTRY = CATALOG.filter((p) => DEFAULT_PANTRY.includes(p.id));
const session = (over: Partial<SessionInput> = {}): SessionInput => ({ sport: "ride", durationSec: 7200, intensityFactor: 0.75, tempClass: "mild", flags: {}, ...over });

describe("carbohydrate during the session", () => {
  it("needs nothing below 45 minutes", () => {
    expect(duringTargets(session({ durationSec: 40 * 60, intensityFactor: 0.9 }), PROFILE).carbsPerHour).toBe(0);
  });
  it("needs nothing for an easy hour, a little for a hard one", () => {
    expect(duringTargets(session({ durationSec: 3600, intensityFactor: 0.65 }), PROFILE).carbsPerHour).toBe(0);
    expect(duringTargets(session({ durationSec: 3600, intensityFactor: 0.9 }), PROFILE).carbsPerHour).toBe(30);
  });
  it("scales 30-60 g/h with intensity up to 2.5 h", () => {
    expect(duringTargets(session({ intensityFactor: 0.6 }), PROFILE).carbsPerHour).toBe(30);
    expect(duringTargets(session({ intensityFactor: 0.75 }), PROFILE).carbsPerHour).toBe(50);
    expect(duringTargets(session({ intensityFactor: 0.95 }), PROFILE).carbsPerHour).toBe(60);
  });
  it("goes to 90 g/h in long races and beyond with a trained gut", () => {
    expect(duringTargets(session({ durationSec: 4 * 3600, flags: { race: true } }), PROFILE).carbsPerHour).toBe(90);
    expect(duringTargets(session({ durationSec: 5 * 3600, flags: { race: true } }), { ...PROFILE, maxCarbPerHour: 110 }).carbsPerHour).toBe(110);
  });
  it("caps at the athlete's gut tolerance", () => {
    const t = duringTargets(session({ durationSec: 4 * 3600, flags: { race: true } }), { ...PROFILE, maxCarbPerHour: 60 });
    expect(t.carbsPerHour).toBe(60);
    expect(t.rationale.join(" ")).toContain("Verträglichkeit");
  });
  it("gives runners less than cyclists", () => {
    const ride = duringTargets(session({ durationSec: 4 * 3600, flags: { race: true } }), PROFILE).carbsPerHour;
    const run = duringTargets(session({ sport: "run", durationSec: 4 * 3600, flags: { race: true } }), PROFILE).carbsPerHour;
    expect(run).toBeLessThan(ride);
    expect(run).toBeLessThanOrEqual(90);
  });
  it("respects train-low sessions and warns when they are hard", () => {
    const t = duringTargets(session({ intensityFactor: 0.85, flags: { fasted: true } }), PROFILE);
    expect(t.carbsPerHour).toBe(0);
    expect(t.warnings.length).toBeGreaterThan(0);
  });
  it("feeds only long strength sessions", () => {
    expect(duringTargets(session({ sport: "strength", durationSec: 3600 }), PROFILE).carbsPerHour).toBe(0);
  });
});

describe("fluid and sodium", () => {
  it("drinks to thirst in short, mild sessions", () => {
    const t = duringTargets(session({ durationSec: 45 * 60 }), PROFILE);
    expect(t.fluidToThirst).toBe(true);
    expect(t.fluidMlPerHour).toBe(0);
  });
  it("never plans more than 1 l/h, even in the heat", () => {
    const t = duringTargets(session({ sport: "run", intensityFactor: 0.9, tempClass: "hot" }), { ...PROFILE, weightKg: 90 });
    expect(t.fluidMlPerHour).toBe(1000);
    expect(t.rationale.join(" ")).toContain("Hyponatriämie");
  });
  it("drinks more in the heat than in the cold", () => {
    const cool = duringTargets(session({ tempClass: "cool" }), PROFILE).fluidMlPerHour;
    const warm = duringTargets(session({ tempClass: "warm" }), PROFILE).fluidMlPerHour;
    expect(warm).toBeGreaterThan(cool);
  });
  it("replaces sodium from 2 h on, more for salty sweaters", () => {
    expect(duringTargets(session({ durationSec: 90 * 60 }), PROFILE).sodiumMgPerHour).toBe(0);
    const avg = duringTargets(session({ durationSec: 3 * 3600 }), PROFILE).sodiumMgPerHour;
    const salty = duringTargets(session({ durationSec: 3 * 3600 }), { ...PROFILE, sweatSodium: "high" }).sodiumMgPerHour;
    expect(avg).toBeGreaterThan(0);
    expect(salty).toBeGreaterThan(avg);
  });
  it("prefers measured sweat rates", () => {
    const measured = estimateSweatRate("ride", 0.7, "mild", 70, [{ sport: "ride", tempClass: "mild", rateLh: 1.6 }]);
    expect(measured).toEqual({ rateLh: 1.6, measured: true });
    const scaled = estimateSweatRate("ride", 0.7, "hot", 70, [{ sport: "ride", tempClass: "mild", rateLh: 1 }]);
    expect(scaled.rateLh).toBe(1.5);
    expect(estimateSweatRate("run", 0.7, "mild", 70, [{ sport: "ride", tempClass: "mild", rateLh: 1.6 }]).measured).toBe(false);
  });
});

describe("sweat test", () => {
  it("computes the rate from weights, drinks and urine", () => {
    expect(sweatRate({ preKg: 72, postKg: 71, fluidMl: 500, durationSec: 3600 })).toBe(1.5);
    expect(sweatRate({ preKg: 72, postKg: 71, fluidMl: 500, urineMl: 300, durationSec: 5400 })).toBe(0.8);
  });
  it("rejects implausible values", () => {
    expect(sweatRate({ preKg: 72, postKg: 67, fluidMl: 0, durationSec: 3600 })).toBeNull();
    expect(sweatRate({ preKg: 72, postKg: 72, fluidMl: 0, durationSec: 3600 })).toBeNull();
    expect(sweatRate({ preKg: 72, postKg: 71, fluidMl: 0, durationSec: 600 })).toBeNull();
  });
  it("classifies temperatures", () => {
    expect([5, 15, 24, 30].map(tempClassOf)).toEqual(["cool", "mild", "warm", "hot"]);
  });
});

describe("schedule", () => {
  it("hits the carbohydrate target from the pantry", () => {
    const plan = planFueling(session({ durationSec: 3 * 3600, intensityFactor: 0.75 }), PROFILE, PANTRY);
    expect(plan.schedule.slots.length).toBeGreaterThanOrEqual(7);
    expect(plan.schedule.totals.carbsPerHour).toBeGreaterThanOrEqual(plan.during.carbsPerHour * 0.85);
    expect(plan.schedule.totals.carbsPerHour).toBeLessThanOrEqual(plan.during.carbsPerHour * 1.2);
    expect(plan.schedule.packing.length).toBeGreaterThan(0);
    // No intake in the last 15 minutes.
    expect(Math.max(...plan.schedule.slots.map((s) => s.atMin))).toBeLessThanOrEqual(165);
  });
  it("has no timeline for a short easy run", () => {
    expect(planFueling(session({ sport: "run", durationSec: 40 * 60 }), PROFILE, PANTRY).schedule.slots).toEqual([]);
  });
  it("moves intake out of hard intervals", () => {
    // 20 min warm-up, then 5x (4 min Z5, 4 min recovery), cool-down.
    const segments: FuelSegment[] = [{ start: 0, duration: 1200, zone: 2, kind: "warmup" }];
    let t = 1200;
    for (let i = 0; i < 5; i++) {
      segments.push({ start: t, duration: 240, zone: 5, kind: "active" }, { start: t + 240, duration: 240, zone: 1, kind: "recovery" });
      t += 480;
    }
    segments.push({ start: t, duration: 3600, zone: 2, kind: "cooldown" });
    const plan = planFueling(session({ durationSec: t + 3600, intensityFactor: 0.8, segments }), PROFILE, PANTRY);
    for (const s of plan.schedule.slots) {
      const seg = segments.find((x) => s.atMin * 60 >= x.start && s.atMin * 60 < x.start + x.duration)!;
      expect(seg.zone).toBeLessThan(4);
    }
    expect(plan.schedule.slots.some((s) => s.note?.includes("verschoben"))).toBe(true);
  });
  it("prefers gels when running and natural food when asked", () => {
    const run = planFueling(session({ sport: "run", durationSec: 2.5 * 3600, intensityFactor: 0.8 }), PROFILE, PANTRY);
    const kinds = run.schedule.slots.flatMap((s) => s.items).map((it) => CATALOG.find((p) => p.id === it.productId)!.kind);
    expect(kinds.filter((k) => k === "gel").length).toBeGreaterThan(kinds.filter((k) => k === "bar").length);
    const natural = planFueling(session({ durationSec: 3 * 3600 }), { ...PROFILE, preferNatural: true }, PANTRY);
    expect(natural.schedule.packing.some((p) => p.productId === "date" || p.productId === "banana")).toBe(true);
  });
  it("warns about single-source products above 60 g/h", () => {
    const glucoseOnly = CATALOG.filter((p) => p.id === "gel");
    const plan = planFueling(session({ durationSec: 4 * 3600, flags: { race: true } }), PROFILE, glucoseOnly);
    expect(plan.schedule.warnings.join(" ")).toContain("Glukose und Fruktose");
  });
  it("tops up sodium with salt tablets", () => {
    const plan = planFueling(session({ durationSec: 4 * 3600, tempClass: "hot" }), { ...PROFILE, sweatSodium: "high" }, PANTRY);
    expect(plan.schedule.packing.some((p) => p.productId === "salt-tab")).toBe(true);
    expect(plan.schedule.totals.sodiumMg).toBeGreaterThan(plan.during.sodiumMgPerHour * 4 * 0.7);
  });
  it("uses caffeine only in the second half of key sessions", () => {
    const pantry = [...PANTRY, CATALOG.find((p) => p.id === "gel-caffeine")!];
    const plain = planFueling(session({ durationSec: 4 * 3600 }), { ...PROFILE, caffeine: true }, pantry);
    expect(plain.schedule.totals.caffeineMg).toBe(0);
    const race = planFueling(session({ durationSec: 4 * 3600, flags: { race: true } }), { ...PROFILE, caffeine: true }, pantry);
    expect(race.pre.caffeineMg).toBe(210);
    const withCaffeine = race.schedule.slots.filter((s) => s.caffeineMg > 0);
    expect(withCaffeine.length).toBeGreaterThan(0);
    expect(withCaffeine.every((s) => s.atMin >= 120)).toBe(true);
    expect(race.pre.caffeineMg + race.schedule.totals.caffeineMg).toBeLessThanOrEqual(6 * 70);
  });
});

describe("before and after", () => {
  it("scales the pre-session meal with duration", () => {
    expect(planFueling(session({ durationSec: 40 * 60, intensityFactor: 0.6 }), PROFILE, PANTRY).pre.meal).toBeNull();
    expect(planFueling(session({ durationSec: 4 * 3600 }), PROFILE, PANTRY).pre.meal).toEqual({ carbsG: [140, 210], hoursBefore: [3, 4] });
  });
  it("suggests carbohydrate loading before long races only", () => {
    expect(planFueling(session({ durationSec: 3 * 3600, flags: { race: true } }), PROFILE, PANTRY).pre.loading?.carbsGPerDay).toEqual([700, 840]);
    expect(planFueling(session({ durationSec: 3 * 3600 }), PROFILE, PANTRY).pre.loading).toBeNull();
  });
  it("makes recovery urgent when the next session is close", () => {
    const soon = planFueling(session({ hoursToNextSession: 6 }), PROFILE, PANTRY).post;
    expect(soon.urgent).toBe(true);
    expect(soon.carbsG).toEqual([70, 85]);
    const later = planFueling(session({ hoursToNextSession: 24 }), PROFILE, PANTRY).post;
    expect(later.urgent).toBe(false);
    expect(later.proteinG).toBe(20);
  });
});

describe("gut training", () => {
  const log = (gutScore: number, carbsPerHour = 60, date = "2026-09-01") => ({ date, durationSec: 3 * 3600, targetCarbsPerHour: 60, carbsG: carbsPerHour * 3, gutScore });
  it("raises the tolerance after three good long sessions", () => {
    expect(progressionAdvice([log(1), log(2), log(1)], 60)).toMatchObject({ direction: "up", suggested: 70 });
  });
  it("holds when the target was not reached", () => {
    expect(progressionAdvice([log(1, 40), log(1), log(1)], 60).direction).toBe("hold");
  });
  it("lowers it after clear gut problems", () => {
    expect(progressionAdvice([log(4), log(1), log(1)], 70)).toMatchObject({ direction: "down", suggested: 60 });
  });
  it("ignores short sessions and stops at 120 g/h", () => {
    expect(progressionAdvice([{ ...log(1), durationSec: 3600 }], 60).direction).toBe("hold");
    expect(progressionAdvice([log(1, 120), log(1, 120), log(1, 120)], 120).direction).toBe("hold");
  });
});
