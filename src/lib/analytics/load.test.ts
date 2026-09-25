import { describe, expect, it } from "vitest";
import { activityLoad, effectiveVo2max, performanceChart, predictRaceTime } from "./load";

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
});

describe("PMC", () => {
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
});
