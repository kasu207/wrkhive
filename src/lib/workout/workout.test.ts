import { Decoder, Stream } from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";
import { encodeFitWorkout } from "./export/fit";
import { encodeGarminWorkout } from "./export/garmin";
import { encodeWahooPlan, wahooCompatibility } from "./export/wahoo";
import { encodeZwo } from "./export/zwo";
import { summarize } from "./metrics";
import { parseStructure } from "./schema";
import { parseWorkoutText, serializeWorkoutText } from "./text";
import type { Repeat, Step, Thresholds } from "./types";

const T: Thresholds = { ftp: 250, lthr: 170, maxHr: 190, thresholdPace: 300 };

function parseOk(text: string, sport: "ride" | "run" | "strength" = "ride") {
  const r = parseWorkoutText(text, sport, T);
  expect(r.errors).toEqual([]);
  return r.structure;
}

describe("text parser", () => {
  it("parses a classic interval ride and infers step roles", () => {
    const w = parseOk("10min 50-65%, 5x (3min 110%, 2min 55%), 10min 50%");
    expect(w.nodes).toHaveLength(3);
    const [wu, rep, cd] = w.nodes as [Step, Repeat, Step];
    expect(wu.kind).toBe("warmup");
    expect(wu.duration).toEqual({ type: "time", seconds: 600 });
    expect(wu.target).toEqual({ type: "power", low: 50, high: 65 });
    expect(rep.count).toBe(5);
    expect(rep.steps[0].kind).toBe("active");
    expect(rep.steps[1].kind).toBe("recovery");
    expect(cd.kind).toBe("cooldown");
  });

  it("understands explicit keywords, watts, cadence and German zones", () => {
    const w = parseOk("Aufwärmen 15min GA1\n3x 12min 240-260W 90-95rpm / 5min Pause\nAusfahren 10min KB");
    const [wu, rep, cd] = w.nodes as [Step, Repeat, Step];
    expect(wu.kind).toBe("warmup");
    expect(wu.target).toEqual({ type: "power", low: 56, high: 75 });
    expect(rep.steps[0].target).toEqual({ type: "power", low: 96, high: 104 });
    expect(rep.steps[0].cadence).toEqual({ low: 90, high: 95 });
    expect(rep.steps[1].kind).toBe("rest");
    expect(cd.kind).toBe("cooldown");
  });

  it("parses run notation with distances and paces", () => {
    const w = parseOk("2km Z2, 6x (400m 4:00/km, 90s Pause), 1,5km locker", "run");
    const [first, rep, last] = w.nodes as [Step, Repeat, Step];
    expect(first.duration).toEqual({ type: "distance", meters: 2000 });
    expect(first.target.type).toBe("pace");
    expect(rep.steps[0].duration).toEqual({ type: "distance", meters: 400 });
    // 300 s/km threshold, 240 s/km target -> 125 % of threshold speed
    expect(rep.steps[0].target).toEqual({ type: "pace", low: 125, high: 125 });
    expect(rep.steps[1].kind).toBe("rest");
    expect(last.duration).toEqual({ type: "distance", meters: 1500 });
    expect(last.kind).toBe("recovery");
  });

  it("supports the indented multi-line repeat form", () => {
    const w = parseOk("10min 60%\n4x\n  - 4min 105%\n  - 3min 50%\n10min 50%");
    expect((w.nodes[1] as Repeat).steps).toHaveLength(2);
  });

  it("parses strength sets shorthand", () => {
    const w = parseOk("3x10 Kniebeuge (Langhantel) 60kg Pause 2min\n4x8 Rudern am Kabel\n3x (45s Unterarmstütz, 30s Pause)", "strength");
    const squat = w.nodes[0] as Repeat;
    expect(squat.count).toBe(3);
    expect(squat.steps[0].duration).toEqual({ type: "reps", reps: 10 });
    expect(squat.steps[0].exercise).toEqual({ key: "back-squat", weightKg: 60 });
    expect(squat.steps[1].duration).toEqual({ type: "time", seconds: 120 });
    expect((w.nodes[1] as Repeat).steps[1].duration).toEqual({ type: "time", seconds: 90 });
    const plank = w.nodes[2] as Repeat;
    expect(plank.steps[0].exercise?.key).toBe("plank");
    expect(plank.steps[0].duration).toEqual({ type: "time", seconds: 45 });
  });

  it("reports helpful errors", () => {
    expect(parseWorkoutText("5x (3min 110%, 2min", "ride", T).errors.length).toBeGreaterThan(0);
    expect(parseWorkoutText("110%", "ride", T).errors[0].message).toMatch(/keine Dauer/);
    expect(parseWorkoutText("10min 4:30/km", "ride", T).errors[0].message).toMatch(/Pace/);
    expect(parseWorkoutText("3x10 Gibtsnicht", "strength", T).errors[0].message).toMatch(/nicht gefunden/);
    expect(parseWorkoutText("10min 30", "ride", T).errors[0].message).toMatch(/Einheit/);
  });

  it("round-trips through the serializer", () => {
    const cases: [string, "ride" | "run" | "strength"][] = [
      ["Aufwärmen 10min 50-65%\n5x (3min 110% 95rpm, Erholung 2min 55%)\nCool-down 10min 50%", "ride"],
      ["Aufwärmen 2km 5:00-5:30/km\n6x (400m 4:00/km, Pause 1min 30s)\nCool-down 10min 150bpm", "run"],
      ["3x10 Kniebeuge (Langhantel) 60kg Pause 2min\n3x12 Liegestütz Pause 1min", "strength"],
      ['2x ("Sweet Spot" 20min 88-94%, Erholung 5min 50%)', "ride"],
      ["Aufwärmen 15min RPE 3\n20min 90% 85-95rpm\nCool-down offen", "ride"],
    ];
    for (const [text, sport] of cases) {
      const a = parseOk(text, sport);
      const serialized = serializeWorkoutText(a, T);
      const b = parseOk(serialized, sport);
      const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "id" ? undefined : v)));
      expect(strip(b)).toEqual(strip(a));
      expect(serializeWorkoutText(b, T)).toBe(serialized);
    }
  });
});

describe("metrics", () => {
  it("computes duration and TSS for steady efforts", () => {
    const w = parseOk("60min 100%");
    const s = summarize(w, T);
    expect(s.durationSec).toBe(3600);
    expect(s.tss).toBe(100);
    expect(s.intensityFactor).toBe(1);
  });

  it("counts repeats", () => {
    const s = summarize(parseOk("10min 50%, 5x (3min 110%, 2min 55%), 10min 50%"), T);
    expect(s.durationSec).toBe(45 * 60);
    expect(s.tss).toBeGreaterThan(40);
    expect(s.tss).toBeLessThan(70);
  });
});

describe("schema", () => {
  it("accepts parsed structures", () => {
    expect(() => parseStructure(parseOk("10min 50%, 5x (3min 110%, 2min 55%)"))).not.toThrow();
  });
  it("rejects inverted ranges", () => {
    const bad = { sport: "ride", nodes: [{ id: "a", type: "step", kind: "active", duration: { type: "time", seconds: 60 }, target: { type: "power", low: 120, high: 80 } }] };
    expect(() => parseStructure(bad)).toThrow();
  });
});

describe("FIT export", () => {
  it("encodes a valid workout file readable by the Garmin decoder", () => {
    const w = parseOk("Aufwärmen 10min 50-65%\n5x (3min 110% 90-100rpm, 2min 55%)\nCool-down 5km 60%");
    const bytes = encodeFitWorkout({ name: "VO2 5x3", structure: w, thresholds: T, createdAt: new Date("2026-01-01T00:00:00Z") });
    const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
    expect(decoder.isFIT()).toBe(true);
    expect(decoder.checkIntegrity()).toBe(true);
    const { messages, errors } = decoder.read();
    expect(errors).toEqual([]);
    expect(messages.fileIdMesgs[0].type).toBe("workout");
    expect(messages.workoutMesgs[0].wktName).toBe("VO2 5x3");
    expect(messages.workoutMesgs[0].sport).toBe("cycling");
    const steps = messages.workoutStepMesgs;
    expect(steps).toHaveLength(5);
    expect(messages.workoutMesgs[0].numValidSteps).toBe(5);

    // Warm-up: 10 minutes, 125-163 W
    expect(steps[0].intensity).toBe("warmup");
    expect(steps[0].durationType).toBe("time");
    expect(steps[0].durationTime).toBe(600);
    expect(steps[0].targetType).toBe("power");
    expect(steps[0].customTargetPowerLow).toBe(125 + 1000);
    expect(steps[0].customTargetPowerHigh).toBe(163 + 1000);

    // Interval with secondary cadence target
    expect(steps[1].customTargetPowerLow).toBe(275 + 1000);
    expect(steps[1].secondaryTargetType).toBe("cadence");
    expect(steps[1].secondaryCustomTargetCadenceLow).toBe(90);
    expect(steps[1].secondaryCustomTargetCadenceHigh).toBe(100);
    expect(steps[2].intensity).toBe("recovery");

    // Repeat step: back to index 1, 5 times
    expect(steps[3].durationType).toBe("repeatUntilStepsCmplt");
    expect(steps[3].durationStep).toBe(1);
    expect(steps[3].repeatSteps).toBe(5);

    // Distance cool-down: 5 km
    expect(steps[4].durationType).toBe("distance");
    expect(steps[4].durationDistance).toBe(5000);
  });

  it("encodes run pace and strength exercises", () => {
    const run = parseOk("6x (400m 4:00/km, 90s Pause)", "run");
    const r = new Decoder(Stream.fromByteArray(Array.from(encodeFitWorkout({ name: "Bahn", structure: run, thresholds: T })))).read();
    expect(r.errors).toEqual([]);
    expect(r.messages.workoutMesgs[0].sport).toBe("running");
    expect(r.messages.workoutStepMesgs[0].targetType).toBe("speed");
    expect(r.messages.workoutStepMesgs[0].customTargetSpeedLow).toBeCloseTo(4.167, 2);

    const gym = parseOk("3x10 Bankdrücken (Langhantel) 62.5kg Pause 2min", "strength");
    const g = new Decoder(Stream.fromByteArray(Array.from(encodeFitWorkout({ name: "Push", structure: gym, thresholds: T })))).read();
    expect(g.errors).toEqual([]);
    expect(g.messages.workoutMesgs[0].subSport).toBe("strengthTraining");
    const s0 = g.messages.workoutStepMesgs[0];
    expect(s0.durationType).toBe("reps");
    expect(s0.durationReps).toBe(10);
    expect(s0.exerciseCategory).toBe("benchPress");
    expect(s0.exerciseWeight).toBe(62.5);
    expect(s0.wktStepName).toBe("Bankdrücken (Langhantel)");
  });
});

describe("Wahoo plan", () => {
  it("builds a plan with relative targets and count-1 repeats", () => {
    const w = parseOk("10min 50-65%, 5x (3min 110%, 2min 55%), 10min 50%");
    const plan = encodeWahooPlan({ name: "VO2", structure: w, thresholds: T });
    expect(plan.header.ftp).toBe(250);
    expect(plan.header.workout_type_family).toBe(0);
    expect(plan.header.description).toBe("VO2");
    expect(plan.intervals[0]).toMatchObject({ exit_trigger_type: "time", exit_trigger_value: 600, intensity_type: "wu" });
    expect(plan.intervals[0].targets).toEqual([{ type: "ftp", low: 0.5, high: 0.65 }]);
    expect(plan.intervals[1]).toMatchObject({ exit_trigger_type: "repeat", exit_trigger_value: 4 });
    expect(plan.intervals[1].intervals).toHaveLength(2);
  });

  it("flags unsupported content", () => {
    expect(wahooCompatibility(parseOk("3x10 Kreuzheben", "strength")).length).toBeGreaterThan(0);
    expect(wahooCompatibility(parseOk("Cool-down offen"))[0]).toMatch(/Runden-Taste/);
  });

  it("always emits targets on non-repeat intervals", () => {
    const plan = encodeWahooPlan({ name: "x", structure: parseOk("30min"), thresholds: T });
    expect(plan.intervals[0].targets).toEqual([{ type: "rpe", low: 1, high: 10 }]);
  });
});

describe("Garmin Training API payload", () => {
  it("builds nested repeat steps with sequential stepOrder", () => {
    const w = parseOk("10min 50-65%, 5x (3min 110%, 2min 55%), 10min 50%");
    const g = encodeGarminWorkout({ name: "VO2", structure: w, thresholds: T });
    const steps = g.segments[0].steps;
    expect(steps.map((s) => s.stepOrder)).toEqual([1, 2, 5]);
    const rep = steps[1];
    expect(rep.type).toBe("WorkoutRepeatStep");
    if (rep.type === "WorkoutRepeatStep") {
      expect(rep.repeatValue).toBe(5);
      expect(rep.steps.map((s) => s.stepOrder)).toEqual([3, 4]);
      expect(rep.steps[0]).toMatchObject({ targetType: "POWER", targetValueLow: 275, targetValueHigh: 275, durationType: "TIME", durationValue: 180 });
    }
  });

  it("maps strength exercises to Garmin identifiers", () => {
    const g = encodeGarminWorkout({ name: "Legs", structure: parseOk("3x5 Kreuzheben 100kg", "strength"), thresholds: T });
    expect(g.sport).toBe("STRENGTH_TRAINING");
    const rep = g.segments[0].steps[0];
    if (rep.type !== "WorkoutRepeatStep") throw new Error("expected repeat");
    expect(rep.steps[0]).toMatchObject({ exerciseCategory: "DEADLIFT", exerciseName: "BARBELL_DEADLIFT", durationType: "REPS", durationValue: 5, weightValue: 100 });
  });
});

describe("ZWO export", () => {
  it("uses IntervalsT for on/off repeats", () => {
    const xml = encodeZwo({ name: "A & B", structure: parseOk("10min 50-65%, 5x (3min 110%, 2min 55%), 10min 50%"), thresholds: T });
    expect(xml).toContain('<IntervalsT Repeat="5" OnDuration="180" OffDuration="120" OnPower="1.1" OffPower="0.55"/>');
    expect(xml).toContain("<name>A &amp; B</name>");
    expect(xml).toContain('<Warmup Duration="600" PowerLow="0.5" PowerHigh="0.65"/>');
  });
});
