/**
 * Daily health values judged against the athlete's own normal range.
 *
 * A single morning value is noise (one late dinner moves HRV and resting
 * heart rate). What matters is the 7-day average against the personal
 * baseline of the last 60 days, the approach of HRV4Training and Plews et al.
 * HRV is compared on the log scale because it is skewed. Readings from
 * different methods (rMSSD vs. SDNN) are never mixed.
 */
import { addDays, type ISODate } from "@/lib/dates";

export interface WellnessDay {
  date: ISODate;
  restingHr: number | null;
  hrv: number | null;
  hrvSdnn: number | null;
  sleepSec: number | null;
  weightKg: number | null;
  legs: number | null;
  sleepFeel: number | null;
  motivation: number | null;
}

export type WellnessMetric = "restingHr" | "hrv" | "hrvSdnn" | "sleepSec" | "weightKg";

export interface MetricTrend {
  metric: WellnessMetric;
  latest: { date: ISODate; value: number } | null;
  /** Mean of the last 7 days (at least 3 values). */
  avg7: number | null;
  /** Normal range from the last 60 days (at least 14 values). */
  baseline: { mean: number; low: number; high: number; n: number } | null;
  /** Where the 7-day average sits relative to the normal range. */
  status: "low" | "normal" | "high" | null;
  /** Daily values of the last 60 days, oldest first. */
  series: { date: ISODate; value: number }[];
}

const BASELINE_DAYS = 60;
const MIN_BASELINE = 14;
const MIN_WEEK = 3;
/** Width of the normal range in standard deviations of the daily values. */
const BAND_SD = 0.75;
/** Smallest half-width of the normal range, so very stable values do not flag every wobble. */
const MIN_HALF_WIDTH: Record<WellnessMetric, number> = { restingHr: 2, hrv: 0.05, hrvSdnn: 0.05, sleepSec: 20 * 60, weightKg: 0.4 };
const LOG_SCALE = new Set<WellnessMetric>(["hrv", "hrvSdnn"]);

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1));
};

export function metricTrend(days: WellnessDay[], metric: WellnessMetric, today: ISODate): MetricTrend {
  const from = addDays(today, -(BASELINE_DAYS - 1));
  const series = days
    .filter((d) => d.date >= from && d.date <= today && d[metric] !== null && (d[metric] as number) > 0)
    .map((d) => ({ date: d.date, value: d[metric] as number }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = series.at(-1) ?? null;
  const week = series.filter((p) => p.date > addDays(today, -7)).map((p) => p.value);
  const avg7 = week.length >= MIN_WEEK ? mean(week) : null;

  let baseline: MetricTrend["baseline"] = null;
  if (series.length >= MIN_BASELINE) {
    const log = LOG_SCALE.has(metric);
    const values = series.map((p) => (log ? Math.log(p.value) : p.value));
    const m = mean(values);
    const half = Math.max(MIN_HALF_WIDTH[metric], BAND_SD * sd(values));
    baseline = log ? { mean: Math.exp(m), low: Math.exp(m - half), high: Math.exp(m + half), n: series.length } : { mean: m, low: m - half, high: m + half, n: series.length };
  }
  const status = avg7 === null || !baseline ? null : avg7 < baseline.low ? "low" : avg7 > baseline.high ? "high" : "normal";
  return { metric, latest, avg7, baseline, status, series };
}

/** rMSSD when the athlete has it, otherwise SDNN (Apple Watch). */
export function hrvTrend(days: WellnessDay[], today: ISODate): MetricTrend {
  const rmssd = metricTrend(days, "hrv", today);
  if (rmssd.series.length) return rmssd;
  return metricTrend(days, "hrvSdnn", today);
}

export type SignalState = "good" | "normal" | "negative";

export interface RecoverySignal {
  key: "hrv" | "restingHr" | "sleep" | "checkin";
  label: string;
  state: SignalState;
  text: string;
}

export interface Recovery {
  level: "normal" | "slightly" | "impaired";
  label: string;
  advice: string;
  signals: RecoverySignal[];
  /** Short list of the negative signals for adaptation notes ("HRV unter Normalbereich, Ruhepuls erhöht"). */
  reasons: string[];
}

/** Sleep below this 7-day average counts as short regardless of the athlete's habit. */
const SHORT_SLEEP_SEC = 6.5 * 3600;

export function checkinScore(d: Pick<WellnessDay, "legs" | "sleepFeel" | "motivation"> | undefined): number | null {
  if (!d) return null;
  const v = [d.legs, d.sleepFeel, d.motivation].filter((x): x is number => x !== null && x > 0);
  return v.length ? mean(v) : null;
}

/**
 * Recovery from the signals the athlete actually has. Each signal counts
 * once; two or more negative signals mean recovery is impaired.
 */
export function recoveryFrom(days: WellnessDay[], today: ISODate): Recovery | null {
  const signals: RecoverySignal[] = [];

  const hrv = hrvTrend(days, today);
  if (hrv.status) {
    const state: SignalState = hrv.status === "low" ? "negative" : hrv.status === "high" ? "good" : "normal";
    signals.push({ key: "hrv", label: "HRV", state, text: state === "negative" ? "unter deinem Normalbereich" : state === "good" ? "über deinem Normalbereich" : "im Normalbereich" });
  }
  const rhr = metricTrend(days, "restingHr", today);
  if (rhr.status) {
    const state: SignalState = rhr.status === "high" ? "negative" : rhr.status === "low" ? "good" : "normal";
    signals.push({ key: "restingHr", label: "Ruhepuls", state, text: state === "negative" ? "erhöht" : state === "good" ? "niedriger als üblich" : "im Normalbereich" });
  }
  const sleep = metricTrend(days, "sleepSec", today);
  if (sleep.avg7 !== null) {
    const short = sleep.avg7 < SHORT_SLEEP_SEC || sleep.status === "low";
    signals.push({ key: "sleep", label: "Schlaf", state: short ? "negative" : "normal", text: short ? "kürzer als üblich" : "ausreichend" });
  }
  const score = checkinScore(days.find((d) => d.date === today));
  if (score !== null) {
    const state: SignalState = score <= 2 ? "negative" : score >= 4 ? "good" : "normal";
    signals.push({ key: "checkin", label: "Check-in", state, text: state === "negative" ? "du fühlst dich schlapp" : state === "good" ? "du fühlst dich gut" : "durchschnittlich" });
  }
  if (!signals.length) return null;

  const negative = signals.filter((s) => s.state === "negative");
  const reasons = negative.map((s) => `${s.label} ${s.text}`);
  if (negative.length >= 2)
    return { level: "impaired", label: "Eingeschränkt", advice: "Mehrere Signale zeigen unvollständige Erholung. Harte Einheiten heute besser kürzer und leichter.", signals, reasons };
  if (negative.length === 1)
    return { level: "slightly", label: "Leicht eingeschränkt", advice: "Ein Signal weicht ab. Kein Grund, den Plan zu ändern, aber achte auf dein Gefühl in der Einheit.", signals, reasons };
  return { level: "normal", label: "Normal", advice: "Deine Erholungswerte liegen im gewohnten Bereich.", signals, reasons };
}
