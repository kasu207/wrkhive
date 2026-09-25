import { formatDistance, formatDuration, formatPace } from "../format";
import { getExercise } from "./exercises";
import type { Duration, Sport, Step, Target, Thresholds } from "./types";
import { targetZone, zoneName, zonesFor } from "./zones";

export function durationLabel(d: Duration): string {
  switch (d.type) {
    case "time":
      return formatDuration(d.seconds, { compact: true });
    case "distance":
      return formatDistance(d.meters);
    case "reps":
      return `${d.reps} Wdh.`;
    case "open":
      return "Runden-Taste";
  }
}

const pct = (n: number) => `${Math.round(n)}`;

/** Main absolute value, e.g. "250–270 W", "4:30–4:40 /km", "150–160 bpm". */
export function targetAbsolute(target: Target, sport: Sport, t: Thresholds): string | null {
  switch (target.type) {
    case "none":
      return null;
    case "rpe":
      return `RPE ${target.value}`;
    case "power": {
      const lo = Math.round((target.low / 100) * t.ftp);
      const hi = Math.round((target.high / 100) * t.ftp);
      return lo === hi ? `${lo} W` : `${lo}–${hi} W`;
    }
    case "hr": {
      const lo = Math.round((target.low / 100) * t.lthr);
      const hi = Math.round((target.high / 100) * t.lthr);
      return lo === hi ? `${lo} bpm` : `${lo}–${hi} bpm`;
    }
    case "pace": {
      const slow = formatPace(t.thresholdPace / (target.low / 100));
      const fast = formatPace(t.thresholdPace / (target.high / 100));
      if (sport !== "run") return `${pct(target.low)}–${pct(target.high)} % Pace`;
      return slow === fast ? `${fast} /km` : `${slow}–${fast} /km`;
    }
  }
}

/** Relative value, e.g. "95–102 % FTP". */
export function targetRelative(target: Target): string | null {
  switch (target.type) {
    case "power":
      return target.low === target.high ? `${pct(target.low)} % FTP` : `${pct(target.low)}–${pct(target.high)} % FTP`;
    case "hr":
      return target.low === target.high ? `${pct(target.low)} % LTHR` : `${pct(target.low)}–${pct(target.high)} % LTHR`;
    case "pace":
      return target.low === target.high ? `${pct(target.low)} % Schwelle` : `${pct(target.low)}–${pct(target.high)} % Schwelle`;
    default:
      return null;
  }
}

export function stepTitle(step: Step): string {
  if (step.name) return step.name;
  if (step.exercise) return getExercise(step.exercise.key)?.label ?? "Übung";
  switch (step.kind) {
    case "warmup":
      return "Aufwärmen";
    case "cooldown":
      return "Cool-down";
    case "recovery":
      return "Erholung";
    case "rest":
      return "Pause";
    case "active":
      return "Belastung";
  }
}

export function stepZoneLabel(step: Step): string | null {
  if (step.target.type === "none") return null;
  const zone = targetZone(step.target, step.kind);
  return `Z${zone} · ${zoneName(step.target.type, zone)}`;
}

export function zoneLegend(type: "power" | "pace" | "hr") {
  return zonesFor(type);
}

export const ZONE_COLOR = ["", "var(--zone-1)", "var(--zone-2)", "var(--zone-3)", "var(--zone-4)", "var(--zone-5)", "var(--zone-6)", "var(--zone-7)"];
