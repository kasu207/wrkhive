/**
 * intervals.icu workout text (the "description" of a calendar event of
 * category WORKOUT). intervals.icu parses it into its own workout model and
 * pushes it from there to Garmin Connect, Wahoo, Zwift and others.
 *
 * Syntax used (conservative subset of the intervals.icu workout builder):
 *  - one step per line, starting with "- "
 *  - duration in whole minutes ("10m") or seconds ("90s"), distance in
 *    metres ("400mtr") or kilometres ("2km")
 *  - power as % FTP ("75%", "88-94%"), heart rate as % LTHR ("80% LTHR"),
 *    pace as % threshold pace ("95% Pace"), cadence ("85-95rpm")
 *  - repeats as a "4x" line followed by their steps; sections are separated
 *    by blank lines; "Warmup" / "Cooldown" section headers mark those steps
 * Targets stay relative, so intervals.icu resolves them with the athlete's
 * thresholds stored there.
 */
import { flattenSteps, stepSeconds } from "../metrics";
import type { Step, Thresholds, WorkoutNode, WorkoutStructure } from "../types";

export class IntervalsUnsupportedError extends Error {}

/** Returns human-readable reasons why a workout cannot be sent to intervals.icu, or [] if it can. */
export function intervalsCompatibility(structure: WorkoutStructure): string[] {
  const issues: string[] = [];
  if (structure.sport === "strength") issues.push("intervals.icu überträgt kein strukturiertes Krafttraining auf Uhren und Radcomputer.");
  const flat = flattenSteps(structure.nodes);
  if (flat.some(({ step }) => step.duration.type === "open")) issues.push("Schritte mit Runden-Taste (offene Dauer) werden über intervals.icu nicht unterstützt.");
  if (flat.some(({ step }) => step.duration.type === "reps")) issues.push("Wiederholungs-Schritte werden über intervals.icu nicht unterstützt.");
  return issues;
}

function duration(step: Step): string {
  const d = step.duration;
  if (d.type === "time") {
    const s = Math.max(1, Math.round(d.seconds));
    return s % 60 === 0 ? `${s / 60}m` : `${s}s`;
  }
  if (d.type === "distance") {
    const m = Math.max(1, Math.round(d.meters));
    // "m" means minutes in intervals.icu, metres are written "mtr".
    return m >= 1000 && m % 10 === 0 ? `${m / 1000}km` : `${m}mtr`;
  }
  throw new IntervalsUnsupportedError("Nicht unterstützte Schrittdauer");
}

function range(low: number, high: number): string {
  const a = Math.round(Math.min(low, high));
  const b = Math.round(Math.max(low, high));
  return a === b ? `${a}%` : `${a}-${b}%`;
}

function rpeWord(value: number): string {
  if (value <= 3) return "locker";
  if (value <= 6) return "moderat";
  if (value <= 8) return "hart";
  return "maximal";
}

// Words the intervals.icu parser treats as instructions; never emit them as cue text.
const RESERVED = new Set(["ramp", "freeride", "maxeffort", "hidepower", "intensity", "warmup", "cooldown", "lap", "press", "pace", "lthr", "hr", "ftp", "mmp", "rpm", "km", "mtr", "w"]);

/** Step names as plain cue text: letters only, so nothing is parsed as a duration or target. */
function cueText(name: string | undefined): string {
  if (!name) return "";
  return name
    .replace(/[^\p{L}\s-]/gu, " ")
    .split(/\s+/)
    // Single letters could be read as units (m, s, h, w, z), so drop them too.
    .filter((w) => w.replace(/-/g, "").length > 1 && !RESERVED.has(w.toLowerCase()))
    .join(" ")
    .slice(0, 40);
}

function stepLine(step: Step): string {
  const parts = [`- ${duration(step)}`];
  const t = step.target;
  if (t.type === "power") parts.push(range(t.low, t.high));
  else if (t.type === "hr") parts.push(`${range(t.low, t.high)} LTHR`);
  else if (t.type === "pace") parts.push(`${range(t.low, t.high)} Pace`);
  if (step.cadence) {
    const lo = Math.round(Math.min(step.cadence.low, step.cadence.high));
    const hi = Math.round(Math.max(step.cadence.low, step.cadence.high));
    parts.push(lo === hi ? `${lo}rpm` : `${lo}-${hi}rpm`);
  }
  const cue = [cueText(step.name), t.type === "rpe" ? rpeWord(t.value) : ""].filter(Boolean).join(" ");
  if (cue) parts.push(cue);
  return parts.join(" ");
}

type Block = { header: string | null; lines: string[] };

export function encodeIntervalsWorkout(structure: WorkoutStructure): string {
  const issues = intervalsCompatibility(structure);
  if (issues.length) throw new IntervalsUnsupportedError(issues.join(" "));

  const blocks: Block[] = [];
  const push = (header: string | null, line: string) => {
    const last = blocks.at(-1);
    // Consecutive plain steps or steps of the same section share one block.
    if (last && last.header === header && header !== null && !/^\d+x$/.test(header)) last.lines.push(line);
    else if (last && last.header === null && header === null) last.lines.push(line);
    else blocks.push({ header, lines: [line] });
  };

  for (const node of structure.nodes as WorkoutNode[]) {
    if (node.type === "repeat") {
      if (!node.steps.length) continue;
      if (node.count <= 1) {
        for (const s of node.steps) push(null, stepLine(s));
        continue;
      }
      blocks.push({ header: `${node.count}x`, lines: node.steps.map(stepLine) });
      continue;
    }
    push(node.kind === "warmup" ? "Warmup" : node.kind === "cooldown" ? "Cooldown" : null, stepLine(node));
  }

  return blocks.map((b) => (b.header ? [b.header, ...b.lines] : b.lines).join("\n")).join("\n\n") + "\n";
}

/** Planned moving time in seconds (intervals.icu shows it in the calendar). */
export function intervalsMovingTime(structure: WorkoutStructure, t: Thresholds): number {
  return Math.round(flattenSteps(structure.nodes).reduce((acc, { step }) => acc + stepSeconds(step, structure.sport, t), 0));
}

export const INTERVALS_SPORT_TYPE = { ride: "Ride", run: "Run" } as const;
