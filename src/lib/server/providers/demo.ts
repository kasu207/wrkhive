import "server-only";
import { addDays, dayOfWeek, diffDays, type ISODate } from "@/lib/dates";
import type { NormalizedActivity } from "./types";

/**
 * Demo data source. Used when no Garmin / Wahoo API credentials are configured
 * so the whole product can be tried end to end. Everything produced here is
 * labelled as demo data in the UI.
 *
 * Generates a plausible, deterministic training history for an amateur
 * endurance athlete: periodized (3 build weeks, 1 recovery week), seasonal
 * (more cycling in summer, more running in winter), with some missed days.
 */

interface Athlete {
  ftp: number;
  lthr: number;
  maxHr: number;
  restHr: number;
  thresholdPace: number;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind =
  | "ride-intervals"
  | "ride-tempo"
  | "ride-long"
  | "ride-easy"
  | "run-easy"
  | "run-intervals"
  | "run-tempo"
  | "run-long"
  | "strength";

const NAMES: Record<Kind, string[]> = {
  "ride-intervals": ["VO2max 5x4 min", "Schwellenintervalle 3x12", "Over-Unders", "Indoor Intervalle"],
  "ride-tempo": ["Sweet Spot 2x20", "Tempofahrt", "Feierabendrunde zügig"],
  "ride-long": ["Lange Ausfahrt", "Grundlagenrunde", "Sonntagsrunde mit Anstiegen", "Gravel-Tour"],
  "ride-easy": ["Lockeres Rollen", "Kaffeerunde", "Regenerationsfahrt"],
  "run-easy": ["Lockerer Dauerlauf", "Morgenlauf", "Feierabendlauf"],
  "run-intervals": ["Intervalle 6x800 m", "Bahntraining 5x1000 m", "Hügelsprints"],
  "run-tempo": ["Tempodauerlauf", "Schwellenlauf 3x10 min"],
  "run-long": ["Langer Lauf", "Sonntagslauf"],
  strength: ["Beine & Rumpf", "Ganzkörper Kraft", "Oberkörper & Core"],
};

/** Day-of-week templates (0 = Monday). Several options per day. */
const WEEK: Kind[][][] = [
  [[], [], [], ["strength"]],
  [["ride-intervals"], ["ride-intervals"], ["run-intervals"]],
  [["run-easy"], ["run-easy", "strength"], ["strength"]],
  [["ride-tempo"], ["ride-tempo"], ["run-tempo"]],
  [[], [], ["run-easy"], ["ride-easy"]],
  [["ride-long"], ["ride-long"], ["run-long"]],
  [["run-long"], ["ride-long"], ["run-easy", "strength"], []],
];

function seasonRideBias(date: ISODate): number {
  const month = Number(date.slice(5, 7));
  // 1.0 in summer, 0.35 in deep winter
  return 0.675 + 0.325 * Math.cos(((month - 7) / 12) * 2 * Math.PI);
}

function hrZones(durationSec: number, avgHr: number, lthr: number, r: () => number): number[] {
  const rel = avgHr / lthr;
  // Center zone (0-based) from relative HR, then spread around it.
  const center = rel < 0.8 ? 0.6 : rel < 0.87 ? 1.2 : rel < 0.92 ? 2 : rel < 0.98 ? 2.7 : 3.4;
  const weights = [0, 1, 2, 3, 4].map((z) => Math.exp(-((z - center) ** 2) / (0.9 + r() * 0.4)));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.round((w / sum) * durationSec));
}

function makeActivity(kind: Kind, date: ISODate, index: number, a: Athlete, progress: number, r: () => number): NormalizedActivity {
  const ftp = a.ftp * (0.92 + 0.08 * progress);
  const tSpeed = (1000 / a.thresholdPace) * (0.94 + 0.06 * progress);
  const weekend = dayOfWeek(date) >= 5;
  const hour = weekend ? 8 + Math.floor(r() * 3) : r() < 0.35 ? 6 : 17 + Math.floor(r() * 2);
  const [y, m, d] = date.split("-").map(Number);
  const startTime = new Date(y, m - 1, d, hour, Math.floor(r() * 4) * 15);
  const name = NAMES[kind][Math.floor(r() * NAMES[kind].length)];
  const jitter = (spread: number) => 1 + (r() - 0.5) * spread;
  const hrFor = (intensity: number) => Math.round(a.restHr + (a.lthr - a.restHr) * Math.min(1.05, intensity * 0.97) * jitter(0.06));

  if (kind.startsWith("ride")) {
    const spec = {
      "ride-intervals": { min: 70, max: 90, if: 0.84, speed: 8.0 },
      "ride-tempo": { min: 80, max: 110, if: 0.81, speed: 8.4 },
      "ride-long": { min: 150, max: 260, if: 0.68, speed: 7.9 },
      "ride-easy": { min: 50, max: 75, if: 0.58, speed: 7.2 },
    }[kind as "ride-intervals"];
    const minutes = spec.min + r() * (spec.max - spec.min);
    const durationSec = Math.round(minutes * 60);
    const movingSec = Math.round(durationSec * (0.9 + r() * 0.07));
    const intensity = spec.if * jitter(0.08);
    const np = Math.round(ftp * intensity);
    const speed = spec.speed * jitter(0.1);
    const distanceM = Math.round(speed * movingSec);
    const avgHr = hrFor(intensity);
    return {
      externalId: `demo-${date}-${index}`,
      sport: "ride",
      name,
      startTime,
      durationSec,
      movingSec,
      distanceM,
      elevationGainM: Math.round((distanceM / 1000) * (4 + r() * 9)),
      avgHr,
      maxHr: Math.min(a.maxHr, Math.round(avgHr * (1.12 + r() * 0.08))),
      avgPower: Math.round(np * (0.88 + r() * 0.06)),
      normPower: np,
      avgCadence: Math.round(84 + r() * 8),
      avgSpeed: Math.round((distanceM / movingSec) * 100) / 100,
      calories: Math.round((np * movingSec) / 1000 / 1.05),
      hrZoneSec: hrZones(movingSec, avgHr, a.lthr, r),
      deviceName: "Demo-Gerät",
    };
  }

  if (kind.startsWith("run")) {
    const spec = {
      "run-easy": { min: 35, max: 60, pace: 0.78 },
      "run-intervals": { min: 50, max: 70, pace: 0.86 },
      "run-tempo": { min: 45, max: 65, pace: 0.9 },
      "run-long": { min: 80, max: 125, pace: 0.76 },
    }[kind as "run-easy"];
    const minutes = spec.min + r() * (spec.max - spec.min);
    const durationSec = Math.round(minutes * 60);
    const movingSec = Math.round(durationSec * (0.96 + r() * 0.03));
    const rel = spec.pace * jitter(0.06);
    const speed = tSpeed * rel;
    const distanceM = Math.round(speed * movingSec);
    const avgHr = hrFor(rel * 1.02);
    return {
      externalId: `demo-${date}-${index}`,
      sport: "run",
      name,
      startTime,
      durationSec,
      movingSec,
      distanceM,
      elevationGainM: Math.round((distanceM / 1000) * (3 + r() * 8)),
      avgHr,
      maxHr: Math.min(a.maxHr, Math.round(avgHr * (1.08 + r() * 0.06))),
      avgCadence: Math.round(166 + r() * 12),
      avgSpeed: Math.round((distanceM / movingSec) * 100) / 100,
      calories: Math.round((distanceM / 1000) * 68),
      hrZoneSec: hrZones(movingSec, avgHr, a.lthr, r),
      deviceName: "Demo-Gerät",
    };
  }

  const durationSec = Math.round((40 + r() * 25) * 60);
  const avgHr = Math.round(a.restHr + 55 + r() * 20);
  return {
    externalId: `demo-${date}-${index}`,
    sport: "strength",
    name,
    startTime,
    durationSec,
    movingSec: durationSec,
    avgHr,
    maxHr: Math.round(avgHr * 1.3),
    calories: Math.round(durationSec / 60 * 6.5),
    hrZoneSec: hrZones(durationSec, avgHr, a.lthr, r),
    deviceName: "Demo-Gerät",
  };
}

/**
 * Deterministic activities for the calendar days [from, to]. The same seed and
 * day always yield the same activities, so repeated syncs are idempotent.
 */
export function generateDemoActivities(seed: string, from: ISODate, to: ISODate, athlete: Athlete, historyStart: ISODate): NormalizedActivity[] {
  const out: NormalizedActivity[] = [];
  const span = Math.max(1, diffDays(to, historyStart));
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const r = rng(hash(`${seed}:${date}`));
    const weekIndex = Math.floor(diffDays(date, historyStart) / 7);
    const recoveryWeek = weekIndex % 4 === 3;
    // A short break once in a while (holiday / illness).
    if (hash(`${seed}:break:${Math.floor(weekIndex / 2)}`) % 13 === 0 && weekIndex % 2 === 0) continue;
    const options = WEEK[dayOfWeek(date)];
    let kinds = options[Math.floor(r() * options.length)];
    const rideBias = seasonRideBias(date);
    kinds = kinds.map((k) => {
      if (k.startsWith("ride") && r() > rideBias + 0.1) return k === "ride-long" ? "run-long" : "run-easy";
      return k;
    });
    if (recoveryWeek) kinds = kinds.filter((k, i) => i === 0 && r() < 0.75).map((k) => (k.includes("intervals") || k.includes("tempo") ? (k.startsWith("ride") ? "ride-easy" : "run-easy") : k));
    if (r() < 0.12) continue; // missed session
    const progress = Math.min(1, diffDays(date, historyStart) / span);
    kinds.forEach((k, i) => out.push(makeActivity(k, date, i, athlete, progress, r)));
  }
  return out;
}
