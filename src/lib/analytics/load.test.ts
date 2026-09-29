import { describe, expect, it } from "vitest";
import { activityLoad, baselineDailyLoad, cyclingVo2max, effectiveVo2max, performanceChart, predictRaceTime } from "./load";

const M = { ftp: 250, lthr: 170, maxHr: 190, restHr: 50, thresholdPace: 300 };

describe("activity load", () => {
  it("1 h at FTP is 100 TSS", () => {
    expect(activityLoad({ sport: "ride", durationSec: 3600, normPower: 250 }, M).tss).toBe(100);
  });
  it("1 h at threshold pace is 100 rTSS", () => {
    expect(activityLoad({ sport: "run", durationSec: 3600, distanceM: 12000 }, M)).toMatchObject({ tss: 100, method: "pace" });
  });
  it("falls back to heart rate, then to an estimate", () => {
    expect(activityLoad({ sport: "ride", durationSec: 3600, avgHr: 170 }, M)).toMatchObject({ tss: 100, method: "hr" });
    expect(activityLoad({ sport: "strength", durationSec: 3600 }, M).method).toBe("estimate");
  });
  it("uses Session-RPE times duration for sessions without sensor data", () => {
    expect(activityLoad({ sport: "other", durationSec: 3600, rpe: 4 }, M)).toMatchObject({ tss: 50, method: "rpe" });
    expect(activityLoad({ sport: "other", durationSec: 1800, rpe: 6 }, M).tss).toBe(35);
    expect(activityLoad({ sport: "other", durationSec: 5400, rpe: 7 }, M).tss).toBe(120);
  });
  it("prefers heart rate over RPE and ignores RPE outside 1-10", () => {
    expect(activityLoad({ sport: "other", durationSec: 3600, avgHr: 170, rpe: 4 }, M).method).toBe("hr");
    expect(activityLoad({ sport: "other", durationSec: 3600, rpe: 0 }, M).method).toBe("estimate");
    expect(activityLoad({ sport: "other", durationSec: 3600, rpe: 11 }, M).method).toBe("estimate");
  });
});

describe("PMC", () => {
  // Nine days of normal training right after connecting (a new account).
  const burst = new Map<string, number>([
    ["2026-09-20", 60], ["2026-09-21", 90], ["2026-09-22", 70], ["2026-09-23", 110], ["2026-09-24", 50],
    ["2026-09-25", 120], ["2026-09-26", 90], ["2026-09-27", 60], ["2026-09-28", 120],
  ]);
  const formPct = (p: { tsb: number; ctl: number }) => Math.round((p.tsb / Math.max(p.ctl, 20)) * 100);
  it("reads a short history without seed as overload", () => {
    expect(formPct(performanceChart(burst, "2026-09-29", "2026-09-29", "2026-05-01").at(-1)!)).toBeLessThan(-150);
  });
  it("seeds fitness from the training volume before the first activity", () => {
    const seed = { date: "2026-09-20", load: baselineDailyLoad(8) };
    const p = performanceChart(burst, "2026-09-29", "2026-09-29", "2026-05-01", seed).at(-1)!;
    expect(p.ctl).toBeGreaterThan(55);
    expect(formPct(p)).toBeGreaterThan(-40);
    // Rest days now show recovery clearly.
    const later = performanceChart(burst, "2026-10-02", "2026-10-02", "2026-05-01", seed).at(-1)!;
    expect(formPct(later)).toBeGreaterThan(0);
  });
  it("applies a seed that lies before the warm-up window", () => {
    const a = performanceChart(burst, "2026-09-29", "2026-09-29", "2026-09-25", { date: "2026-09-20", load: 60 }).at(-1)!;
    const b = performanceChart(burst, "2026-09-29", "2026-09-29", "2026-01-01", { date: "2026-09-20", load: 60 }).at(-1)!;
    expect(a).toEqual(b);
  });
  it("converges towards a constant daily load", () => {
    const daily = new Map<string, number>();
    let d = "2026-01-01";
    for (let i = 0; i < 400; i++) {
      daily.set(d, 50);
      d = new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
    }
    const pmc = performanceChart(daily, "2027-01-01", "2027-01-31", "2026-01-01");
    const last = pmc[pmc.length - 1];
    expect(last.ctl).toBeGreaterThan(49);
    expect(last.atl).toBeCloseTo(50, 0);
    expect(Math.abs(last.tsb)).toBeLessThan(1.5);
  });
  it("form is positive after rest", () => {
    const daily = new Map([["2026-01-01", 300]]);
    const pmc = performanceChart(daily, "2026-01-01", "2026-01-20");
    expect(pmc[0].tsb).toBe(0);
    expect(pmc[1].tsb).toBeLessThan(0);
    expect(pmc[19].tsb).toBeGreaterThan(pmc[1].tsb);
  });
});

describe("VO2max", () => {
  it("race predictions are consistent with Daniels tables", () => {
    // VDOT 50 ≈ 19:57 for 5 km and 3:10:49 for the marathon
    expect(predictRaceTime(50, 5000)).toBeGreaterThan(19 * 60 + 40);
    expect(predictRaceTime(50, 5000)).toBeLessThan(20 * 60 + 15);
    expect(predictRaceTime(50, 42195)).toBeGreaterThan(3 * 3600 + 8 * 60);
    expect(predictRaceTime(50, 42195)).toBeLessThan(3 * 3600 + 14 * 60);
  });
  it("estimates a plausible value for an easy run", () => {
    const v = effectiveVo2max({ distanceM: 10000, durationSec: 55 * 60, avgHr: 145 }, 190);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(40);
    expect(v!).toBeLessThan(60);
  });
  it("estimates cycling VO2max from 5-minute power per kilogram", () => {
    // 4.5 W/kg over 5 minutes: 16.61 + 8.87 * 4.5 = 56.5
    expect(cyclingVo2max(337.5, 75)).toBe(56.5);
    expect(cyclingVo2max(0, 75)).toBeNull();
    expect(cyclingVo2max(300, 0)).toBeNull();
    expect(cyclingVo2max(2000, 40)).toBeNull();
  });
});
