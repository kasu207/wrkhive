import { CARB_CEILING, MIN_MAX_CARB, PROGRESSION_STEP } from "./guidelines";

export interface FuelLogEntry {
  date: string;
  durationSec: number;
  /** Planned carbohydrate per hour for the session, 0 when unknown. */
  targetCarbsPerHour: number;
  carbsG: number;
  /** 1 = no complaints .. 5 = severe gut problems. */
  gutScore: number | null;
}

export interface ProgressionAdvice {
  direction: "up" | "down" | "hold";
  current: number;
  suggested: number;
  reason: string;
}

/** Sessions shorter than this say little about gut tolerance. */
const MIN_LOG_MINUTES = 75;
const STREAK = 3;

/**
 * Gut training: the gut adapts to carbohydrate like muscles to load. Three
 * long sessions in a row at the target without complaints → raise the
 * tolerance by 10 g/h; clear problems → lower it again.
 * Logs are expected newest first.
 */
export function progressionAdvice(logs: FuelLogEntry[], current: number): ProgressionAdvice {
  const relevant = logs.filter((l) => l.durationSec >= MIN_LOG_MINUTES * 60 && l.gutScore !== null);
  const hold = (reason: string): ProgressionAdvice => ({ direction: "hold", current, suggested: current, reason });
  if (!relevant.length) return hold("Protokolliere nach langen Einheiten, was du gegessen hast und wie es dem Magen ging. Daraus entsteht dein Darmtraining.");

  const latest = relevant[0];
  if ((latest.gutScore ?? 0) >= 4 && current > MIN_MAX_CARB) {
    const suggested = Math.max(MIN_MAX_CARB, current - PROGRESSION_STEP);
    return { direction: "down", current, suggested, reason: `Deutliche Magenprobleme am ${latest.date}. Geh vorübergehend auf ${suggested} g/h zurück und steigere dann langsam wieder.` };
  }

  const streak = relevant.slice(0, STREAK);
  const hitTarget = (l: FuelLogEntry) => l.carbsG / (l.durationSec / 3600) >= current * 0.9;
  if (streak.length === STREAK && streak.every((l) => (l.gutScore ?? 5) <= 2 && hitTarget(l))) {
    if (current >= CARB_CEILING) return hold(`Du verträgst ${current} g/h, das ist das Maximum. Mehr bringt keinen Vorteil.`);
    const suggested = Math.min(CARB_CEILING, current + PROGRESSION_STEP);
    return { direction: "up", current, suggested, reason: `Drei lange Einheiten mit etwa ${current} g/h ohne Beschwerden. Zeit für den nächsten Schritt: ${suggested} g/h.` };
  }

  const done = streak.filter((l) => (l.gutScore ?? 5) <= 2 && hitTarget(l)).length;
  return hold(`${done} von ${STREAK} langen Einheiten mit ${current} g/h ohne Beschwerden. Danach schlagen wir ${Math.min(CARB_CEILING, current + PROGRESSION_STEP)} g/h vor.`);
}
