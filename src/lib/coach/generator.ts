/**
 * Deterministic workout and plan generator.
 *
 * Used directly when no AI key is configured, and as the structural backbone
 * the AI coach is compared against. Workouts are produced in text notation and
 * parsed, so every generated workout is valid by construction.
 */
import { addDays, dayOfWeek, diffDays, startOfWeek, type ISODate } from "../dates";
import { summarize } from "../workout/metrics";
import { TEMPLATES } from "../workout/templates";
import { parseWorkoutText } from "../workout/text";
import type { Sport, Thresholds, WorkoutStructure } from "../workout/types";
import type { PlanProposal, PlanWeek, PlannedSession } from "./types";

export type Focus = "recovery" | "endurance" | "tempo" | "threshold" | "vo2" | "anaerobic" | "strength-legs" | "strength-upper" | "strength-full";

export const FOCUS_LABEL: Record<Focus, string> = {
  recovery: "Regeneration",
  endurance: "Grundlage",
  tempo: "Tempo",
  threshold: "Schwelle",
  vo2: "VO2max",
  anaerobic: "Sprints",
  "strength-legs": "Kraft Beine",
  "strength-upper": "Kraft Oberkörper",
  "strength-full": "Kraft Ganzkörper",
};

export interface GeneratedWorkout {
  name: string;
  description: string;
  sport: Sport;
  text: string;
  structure: WorkoutStructure;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/** Warm-up / cool-down lengths scaled to the session length. */
function frame(m: number) {
  if (m < 45) return { wu: 8, cd: 5 };
  if (m < 75) return { wu: 12, cd: 8 };
  return { wu: 15, cd: 10 };
}

function build(sport: Sport, name: string, description: string, text: string, t: Thresholds): GeneratedWorkout {
  const parsed = parseWorkoutText(text, sport, t);
  if (parsed.errors.length) throw new Error(`Generator produced invalid workout: ${parsed.errors[0].message} in ${text}`);
  return { name, description, sport, text, structure: parsed.structure };
}

/** Builds a workout of roughly `minutes` length for a focus. */
export function generateWorkout(sport: Sport, focus: Focus, minutes: number, t: Thresholds): GeneratedWorkout {
  if (sport === "strength" || focus.startsWith("strength")) {
    const id = focus === "strength-upper" ? "strength-upper" : focus === "strength-legs" ? "strength-legs" : "strength-full";
    const tpl = TEMPLATES.find((x) => x.id === id)!;
    return build("strength", tpl.name, tpl.description, tpl.text, t);
  }
  const m = clamp(Math.round(minutes), 20, 360);
  const ride = sport === "ride";
  const z = (ridePct: string, runZone: string) => (ride ? ridePct : runZone);

  switch (focus) {
    case "recovery": {
      const main = m - 10;
      return build(
        sport,
        ride ? "Aktive Erholung" : "Regenerationslauf",
        "Sehr locker, Puls niedrig halten. Ziel ist Durchblutung, nicht Training.",
        `Aufwärmen 5min ${z("45-50%", "Z1")}\n${main}min ${z("50-55% 90-95rpm", "Z1")}\nCool-down 5min ${z("45%", "Z1")}`,
        t,
      );
    }
    case "endurance": {
      const wu = m >= 90 ? 15 : 10;
      const cd = m >= 90 ? 10 : 5;
      const main = m - wu - cd;
      return build(
        sport,
        ride ? `Grundlage ${m} min` : `Dauerlauf ${m} min`,
        "Gleichmäßig im Grundlagenbereich. Du solltest dich jederzeit unterhalten können.",
        `Aufwärmen ${wu}min ${z("50-60%", "Z1")}\n${main}min ${z("65-75% 85-95rpm", "Z2")}\nCool-down ${cd}min ${z("50%", "Z1")}`,
        t,
      );
    }
    case "tempo": {
      const { wu, cd } = frame(m);
      const available = m - wu - cd;
      const block = available >= 60 ? 15 : available >= 40 ? 12 : 8;
      const rec = 4;
      const n = clamp(Math.floor((available + rec) / (block + rec)), 1, 5);
      const used = n * block + (n - 1) * rec;
      const extra = Math.max(0, available - used - rec);
      const lines = [`Aufwärmen ${wu}min ${z("50-65%", "Z1-Z2")}`, `${n}x (${block}min ${z("80-88%", "Z3")}, Erholung ${rec}min ${z("55%", "Z1")})`];
      if (extra >= 5) lines.push(`${extra}min ${z("65-72%", "Z2")}`);
      lines.push(`Cool-down ${cd}min ${z("50%", "Z1")}`);
      return build(sport, `Tempo ${n}x${block}`, "Zügig, aber kontrolliert. Die Atmung ist tief, Sprechen nur in kurzen Sätzen.", lines.join("\n"), t);
    }
    case "threshold": {
      const { wu, cd } = frame(m);
      const available = m - wu - cd;
      const block = ride ? (available >= 55 ? 20 : available >= 40 ? 12 : 8) : available >= 45 ? 10 : 6;
      const rec = ride ? (block >= 20 ? 5 : 4) : 2;
      const n = clamp(Math.floor((available + rec) / (block + rec)), 1, 4);
      const target = ride ? (block >= 20 ? "88-94%" : "95-100%") : "Z4";
      const used = n * block + n * rec;
      const extra = Math.max(0, available - used);
      const lines = [`Aufwärmen ${wu}min ${z("50-70%", "Z1-Z2")}`, `${n}x (${block}min ${target}, Erholung ${rec}min ${z("55%", "Z1")})`];
      if (extra >= 5) lines.push(`${extra}min ${z("65-72%", "Z2")}`);
      lines.push(`Cool-down ${cd}min ${z("50%", "Z1")}`);
      const label = ride && block >= 20 ? "Sweet Spot" : "Schwelle";
      return build(sport, `${label} ${n}x${block}`, "Gleichmäßig an der Schwelle. Das letzte Intervall soll hart, aber machbar sein.", lines.join("\n"), t);
    }
    case "vo2": {
      const { wu, cd } = frame(m);
      const available = m - wu - cd;
      const on = ride ? (available < 25 ? 3 : 4) : available < 25 ? 2 : 3;
      const off = ride ? on : 2;
      const n = clamp(Math.floor(available / (on + off)), 2, 8);
      const extra = Math.max(0, available - n * (on + off));
      const lines = [`Aufwärmen ${wu}min ${z("50-70%", "Z1-Z2")}`, `${n}x (${on}min ${z("110-118%", "Z5")}, Erholung ${off}min ${z("50%", "Z1")})`];
      if (extra >= 5) lines.push(`${extra}min ${z("60-70%", "Z2")}`);
      lines.push(`Cool-down ${cd}min ${z("50%", "Z1")}`);
      return build(sport, `VO2max ${n}x${on} min`, "Harte Intervalle nahe der maximalen Sauerstoffaufnahme. Gleichmäßig starten, nicht überpacen.", lines.join("\n"), t);
    }
    case "anaerobic": {
      const { wu, cd } = frame(m);
      const available = m - wu - cd;
      const n = clamp(Math.floor(available / 5), 3, 10);
      const extra = Math.max(0, available - n * 5);
      const filler = extra >= 5 ? `\n${extra}min ${z("65-72%", "Z2")}` : "";
      const text = ride
        ? `Aufwärmen ${wu}min 50-70%\n${n}x (15s 200% 110-120rpm, Erholung 4min 45s 50%)${filler}\nCool-down ${cd}min 50%`
        : `Aufwärmen ${wu}min Z1-Z2\n${n}x ("Sprint" 20s Z7, Erholung 4min 40s Z1)${filler}\nCool-down ${cd}min Z1`;
      return build(sport, `Sprints ${n}x`, "Maximale, kurze Belastungen mit vollständiger Erholung. Qualität vor Quantität.", text, t);
    }
    default:
      return generateWorkout(sport, "endurance", m, t);
  }
}

// ---------------------------------------------------------------------------
// Request interpretation (rule-based coach)
// ---------------------------------------------------------------------------

export interface WorkoutRequest {
  sport: Sport | null;
  minutes: number | null;
  focus: Focus | null;
}

export function interpretRequest(text: string): WorkoutRequest {
  const s = text.toLowerCase();
  let sport: Sport | null = null;
  if (/(kraft|gym|studio|fitnessstudio|hantel|strength|gewicht)/.test(s)) sport = "strength";
  else if (/(lauf|laufen|run|joggen|jog|renn)/.test(s)) sport = "run";
  else if (/(rad|bike|ride|fahr|zwift|rolle|trainer|kickr|velo|cycling)/.test(s)) sport = "ride";

  let minutes: number | null = null;
  const h = /(\d+(?:[.,]\d+)?)\s*(?:h|std|stunden?)/.exec(s);
  const m = /(\d+)\s*(?:min|minuten|m\b)/.exec(s);
  if (h) minutes = Math.round(Number(h[1].replace(",", ".")) * 60) + (m ? Number(m[1]) : 0);
  else if (m) minutes = Number(m[1]);

  let focus: Focus | null = null;
  if (/(regener|erhol|recovery|ganz locker|müde|muede|platt|kaputt)/.test(s)) focus = "recovery";
  else if (/(vo2|intervall|hart|knackig|4x4|5x4|30\/30)/.test(s)) focus = "vo2";
  else if (/(sprint|antritt|anaerob|kurz und hart)/.test(s)) focus = "anaerobic";
  else if (/(schwelle|ftp|sweet ?spot|threshold|laktat)/.test(s)) focus = "threshold";
  else if (/(tempo|zügig|zuegig)/.test(s)) focus = "tempo";
  else if (/(grundlage|locker|ga1|ausdauer|lang|zone 2|z2|easy)/.test(s)) focus = "endurance";
  if (sport === "strength") {
    if (/(bein|unterkörper|squat|kniebeuge)/.test(s)) focus = "strength-legs";
    else if (/(oberkörper|brust|rücken|arme|push|pull)/.test(s)) focus = "strength-upper";
    else focus = "strength-full";
  }
  return { sport, minutes, focus };
}

/** Picks a focus from current form (TSB) when the athlete did not specify one. */
export function focusForForm(tsb: number | null): Focus {
  if (tsb === null) return "tempo";
  if (tsb < -25) return "recovery";
  if (tsb < -10) return "endurance";
  if (tsb < 5) return "threshold";
  return "vo2";
}

const HARD: Focus[] = ["threshold", "vo2", "anaerobic"];
export const isHard = (f: Focus) => HARD.includes(f);

// ---------------------------------------------------------------------------
// Training plans
// ---------------------------------------------------------------------------

export interface PlanRequest {
  goal: string;
  sport: Sport | "mixed";
  /** Event day, or null for an open-ended build block. */
  eventDate: ISODate | null;
  /** Used when there is no event. */
  weeks: number;
  hoursPerWeek: number;
  /** 0 = Monday ... 6 = Sunday */
  trainingDays: number[];
  longDay: number;
  strength: boolean;
  startDate: ISODate;
}

type Phase = PlanWeek["phase"];

const PHASE_LABEL: Record<Phase, string> = {
  base: "Grundlagenaufbau",
  build: "Aufbau",
  peak: "Spitze",
  taper: "Tapering",
  recovery: "Entlastung",
  race: "Wettkampfwoche",
};

const PHASE_FOCUS: Record<Phase, string> = {
  base: "Aerobe Basis aufbauen, Tempo dosiert",
  build: "Schwelle und VO2max entwickeln",
  peak: "Wettkampfspezifisch, hohe Qualität",
  taper: "Umfang reduzieren, Frische aufbauen",
  recovery: "Erholen und Anpassungen festigen",
  race: "Locker bleiben, Beine wach halten",
};

export function planPhases(weeks: number, hasEvent: boolean): Phase[] {
  const phases: Phase[] = [];
  const raceWeeks = hasEvent ? 1 : 0;
  const taperWeeks = hasEvent && weeks >= 8 ? 1 : 0;
  const training = weeks - raceWeeks - taperWeeks;
  const baseWeeks = Math.round(training * 0.45);
  const peakWeeks = hasEvent ? Math.max(1, Math.round(training * 0.15)) : 0;
  for (let i = 0; i < training; i++) {
    // Every fourth week is a recovery week (3:1).
    if (i % 4 === 3 && i < training - 1) phases.push("recovery");
    else if (i < baseWeeks) phases.push("base");
    else if (i >= training - peakWeeks) phases.push("peak");
    else phases.push("build");
  }
  for (let i = 0; i < taperWeeks; i++) phases.push("taper");
  for (let i = 0; i < raceWeeks; i++) phases.push("race");
  return phases;
}

const VOLUME: Record<Phase, number> = { base: 0.9, build: 1.0, peak: 1.02, taper: 0.65, recovery: 0.6, race: 0.45 };

interface SessionSpec {
  day: number;
  sport: Sport;
  focus: Focus;
  share: number;
}

function sessionSpecs(req: PlanRequest, phase: Phase, weekIndex: number): SessionSpec[] {
  const days = [...new Set(req.trainingDays)].sort((a, b) => a - b);
  const longDay = days.includes(req.longDay) ? req.longDay : days[days.length - 1];
  const others = days.filter((d) => d !== longDay);
  const endurance: Sport[] = req.sport === "mixed" ? ["ride", "run"] : [req.sport === "strength" ? "ride" : req.sport];
  const sportAt = (i: number) => endurance[i % endurance.length];

  // Key sessions by phase.
  const keys: Focus[] =
    phase === "base"
      ? ["tempo"]
      : phase === "build"
        ? ["threshold", "vo2"]
        : phase === "peak"
          ? ["vo2", "threshold"]
          : phase === "taper"
            ? ["vo2"]
            : phase === "race"
              ? ["anaerobic"]
              : [];

  const specs: SessionSpec[] = [];
  // Spread key sessions over non-adjacent days where possible.
  const keyDays = pickSpread(others, keys.length);
  let strengthLeft = req.strength && phase !== "race" && phase !== "taper" ? (phase === "base" ? 2 : 1) : 0;

  others.forEach((d, i) => {
    const k = keyDays.indexOf(d);
    if (k >= 0) specs.push({ day: d, sport: sportAt(i + weekIndex), focus: keys[k], share: 0.2 });
    else if (strengthLeft > 0 && (i % 2 === 1 || others.length - i <= strengthLeft)) {
      specs.push({ day: d, sport: "strength", focus: phase === "base" && strengthLeft === 2 ? "strength-legs" : "strength-full", share: 0.1 });
      strengthLeft--;
    } else specs.push({ day: d, sport: sportAt(i + weekIndex), focus: phase === "recovery" || phase === "race" ? "recovery" : "endurance", share: 0.14 });
  });
  specs.push({ day: longDay, sport: req.sport === "mixed" ? (weekIndex % 2 === 0 ? "ride" : "run") : endurance[0], focus: "endurance", share: 0.34 });
  return specs.sort((a, b) => a.day - b.day);
}

function pickSpread(days: number[], n: number): number[] {
  if (n <= 0 || days.length === 0) return [];
  if (n >= days.length) return days.slice(0, n);
  const picked: number[] = [];
  const step = days.length / n;
  for (let i = 0; i < n; i++) picked.push(days[Math.floor(i * step + step / 2 - 0.5)] ?? days[i]);
  return [...new Set(picked)];
}

export function nextMonday(today: ISODate): ISODate {
  return dayOfWeek(today) === 0 ? today : addDays(startOfWeek(today), 7);
}

export function generatePlan(req: PlanRequest, t: Thresholds): PlanProposal {
  const start = startOfWeek(req.startDate);
  const weeksCount = req.eventDate ? clamp(Math.ceil((diffDays(req.eventDate, start) + 1) / 7), 3, 24) : clamp(req.weeks, 3, 24);
  const phases = planPhases(weeksCount, Boolean(req.eventDate));
  const weeks: PlanWeek[] = [];

  phases.forEach((phase, i) => {
    const weekStart = addDays(start, i * 7);
    const blockPos = i % 4; // gentle progression inside each 3:1 block
    const progression = phase === "recovery" ? 1 : 1 + blockPos * 0.05;
    const weeklyMinutes = req.hoursPerWeek * 60 * VOLUME[phase] * progression;
    const specs = sessionSpecs(req, phase, i);
    // Strength sessions have a fixed length; the rest of the time goes to endurance.
    const strengthCount = specs.filter((s) => s.sport === "strength").length;
    const enduranceMinutes = Math.max(60, weeklyMinutes - strengthCount * 45);
    const totalShare = specs.filter((s) => s.sport !== "strength").reduce((a, s) => a + s.share, 0);
    const sessions: PlannedSession[] = [];

    for (const spec of specs) {
      const date = addDays(weekStart, spec.day);
      if (date < req.startDate) continue;
      if (req.eventDate && date > req.eventDate) continue;
      if (req.eventDate && date === req.eventDate) {
        sessions.push(eventSession(req, spec.day, t));
        continue;
      }
      const raw = (enduranceMinutes * spec.share) / totalShare;
      // Keep single sessions within sensible bounds (long runs beyond ~2 h add injury risk).
      const cap = spec.sport === "run" ? (spec.share > 0.3 ? 120 : 75) : spec.share > 0.3 ? 300 : 120;
      const minutes = r5(Math.min(cap, raw));
      const w = generateWorkout(spec.sport, spec.focus, spec.sport === "strength" ? 45 : minutes, t);
      const isLong = spec.share > 0.3 && spec.focus === "endurance";
      const name = isLong ? (spec.sport === "run" ? `Langer Lauf ${minutes} min` : `Lange Ausfahrt ${Math.round((minutes / 60) * 10) / 10} h`.replace(".", ",")) : w.name;
      sessions.push({ day: spec.day, name, description: w.description, sport: w.sport, structure: w.structure });
    }
    if (req.eventDate && req.eventDate >= weekStart && req.eventDate <= addDays(weekStart, 6) && !sessions.some((s) => addDays(weekStart, s.day) === req.eventDate)) {
      sessions.push(eventSession(req, diffDays(req.eventDate, weekStart), t));
      sessions.sort((a, b) => a.day - b.day);
    }

    const targetTss = Math.round(sessions.reduce((a, s) => a + summarize(s.structure, t).tss, 0));
    weeks.push({ index: i, startDate: weekStart, phase, focus: PHASE_FOCUS[phase], targetTss, sessions });
  });

  const endDate = addDays(start, weeksCount * 7 - 1);
  const sportLabel = req.sport === "ride" ? "Rad" : req.sport === "run" ? "Lauf" : req.sport === "strength" ? "Kraft" : "Ausdauer";
  return {
    name: req.goal.trim() ? req.goal.trim().slice(0, 60) : `${sportLabel}-Plan ${weeksCount} Wochen`,
    goal: req.goal,
    sport: req.sport,
    startDate: start,
    endDate: req.eventDate && req.eventDate < endDate ? req.eventDate : endDate,
    summary: `${weeksCount} Wochen, ${req.trainingDays.length} Einheiten pro Woche, ca. ${req.hoursPerWeek} h. Periodisiert in ${[...new Set(phases)].map((p) => PHASE_LABEL[p]).join(", ")} mit einer Entlastungswoche nach jeweils drei Belastungswochen.`,
    weeks,
  };
}

function eventSession(req: PlanRequest, day: number, t: Thresholds): PlannedSession {
  const sport: Sport = req.sport === "mixed" || req.sport === "strength" ? "run" : req.sport;
  const w = build(sport, "Wettkampf", "Dein Ziel-Event. Viel Erfolg!", sport === "ride" ? "Aufwärmen 15min 50-70%\n\"Wettkampf\" offen" : "Aufwärmen 15min Z1-Z2\n\"Wettkampf\" offen", t);
  return { day, name: `${req.goal.trim() || "Wettkampf"}`.slice(0, 60), description: w.description, sport, structure: w.structure };
}
