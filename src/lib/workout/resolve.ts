import type { CadenceRange, Target, Thresholds } from "./types";

/** Absolute target values, resolved against the athlete's thresholds. */
export type AbsoluteTarget =
  | { type: "none" }
  | { type: "rpe"; value: number }
  | { type: "power"; watts: [number, number] }
  | { type: "hr"; bpm: [number, number] }
  /** Speed range in m/s, [slow, fast]. */
  | { type: "pace"; speed: [number, number] }
  | { type: "cadence"; rpm: [number, number] };

export function resolveTarget(target: Target, t: Thresholds): AbsoluteTarget {
  switch (target.type) {
    case "none":
      return { type: "none" };
    case "rpe":
      return { type: "rpe", value: target.value };
    case "power":
      return { type: "power", watts: [Math.round((target.low / 100) * t.ftp), Math.round((target.high / 100) * t.ftp)] };
    case "hr":
      return { type: "hr", bpm: [Math.round((target.low / 100) * t.lthr), Math.round((target.high / 100) * t.lthr)] };
    case "pace": {
      const thresholdSpeed = 1000 / t.thresholdPace;
      return {
        type: "pace",
        speed: [round3((target.low / 100) * thresholdSpeed), round3((target.high / 100) * thresholdSpeed)],
      };
    }
  }
}

export function resolveCadence(c: CadenceRange): AbsoluteTarget {
  return { type: "cadence", rpm: [c.low, c.high] };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
