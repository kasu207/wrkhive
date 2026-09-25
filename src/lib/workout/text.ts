/**
 * Plain-text workout notation ("Schnelleingabe").
 *
 * Designed to be typed quickly and read naturally, and to round-trip with the
 * visual builder. Examples:
 *
 *   Aufwärmen 10min 50-65%
 *   5x (3min 110%, 2min 55%)
 *   Cool-down 10min 50%
 *
 *   2km Z2, 6x (400m 4:00/km, 90s Pause), 2km locker
 *
 *   3x10 Kniebeuge (Langhantel) 60kg Pause 2min
 *
 * Units: h, min (also "m" below 100 and '), s (also "), km, m (>= 100) or mtr.
 * Targets: 90% or 88-94% (power for rides, pace for runs; add "hr" for heart
 * rate), 250W, 4:30/km, 150bpm, Z1..Z7, GA1/GA2/KB/EB/SB, RPE 7, 90rpm.
 */
import { findExercise, getExercise } from "./exercises";
import { formatPace } from "../format";
import { newId } from "../id";
import type { Duration, Repeat, Sport, Step, StepKind, Target, Thresholds, WorkoutNode, WorkoutStructure } from "./types";
import { zoneRange, type ZoneIndex } from "./zones";

export interface ParseIssue {
  line: number;
  message: string;
}

export interface ParseResult {
  structure: WorkoutStructure;
  errors: ParseIssue[];
}

const KIND_WORDS: Record<string, StepKind> = {
  aufwärmen: "warmup",
  aufwaermen: "warmup",
  warmup: "warmup",
  "warm-up": "warmup",
  wu: "warmup",
  einfahren: "warmup",
  einlaufen: "warmup",
  einrollen: "warmup",
  "cool-down": "cooldown",
  cooldown: "cooldown",
  cd: "cooldown",
  ausfahren: "cooldown",
  auslaufen: "cooldown",
  ausrollen: "cooldown",
  abwärmen: "cooldown",
  erholung: "recovery",
  recovery: "recovery",
  rec: "recovery",
  locker: "recovery",
  easy: "recovery",
  pause: "rest",
  rest: "rest",
  ruhe: "rest",
  belastung: "active",
  intervall: "active",
  interval: "active",
  work: "active",
  active: "active",
};

/** German training-zone vocabulary -> zone index. */
const GERMAN_ZONES: Record<string, ZoneIndex> = { kb: 1, ga1: 2, ga2: 3, eb: 4, sb: 5 };

const DASH = "\\s*(?:-|–|bis)\\s*";
const NUM = "(\\d+(?:[.,]\\d+)?)";

function num(s: string): number {
  return Number(s.replace(",", "."));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Split on top-level separators (newline, comma, semicolon), respecting parentheses and decimal commas. */
function splitTopLevel(text: string, separators = /[\n,;]/): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    const isDecimalComma = ch === "," && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "");
    if (depth === 0 && separators.test(ch) && !isDecimalComma) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

interface RawItem {
  text: string;
  line: number;
  children?: { text: string; line: number }[];
}

/** First pass: lines -> items, supporting the indented multi-line repeat form. */
function collectItems(text: string): RawItem[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const items: RawItem[] = [];
  let open: RawItem | null = null;
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (!raw.trim() || raw.trim().startsWith("#")) return;
    const isChild = /^(\s+|\s*[-•*]\s)/.test(raw);
    if (open && isChild) {
      const body = raw.replace(/^\s*[-•*]?\s*/, "");
      for (const part of splitTopLevel(body)) open.children!.push({ text: part, line });
      return;
    }
    open = null;
    if (/^\s*\d+\s*[x×]\s*:?\s*$/i.test(raw)) {
      open = { text: raw.trim(), line, children: [] };
      items.push(open);
      return;
    }
    for (const part of splitTopLevel(raw)) items.push({ text: part, line });
  });
  return items;
}

export function parseWorkoutText(text: string, sport: Sport, t: Thresholds): ParseResult {
  const errors: ParseIssue[] = [];
  const nodes: WorkoutNode[] = [];

  for (const item of collectItems(text)) {
    const err = (message: string, line = item.line) => errors.push({ line, message });

    if (item.children) {
      const count = Number(/^(\d+)/.exec(item.text)![1]);
      const steps: Step[] = [];
      for (const child of item.children) {
        const s = parseStep(child.text, sport, t, (m) => err(m, child.line));
        if (s) steps.push(s);
      }
      if (steps.length === 0) err("Wiederholung ohne Schritte.");
      else nodes.push(makeRepeat(count, steps, err));
      continue;
    }

    const text = item.text;
    const opens = (text.match(/\(/g) ?? []).length;
    const closes = (text.match(/\)/g) ?? []).length;
    if (opens !== closes) {
      err(`„${text}“: Klammer nicht geschlossen.`);
      continue;
    }

    // 5x (3min 110%, 2min 55%)
    const group = /^(\d+)\s*[x×]\s*\((.*)\)\s*$/is.exec(text);
    if (group) {
      const inner = group[2];
      if (/\d+\s*[x×]\s*\(/i.test(inner)) {
        err("Verschachtelte Wiederholungen werden nicht unterstützt.");
        continue;
      }
      const steps = splitTopLevel(inner)
        .map((p) => parseStep(p, sport, t, err))
        .filter((s): s is Step => s !== null);
      if (steps.length) nodes.push(makeRepeat(Number(group[1]), steps, err));
      continue;
    }

    // Strength: 3x10 Kniebeuge 60kg Pause 90s
    const sets = sport === "strength" && /^(\d+)\s*[x×]\s*(\d+)(?!\s*(?:min|m\b|s\b|sek|sec|h\b|km|mtr|%|'|"|:))\s+(.+)$/i.exec(text);
    if (sets) {
      const node = parseSetsShorthand(Number(sets[1]), Number(sets[2]), sets[3], err);
      if (node) nodes.push(node);
      continue;
    }

    // 5x 3min 110% / 2min 55%   or   3x 10min 95%
    const inline = /^(\d+)\s*[x×]\s*(.+)$/i.exec(text);
    if (inline) {
      const steps = inline[2]
        .split(/\s\/\s/)
        .map((p) => parseStep(p, sport, t, err))
        .filter((s): s is Step => s !== null);
      if (steps.length) nodes.push(makeRepeat(Number(inline[1]), steps, err));
      continue;
    }

    const step = parseStep(text, sport, t, err);
    if (step) nodes.push(step);
  }

  inferKinds(nodes);
  return { structure: { sport, nodes }, errors };
}

function makeRepeat(count: number, steps: Step[], err: (m: string) => void): Repeat {
  if (count < 1 || count > 99) err("Wiederholungen müssen zwischen 1 und 99 liegen.");
  return { id: newId(), type: "repeat", count: Math.min(99, Math.max(1, count)), steps };
}

function parseSetsShorthand(sets: number, reps: number, rest: string, err: (m: string) => void): WorkoutNode | null {
  const [exercisePart, pausePart] = rest.split(/\b(?:pause|rest|ruhe)\b/i);
  let weightKg: number | undefined;
  const words: string[] = [];
  for (const token of exercisePart.replace(/@/g, " ").trim().split(/\s+/)) {
    const w = /^(\d+(?:[.,]\d+)?)\s*kg$/i.exec(token);
    if (w) weightKg = num(w[1]);
    else if (token) words.push(token);
  }
  // "60 kg" written with a space
  const joined = words.join(" ");
  const spaced = /(.*?)\s*(\d+(?:[.,]\d+)?)\s+kg\s*$/i.exec(joined);
  const name = spaced ? spaced[1] : joined;
  if (spaced) weightKg = num(spaced[2]);

  const exercise = findExercise(name);
  if (!exercise) {
    err(`Übung „${name}“ nicht gefunden.`);
    return null;
  }
  let restSeconds = 90;
  if (pausePart !== undefined) {
    const d = parseDurationOnly(pausePart);
    if (d === null) err("Pausendauer nicht erkannt, z. B. „Pause 90s“.");
    else restSeconds = d;
  }
  const work: Step = {
    id: newId(),
    type: "step",
    kind: "active",
    duration: { type: "reps", reps },
    target: { type: "none" },
    exercise: { key: exercise.key, ...(weightKg !== undefined && exercise.weighted ? { weightKg } : {}) },
  };
  const steps: Step[] = [work];
  if (restSeconds > 0) {
    steps.push({ id: newId(), type: "step", kind: "rest", duration: { type: "time", seconds: restSeconds }, target: { type: "none" } });
  }
  if (sets < 1 || sets > 99) err("Sätze müssen zwischen 1 und 99 liegen.");
  return { id: newId(), type: "repeat", count: Math.min(99, Math.max(1, sets)), steps };
}

function parseDurationOnly(text: string): number | null {
  let total = 0;
  let found = false;
  const re = /(\d+(?:[.,]\d+)?)\s*(h|std|min|m|'|s|sek|sec|")/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    found = true;
    const v = num(m[1]);
    const u = m[2].toLowerCase();
    total += u === "h" || u === "std" ? v * 3600 : u === "s" || u === "sek" || u === "sec" || u === '"' ? v : v * 60;
  }
  const mmss = /(\d+):(\d{2})/.exec(text);
  if (!found && mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  return found ? Math.round(total) : null;
}

type PctKind = "power" | "hr" | "pace";

function pctKindFromSuffix(suffix: string | undefined, sport: Sport): PctKind | null {
  switch (suffix?.toLowerCase()) {
    case "ftp":
      return "power";
    case "hr":
    case "hf":
    case "lthr":
      return "hr";
    case "pace":
      return "pace";
  }
  if (sport === "ride") return "power";
  if (sport === "run") return "pace";
  return null;
}

/** Parses a single step. Returns null (and reports) on failure. */
export function parseStep(input: string, sport: Sport, t: Thresholds, err: (m: string) => void): Step | null {
  const original = input.trim();
  let rest = original;
  const lower = () => rest.toLowerCase();

  let seconds = 0;
  let hasTime = false;
  let meters: number | null = null;
  let reps: number | null = null;
  let open = false;
  let target: Target | null = null;
  let cadence: { low: number; high: number } | undefined;
  let weightKg: number | undefined;
  let name: string | undefined;
  let kind: StepKind | undefined;
  const words: string[] = [];

  const setTarget = (tg: Target) => {
    if (target) err(`„${original}“: nur ein Intensitätsziel pro Schritt möglich.`);
    target = tg;
  };
  const addTime = (s: number) => {
    seconds += s;
    hasTime = true;
  };

  const rules: [RegExp, (m: RegExpExecArray) => void][] = [
    [/^"([^"]*)"/, (m) => (name = m[1].trim() || undefined)],
    [/^@/, () => {}],
    [/^(\d+):(\d{2}):(\d{2})(?![\d/])/, (m) => addTime(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))],
    [
      new RegExp(`^(\\d{1,2}:\\d{2})${DASH}(\\d{1,2}:\\d{2})\\s*(?:min)?\\s*\\/\\s*km`),
      (m) => setTarget(paceTarget(m[1], m[2], t, sport, err)),
    ],
    [/^(\d{1,2}:\d{2})\s*(?:min)?\s*\/\s*km/, (m) => setTarget(paceTarget(m[1], m[1], t, sport, err))],
    [/^(\d+):(\d{2})(?![\d/:])/, (m) => addTime(Number(m[1]) * 60 + Number(m[2]))],
    [
      new RegExp(`^${NUM}${DASH}${NUM}\\s*%\\s*(ftp|hr|hf|lthr|pace)?(?![a-z])`),
      (m) => setTarget(pctTarget(num(m[1]), num(m[2]), m[3], sport, err)),
    ],
    [new RegExp(`^${NUM}\\s*%\\s*(ftp|hr|hf|lthr|pace)?(?![a-z])`), (m) => setTarget(pctTarget(num(m[1]), num(m[1]), m[2], sport, err))],
    [new RegExp(`^(\\d+)${DASH}(\\d+)\\s*w(?:att)?\\b`), (m) => setTarget(wattTarget(Number(m[1]), Number(m[2]), t, sport, err))],
    [/^(\d+)\s*w(?:att)?\b/, (m) => setTarget(wattTarget(Number(m[1]), Number(m[1]), t, sport, err))],
    [new RegExp(`^(\\d+)${DASH}(\\d+)\\s*bpm\\b`), (m) => setTarget(bpmTarget(Number(m[1]), Number(m[2]), t))],
    [/^(\d+)\s*bpm\b/, (m) => setTarget(bpmTarget(Number(m[1]), Number(m[1]), t))],
    [
      new RegExp(`^(\\d+)${DASH}(\\d+)\\s*(?:rpm|u\\/min)`),
      (m) => (cadence = { low: Math.min(Number(m[1]), Number(m[2])), high: Math.max(Number(m[1]), Number(m[2])) }),
    ],
    [/^(\d+)\s*(?:rpm|u\/min)/, (m) => (cadence = { low: Number(m[1]), high: Number(m[1]) })],
    [/^rpe\s*(\d+(?:[.,]\d+)?)/, (m) => setTarget(rpeTarget(num(m[1]), err))],
    [
      /^(?:(hr|hf|puls)\s*)?(?:z|zone\s*)([1-7])(?:\s*(?:-|–)\s*(?:z|zone\s*)?([1-7]))?\b/,
      (m) => setTarget(zoneTarget(Number(m[2]) as ZoneIndex, Number(m[3] ?? m[2]) as ZoneIndex, m[1] ? "hr" : null, sport, err)),
    ],
    [/^(ga1|ga2|kb|eb|sb)\b/, (m) => setTarget(zoneTarget(GERMAN_ZONES[m[1]], GERMAN_ZONES[m[1]], null, sport, err))],
    [new RegExp(`^${NUM}\\s*km\\b`), (m) => (meters = (meters ?? 0) + num(m[1]) * 1000)],
    [new RegExp(`^${NUM}\\s*(?:mtr|meter)\\b`), (m) => (meters = (meters ?? 0) + num(m[1]))],
    [new RegExp(`^${NUM}\\s*(?:h|std|stunden?)(?![a-zäöü])`), (m) => addTime(num(m[1]) * 3600)],
    [
      new RegExp(`^${NUM}\\s*(?:min|minuten?|m|')(?![a-zäöü])`),
      (m) => {
        const v = num(m[1]);
        // "400m" is a distance, "10m" is ten minutes.
        if (/^\d+(?:[.,]\d+)?\s*m(?![a-z])/.test(m[0]) && !/min/.test(m[0]) && v >= 100) meters = (meters ?? 0) + v;
        else addTime(v * 60);
      },
    ],
    [new RegExp(`^${NUM}\\s*(?:s|sek|sec|sekunden|")(?![a-zäöü])`), (m) => addTime(num(m[1]))],
    [/^(\d+)\s*(?:wdh|reps?|wiederholungen)\b/, (m) => (reps = Number(m[1]))],
    [new RegExp(`^${NUM}\\s*kg\\b`), (m) => (weightKg = num(m[1]))],
    [/^(offen|open|lap|runde|lap-taste)(?![a-zäöü])/, () => (open = true)],
  ];

  outer: while (rest.length) {
    rest = rest.trimStart();
    if (!rest) break;
    const l = lower();
    for (const [re, handle] of rules) {
      const m = re.exec(l);
      if (m) {
        handle(m);
        rest = rest.slice(m[0].length);
        continue outer;
      }
    }
    const word = /^[^\s]+/.exec(rest)![0];
    words.push(word);
    rest = rest.slice(word.length);
  }

  // Classify free words: step kind keywords, otherwise name / exercise.
  const nameWords: string[] = [];
  for (const w of words) {
    if (/^\d+(?:[.,]\d+)?$/.test(w)) {
      err(`„${original}“: bei „${w}“ fehlt die Einheit (z. B. min, km, %).`);
      return null;
    }
    const k = KIND_WORDS[w.toLowerCase().replace(/[:.]$/, "")];
    if (k && !kind) kind = k;
    else nameWords.push(w);
  }

  let exercise: Step["exercise"];
  if (nameWords.length) {
    const joined = nameWords.join(" ");
    const ex = sport === "strength" ? findExercise(joined) : undefined;
    if (ex) exercise = { key: ex.key, ...(weightKg !== undefined && ex.weighted ? { weightKg } : {}) };
    else if (!name) name = joined;
  }

  const kindsOfDuration = [hasTime, meters !== null, reps !== null, open].filter(Boolean).length;
  if (kindsOfDuration > 1) {
    err(`„${original}“: bitte nur eine Dauer angeben (Zeit, Distanz, Wiederholungen oder offen).`);
    return null;
  }
  let duration: Duration;
  if (hasTime) duration = { type: "time", seconds: Math.round(seconds) };
  else if (meters !== null) duration = { type: "distance", meters: Math.round(meters) };
  else if (reps !== null) duration = { type: "reps", reps };
  else if (open) duration = { type: "open" };
  else {
    err(`„${original}“: keine Dauer erkannt, z. B. „10min“, „2km“ oder „10 Wdh“.`);
    return null;
  }
  if (duration.type === "time" && duration.seconds <= 0) {
    err(`„${original}“: Dauer muss größer als 0 sein.`);
    return null;
  }
  if (duration.type === "distance" && sport === "strength") {
    err(`„${original}“: Distanzen gibt es im Krafttraining nicht.`);
    return null;
  }
  if (duration.type === "reps" && sport !== "strength") {
    err(`„${original}“: Wiederholungen gibt es nur im Krafttraining.`);
    return null;
  }

  return {
    id: newId(),
    type: "step",
    kind: kind ?? "active",
    ...(kind ? {} : { inferred: true }),
    ...(name ? { name } : {}),
    duration,
    target: target ?? { type: "none" },
    ...(cadence ? { cadence } : {}),
    ...(exercise ? { exercise } : {}),
  } as Step;
}

function pctTarget(a: number, b: number, suffix: string | undefined, sport: Sport, err: (m: string) => void): Target {
  const kind = pctKindFromSuffix(suffix, sport);
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  if (!kind) {
    err("Prozentangaben brauchen im Krafttraining einen Bezug, nutze z. B. RPE 7.");
    return { type: "none" };
  }
  if (kind === "pace" && sport !== "run") {
    err("Pace-Ziele gibt es nur beim Laufen.");
    return { type: "none" };
  }
  if (high > 250 || low < 20) err(`${low}-${high}% liegt außerhalb des sinnvollen Bereichs.`);
  return { type: kind, low: round1(low), high: round1(high) };
}

function wattTarget(a: number, b: number, t: Thresholds, sport: Sport, err: (m: string) => void): Target {
  if (sport !== "ride") err("Watt-Ziele sind fürs Radfahren gedacht.");
  const low = (Math.min(a, b) / t.ftp) * 100;
  const high = (Math.max(a, b) / t.ftp) * 100;
  return { type: "power", low: round1(low), high: round1(high) };
}

function bpmTarget(a: number, b: number, t: Thresholds): Target {
  return { type: "hr", low: round1((Math.min(a, b) / t.lthr) * 100), high: round1((Math.max(a, b) / t.lthr) * 100) };
}

function paceTarget(a: string, b: string, t: Thresholds, sport: Sport, err: (m: string) => void): Target {
  if (sport !== "run") err("Pace-Ziele gibt es nur beim Laufen.");
  const toSec = (s: string) => {
    const [m, sec] = s.split(":").map(Number);
    return m * 60 + sec;
  };
  const pa = toSec(a);
  const pb = toSec(b);
  if (pa <= 0 || pb <= 0) {
    err("Ungültige Pace.");
    return { type: "none" };
  }
  // Faster pace (fewer seconds) = higher percentage of threshold speed.
  const p1 = (t.thresholdPace / pa) * 100;
  const p2 = (t.thresholdPace / pb) * 100;
  return { type: "pace", low: round1(Math.min(p1, p2)), high: round1(Math.max(p1, p2)) };
}

function rpeTarget(v: number, err: (m: string) => void): Target {
  if (v < 1 || v > 10) err("RPE liegt zwischen 1 und 10.");
  return { type: "rpe", value: Math.min(10, Math.max(1, Math.round(v))) };
}

function zoneTarget(a: ZoneIndex, b: ZoneIndex, forced: "hr" | null, sport: Sport, err: (m: string) => void): Target {
  const type = forced ?? (sport === "ride" ? "power" : sport === "run" ? "pace" : null);
  if (!type) {
    err("Zonen gibt es im Krafttraining nicht, nutze z. B. RPE 7.");
    return { type: "none" };
  }
  const lo = Math.min(a, b) as ZoneIndex;
  const hi = Math.max(a, b) as ZoneIndex;
  return { type, low: zoneRange(type, lo).low, high: zoneRange(type, hi).high };
}

function stepIntensityMid(s: Step): number | null {
  switch (s.target.type) {
    case "power":
    case "pace":
    case "hr":
      return (s.target.low + s.target.high) / 2;
    case "rpe":
      return s.target.value * 10;
    case "none":
      return null;
  }
}

/**
 * Assigns warm-up / recovery / cool-down to steps whose role was not written
 * explicitly, so "10min 60%, 5x(3min 110%, 2min 50%), 10min 50%" does the
 * right thing without keywords.
 */
function inferKinds(nodes: WorkoutNode[]) {
  const isInferred = (s: Step) => (s as Step & { inferred?: boolean }).inferred === true;
  const clear = (s: Step) => delete (s as Step & { inferred?: boolean }).inferred;

  nodes.forEach((node, i) => {
    if (node.type === "repeat") {
      const mids = node.steps.map(stepIntensityMid);
      const max = Math.max(...mids.map((m) => m ?? 0));
      node.steps.forEach((s, j) => {
        if (isInferred(s)) {
          const mid = mids[j];
          if (node.steps.length > 1 && mid !== null && mid < max && mid <= 70) s.kind = "recovery";
        }
        clear(s);
      });
      return;
    }
    if (isInferred(node) && nodes.length > 1 && !node.exercise) {
      const mid = stepIntensityMid(node);
      if (i === 0 && (mid === null || mid <= 78)) node.kind = "warmup";
      else if (i === nodes.length - 1 && (mid === null || mid <= 70)) node.kind = "cooldown";
    }
    clear(node);
  });
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

const KIND_OUT: Record<StepKind, string> = {
  warmup: "Aufwärmen",
  active: "",
  recovery: "Erholung",
  rest: "Pause",
  cooldown: "Cool-down",
};

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(round1(n));
}

export function formatDurationToken(d: Duration): string {
  switch (d.type) {
    case "time": {
      const s = d.seconds;
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      const parts: string[] = [];
      if (h) parts.push(`${h}h`);
      if (m) parts.push(`${m}min`);
      if (sec || parts.length === 0) parts.push(`${sec}s`);
      return parts.join(" ");
    }
    case "distance":
      if (d.meters >= 1000 && d.meters % 100 === 0) return `${fmtNum(d.meters / 1000)}km`;
      return d.meters >= 100 ? `${d.meters}m` : `${d.meters}mtr`;
    case "reps":
      return `${d.reps} Wdh`;
    case "open":
      return "offen";
  }
}

export function formatTargetToken(target: Target, sport: Sport, t: Thresholds): string {
  switch (target.type) {
    case "none":
      return "";
    case "rpe":
      return `RPE ${target.value}`;
    case "power":
      return target.low === target.high ? `${fmtNum(target.low)}%` : `${fmtNum(target.low)}-${fmtNum(target.high)}%`;
    case "hr": {
      const lo = Math.round((target.low / 100) * t.lthr);
      const hi = Math.round((target.high / 100) * t.lthr);
      return lo === hi ? `${lo}bpm` : `${lo}-${hi}bpm`;
    }
    case "pace": {
      if (sport !== "run") return target.low === target.high ? `${fmtNum(target.low)}% pace` : `${fmtNum(target.low)}-${fmtNum(target.high)}% pace`;
      // high percentage = faster = fewer seconds per km
      const fast = formatPace(t.thresholdPace / (target.high / 100));
      const slow = formatPace(t.thresholdPace / (target.low / 100));
      return fast === slow ? `${fast}/km` : `${slow}-${fast}/km`;
    }
  }
}

function formatStep(s: Step, sport: Sport, t: Thresholds): string {
  const parts: string[] = [];
  if (KIND_OUT[s.kind]) parts.push(KIND_OUT[s.kind]);
  if (s.name) parts.push(`"${s.name.replace(/"/g, "'")}"`);
  parts.push(formatDurationToken(s.duration));
  if (s.exercise) {
    const ex = getExercise(s.exercise.key);
    if (ex) parts.push(ex.label);
    if (s.exercise.weightKg !== undefined) parts.push(`${fmtNum(s.exercise.weightKg)}kg`);
  }
  const tg = formatTargetToken(s.target, sport, t);
  if (tg) parts.push(tg);
  if (s.cadence) parts.push(s.cadence.low === s.cadence.high ? `${s.cadence.low}rpm` : `${s.cadence.low}-${s.cadence.high}rpm`);
  return parts.join(" ");
}

function formatRepeat(r: Repeat, sport: Sport, t: Thresholds): string {
  const [first, second] = r.steps;
  const isSetShorthand =
    sport === "strength" &&
    first?.exercise &&
    first.duration.type === "reps" &&
    first.target.type === "none" &&
    !first.name &&
    !first.cadence &&
    (r.steps.length === 1 ||
      (r.steps.length === 2 && second.kind === "rest" && second.duration.type === "time" && second.target.type === "none" && !second.name));
  if (isSetShorthand) {
    const ex = getExercise(first.exercise!.key);
    if (ex) {
      const weight = first.exercise!.weightKg !== undefined ? ` ${fmtNum(first.exercise!.weightKg)}kg` : "";
      const rest = r.steps.length === 2 ? ` Pause ${formatDurationToken(second.duration)}` : " Pause 0s";
      return `${r.count}x${first.duration.type === "reps" ? first.duration.reps : 0} ${ex.label}${weight}${rest}`;
    }
  }
  return `${r.count}x (${r.steps.map((s) => formatStep(s, sport, t)).join(", ")})`;
}

export function serializeWorkoutText(structure: WorkoutStructure, t: Thresholds): string {
  return structure.nodes
    .map((n) => (n.type === "repeat" ? formatRepeat(n, structure.sport, t) : formatStep(n, structure.sport, t)))
    .join("\n");
}
