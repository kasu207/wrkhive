import { FALLBACK_WEIGHT_KG, SWEAT_MODEL, SWEAT_RANGE, TEMP_FACTOR } from "./guidelines";
import type { FuelSport, SweatSample, TempClass } from "./types";

export interface SweatTestInput {
  preKg: number;
  postKg: number;
  /** Drunk during the session. */
  fluidMl: number;
  /** Urine passed during the session. */
  urineMl?: number;
  durationSec: number;
}

/**
 * Sweat rate from a weigh-in before and after (nude, towel-dried):
 * (pre - post + drunk - urine) / hours. 1 kg of body mass = 1 l of sweat.
 * Returns null for implausible results (scale error, wrong entry).
 */
export function sweatRate(t: SweatTestInput): number | null {
  const hours = t.durationSec / 3600;
  if (!(hours >= 0.5) || !(t.preKg > 0) || !(t.postKg > 0)) return null;
  const lost = t.preKg - t.postKg + t.fluidMl / 1000 - (t.urineMl ?? 0) / 1000;
  const rate = lost / hours;
  if (rate < SWEAT_RANGE[0] || rate > SWEAT_RANGE[1]) return null;
  return Math.round(rate * 100) / 100;
}

export function tempClassOf(celsius: number): TempClass {
  if (celsius < 12) return "cool";
  if (celsius <= 20) return "mild";
  if (celsius <= 26) return "warm";
  return "hot";
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Sweat rate for a session: the athlete's own measurements first (same sport
 * and temperature, else same sport scaled by temperature), otherwise the
 * population model scaled by body mass and temperature.
 */
export function estimateSweatRate(
  sport: FuelSport,
  intensityFactor: number,
  tempClass: TempClass,
  weightKg: number,
  samples: SweatSample[] = [],
): { rateLh: number; measured: boolean } {
  const same = samples.filter((s) => s.sport === sport && s.tempClass === tempClass).map((s) => s.rateLh);
  if (same.length) return { rateLh: round2(median(same)), measured: true };
  const sport_ = samples.filter((s) => s.sport === sport);
  if (sport_.length) {
    const scaled = sport_.map((s) => (s.rateLh * TEMP_FACTOR[tempClass]) / TEMP_FACTOR[s.tempClass]);
    return { rateLh: round2(clamp(median(scaled), SWEAT_RANGE[0], SWEAT_RANGE[1])), measured: true };
  }
  const { base, slope } = SWEAT_MODEL[sport];
  const mass = clamp((weightKg || FALLBACK_WEIGHT_KG) / FALLBACK_WEIGHT_KG, 0.7, 1.4);
  const rate = (base + slope * clamp(intensityFactor, 0.4, 1.1)) * mass * TEMP_FACTOR[tempClass];
  return { rateLh: round2(clamp(rate, SWEAT_RANGE[0], SWEAT_RANGE[1])), measured: false };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
