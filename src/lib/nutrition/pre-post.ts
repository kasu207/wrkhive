import {
  LOADING_G_KG,
  LOADING_MIN_MINUTES,
  PRE_FLUID_ML_KG,
  PRE_MEAL,
  PRE_SNACK_G,
  PROTEIN_G_KG,
  RECOVERY_G_KG_H,
  RECOVERY_HOURS,
  RECOVERY_URGENT_HOURS,
  REHYDRATION_FACTOR,
} from "./guidelines";
import { preCaffeine } from "./targets";
import type { DuringTargets, FuelProfile, PostTargets, PreTargets, SessionInput } from "./types";

const round5 = (v: number) => Math.round(v / 5) * 5;
const round50 = (v: number) => Math.round(v / 50) * 50;

/** Meal, snack, fluid and caffeine before the session; carbohydrate loading before long races. */
export function preTargets(input: SessionInput, profile: FuelProfile): PreTargets {
  const minutes = input.durationSec / 60;
  const w = profile.weightKg;
  const IF = input.intensityFactor || 0.65;
  const notes: string[] = [];
  const light = minutes < 60 && IF < 0.75 && !input.flags.race;

  let meal: PreTargets["meal"] = null;
  let snack: PreTargets["snack"] = null;
  if (input.flags.fasted) {
    notes.push("Nüchtern: vorher nur Wasser, Kaffee oder Tee ohne Zucker.");
  } else if (light) {
    notes.push("Kurz und locker: normal essen genügt, keine besondere Mahlzeit nötig.");
  } else {
    const row = PRE_MEAL.find((r) => minutes < r.maxMin) ?? PRE_MEAL[PRE_MEAL.length - 1];
    meal = { carbsG: [round5(row.gPerKg[0] * w), round5(row.gPerKg[1] * w)], hoursBefore: row.hours };
    notes.push("Kohlenhydratbetont, wenig Fett, Ballaststoffe und Protein: z. B. Haferflocken mit Banane und Honig, Weißbrot mit Marmelade, Reis oder Nudeln.");
    if (minutes >= 60 || IF >= 0.8) {
      snack = { carbsG: PRE_SNACK_G, minutesBefore: [30, 60] };
      notes.push("Falls die Mahlzeit länger her ist: 30–60 min vorher ein kleiner Snack wie Banane, zwei Datteln oder ein Gel.");
    }
  }

  let loading: PreTargets["loading"] = null;
  if (input.flags.race && minutes > LOADING_MIN_MINUTES && !input.flags.fasted) {
    loading = {
      gPerKg: LOADING_G_KG,
      carbsGPerDay: [round5(LOADING_G_KG[0] * w), round5(LOADING_G_KG[1] * w)],
      hours: [36, 48],
    };
    notes.push("Carb-Loading: in den 36–48 h vor dem Start viele Kohlenhydrate, wenig Ballaststoffe. Nichts Neues ausprobieren.");
  }

  const caffeineMg = preCaffeine(input, profile);
  if (caffeineMg) notes.push(`Koffein etwa ${caffeineMg} mg (3 mg/kg) 45–60 min vor dem Start, z. B. Kaffee oder Koffein-Gel.`);

  return {
    meal,
    snack,
    fluidMl: [round50(PRE_FLUID_ML_KG[0] * w), round50(PRE_FLUID_ML_KG[1] * w)],
    caffeineMg,
    loading,
    notes,
  };
}

/** Recovery: carbohydrate, protein and fluid after the session. */
export function postTargets(input: SessionInput, profile: FuelProfile, during: DuringTargets): PostTargets {
  const minutes = input.durationSec / 60;
  const w = profile.weightKg;
  const IF = input.intensityFactor || 0.65;
  const notes: string[] = [];
  const next = input.hoursToNextSession;
  const urgent = next != null && next < RECOVERY_URGENT_HOURS && minutes >= 45;
  const demanding = minutes >= 90 || IF >= 0.85;

  let carbsG: [number, number];
  let carbsHours = 0;
  if (urgent) {
    carbsG = [round5(RECOVERY_G_KG_H[0] * w), round5(RECOVERY_G_KG_H[1] * w)];
    carbsHours = RECOVERY_HOURS;
    notes.push(`Die nächste Einheit folgt in ${Math.round(next!)} h: sofort anfangen und über ${RECOVERY_HOURS} h jede Stunde Kohlenhydrate essen, damit die Speicher voll werden.`);
  } else if (demanding) {
    carbsG = [round5(1 * w), round5(1.5 * w)];
    notes.push("Mit der nächsten Mahlzeit die Speicher auffüllen, Eile ist nicht nötig.");
  } else {
    carbsG = [0, 0];
    notes.push("Nach einer kurzen oder lockeren Einheit reicht die normale nächste Mahlzeit.");
  }
  const proteinG = Math.min(40, Math.max(20, round5(PROTEIN_G_KG * w)));
  notes.push(`Protein etwa ${proteinG} g innerhalb von 2 h, z. B. Skyr, Quark, Milch, Eier oder ein Proteinshake.`);

  const lossL = (during.expectedLossPct / 100) * w;
  const fluidMl = round50(lossL * REHYDRATION_FACTOR * 1000);
  if (fluidMl >= 300) notes.push(`Etwa ${fluidMl} ml trinken (150 % des Verlusts), mit etwas Salz oder salzigem Essen, damit das Wasser im Körper bleibt.`);

  return { urgent, carbsG, carbsHours, proteinG, fluidMl, notes };
}
