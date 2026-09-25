/**
 * Readiness for today's training from the performance management chart.
 *
 * Form is judged relative to fitness (TSB as percent of CTL, the scale
 * intervals.icu and TrainingPeaks coaches use): an athlete with CTL 30 is
 * deeper in the hole at TSB -20 than one with CTL 90. A fast rise in fitness
 * (ramp rate) adds risk on top.
 *
 *   form > +5 %          fresh         keep the plan
 *   -30 % ... +5 %       productive    keep the plan (this is where training works)
 *   -40 % ... -30 %      strained      reduce hard sessions
 *   below -40 %          overreached   replace hard sessions with easy ones
 *   ramp > 8 CTL / week  at least "strained" once form is below -20 %
 */
import type { PmcPoint } from "./load";

export type ReadinessLevel = "fresh" | "productive" | "strained" | "overreached";
export type AdaptMode = "keep" | "reduce" | "recover";

export interface Readiness {
  level: ReadinessLevel;
  /** TSB as percent of CTL (negative = fatigued). */
  formPct: number;
  /** CTL change over the last 7 days. */
  ramp: number;
  ctl: number;
  atl: number;
  tsb: number;
  mode: AdaptMode;
  label: string;
  advice: string;
}

/** CTL floor for the relative form, so beginners with tiny CTL are not over-flagged. */
const MIN_CTL = 20;
const RAMP_LIMIT = 8;

export function readinessFromPmc(pmc: PmcPoint[]): Readiness | null {
  const now = pmc.at(-1);
  if (!now) return null;
  const weekAgo = pmc.length >= 8 ? pmc[pmc.length - 8] : pmc[0];
  const ramp = Math.round((now.ctl - weekAgo.ctl) * 10) / 10;
  const formPct = Math.round((now.tsb / Math.max(now.ctl, MIN_CTL)) * 100);

  let level: ReadinessLevel = formPct > 5 ? "fresh" : formPct >= -30 ? "productive" : formPct >= -40 ? "strained" : "overreached";
  if (level === "productive" && ramp > RAMP_LIMIT && formPct < -20) level = "strained";

  const texts: Record<ReadinessLevel, { label: string; advice: string; mode: AdaptMode }> = {
    fresh: { label: "Frisch", advice: "Gute Voraussetzungen für harte Einheiten.", mode: "keep" },
    productive: { label: "Im Training", advice: "Belastung und Erholung passen, der Plan bleibt wie er ist.", mode: "keep" },
    strained: {
      label: "Stark belastet",
      advice:
        ramp > RAMP_LIMIT && formPct >= -30
          ? `Deine Fitness steigt sehr schnell (+${ramp} pro Woche). Harte Einheiten werden etwas kürzer und leichter.`
          : "Die Ermüdung ist hoch. Harte Einheiten werden etwas kürzer und leichter.",
      mode: "reduce",
    },
    overreached: { label: "Erholung nötig", advice: "Sehr hohe Ermüdung. Harte Einheiten werden durch lockere ersetzt, bis du wieder frischer bist.", mode: "recover" },
  };
  const t = texts[level];
  return { level, formPct, ramp, ctl: now.ctl, atl: now.atl, tsb: now.tsb, mode: t.mode, label: t.label, advice: t.advice };
}
