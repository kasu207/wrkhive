import { formatNumber } from "@/lib/format";
import {
  CAFFEINE_MAX_MG_KG,
  CAFFEINE_PRE_MG_KG,
  CAFFEINE_TOPUP_MG_KG,
  CARB_BANDS,
  CARB_CEILING,
  FLUID_MAX_MLH,
  FLUID_MIN_MLH,
  FLUID_PLAN_MIN,
  FLUID_REPLACEMENT,
  IF_HIGH,
  IF_LOW,
  IF_SHORT_SESSION,
  MAX_LOSS_PCT,
  RUN_CEILING,
  RUN_FACTOR,
  SODIUM_HEAVY_SWEAT_LH,
  SODIUM_MIN_MINUTES,
  SODIUM_REPLACEMENT,
  SWEAT_SODIUM_MG_L,
} from "./guidelines";
import { clamp, estimateSweatRate } from "./sweat";
import type { DuringTargets, FuelProfile, SessionInput } from "./types";

const round5 = (v: number) => Math.round(v / 5) * 5;
const round50 = (v: number) => Math.round(v / 50) * 50;
const round10 = (v: number) => Math.round(v / 10) * 10;

/** Pre-session caffeine dose, mg, or 0 when not wanted or not worth it. */
export function preCaffeine(input: SessionInput, profile: FuelProfile): number {
  if (!profile.caffeine || !(input.flags.key || input.flags.race) || input.durationSec < 45 * 60) return 0;
  return round10(CAFFEINE_PRE_MG_KG * profile.weightKg);
}

/** Carbohydrate, fluid, sodium and caffeine per hour during the session. */
export function duringTargets(input: SessionInput, profile: FuelProfile): DuringTargets {
  const minutes = input.durationSec / 60;
  const hours = minutes / 60;
  const IF = input.intensityFactor || 0.65;
  const rationale: string[] = [];
  const warnings: string[] = [];
  const race = !!input.flags.race;

  // Carbohydrate -----------------------------------------------------------
  let carbs = 0;
  const band = CARB_BANDS.find((b) => minutes < b.maxMin) ?? CARB_BANDS[CARB_BANDS.length - 1];
  const lo = band.range[0];
  let hi = band.range[1];
  const long = band.maxMin === Infinity;
  if (long && profile.maxCarbPerHour > hi) hi = Math.min(profile.maxCarbPerHour, CARB_CEILING);
  // Position within the band: easy sessions low, hard sessions and races high.
  const t = race ? 1 : clamp((IF - IF_LOW) / (IF_HIGH - IF_LOW), 0, 1);

  if (input.flags.fasted) {
    carbs = 0;
    rationale.push("Bewusst ohne Kohlenhydrate (Train low).");
    if (IF >= 0.8) warnings.push("Harte Einheit nüchtern: Qualität leidet, Verletzungs- und Infektrisiko steigen. Train low besser nur für lockere Einheiten.");
    if (minutes >= 150) warnings.push("Über 2,5 h ohne Kohlenhydrate ist nicht sinnvoll. Nimm zumindest ein Gel für den Notfall mit.");
  } else if (input.sport === "strength") {
    carbs = minutes >= 90 ? round5(30 * t) : 0;
    rationale.push(carbs ? "Lange Krafteinheit: etwas Kohlenhydrat hält die Qualität der letzten Sätze." : "Krafttraining unter 90 min braucht keine Verpflegung während der Einheit.");
  } else if (hi === 0) {
    rationale.push(`Unter 45 min reichen die Glykogenspeicher, Essen ist nicht nötig.`);
  } else if (band.maxMin === 75 && IF < IF_SHORT_SESSION && !race) {
    rationale.push("Unter 75 min und nicht hart: die Speicher reichen. Wer mag, nimmt ein halbes Gel oder spült den Mund mit Sportgetränk.");
  } else {
    carbs = lo + t * (hi - lo);
    const what = race ? "Wettkampf" : IF >= 0.8 ? "hohe Intensität" : IF >= 0.7 ? "mittlere Intensität" : "locker";
    rationale.push(`${formatDurationShort(minutes)}, ${what}: ${lo}–${hi} g/h Kohlenhydrate empfohlen.`);
  }

  if (carbs > 0 && input.sport === "run") {
    carbs = Math.min(carbs * RUN_FACTOR, RUN_CEILING);
    rationale.push("Beim Laufen verträgt der Magen weniger als auf dem Rad, daher etwas weniger.");
  }
  if (carbs > profile.maxCarbPerHour) {
    rationale.push(`Begrenzt auf deine Verträglichkeit von ${profile.maxCarbPerHour} g/h. Mit Darmtraining lässt sie sich steigern.`);
    carbs = profile.maxCarbPerHour;
  }
  carbs = round5(carbs);
  if (carbs > 60) rationale.push("Über 60 g/h nur mit Glukose-Fruktose-Mischungen (2:1 oder 1:0,8), sonst staut es sich im Darm.");

  // Fluid ------------------------------------------------------------------
  const sweat = estimateSweatRate(input.sport, IF, input.tempClass, profile.weightKg, profile.sweatSamples);
  const heat = input.tempClass === "warm" || input.tempClass === "hot";
  const toThirst = minutes < FLUID_PLAN_MIN && !heat;
  let fluid = 0;
  if (toThirst) {
    rationale.push("Kurze Einheit: nach Durst trinken genügt.");
  } else {
    fluid = round50(clamp(sweat.rateLh * 1000 * FLUID_REPLACEMENT, FLUID_MIN_MLH, FLUID_MAX_MLH));
    rationale.push(
      sweat.measured
        ? `Deine gemessene Schweißrate von ${formatNumber(sweat.rateLh, 1)} l/h: etwa 70 % davon ersetzen.`
        : `Geschätzte Schweißrate ${formatNumber(sweat.rateLh, 1)} l/h (aus Sportart, Intensität, Gewicht und Temperatur). Ein Schweißtest macht das genauer.`,
    );
    if (sweat.rateLh * 1000 > FLUID_MAX_MLH) rationale.push("Mehr als 1 l/h wird nicht empfohlen: zu viel Wasser verdünnt das Blutnatrium (Hyponatriämie).");
  }
  const lossKg = Math.max(0, (sweat.rateLh - fluid / 1000) * hours);
  const expectedLossPct = Math.round((lossKg / profile.weightKg) * 1000) / 10;
  if (!toThirst && expectedLossPct > MAX_LOSS_PCT) {
    warnings.push(`Voraussichtlich ${formatNumber(expectedLossPct, 1)} % Gewichtsverlust. Über 2 % leidet die Leistung: gut hydriert starten und danach konsequent nachtrinken.`);
  }

  // Sodium -----------------------------------------------------------------
  let sodium = 0;
  const lossMgH = sweat.rateLh * SWEAT_SODIUM_MG_L[profile.sweatSodium];
  if (minutes >= SODIUM_MIN_MINUTES || (sweat.rateLh >= SODIUM_HEAVY_SWEAT_LH && minutes >= FLUID_PLAN_MIN)) {
    sodium = round50(lossMgH * SODIUM_REPLACEMENT);
    rationale.push(`Natrium: etwa ${round50(lossMgH)} mg/h gehen mit dem Schweiß verloren, gut die Hälfte davon ersetzen.`);
  } else if (!toThirst) {
    rationale.push("Natrium ist bei dieser Dauer optional, ein Elektrolytgetränk schadet nicht.");
  }

  // Caffeine ---------------------------------------------------------------
  let caffeine = 0;
  const pre = preCaffeine(input, profile);
  if (pre > 0 && minutes >= 150) {
    caffeine = Math.min(round10(CAFFEINE_TOPUP_MG_KG * profile.weightKg), round10(CAFFEINE_MAX_MG_KG * profile.weightKg) - pre);
    rationale.push("Koffein: in der zweiten Hälfte nachlegen, wenn die Ermüdung kommt.");
  }

  return {
    carbsPerHour: carbs,
    fluidMlPerHour: fluid,
    fluidToThirst: toThirst,
    sodiumMgPerHour: sodium,
    caffeineMg: Math.max(0, caffeine),
    sweatRateLh: sweat.rateLh,
    sweatMeasured: sweat.measured,
    expectedLossPct: toThirst ? 0 : expectedLossPct,
    rationale,
    warnings,
  };
}

function formatDurationShort(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
