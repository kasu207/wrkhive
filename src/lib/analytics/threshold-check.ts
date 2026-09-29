/**
 * Checks the athlete's thresholds against what the recordings show. Stale
 * thresholds are the most common data error: every load score, form value
 * and zone depends on them. Suggestions are conservative and only point
 * upwards where a single test-like effort is enough evidence (maximum heart
 * rate, FTP); resting heart rate follows the measured median in both
 * directions.
 */

export interface ThresholdValues {
  ftp: number;
  lthr: number;
  maxHr: number;
  restHr: number;
}

export type ThresholdField = keyof ThresholdValues;

export interface ThresholdSuggestion {
  field: ThresholdField;
  label: string;
  unit: string;
  current: number;
  suggested: number;
  reason: string;
}

export interface ThresholdEvidence {
  /** Activities of the last 365 days. */
  activities: { sport: string; date: string; durationSec: number; movingSec: number | null; avgHr: number | null; maxHr: number | null; normPower: number | null }[];
  /** FTP estimate from the power curve of the last 90 days (bests.ts). */
  ftpFromCurve: number | null;
  /** Measured resting heart rate values of the last 30 days. */
  restingHr: number[];
}

/** The values a new account starts with (schema defaults). */
export const DEFAULT_THRESHOLDS: ThresholdValues = { ftp: 230, lthr: 165, maxHr: 188, restHr: 52 };

export function usesDefaults(t: ThresholdValues): boolean {
  return t.ftp === DEFAULT_THRESHOLDS.ftp && t.lthr === DEFAULT_THRESHOLDS.lthr && t.maxHr === DEFAULT_THRESHOLDS.maxHr && t.restHr === DEFAULT_THRESHOLDS.restHr;
}

const HOUR = 55 * 60;

export function checkThresholds(t: ThresholdValues, e: ThresholdEvidence): ThresholdSuggestion[] {
  const out: ThresholdSuggestion[] = [];

  // Maximum heart rate: the second highest session maximum, so a single
  // optical-sensor spike (cadence lock) does not count.
  const maxima = e.activities
    .map((a) => a.maxHr)
    .filter((v): v is number => v !== null && v >= 100 && v <= 225)
    .sort((a, b) => b - a);
  if (maxima.length >= 2 && maxima[1] > t.maxHr) {
    out.push({ field: "maxHr", label: "Maximalpuls", unit: "bpm", current: t.maxHr, suggested: maxima[1], reason: `In mindestens zwei Einheiten gemessen (höchster Wert ${maxima[0]} bpm).` });
  }

  // FTP: best 20 minutes or a long ride above the current FTP.
  const longRides = e.activities.filter((a) => a.sport === "ride" && (a.movingSec ?? a.durationSec) >= HOUR && a.normPower);
  const npHour = longRides.reduce((m, a) => Math.max(m, a.normPower ?? 0), 0);
  const ftpEvidence = Math.max(e.ftpFromCurve ?? 0, npHour);
  if (ftpEvidence > t.ftp * 1.03) {
    out.push({
      field: "ftp",
      label: "FTP",
      unit: "W",
      current: t.ftp,
      suggested: Math.round(ftpEvidence),
      reason:
        e.ftpFromCurve !== null && e.ftpFromCurve >= npHour
          ? `95 % deiner besten 20 Minuten der letzten 90 Tage.`
          : `Eine Ausfahrt über eine Stunde mit ${Math.round(npHour)} W Normalized Power liegt über deiner FTP.`,
    });
  }

  // Threshold heart rate: an hour-long session averages close to it at most.
  const hourHr = e.activities.filter((a) => (a.movingSec ?? a.durationSec) >= HOUR && a.avgHr).reduce((m, a) => Math.max(m, a.avgHr ?? 0), 0);
  if (hourHr > t.lthr + 2 && hourHr < (maxima[1] ?? t.maxHr)) {
    out.push({ field: "lthr", label: "Schwellenpuls", unit: "bpm", current: t.lthr, suggested: hourHr, reason: `Durchschnitt einer Einheit über eine Stunde, das geht nur knapp unter der Schwelle.` });
  }

  // Resting heart rate: median of the last 30 days.
  if (e.restingHr.length >= 7) {
    const sorted = [...e.restingHr].sort((a, b) => a - b);
    const median = Math.round(sorted[Math.floor(sorted.length / 2)]);
    if (Math.abs(median - t.restHr) >= 3) {
      out.push({ field: "restHr", label: "Ruhepuls", unit: "bpm", current: t.restHr, suggested: median, reason: `Median deiner letzten ${e.restingHr.length} Messungen.` });
    }
  }
  return out;
}
