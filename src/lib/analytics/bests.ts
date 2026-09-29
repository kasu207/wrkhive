/**
 * Best efforts within a session, from 1 Hz series: highest average power
 * over fixed durations (the power curve) and fastest time over fixed
 * distances. Pauses are removed before (see fit/activity.ts), so a best
 * never spans a coffee stop.
 */

/** Power curve durations in seconds. */
export const POWER_DURATIONS = [5, 60, 300, 1200, 3600] as const;
/** Running distances in metres. */
export const PACE_DISTANCES = [1000, 5000, 10000] as const;

export interface ActivityBests {
  /** Duration in seconds -> best average power in watts. */
  power?: Record<string, number>;
  /** Distance in metres -> fastest time in seconds. */
  pace?: Record<string, number>;
}

export const POWER_LABEL: Record<number, string> = { 5: "5 s", 60: "1 min", 300: "5 min", 1200: "20 min", 3600: "60 min" };
export const PACE_LABEL: Record<number, string> = { 1000: "1 km", 5000: "5 km", 10000: "10 km" };

/** Highest rolling average over each duration; durations longer than the series are left out. */
export function powerBests(power: number[], durations: readonly number[] = POWER_DURATIONS): Record<string, number> | null {
  if (!power.some((p) => p > 0)) return null;
  const prefix = new Float64Array(power.length + 1);
  for (let i = 0; i < power.length; i++) prefix[i + 1] = prefix[i] + Math.max(0, power[i]);
  const out: Record<string, number> = {};
  for (const d of durations) {
    if (power.length < d) continue;
    let best = 0;
    for (let i = d; i <= power.length; i++) best = Math.max(best, prefix[i] - prefix[i - d]);
    if (best > 0) out[String(d)] = Math.round(best / d);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Fastest time for each distance from a cumulative distance series sampled
 * at 1 Hz (index = seconds of moving time). Two pointers, linear time.
 */
export function distanceBests(distance: number[], targets: readonly number[] = PACE_DISTANCES): Record<string, number> | null {
  const out: Record<string, number> = {};
  const total = distance.length ? distance[distance.length - 1] - distance[0] : 0;
  for (const target of targets) {
    if (total < target) continue;
    let best = Infinity;
    let j = 0;
    for (let i = 0; i < distance.length; i++) {
      // Smallest window [j, i] that still covers the target distance.
      while (j < i && distance[i] - distance[j + 1] >= target) j++;
      if (distance[i] - distance[j] >= target) best = Math.min(best, i - j);
    }
    if (Number.isFinite(best) && best > 0) out[String(target)] = best;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Aerobic decoupling in percent: how much the output per heartbeat (power or
 * speed divided by heart rate) drops from the first to the second half.
 * Below 5 % the aerobic base carries the session (Friel). Needs 20 minutes.
 */
export function decoupling(output: number[], hr: (number | null)[]): number | null {
  const n = Math.min(output.length, hr.length);
  if (n < 1200) return null;
  const half = Math.floor(n / 2);
  const ef = (from: number, to: number) => {
    let o = 0;
    let h = 0;
    let count = 0;
    for (let i = from; i < to; i++) {
      const beat = hr[i];
      if (beat === null || beat <= 0) continue;
      o += output[i];
      h += beat;
      count++;
    }
    return count >= (to - from) * 0.8 && h > 0 && o > 0 ? o / h : null;
  };
  const first = ef(0, half);
  const second = ef(half, n);
  if (first === null || second === null) return null;
  return Math.round(((first - second) / first) * 1000) / 10;
}

export interface BestEffort {
  value: number;
  date: string;
  activityId: string;
}

/** Best value per key across activities (highest power, lowest time). */
export function bestOf(list: { id: string; date: string; bests: ActivityBests | null }[], kind: "power" | "pace"): Record<string, BestEffort> {
  const out: Record<string, BestEffort> = {};
  for (const a of list) {
    const values = a.bests?.[kind];
    if (!values) continue;
    for (const [k, v] of Object.entries(values)) {
      if (!(v > 0)) continue;
      const cur = out[k];
      if (!cur || (kind === "power" ? v > cur.value : v < cur.value)) out[k] = { value: v, date: a.date, activityId: a.id };
    }
  }
  return out;
}

/** FTP estimate from the power curve: 95 % of the best 20 minutes, or the best hour if higher. */
export function estimateFtp(power: Record<string, BestEffort>): number | null {
  const p20 = power["1200"]?.value;
  const p60 = power["3600"]?.value;
  const est = Math.max(p20 ? p20 * 0.95 : 0, p60 ?? 0);
  return est > 0 ? Math.round(est) : null;
}
