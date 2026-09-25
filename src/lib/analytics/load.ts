/**
 * Training load and performance models.
 *
 * - TSS per activity: power-based (TSS), pace-based (rTSS), heart-rate based
 *   (hrTSS approximation) or a duration estimate as last resort.
 * - Performance Management Chart: CTL (42 d), ATL (7 d) exponentially weighted
 *   daily load, TSB = CTL - ATL of the previous day (form going into today).
 * - Effective VO2max from runs (Daniels/Gilbert oxygen cost, corrected for the
 *   heart-rate fraction after Swain), race predictions from VO2max.
 */
import { addDays, type ISODate } from "../dates";

export interface LoadInput {
  sport: "ride" | "run" | "strength" | "other";
  durationSec: number;
  movingSec?: number | null;
  distanceM?: number | null;
  avgHr?: number | null;
  avgPower?: number | null;
  normPower?: number | null;
}

export interface AthleteModel {
  ftp: number;
  lthr: number;
  maxHr: number;
  restHr: number;
  thresholdPace: number; // s/km
}

export function activityLoad(a: LoadInput, m: AthleteModel): { tss: number; method: "power" | "pace" | "hr" | "estimate"; intensityFactor: number | null } {
  const sec = a.movingSec && a.movingSec > 0 ? a.movingSec : a.durationSec;
  const hours = sec / 3600;
  if (hours <= 0) return { tss: 0, method: "estimate", intensityFactor: null };

  if (a.sport === "ride" && (a.normPower || a.avgPower) && m.ftp > 0) {
    const np = a.normPower ?? (a.avgPower as number) * 1.05;
    const intensity = np / m.ftp;
    return { tss: round1(hours * intensity * intensity * 100), method: "power", intensityFactor: round2(intensity) };
  }
  if (a.sport === "run" && a.distanceM && a.distanceM > 0 && m.thresholdPace > 0) {
    const speed = a.distanceM / sec;
    const intensity = speed / (1000 / m.thresholdPace);
    if (intensity > 0.3 && intensity < 1.6) {
      return { tss: round1(hours * intensity * intensity * 100), method: "pace", intensityFactor: round2(intensity) };
    }
  }
  if (a.avgHr && m.lthr > m.restHr && a.sport !== "strength") {
    const intensity = Math.max(0, (a.avgHr - m.restHr) / (m.lthr - m.restHr));
    return { tss: round1(hours * intensity * intensity * 100), method: "hr", intensityFactor: round2(intensity) };
  }
  const assumed = a.sport === "strength" ? 0.62 : 0.7;
  return { tss: round1(hours * assumed * assumed * 100), method: "estimate", intensityFactor: assumed };
}

export interface PmcPoint {
  date: ISODate;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

/**
 * Computes the PMC from daily load. `daily` may be sparse; days without an
 * entry count as zero load. The model is warmed up from the first day given.
 */
export function performanceChart(daily: Map<ISODate, number>, from: ISODate, to: ISODate, warmupFrom?: ISODate): PmcPoint[] {
  const start = warmupFrom && warmupFrom < from ? warmupFrom : from;
  const out: PmcPoint[] = [];
  let ctl = 0;
  let atl = 0;
  const kCtl = 1 - Math.exp(-1 / 42);
  const kAtl = 1 - Math.exp(-1 / 7);
  for (let d = start; d <= to; d = addDays(d, 1)) {
    const tss = daily.get(d) ?? 0;
    const tsb = ctl - atl; // form going into the day
    ctl = ctl + (tss - ctl) * kCtl;
    atl = atl + (tss - atl) * kAtl;
    if (d >= from) out.push({ date: d, tss: round1(tss), ctl: round1(ctl), atl: round1(atl), tsb: round1(tsb) });
  }
  return out;
}

/** Oxygen cost of running at velocity v (m/min), Daniels & Gilbert. */
function vo2AtVelocity(v: number): number {
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraction of VO2max sustainable for t minutes (race effort), Daniels & Gilbert. */
function sustainableFraction(tMin: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
}

/**
 * Effective VO2max of a run: oxygen cost of the run's pace divided by the
 * VO2max fraction implied by its average heart rate (Swain: %HRmax = 0.64·%VO2max + 0.37).
 */
export function effectiveVo2max(run: { distanceM: number; durationSec: number; avgHr: number | null | undefined }, maxHr: number): number | null {
  if (!run.avgHr || run.distanceM < 3000 || run.durationSec < 15 * 60 || maxHr <= 0) return null;
  const v = run.distanceM / (run.durationSec / 60);
  const vo2 = vo2AtVelocity(v);
  const hrFraction = run.avgHr / maxHr;
  if (hrFraction < 0.6 || hrFraction > 1.02) return null;
  const vo2Fraction = Math.min(1, Math.max(0.45, (hrFraction - 0.37) / 0.64));
  const est = vo2 / vo2Fraction;
  return est > 20 && est < 90 ? round1(est) : null;
}

/** Predicted race time in seconds for a distance at a given VO2max (bisection). */
export function predictRaceTime(vo2max: number, distanceM: number): number {
  let lo = distanceM / 8; // 8 m/s — faster than any human race pace
  let hi = distanceM / 1; // 1 m/s
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const tMin = mid / 60;
    const required = vo2AtVelocity(distanceM / tMin) / sustainableFraction(tMin);
    if (required > vo2max) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
