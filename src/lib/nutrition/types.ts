/**
 * Fueling model: what to eat and drink before, during and after a session.
 * Everything here is pure and deterministic; the server layer only supplies
 * the athlete profile, the pantry and the session.
 */

import type { ZoneIndex } from "@/lib/workout/zones";
import type { StepKind } from "@/lib/workout/types";

export type FuelSport = "ride" | "run" | "strength";

/** Ambient temperature class; drives the sweat-rate estimate. */
export const TEMP_CLASSES = ["cool", "mild", "warm", "hot"] as const;
export type TempClass = (typeof TEMP_CLASSES)[number];

export const TEMP_LABEL: Record<TempClass, string> = {
  cool: "Kühl (unter 12 °C)",
  mild: "Mild (12–20 °C)",
  warm: "Warm (21–26 °C)",
  hot: "Heiß (über 26 °C)",
};

/** Self-assessed sweat saltiness (white rims on clothes, stinging eyes = high). */
export const SWEAT_SODIUM = ["low", "average", "high"] as const;
export type SweatSodium = (typeof SWEAT_SODIUM)[number];

export const PRODUCT_KINDS = ["gel", "chew", "bar", "fruit", "snack", "drink", "salt"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = {
  gel: "Gel",
  chew: "Chews",
  bar: "Riegel",
  fruit: "Obst",
  snack: "Snack",
  drink: "Getränk",
  salt: "Salz",
};

export interface FuelProduct {
  id: string;
  name: string;
  kind: ProductKind;
  /** Per serving. */
  carbsG: number;
  sodiumMg: number;
  caffeineMg: number;
  /** Glucose and fructose sources combined; needed above about 60 g/h. */
  multiSource: boolean;
  /** Drinks: water per serving (the mix for one bottle). */
  fluidMl: number | null;
  /** "1 Stück", "1 Beutel", "500 ml". */
  servingLabel: string;
  custom?: boolean;
}

export interface SweatSample {
  sport: FuelSport;
  tempClass: TempClass;
  /** Liters per hour. */
  rateLh: number;
}

export interface FuelProfile {
  weightKg: number;
  /** False when the weight is the fallback, not the athlete's own. */
  weightKnown: boolean;
  /** Carbohydrate the gut tolerates, g/h (trainable, 30-120). */
  maxCarbPerHour: number;
  sweatSodium: SweatSodium;
  sweatSamples: SweatSample[];
  caffeine: boolean;
  preferNatural: boolean;
}

export interface SessionFlags {
  /** Key session: the athlete wants to perform, not just to train. */
  key?: boolean;
  race?: boolean;
  /** Deliberately without carbohydrate ("train low"). */
  fasted?: boolean;
}

/** A piece of the session timeline, from profileSegments(). */
export interface FuelSegment {
  start: number;
  duration: number;
  zone: ZoneIndex;
  kind: StepKind;
}

export interface SessionInput {
  sport: FuelSport;
  durationSec: number;
  /** Normalized intensity relative to threshold (0.5 easy .. 1.0 threshold). */
  intensityFactor: number;
  tempClass: TempClass;
  flags: SessionFlags;
  segments?: FuelSegment[];
  /** Hours until the next session starts; below 8 h recovery gets urgent. */
  hoursToNextSession?: number | null;
}

export interface DuringTargets {
  carbsPerHour: number;
  fluidMlPerHour: number;
  /** True: drink to thirst, no plan needed. */
  fluidToThirst: boolean;
  sodiumMgPerHour: number;
  /** Caffeine during the session (the pre-session dose is in PreTargets). */
  caffeineMg: number;
  /** Estimated sweat loss, l/h, and whether it was measured. */
  sweatRateLh: number;
  sweatMeasured: boolean;
  /** Expected body-mass loss at the end in percent, drinking to plan. */
  expectedLossPct: number;
  rationale: string[];
  warnings: string[];
}

export interface PreTargets {
  meal: { carbsG: [number, number]; hoursBefore: [number, number] } | null;
  snack: { carbsG: [number, number]; minutesBefore: [number, number] } | null;
  fluidMl: [number, number];
  caffeineMg: number;
  loading: { gPerKg: [number, number]; carbsGPerDay: [number, number]; hours: [number, number] } | null;
  notes: string[];
}

export interface PostTargets {
  urgent: boolean;
  /** Urgent: per hour for the first hours; otherwise with the next meal. */
  carbsG: [number, number];
  carbsHours: number;
  proteinG: number;
  fluidMl: number;
  notes: string[];
}

export interface ScheduleSlot {
  atMin: number;
  items: { productId: string; name: string; count: number }[];
  carbsG: number;
  fluidMl: number;
  sodiumMg: number;
  caffeineMg: number;
  note?: string;
}

export interface PackingItem {
  productId: string;
  name: string;
  count: number;
  /** Extra pieces as a reserve (long sessions). */
  spare: number;
  servingLabel: string;
}

export interface FuelSchedule {
  slots: ScheduleSlot[];
  totals: { carbsG: number; fluidMl: number; sodiumMg: number; caffeineMg: number; carbsPerHour: number };
  packing: PackingItem[];
  /** Water to carry in total, ml (including the water for drink mixes). */
  waterMl: number;
  warnings: string[];
}

export interface FuelPlan {
  input: SessionInput;
  pre: PreTargets;
  during: DuringTargets;
  schedule: FuelSchedule;
  post: PostTargets;
}
