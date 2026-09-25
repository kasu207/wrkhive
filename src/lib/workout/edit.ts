/** Immutable editing helpers for the visual builder. */
import { newId } from "../id";
import type { Repeat, Sport, Step, StepKind, Target, WorkoutNode, WorkoutStructure } from "./types";

export function defaultTarget(sport: Sport, kind: StepKind): Target {
  if (sport === "strength") return kind === "rest" ? { type: "none" } : { type: "rpe", value: kind === "active" ? 7 : 3 };
  const type = sport === "ride" ? "power" : "pace";
  switch (kind) {
    case "warmup":
      return sport === "ride" ? { type, low: 50, high: 65 } : { type, low: 70, high: 80 };
    case "cooldown":
      return sport === "ride" ? { type, low: 45, high: 55 } : { type, low: 65, high: 75 };
    case "recovery":
      return sport === "ride" ? { type, low: 50, high: 55 } : { type, low: 65, high: 75 };
    case "rest":
      return { type: "none" };
    case "active":
      return sport === "ride" ? { type, low: 88, high: 94 } : { type, low: 95, high: 101 };
  }
}

export function newStep(sport: Sport, kind: StepKind = "active", seconds?: number): Step {
  const fallback = kind === "warmup" || kind === "cooldown" ? 600 : kind === "active" ? (sport === "strength" ? 60 : 300) : 120;
  return { id: newId(), type: "step", kind, duration: { type: "time", seconds: seconds ?? fallback }, target: defaultTarget(sport, kind) };
}

export function newRepeat(sport: Sport): Repeat {
  if (sport === "ride") {
    return {
      id: newId(),
      type: "repeat",
      count: 5,
      steps: [
        { id: newId(), type: "step", kind: "active", duration: { type: "time", seconds: 180 }, target: { type: "power", low: 105, high: 115 } },
        { id: newId(), type: "step", kind: "recovery", duration: { type: "time", seconds: 120 }, target: { type: "power", low: 50, high: 55 } },
      ],
    };
  }
  if (sport === "run") {
    return {
      id: newId(),
      type: "repeat",
      count: 6,
      steps: [
        { id: newId(), type: "step", kind: "active", duration: { type: "distance", meters: 800 }, target: { type: "pace", low: 104, high: 108 } },
        { id: newId(), type: "step", kind: "rest", duration: { type: "time", seconds: 120 }, target: { type: "none" } },
      ],
    };
  }
  return newExerciseBlock("back-squat");
}

export function newExerciseBlock(exerciseKey: string, sets = 3, reps = 10, weightKg?: number, restSeconds = 90): Repeat {
  const steps: Step[] = [
    {
      id: newId(),
      type: "step",
      kind: "active",
      duration: { type: "reps", reps },
      target: { type: "none" },
      exercise: { key: exerciseKey, ...(weightKg !== undefined ? { weightKg } : {}) },
    },
  ];
  if (restSeconds > 0) steps.push({ id: newId(), type: "step", kind: "rest", duration: { type: "time", seconds: restSeconds }, target: { type: "none" } });
  return { id: newId(), type: "repeat", count: sets, steps };
}

export function starterStructure(sport: Sport): WorkoutStructure {
  if (sport === "strength") {
    return { sport, nodes: [newStep(sport, "warmup", 300), newExerciseBlock("back-squat", 3, 8, 50), newExerciseBlock("push-up", 3, 12)] };
  }
  return { sport, nodes: [newStep(sport, "warmup"), newRepeat(sport), newStep(sport, "cooldown")] };
}

/** Finds a step anywhere in the structure. */
export function findStep(nodes: WorkoutNode[], id: string): { step: Step; parent: Repeat | null } | null {
  for (const n of nodes) {
    if (n.type === "step" && n.id === id) return { step: n, parent: null };
    if (n.type === "repeat") {
      const s = n.steps.find((x) => x.id === id);
      if (s) return { step: s, parent: n };
    }
  }
  return null;
}

export function updateStep(nodes: WorkoutNode[], id: string, patch: (s: Step) => Step): WorkoutNode[] {
  return nodes.map((n) => {
    if (n.type === "step") return n.id === id ? patch(n) : n;
    return { ...n, steps: n.steps.map((s) => (s.id === id ? patch(s) : s)) };
  });
}

export function updateRepeat(nodes: WorkoutNode[], id: string, patch: (r: Repeat) => Repeat): WorkoutNode[] {
  return nodes.map((n) => (n.type === "repeat" && n.id === id ? patch(n) : n));
}

/** Removes a node or a step inside a repeat (repeats that become empty are removed). */
export function removeById(nodes: WorkoutNode[], id: string): WorkoutNode[] {
  const out: WorkoutNode[] = [];
  for (const n of nodes) {
    if (n.id === id) continue;
    if (n.type === "repeat") {
      const steps = n.steps.filter((s) => s.id !== id);
      if (steps.length) out.push(steps.length === n.steps.length ? n : { ...n, steps });
    } else out.push(n);
  }
  return out;
}

function cloneStep(s: Step): Step {
  return { ...s, id: newId(), duration: { ...s.duration }, target: { ...s.target }, ...(s.cadence ? { cadence: { ...s.cadence } } : {}), ...(s.exercise ? { exercise: { ...s.exercise } } : {}) };
}

export function duplicateById(nodes: WorkoutNode[], id: string): WorkoutNode[] {
  const out: WorkoutNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.id === id) {
      out.push(n.type === "step" ? cloneStep(n) : { ...n, id: newId(), steps: n.steps.map(cloneStep) });
      continue;
    }
    if (n.type === "repeat" && n.steps.some((s) => s.id === id)) {
      out[out.length - 1] = { ...n, steps: n.steps.flatMap((s) => (s.id === id ? [s, cloneStep(s)] : [s])) };
    }
  }
  return out;
}

export function moveNode(nodes: WorkoutNode[], from: number, to: number): WorkoutNode[] {
  if (from === to || from < 0 || to < 0 || from >= nodes.length || to >= nodes.length) return nodes;
  const copy = nodes.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function moveStepInRepeat(nodes: WorkoutNode[], repeatId: string, from: number, to: number): WorkoutNode[] {
  return updateRepeat(nodes, repeatId, (r) => {
    if (from === to || to < 0 || to >= r.steps.length) return r;
    const steps = r.steps.slice();
    const [item] = steps.splice(from, 1);
    steps.splice(to, 0, item);
    return { ...r, steps };
  });
}

/** Wraps a top-level step into a new repeat block. */
export function wrapInRepeat(nodes: WorkoutNode[], stepId: string): WorkoutNode[] {
  return nodes.map((n) => (n.type === "step" && n.id === stepId ? ({ id: newId(), type: "repeat", count: 3, steps: [n] } as Repeat) : n));
}

/** Dissolves a repeat into a single pass of its steps. */
export function unwrapRepeat(nodes: WorkoutNode[], repeatId: string): WorkoutNode[] {
  return nodes.flatMap((n) => (n.type === "repeat" && n.id === repeatId ? n.steps : [n]));
}

/** Converts a structure to another endurance sport, mapping targets sensibly. */
export function convertSport(structure: WorkoutStructure, sport: Sport): WorkoutStructure {
  if (structure.sport === sport) return structure;
  if (sport === "strength" || structure.sport === "strength") return starterStructure(sport);
  const mapTarget = (t: Target): Target => {
    if (sport === "ride" && t.type === "pace") return { type: "power", low: t.low, high: t.high };
    if (sport === "run" && t.type === "power") return { type: "pace", low: Math.min(t.low, 130), high: Math.min(t.high, 135) };
    return t;
  };
  const mapStep = (s: Step): Step => {
    const { cadence: _c, ...rest } = s;
    return { ...(sport === "ride" ? s : rest), target: mapTarget(s.target) };
  };
  return { sport, nodes: structure.nodes.map((n) => (n.type === "step" ? mapStep(n) : { ...n, steps: n.steps.map(mapStep) })) };
}
