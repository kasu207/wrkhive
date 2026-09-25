import type { Sport, StepKind, Target, TargetType } from "./types";

/** Zone index 1..7 is shared across target types so the UI can color consistently. */
export type ZoneIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ZoneDef {
  zone: ZoneIndex;
  name: string;
  /** Inclusive lower / upper bounds in the target's unit (percent, or RPE). */
  low: number;
  high: number;
}

/** Coggan power levels, percent of FTP. */
export const POWER_ZONES: ZoneDef[] = [
  { zone: 1, name: "Aktive Erholung", low: 40, high: 55 },
  { zone: 2, name: "Grundlage", low: 56, high: 75 },
  { zone: 3, name: "Tempo", low: 76, high: 90 },
  { zone: 4, name: "Schwelle", low: 91, high: 105 },
  { zone: 5, name: "VO2max", low: 106, high: 120 },
  { zone: 6, name: "Anaerob", low: 121, high: 150 },
  { zone: 7, name: "Neuromuskulär", low: 151, high: 250 },
];

/** Running pace zones, percent of threshold speed (100 = threshold pace). */
export const PACE_ZONES: ZoneDef[] = [
  { zone: 1, name: "Erholung", low: 60, high: 78 },
  { zone: 2, name: "Grundlage", low: 79, high: 87 },
  { zone: 3, name: "Tempo", low: 88, high: 94 },
  { zone: 4, name: "Schwelle", low: 95, high: 101 },
  { zone: 5, name: "VO2max", low: 102, high: 110 },
  { zone: 6, name: "Anaerob", low: 111, high: 125 },
  { zone: 7, name: "Sprint", low: 126, high: 160 },
];

/** Heart-rate zones after Friel, percent of threshold heart rate. */
export const HR_ZONES: ZoneDef[] = [
  { zone: 1, name: "Erholung", low: 60, high: 84 },
  { zone: 2, name: "Grundlage", low: 85, high: 89 },
  { zone: 3, name: "Tempo", low: 90, high: 94 },
  { zone: 4, name: "Schwelle", low: 95, high: 99 },
  { zone: 5, name: "VO2max", low: 100, high: 102 },
  { zone: 6, name: "Anaerob", low: 103, high: 106 },
  { zone: 7, name: "Maximal", low: 107, high: 115 },
];

export const RPE_ZONES: ZoneDef[] = [
  { zone: 1, name: "Sehr leicht", low: 1, high: 2 },
  { zone: 2, name: "Leicht", low: 3, high: 4 },
  { zone: 3, name: "Moderat", low: 5, high: 5 },
  { zone: 4, name: "Hart", low: 6, high: 6 },
  { zone: 5, name: "Sehr hart", low: 7, high: 7 },
  { zone: 6, name: "Extrem hart", low: 8, high: 9 },
  { zone: 7, name: "Maximal", low: 10, high: 10 },
];

export function zonesFor(type: Exclude<TargetType, "none">): ZoneDef[] {
  switch (type) {
    case "power":
      return POWER_ZONES;
    case "pace":
      return PACE_ZONES;
    case "hr":
      return HR_ZONES;
    case "rpe":
      return RPE_ZONES;
  }
}

function zoneOfValue(zones: ZoneDef[], value: number): ZoneIndex {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (value >= zones[i].low) return zones[i].zone;
  }
  return 1;
}

/** Midpoint of a target in its own unit (percent or RPE). */
export function targetMid(target: Target): number | null {
  switch (target.type) {
    case "none":
      return null;
    case "rpe":
      return target.value;
    default:
      return (target.low + target.high) / 2;
  }
}

export function targetZone(target: Target, kind: StepKind): ZoneIndex {
  const mid = targetMid(target);
  if (mid === null || target.type === "none") {
    // No target: derive a sensible visual zone from the step's role.
    if (kind === "rest") return 1;
    if (kind === "recovery" || kind === "warmup" || kind === "cooldown") return 1;
    return 3;
  }
  return zoneOfValue(zonesFor(target.type), mid);
}

export function zoneRange(type: Exclude<TargetType, "none" | "rpe">, zone: ZoneIndex) {
  const def = zonesFor(type).find((z) => z.zone === zone)!;
  return { low: def.low, high: def.high };
}

export function zoneName(type: Exclude<TargetType, "none">, zone: ZoneIndex) {
  return zonesFor(type).find((z) => z.zone === zone)!.name;
}

/**
 * Relative intensity (fraction of threshold, ~1.0 at threshold) used for load
 * estimates. Heart rate and RPE are mapped onto a power-equivalent scale.
 */
export function relativeIntensity(target: Target, kind: StepKind): number {
  switch (target.type) {
    case "power":
    case "pace":
      return (target.low + target.high) / 200;
    case "hr": {
      const pct = (target.low + target.high) / 2;
      return Math.max(0.3, (pct - 50) / 50);
    }
    case "rpe":
      return 0.45 + 0.065 * target.value;
    case "none":
      switch (kind) {
        case "rest":
          return 0;
        case "recovery":
          return 0.5;
        case "warmup":
        case "cooldown":
          return 0.55;
        case "active":
          return 0.7;
      }
  }
}

/** The target type a sport uses by default in the builder. */
export function defaultTargetType(sport: Sport): TargetType {
  switch (sport) {
    case "ride":
      return "power";
    case "run":
      return "pace";
    case "strength":
      return "none";
  }
}
