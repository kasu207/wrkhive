import { describe, expect, it } from "vitest";
import type { PmcPoint } from "../analytics/load";
import { readinessFromPmc } from "../analytics/readiness";
import { adaptWorkout, isHardSession } from "./adapt";
import { summarize } from "./metrics";
import { parseWorkoutText } from "./text";
import type { Repeat, Step, Thresholds } from "./types";

const T: Thresholds = { ftp: 250, lthr: 170, maxHr: 190, thresholdPace: 300 };
const parse = (text: string, sport: "ride" | "run" | "strength" = "ride") => {
  const r = parseWorkoutText(text, sport, T);
  expect(r.errors).toEqual([]);
  return r.structure;
};

function pmc(ctlWeekAgo: number, ctl: number, tsb: number): PmcPoint[] {
  return Array.from({ length: 8 }, (_, i) => {
    const c = ctlWeekAgo + ((ctl - ctlWeekAgo) * i) / 7;
    return { date: `2026-05-${String(i + 1).padStart(2, "0")}`, tss: 50, ctl: c, atl: c - tsb, tsb: i === 7 ? tsb : 0 };
  });
}

describe("readiness", () => {
  it("scales form with fitness", () => {
    expect(readinessFromPmc(pmc(60, 60, 10))?.level).toBe("fresh");
    expect(readinessFromPmc(pmc(60, 60, -15))?.level).toBe("productive");
    expect(readinessFromPmc(pmc(60, 60, -20))?.level).toBe("strained");
    expect(readinessFromPmc(pmc(60, 60, -30))?.level).toBe("overreached");
    // Same TSB is harmless for a very fit athlete.
    expect(readinessFromPmc(pmc(100, 100, -20))?.level).toBe("productive");
  });
  it("uses a CTL floor for beginners", () => {
    expect(readinessFromPmc(pmc(5, 5, -5))?.formPct).toBe(-25);
  });
  it("flags a steep ramp", () => {
    const r = readinessFromPmc(pmc(50, 62, -15))!;
    expect(r.ramp).toBe(12);
    expect(r.level).toBe("strained");
    expect(r.mode).toBe("reduce");
  });
  it("handles an empty chart", () => {
    expect(readinessFromPmc([])).toBeNull();
  });
});

describe("workout adaptation", () => {
  const vo2 = () => parse("15min 50-70%, 5x (4min 110-118%, 4min 50%), 10min 50%");

  it("leaves easy sessions alone", () => {
    const easy = parse("10min 55%, 60min 65-72%, 5min 50%");
    expect(isHardSession(easy, T)).toBe(false);
    expect(adaptWorkout(easy, "reduce", T)).toBeNull();
    expect(adaptWorkout(vo2(), "keep", T)).toBeNull();
  });

  it("reduces sets and hard targets, keeps warm-up and cool-down", () => {
    const w = vo2();
    const a = adaptWorkout(w, "reduce", T)!;
    const rep = a.structure.nodes[1] as Repeat;
    expect(rep.count).toBe(4);
    expect(rep.steps[0].target).toEqual({ type: "power", low: 105, high: 112 });
    expect(rep.steps[1].target).toEqual({ type: "power", low: 50, high: 50 });
    expect((a.structure.nodes[0] as Step).target).toEqual((w.nodes[0] as Step).target);
    expect(summarize(a.structure, T).tss).toBeLessThan(summarize(w, T).tss);
    expect(a.note).toMatch(/Wiederholungen/);
    expect(a.note).toMatch(/TSS/);
    // New ids: the adapted copy never shares step ids with the original.
    expect(rep.id).not.toBe((w.nodes[1] as Repeat).id);
  });

  it("shortens long blocks that cannot lose a set", () => {
    const a = adaptWorkout(parse("10min 60%, 2x (20min 88-94%, 5min 55%), 10min 50%"), "reduce", T)!;
    const rep = a.structure.nodes[1] as Repeat;
    expect(rep.count).toBe(2);
    expect(rep.steps[0].duration).toEqual({ type: "time", seconds: 900 });
    expect(rep.steps[0].target).toEqual({ type: "power", low: 84, high: 89 });
  });

  it("replaces a hard session with an easy one when overreached", () => {
    const a = adaptWorkout(vo2(), "recover", T)!;
    expect(a.structure.nodes).toHaveLength(3);
    const s = summarize(a.structure, T);
    expect(s.durationSec).toBeGreaterThanOrEqual(30 * 60);
    expect(s.durationSec).toBeLessThanOrEqual(60 * 60);
    expect(s.intensityFactor).toBeLessThan(0.7);
    const run = adaptWorkout(parse("2km Z2, 6x (800m 105%, 2min Pause), 2km Z1", "run"), "recover", T)!;
    expect((run.structure.nodes[1] as Step).target.type).toBe("pace");
  });

  it("halves strength sets when overreached and drops one when strained", () => {
    const w = parse("4x6 Kniebeuge (Langhantel) 60kg Pause 2min\n3x10 Liegestütz", "strength");
    expect((adaptWorkout(w, "recover", T)!.structure.nodes[0] as Repeat).count).toBe(2);
    expect((adaptWorkout(w, "reduce", T)!.structure.nodes[0] as Repeat).count).toBe(3);
  });
});
