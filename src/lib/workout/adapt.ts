/**
 * Adapts a planned workout to the athlete's current load (see
 * analytics/readiness.ts). Only hard sessions are touched; easy ones already
 * fit a tired athlete.
 *
 *  reduce:  about 20-25 % less work in the hard part and hard targets 5 %
 *           lower. Repeats lose sets (5 -> 4, 4 -> 3, 3 -> 2), long single
 *           efforts are shortened; warm-up and cool-down stay.
 *  recover: the session becomes an easy one of the same sport and roughly
 *           60 % of the planned time (30-60 min) in zone 1-2. Strength
 *           sessions keep their exercises with half the sets.
 */
import type { AdaptMode } from "../analytics/readiness";
import { newId } from "../id";
import { summarize } from "./metrics";
import type { Repeat, Step, Target, Thresholds, WorkoutNode, WorkoutStructure } from "./types";

export interface Adaptation {
  structure: WorkoutStructure;
  /** Short German description of what changed. */
  note: string;
}

/** Intensity factor above which a session counts as hard. */
const HARD_IF = 0.8;
/** Seconds in zone 4+ that make a session hard even at a lower overall IF. */
const HARD_ZONE_SECONDS = 8 * 60;

export function isHardSession(structure: WorkoutStructure, t: Thresholds): boolean {
  if (structure.sport === "strength") return structure.nodes.some((n) => n.type === "repeat" && n.count >= 3);
  const s = summarize(structure, t);
  const hardSeconds = s.zoneSeconds[4] + s.zoneSeconds[5] + s.zoneSeconds[6] + s.zoneSeconds[7];
  return s.intensityFactor >= HARD_IF || hardSeconds >= HARD_ZONE_SECONDS;
}

/** Hard means threshold or above for the target type. */
function isHardTarget(t: Target): boolean {
  if (t.type === "power" || t.type === "pace") return t.high >= 91;
  if (t.type === "hr") return t.high >= 95;
  if (t.type === "rpe") return t.value >= 6;
  return false;
}

function easier(t: Target): Target {
  const scale = (n: number) => Math.round(n * 0.95);
  if (t.type === "power" || t.type === "pace" || t.type === "hr") return { ...t, low: scale(t.low), high: Math.max(scale(t.low), scale(t.high)) };
  if (t.type === "rpe") return { ...t, value: Math.max(1, t.value - 1) };
  return t;
}

const fewerSets = (count: number) => (count >= 5 ? Math.round(count * 0.8) : count >= 3 ? count - 1 : count);

function shortenStep(step: Step, factor: number): Step {
  const d = step.duration;
  if (d.type === "time") return { ...step, duration: { type: "time", seconds: Math.max(60, Math.round((d.seconds * factor) / 30) * 30) } };
  if (d.type === "distance") return { ...step, duration: { type: "distance", meters: Math.max(200, Math.round((d.meters * factor) / 100) * 100) } };
  return step;
}

function reduce(structure: WorkoutStructure): { nodes: WorkoutNode[]; changes: string[] } {
  const changes = new Set<string>();
  const nodes = structure.nodes.map((node): WorkoutNode => {
    if (node.type === "repeat") {
      const hard = node.steps.some((s) => s.kind === "active" && isHardTarget(s.target));
      if (!hard && structure.sport !== "strength") return node;
      const count = fewerSets(node.count);
      let steps = node.steps;
      if (count !== node.count) changes.add("weniger Wiederholungen");
      // Two long blocks (2x20) keep their count but get shorter.
      if (count === node.count && structure.sport !== "strength") {
        steps = steps.map((s) => (s.kind === "active" ? shortenStep(s, 0.75) : s));
        changes.add("kürzere Intervalle");
      }
      steps = steps.map((s) => (s.kind === "active" && isHardTarget(s.target) ? { ...s, target: easier(s.target) } : s));
      if (steps.some((s, i) => s.target !== node.steps[i].target)) changes.add("Zielbereiche 5 % niedriger");
      return { ...node, id: newId(), count, steps: steps.map((s) => ({ ...s, id: newId() })) } satisfies Repeat;
    }
    if (node.kind === "active" && isHardTarget(node.target)) {
      changes.add("kürzere Belastung");
      changes.add("Zielbereiche 5 % niedriger");
      return { ...shortenStep(node, 0.75), id: newId(), target: easier(node.target) };
    }
    return { ...node, id: newId() };
  });
  return { nodes, changes: [...changes] };
}

function easyTarget(sport: WorkoutStructure["sport"], kind: Step["kind"]): Target {
  if (sport === "ride") return kind === "active" ? { type: "power", low: 56, high: 68 } : { type: "power", low: 45, high: 55 };
  return kind === "active" ? { type: "pace", low: 72, high: 80 } : { type: "pace", low: 65, high: 72 };
}

function recover(structure: WorkoutStructure, t: Thresholds): { nodes: WorkoutNode[]; changes: string[] } {
  if (structure.sport === "strength") {
    const nodes = structure.nodes.map((n): WorkoutNode => (n.type === "repeat" ? { ...n, id: newId(), count: Math.max(1, Math.ceil(n.count / 2)), steps: n.steps.map((s) => ({ ...s, id: newId() })) } : { ...n, id: newId() }));
    return { nodes, changes: ["halbe Satzzahl"] };
  }
  const planned = summarize(structure, t).durationSec;
  const total = Math.min(60 * 60, Math.max(30 * 60, Math.round((planned * 0.6) / 300) * 300));
  const warm = 10 * 60;
  const cool = 5 * 60;
  const step = (kind: Step["kind"], seconds: number, name?: string): Step => ({
    id: newId(),
    type: "step",
    kind,
    ...(name ? { name } : {}),
    duration: { type: "time", seconds },
    target: easyTarget(structure.sport, kind),
    ...(structure.sport === "ride" && kind === "active" ? { cadence: { low: 85, high: 95 } } : {}),
  });
  return {
    nodes: [step("warmup", warm), step("active", total - warm - cool, "Locker"), step("cooldown", cool)],
    changes: [`lockere Einheit mit ${Math.round(total / 60)} min statt der harten Intervalle`],
  };
}

/** Returns the adapted workout, or null when nothing needs to change. */
export function adaptWorkout(structure: WorkoutStructure, mode: AdaptMode, t: Thresholds): Adaptation | null {
  if (mode === "keep" || !isHardSession(structure, t)) return null;
  const { nodes, changes } = mode === "reduce" ? reduce(structure) : recover(structure, t);
  if (!changes.length) return null;
  const before = summarize(structure, t);
  const after = summarize({ sport: structure.sport, nodes }, t);
  const load = structure.sport === "strength" ? "" : ` Belastung ${before.tss} → ${after.tss} TSS.`;
  const note = `${changes.join(", ").replace(/^./, (c) => c.toUpperCase())}.${load}`;
  return { structure: { sport: structure.sport, nodes }, note };
}
