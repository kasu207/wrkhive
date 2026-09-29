import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { bestOf, decoupling, distanceBests, estimateFtp, powerBests } from "./bests";
import { consistency, efficiencyChange, efficiencyPoints, intensitySplit, isSteadyAerobic, type EfficiencyInput } from "./quality";
import { readinessFromPmc, withRecovery, type Readiness } from "./readiness";
import { checkThresholds, usesDefaults } from "./threshold-check";
import { hrvTrend, metricTrend, recoveryFrom, type WellnessDay } from "./wellness";

const TODAY = "2026-09-29";
const day = (offset: number, v: Partial<WellnessDay>): WellnessDay => ({
  date: addDays(TODAY, offset),
  restingHr: null,
  hrv: null,
  hrvSdnn: null,
  sleepSec: null,
  weightKg: null,
  legs: null,
  sleepFeel: null,
  motivation: null,
  ...v,
});
/** 60 days of stable values with a small daily wobble, optionally a different last week. */
const history = (base: Partial<WellnessDay>, lastWeek?: Partial<WellnessDay>) =>
  Array.from({ length: 60 }, (_, i) => {
    const offset = i - 59;
    const wobble = i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0;
    const v: Partial<WellnessDay> = {};
    for (const [k, val] of Object.entries(base)) (v as Record<string, number>)[k] = (val as number) + wobble * ((val as number) * 0.03);
    return day(offset, offset > -7 && lastWeek ? lastWeek : v);
  });

describe("best efforts", () => {
  it("finds the highest rolling power per duration", () => {
    const power = [...Array(600).fill(150), ...Array(300).fill(300), ...Array(600).fill(150)];
    power[100] = 900;
    const b = powerBests(power, [1, 60, 300, 1200])!;
    expect(b["1"]).toBe(900);
    expect(b["300"]).toBe(300);
    expect(b["60"]).toBe(300);
    expect(b["1200"]).toBeGreaterThan(150);
    expect(powerBests(Array(100).fill(0))).toBeNull();
    // Durations longer than the ride are left out.
    expect(powerBests(Array(100).fill(200), [60, 300])).toEqual({ "60": 200 });
  });

  it("finds the fastest time over a distance", () => {
    // 3 m/s for 10 minutes, then 5 m/s for 10 minutes.
    const distance: number[] = [];
    let d = 0;
    for (let s = 0; s < 1200; s++) {
      d += s < 600 ? 3 : 5;
      distance.push(d);
    }
    const b = distanceBests(distance, [1000, 3000, 5000])!;
    expect(b["1000"]).toBe(200);
    expect(b["3000"]).toBe(600);
    // 4.8 km in total: no 5 km best.
    expect(b["5000"]).toBeUndefined();
    expect(distanceBests([0, 10, 20], [1000])).toBeNull();
  });

  it("measures aerobic decoupling between the two halves", () => {
    const power = Array(3600).fill(200);
    const steady = Array(3600).fill(140);
    const drifting = Array.from({ length: 3600 }, (_, i) => (i < 1800 ? 140 : 154));
    expect(decoupling(power, steady)).toBe(0);
    expect(decoupling(power, drifting)).toBeCloseTo(9.1, 1);
    expect(decoupling(power.slice(0, 600), steady.slice(0, 600))).toBeNull();
    expect(decoupling(power, Array(3600).fill(null))).toBeNull();
  });

  it("combines activities and estimates FTP from the curve", () => {
    const best = bestOf(
      [
        { id: "a", date: "2026-09-01", bests: { power: { "1200": 260 } } },
        { id: "b", date: "2026-09-10", bests: { power: { "1200": 280, "3600": 250 } } },
        { id: "c", date: "2026-09-12", bests: null },
      ],
      "power",
    );
    expect(best["1200"]).toMatchObject({ value: 280, activityId: "b" });
    expect(estimateFtp(best)).toBe(266);
    expect(bestOf([{ id: "r", date: "2026-09-01", bests: { pace: { "5000": 1500 } } }, { id: "s", date: "2026-09-02", bests: { pace: { "5000": 1450 } } }], "pace")["5000"].value).toBe(1450);
  });
});

describe("daily health values", () => {
  it("judges the 7-day average against the personal normal range", () => {
    const normal = metricTrend(history({ restingHr: 50 }), "restingHr", TODAY);
    expect(normal.baseline!.n).toBe(60);
    expect(normal.status).toBe("normal");
    const elevated = metricTrend(history({ restingHr: 50 }, { restingHr: 57 }), "restingHr", TODAY);
    expect(elevated.status).toBe("high");
    expect(metricTrend(history({ restingHr: 50 }).slice(-10), "restingHr", TODAY).baseline).toBeNull();
  });

  it("uses rMSSD when present and never mixes it with SDNN", () => {
    const sdnnOnly = history({ hrvSdnn: 45 });
    expect(hrvTrend(sdnnOnly, TODAY).metric).toBe("hrvSdnn");
    const both = history({ hrvSdnn: 45, hrv: 60 });
    expect(hrvTrend(both, TODAY).metric).toBe("hrv");
    expect(hrvTrend(both, TODAY).baseline!.mean).toBeGreaterThan(55);
  });

  it("combines only the signals the athlete has", () => {
    expect(recoveryFrom([], TODAY)).toBeNull();
    const fine = recoveryFrom(history({ restingHr: 50, hrv: 60 }), TODAY)!;
    expect(fine.level).toBe("normal");
    expect(fine.signals.map((s) => s.key)).toEqual(["hrv", "restingHr"]);

    const tired = recoveryFrom(history({ restingHr: 50, hrv: 60 }, { restingHr: 57, hrv: 42 }), TODAY)!;
    expect(tired.level).toBe("impaired");
    expect(tired.reasons.join(", ")).toContain("Ruhepuls erhöht");

    // Without a wearable: the check-in alone.
    const checkin = recoveryFrom([day(0, { legs: 1, sleepFeel: 2, motivation: 2 })], TODAY)!;
    expect(checkin.level).toBe("slightly");
    // Short sleep counts even before a normal range exists.
    const short = recoveryFrom([day(-2, { sleepSec: 5 * 3600 }), day(-1, { sleepSec: 5.5 * 3600 }), day(0, { sleepSec: 5 * 3600 })], TODAY)!;
    expect(short.signals[0]).toMatchObject({ key: "sleep", state: "negative" });
  });

  it("reduces hard sessions when recovery is impaired although the load says keep", () => {
    const pmc = Array.from({ length: 14 }, (_, i) => ({ date: addDays(TODAY, i - 13), tss: 60, ctl: 60, atl: 60, tsb: 0 }));
    const base = readinessFromPmc(pmc)!;
    expect(base.mode).toBe("keep");
    const tired = recoveryFrom(history({ restingHr: 50, hrv: 60 }, { restingHr: 57, hrv: 42 }), TODAY);
    const r = withRecovery(base, tired) as Readiness;
    expect(r.mode).toBe("reduce");
    expect(r.advice).toContain("HRV");
    expect(withRecovery(base, recoveryFrom(history({ restingHr: 50 }), TODAY))).toBe(base);
    expect(withRecovery(null, tired)).toBeNull();
  });
});

describe("training quality", () => {
  it("splits time into low, moderate and high intensity", () => {
    const s = intensitySplit([{ hrZoneSec: [600, 2400, 300, 300, 0] }, { hrZoneSec: [0, 0, 0, 0, 600] }, { hrZoneSec: null }]);
    expect(s).toEqual({ low: 3000, mid: 600, high: 600, sessions: 2 });
  });

  it("counts weeks in a row that reached the goal", () => {
    // Monday 2026-09-28 is the running week.
    const dates = ["2026-09-28", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-08"];
    const c = consistency(dates, TODAY, 3);
    expect(c.streak).toBe(2);
    expect(c.weeks.at(-1)).toMatchObject({ sessions: 1, met: false, current: true });
    expect(consistency([...dates, "2026-09-29", "2026-09-29"], TODAY, 3).streak).toBe(3);
  });

  it("tracks efficiency only for steady aerobic sessions", () => {
    const base: EfficiencyInput = { id: "x", date: "2026-09-01", name: "Grundlage", sport: "ride", durationSec: 5400, movingSec: 5400, avgHr: 130, avgPower: 180, normPower: 190, avgSpeed: null, hrZoneSec: [1000, 4000, 300, 100, 0], decouplingPct: 3 };
    expect(isSteadyAerobic(base, 165)).toBe(true);
    expect(isSteadyAerobic({ ...base, hrZoneSec: [500, 500, 1000, 2000, 1400] }, 165)).toBe(false);
    expect(isSteadyAerobic({ ...base, movingSec: 1800 }, 165)).toBe(false);
    const points = efficiencyPoints(
      [
        { ...base, id: "a", date: "2026-08-10", avgHr: 140 },
        { ...base, id: "b", date: "2026-08-20", avgHr: 138 },
        { ...base, id: "c", date: "2026-09-15", avgHr: 130 },
        { ...base, id: "d", date: "2026-09-20", avgHr: 128 },
        { ...base, id: "e", date: "2026-09-21", sport: "run", avgSpeed: 3 },
      ],
      "ride",
      165,
    );
    expect(points.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(points[0].ef).toBeCloseTo(190 / 140, 3);
    expect(efficiencyChange(points, TODAY)!.pct).toBeGreaterThan(5);
  });
});

describe("threshold check", () => {
  const t = { ftp: 230, lthr: 165, maxHr: 188, restHr: 52 };
  const act = (v: Partial<{ sport: string; durationSec: number; maxHr: number; avgHr: number; normPower: number }>) => ({ sport: "ride", date: "2026-09-01", durationSec: 3600, movingSec: null, avgHr: null, maxHr: null, normPower: null, ...v });

  it("needs two sessions before raising the maximum heart rate", () => {
    expect(checkThresholds(t, { activities: [act({ maxHr: 199 })], ftpFromCurve: null, restingHr: [] })).toEqual([]);
    const s = checkThresholds(t, { activities: [act({ maxHr: 199 }), act({ maxHr: 195 }), act({ maxHr: 240 })], ftpFromCurve: null, restingHr: [] });
    expect(s).toMatchObject([{ field: "maxHr", suggested: 195 }]);
  });

  it("raises FTP from the power curve or a long ride above it", () => {
    expect(checkThresholds(t, { activities: [], ftpFromCurve: 262, restingHr: [] })).toMatchObject([{ field: "ftp", suggested: 262 }]);
    expect(checkThresholds(t, { activities: [act({ normPower: 245, durationSec: 4000 })], ftpFromCurve: null, restingHr: [] })[0]).toMatchObject({ field: "ftp", suggested: 245 });
    expect(checkThresholds(t, { activities: [], ftpFromCurve: 234, restingHr: [] })).toEqual([]);
  });

  it("follows the measured resting heart rate both ways", () => {
    expect(checkThresholds(t, { activities: [], ftpFromCurve: null, restingHr: [46, 47, 45, 46, 48, 46, 47] })).toMatchObject([{ field: "restHr", suggested: 46 }]);
    expect(checkThresholds(t, { activities: [], ftpFromCurve: null, restingHr: [52, 53, 51] })).toEqual([]);
    expect(usesDefaults(t)).toBe(true);
    expect(usesDefaults({ ...t, ftp: 250 })).toBe(false);
  });
});
