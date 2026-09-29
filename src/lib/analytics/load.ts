/**
 * Training load and performance models.
 *
 * - TSS per activity: power-based (TSS), pace-based (rTSS), heart-rate based
 *   (hrTSS approximation), Session-RPE for sessions recorded without a
 *   device, or a duration estimate as last resort.
 * - Performance Management Chart: CTL (42 d), ATL (7 d) exponentially weighted
 *   daily load, TSB = CTL - ATL of the previous day (form going into today).
 * - Cycling VO2max from the best 5-minute power per kilogram (Sitko).
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
  /** Session-RPE (Foster CR-10, 1-10), only for manually recorded sessions. */
  rpe?: number | null;
}

export interface AthleteModel {
  ftp: number;
  lthr: number;
  maxHr: number;
  restHr: number;
  thresholdPace: number; // s/km
}

/**
 * TSS per hour for a Session-RPE (Foster CR-10). Anchored at Friel's scale
 * (RPE 4 = 50, RPE 6 = 70 TSS/h); values above RPE 6 are an assumption and
 * capped at threshold (100 TSS/h), since a whole session cannot be held above it.
 */
export const RPE_TSS_PER_HOUR: Record<number, number> = { 1: 20, 2: 30, 3: 40, 4: 50, 5: 60, 6: 70, 7: 80, 8: 90, 9: 100, 10: 100 };

export type LoadMethod = "power" | "pace" | "hr" | "rpe" | "estimate";

export function activityLoad(a: LoadInput, m: AthleteModel): { tss: number; method: LoadMethod; intensityFactor: number | null } {
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
  if (a.rpe && Number.isInteger(a.rpe) && a.rpe >= 1 && a.rpe <= 10) {
    const perHour = RPE_TSS_PER_HOUR[a.rpe];
    return { tss: round1(hours * perHour), method: "rpe", intensityFactor: round2(Math.sqrt(perHour / 100)) };
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

/** Typical load per training hour (endurance at IF ~0.7), used to turn weekly hours into daily load. */
export const TSS_PER_HOUR_TYPICAL = 50;

/** Daily load of an athlete who trained `hours` per week, the steady state of CTL and ATL. */
export function baselineDailyLoad(weeklyHours: number): number {
  return (weeklyHours * TSS_PER_HOUR_TYPICAL) / 7;
}

/**
 * Computes the PMC from daily load. `daily` may be sparse; days without an
 * entry count as zero load. The model is warmed up from the first day given.
 *
 * `seed` starts fitness and fatigue at a steady state on `seed.date` (the
 * first recorded day) instead of zero: without it a new athlete's first
 * weeks look like massive overload, because the model assumes no training
 * happened before the first synced activity.
 */
export function performanceChart(daily: Map<ISODate, number>, from: ISODate, to: ISODate, warmupFrom?: ISODate, seed?: { date: ISODate; load: number }): PmcPoint[] {
  let start = warmupFrom && warmupFrom < from ? warmupFrom : from;
  if (seed && seed.load > 0 && seed.date < start) start = seed.date;
  const out: PmcPoint[] = [];
  let ctl = 0;
  let atl = 0;
  const kCtl = 1 - Math.exp(-1 / 42);
  const kAtl = 1 - Math.exp(-1 / 7);
  for (let d = start; d <= to; d = addDays(d, 1)) {
    if (seed && seed.load > 0 && d === seed.date) {
      ctl = Math.max(ctl, seed.load);
      atl = Math.max(atl, seed.load);
    }
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

/** Share of the 5-minute power a typical FTP corresponds to (FTP ≈ 83 % of the best 5 minutes). */
export const FTP_OF_5MIN = 0.83;

/**
 * Cycling VO2max from the best 5-minute power per kilogram (Sitko et al.
 * 2021: VO2max = 16.61 + 8.87 · W/kg, trained cyclists). Five minutes all-out
 * is close to maximal aerobic power, so the estimate is only as good as the
 * athlete's hardest recent effort.
 */
export function cyclingVo2max(power5min: number, weightKg: number): number | null {
  if (!(power5min > 0) || !(weightKg >= 30 && weightKg <= 250)) return null;
  const est = 16.61 + 8.87 * (power5min / weightKg);
  return est > 20 && est < 95 ? round1(est) : null;
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
