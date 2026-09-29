/**
 * How the athlete trains, from data every source delivers: intensity
 * distribution, consistency and aerobic efficiency.
 */
import { addDays, startOfWeek, type ISODate } from "@/lib/dates";

// ---------------------------------------------------------------------------
// Intensity distribution (three zones after Seiler)

export interface IntensitySplit {
  /** Seconds below ~90 % of threshold heart rate (Z1-Z2). */
  low: number;
  /** Seconds between ~90 and 100 % (Z3-Z4). */
  mid: number;
  /** Seconds above threshold (Z5). */
  high: number;
  sessions: number;
}

export function intensitySplit(list: { hrZoneSec: number[] | null }[]): IntensitySplit {
  const out: IntensitySplit = { low: 0, mid: 0, high: 0, sessions: 0 };
  for (const a of list) {
    const z = a.hrZoneSec;
    if (!z || z.length < 5) continue;
    const total = z.reduce((x, y) => x + y, 0);
    if (!total) continue;
    out.low += z[0] + z[1];
    out.mid += z[2] + z[3];
    out.high += z[4];
    out.sessions++;
  }
  return out;
}

/** Share of low intensity per week, oldest first (null for weeks without heart-rate data). */
export function weeklyLowShare(list: { date: ISODate; hrZoneSec: number[] | null }[], today: ISODate, weeks: number): { week: ISODate; share: number | null }[] {
  const first = addDays(startOfWeek(today), -(weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, i) => {
    const week = addDays(first, i * 7);
    const s = intensitySplit(list.filter((a) => startOfWeek(a.date) === week));
    const total = s.low + s.mid + s.high;
    return { week, share: total ? s.low / total : null };
  });
}

// ---------------------------------------------------------------------------
// Consistency

export interface Consistency {
  goal: number;
  /** Completed weeks in a row that reached the goal (the running week counts once reached). */
  streak: number;
  weeks: { week: ISODate; sessions: number; met: boolean; current: boolean }[];
}

export function consistency(dates: ISODate[], today: ISODate, goal: number, weeks = 12): Consistency {
  const first = addDays(startOfWeek(today), -(weeks - 1) * 7);
  const counts = new Map<ISODate, number>();
  // Sessions per day count once each: two recordings of one ride are merged already.
  for (const d of dates) counts.set(startOfWeek(d), (counts.get(startOfWeek(d)) ?? 0) + 1);
  const list = Array.from({ length: weeks }, (_, i) => {
    const week = addDays(first, i * 7);
    const sessions = counts.get(week) ?? 0;
    return { week, sessions, met: sessions >= goal, current: i === weeks - 1 };
  });
  let streak = 0;
  // Look further back than the chart so long streaks are counted fully.
  const current = startOfWeek(today);
  if ((counts.get(current) ?? 0) >= goal) streak++;
  for (let w = addDays(current, -7); (counts.get(w) ?? 0) >= goal; w = addDays(w, -7)) streak++;
  return { goal, streak, weeks: list };
}

// ---------------------------------------------------------------------------
// Aerobic efficiency

export interface EfficiencyInput {
  id: string;
  date: ISODate;
  name: string;
  sport: "ride" | "run" | "strength" | "other";
  durationSec: number;
  movingSec: number | null;
  avgHr: number | null;
  avgPower: number | null;
  normPower: number | null;
  avgSpeed: number | null;
  hrZoneSec: number[] | null;
  decouplingPct: number | null;
}

export interface EfficiencyPoint {
  id: string;
  date: ISODate;
  name: string;
  /** Rides: watts per beat; runs: metres per minute per beat. */
  ef: number;
  decouplingPct: number | null;
}

/** Minimum moving time for a session to say something about the aerobic base. */
const MIN_STEADY_SEC = 40 * 60;

/**
 * Steady aerobic sessions only: efficiency of an interval session says
 * nothing about the base. With heart-rate zones at least 70 % in Z1-Z2,
 * otherwise an average below 88 % of threshold heart rate.
 */
export function isSteadyAerobic(a: EfficiencyInput, lthr: number): boolean {
  if ((a.movingSec ?? a.durationSec) < MIN_STEADY_SEC || !a.avgHr) return false;
  const z = a.hrZoneSec;
  const total = z ? z.reduce((x, y) => x + y, 0) : 0;
  if (z && total) return (z[0] + z[1]) / total >= 0.7;
  return a.avgHr < lthr * 0.88;
}

export function efficiencyPoints(list: EfficiencyInput[], sport: "ride" | "run", lthr: number): EfficiencyPoint[] {
  const out: EfficiencyPoint[] = [];
  for (const a of list) {
    if (a.sport !== sport || !isSteadyAerobic(a, lthr)) continue;
    const output = sport === "ride" ? (a.normPower ?? a.avgPower) : a.avgSpeed ? a.avgSpeed * 60 : null;
    if (!output || !a.avgHr) continue;
    out.push({ id: a.id, date: a.date, name: a.name, ef: Math.round((output / a.avgHr) * 1000) / 1000, decouplingPct: a.decouplingPct });
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : 1));
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Change of the median efficiency in the last 4 weeks against the 4 weeks before, in percent. */
export function efficiencyChange(points: EfficiencyPoint[], today: ISODate): { recent: number; previous: number; pct: number } | null {
  const recent = points.filter((p) => p.date > addDays(today, -28)).map((p) => p.ef);
  const previous = points.filter((p) => p.date <= addDays(today, -28) && p.date > addDays(today, -56)).map((p) => p.ef);
  if (recent.length < 2 || previous.length < 2) return null;
  const r = median(recent);
  const p = median(previous);
  return { recent: r, previous: p, pct: Math.round(((r - p) / p) * 1000) / 10 };
}
