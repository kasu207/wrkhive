/**
 * Evidence base for the fueling engine. Every number the planner uses lives
 * here, with its source, so the rules can be checked and tuned in one place.
 *
 * Sources:
 * - Thomas, Erdman, Burke: ACSM/AND/DC Joint Position Statement "Nutrition
 *   and Athletic Performance", Med Sci Sports Exerc 2016.
 * - Jeukendrup: "A Step Towards Personalized Sports Nutrition: Carbohydrate
 *   Intake During Exercise", Sports Med 2014.
 * - Podlogar, Wallis et al.: high carbohydrate intakes (up to 120 g/h) with
 *   glucose-fructose blends, 2022-2025.
 * - Sawka et al.: ACSM Position Stand "Exercise and Fluid Replacement", 2007.
 * - Mosler et al.: "Fluid Replacement in Sports", position of the DGE working
 *   group sports nutrition, Dtsch Z Sportmed 2020.
 * - Guest et al.: ISSN Position Stand "Caffeine and exercise performance", 2021.
 * - Jäger et al.: ISSN Position Stand "Protein and exercise", 2017.
 */

import type { FuelSport, SweatSodium, TempClass } from "./types";

/** Carbohydrate during exercise, g/h, by session length (Jeukendrup 2014). */
export const CARB_BANDS: { maxMin: number; range: [number, number] }[] = [
  // Under 45 min: no intake needed; glycogen stores suffice.
  { maxMin: 45, range: [0, 0] },
  // 45-75 min: small amounts or mouth rinse, only when intense.
  { maxMin: 75, range: [0, 30] },
  // Up to 2.5 h: 30-60 g/h.
  { maxMin: 150, range: [30, 60] },
  // Longer: 60-90 g/h, up to 120 g/h with a trained gut.
  { maxMin: Infinity, range: [60, 90] },
];

/** Upper limit with glucose-fructose blends and a trained gut. */
export const CARB_CEILING = 120;
/** Single-source carbohydrate (glucose/maltodextrin) oxidizes at about 60 g/h at most. */
export const SINGLE_SOURCE_LIMIT = 60;
/** Intensity factor at which the band's lower and upper end apply. */
export const IF_LOW = 0.6;
export const IF_HIGH = 0.85;
/** 45-75 min sessions only need carbohydrate above this intensity. */
export const IF_SHORT_SESSION = 0.8;
/** Running jostles the gut: lower tolerance than on the bike. */
export const RUN_FACTOR = 0.85;
export const RUN_CEILING = 90;

/** Gut tolerance the athlete starts with and its trainable range. */
export const DEFAULT_MAX_CARB = 60;
export const MIN_MAX_CARB = 30;
export const PROGRESSION_STEP = 10;

/**
 * Sweat rate estimate at 70 kg in mild conditions: base + slope * IF, l/h.
 * Calibrated to the ranges in Sawka 2007 (0.5-2.0 l/h; running above cycling).
 */
export const SWEAT_MODEL: Record<FuelSport, { base: number; slope: number }> = {
  ride: { base: 0.1, slope: 1.0 },
  run: { base: 0.2, slope: 1.1 },
  strength: { base: 0.2, slope: 0.5 },
};
export const TEMP_FACTOR: Record<TempClass, number> = { cool: 0.7, mild: 1, warm: 1.25, hot: 1.5 };
export const SWEAT_RANGE: [number, number] = [0.2, 3.5];

/** Replace most, not all, of the sweat loss; never drink more than about 1 l/h (hyponatremia). */
export const FLUID_REPLACEMENT = 0.7;
export const FLUID_MIN_MLH = 400;
export const FLUID_MAX_MLH = 1000;
/** Above this loss of body mass performance suffers (ACSM, DGE). */
export const MAX_LOSS_PCT = 2;
/** Below this length drinking to thirst is enough unless it is warm. */
export const FLUID_PLAN_MIN = 60;

/** Sodium in sweat, mg/l: average about 900, range 200-2000. */
export const SWEAT_SODIUM_MG_L: Record<SweatSodium, number> = { low: 500, average: 900, high: 1300 };
/** Replace part of the sodium loss when long or heavy sweating. */
export const SODIUM_REPLACEMENT = 0.6;
export const SODIUM_MIN_MINUTES = 120;
export const SODIUM_HEAVY_SWEAT_LH = 1.2;

/** Caffeine, mg/kg: 3 before, 1-2 later in long sessions, 6 at most. */
export const CAFFEINE_PRE_MG_KG = 3;
export const CAFFEINE_TOPUP_MG_KG = 1.5;
export const CAFFEINE_MAX_MG_KG = 6;

/** Pre-exercise meal, g/kg, and hours before. */
export const PRE_MEAL: { maxMin: number; gPerKg: [number, number]; hours: [number, number] }[] = [
  { maxMin: 90, gPerKg: [1, 1], hours: [2, 3] },
  { maxMin: 150, gPerKg: [1.5, 2], hours: [3, 3] },
  { maxMin: Infinity, gPerKg: [2, 3], hours: [3, 4] },
];
export const PRE_SNACK_G: [number, number] = [20, 30];
/** Fluid 2-4 h before: 5-7 ml/kg (ACSM 2007). */
export const PRE_FLUID_ML_KG: [number, number] = [5, 7];
/** Carbohydrate loading before races over 90 min: 10-12 g/kg/day for 36-48 h. */
export const LOADING_G_KG: [number, number] = [10, 12];
export const LOADING_MIN_MINUTES = 90;

/** Recovery: 1.0-1.2 g/kg/h for 4 h when the next session is within 8 h. */
export const RECOVERY_G_KG_H: [number, number] = [1, 1.2];
export const RECOVERY_HOURS = 4;
export const RECOVERY_URGENT_HOURS = 8;
export const PROTEIN_G_KG = 0.3;
/** Drink 125-150 % of the remaining loss after the session. */
export const REHYDRATION_FACTOR = 1.5;

/** Weight used when the athlete has not entered one. */
export const FALLBACK_WEIGHT_KG = 70;
