/**
 * Zwift workout (.zwo) export for rides and runs.
 *
 * Zwift expresses intensity as a fraction of FTP (bike) or of threshold pace
 * (run) and only knows time-based segments. Distance and lap-button steps are
 * converted to their estimated duration; heart-rate and RPE targets are mapped
 * to their approximate power / pace equivalent.
 */
import { stepSeconds } from "../metrics";
import type { Repeat, Step, Thresholds, WorkoutStructure } from "../types";
import { relativeIntensity } from "../zones";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function f(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function range(step: Step): [number, number] {
  if (step.target.type === "power" || step.target.type === "pace") return [step.target.low / 100, step.target.high / 100];
  const i = relativeIntensity(step.target, step.kind);
  const v = step.kind === "rest" ? 0.4 : Math.max(0.3, i);
  return [v, v];
}

function cadenceAttr(step: Step): string {
  if (!step.cadence) return "";
  return ` Cadence="${Math.round((step.cadence.low + step.cadence.high) / 2)}"`;
}

function textEvent(step: Step): string {
  const label = step.name ?? (step.target.type === "rpe" ? `RPE ${step.target.value}` : "");
  return label ? `\n      <textevent timeoffset="0" message="${esc(label)}"/>` : "";
}

function segment(step: Step, structure: WorkoutStructure, t: Thresholds): string {
  const dur = Math.max(1, Math.round(stepSeconds(step, structure.sport, t)));
  const [low, high] = range(step);
  const extra = cadenceAttr(step);
  const inner = textEvent(step);
  const open = (tag: string, attrs: string) => (inner ? `<${tag} ${attrs}>${inner}\n    </${tag}>` : `<${tag} ${attrs}/>`);

  if (step.duration.type === "open" && step.target.type === "none") {
    return open("FreeRide", `Duration="${dur}"${extra}`);
  }
  if (step.kind === "warmup") return open("Warmup", `Duration="${dur}" PowerLow="${f(low)}" PowerHigh="${f(high)}"${extra}`);
  if (step.kind === "cooldown") return open("Cooldown", `Duration="${dur}" PowerLow="${f(high)}" PowerHigh="${f(low)}"${extra}`);
  if (low !== high) return open("SteadyState", `Duration="${dur}" PowerLow="${f(low)}" PowerHigh="${f(high)}"${extra}`);
  return open("SteadyState", `Duration="${dur}" Power="${f(low)}"${extra}`);
}

function repeatBlock(r: Repeat, structure: WorkoutStructure, t: Thresholds): string[] {
  if (r.steps.length === 2 && r.steps.every((s) => s.target.type !== "none" || s.kind === "rest")) {
    const [on, off] = r.steps;
    const [onLow, onHigh] = range(on);
    const [offLow, offHigh] = range(off);
    const onDur = Math.max(1, Math.round(stepSeconds(on, structure.sport, t)));
    const offDur = Math.max(1, Math.round(stepSeconds(off, structure.sport, t)));
    const cad = on.cadence ? ` Cadence="${Math.round((on.cadence.low + on.cadence.high) / 2)}"` : "";
    const cadRest = off.cadence ? ` CadenceResting="${Math.round((off.cadence.low + off.cadence.high) / 2)}"` : "";
    return [
      `<IntervalsT Repeat="${r.count}" OnDuration="${onDur}" OffDuration="${offDur}" OnPower="${f((onLow + onHigh) / 2)}" OffPower="${f((offLow + offHigh) / 2)}"${cad}${cadRest}/>`,
    ];
  }
  const out: string[] = [];
  for (let i = 0; i < r.count; i++) for (const s of r.steps) out.push(segment(s, structure, t));
  return out;
}

export function encodeZwo(input: { name: string; description?: string; structure: WorkoutStructure; thresholds: Thresholds }): string {
  const { structure, thresholds } = input;
  if (structure.sport === "strength") throw new Error("Zwift unterstützt kein Krafttraining");
  const lines: string[] = [];
  for (const node of structure.nodes) {
    if (node.type === "step") lines.push(segment(node, structure, thresholds));
    else lines.push(...repeatBlock(node, structure, thresholds));
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<workout_file>`,
    `  <author>Wrkhive</author>`,
    `  <name>${esc(input.name)}</name>`,
    `  <description>${esc(input.description ?? "")}</description>`,
    `  <sportType>${structure.sport === "ride" ? "bike" : "run"}</sportType>`,
    `  <tags/>`,
    `  <workout>`,
    ...lines.map((l) => `    ${l}`),
    `  </workout>`,
    `</workout_file>`,
    ``,
  ].join("\n");
}
