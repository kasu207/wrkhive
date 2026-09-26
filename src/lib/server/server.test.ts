/**
 * Integration tests for the server layer against a real (temporary) SQLite
 * database. The Anthropic SDK is mocked; everything else runs for real.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wrkhive-test-"));
process.env.DATABASE_PATH = path.join(tmp, "test.db");

// Captured requests and scripted responses for the mocked Claude API.
const calls: Record<string, unknown>[] = [];
const responses: unknown[] = [];

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          const next = responses.shift();
          if (!next) throw new Error("no scripted response");
          return next;
        },
      },
    };
  }
  return { default: Anthropic };
});

const { getDb } = await import("@/db");
const schema = await import("@/db/schema");
const { isSameSession, upsertActivities, syncConnection, todayFor } = await import("./sync");
const { createConnection } = await import("./connections");
const { handleCoachMessage, handlePlanRequest } = await import("./coach");
const { pmcFor } = await import("./training");
const { adaptScheduled, autoAdaptToday, readinessFor, restoreScheduled } = await import("./adapt");

function makeUser(id: string) {
  const db = getDb();
  db.insert(schema.users)
    .values({ id, email: `${id}@example.com`, name: "Test", passwordHash: "x", ftp: 250, lthr: 170, maxHr: 190, restHr: 50, thresholdPace: 300, timeZone: "Europe/Berlin" })
    .run();
  return db.select().from(schema.users).all().find((u) => u.id === id)!;
}

describe("activities sync (demo provider)", () => {
  let user: ReturnType<typeof makeUser>;
  beforeAll(() => {
    user = makeUser("u-sync");
  });

  it("imports a year of plausible history and is idempotent", async () => {
    const conn = await createConnection(user, "garmin", { mode: "demo" });
    const db = getDb();
    const count = () => db.select().from(schema.activities).all().filter((a) => a.userId === user.id).length;
    const first = count();
    expect(first).toBeGreaterThan(200);
    const again = await syncConnection(conn, { full: true });
    expect(again.ok).toBe(true);
    expect(count()).toBe(first);
    const pmc = pmcFor(user, 42);
    expect(pmc[pmc.length - 1].ctl).toBeGreaterThan(20);
    expect(pmc[pmc.length - 1].ctl).toBeLessThan(150);
  });

  it("skips a duplicate delivered by a second provider", () => {
    getDb()
      .insert(schema.deviceConnections)
      .values([
        { id: "c1", userId: user.id, provider: "wahoo", mode: "demo" },
      ])
      .run();
    const garmin = getDb().select().from(schema.deviceConnections).all().find((c) => c.userId === user.id && c.provider === "garmin")!;
    const start = new Date("2026-01-10T08:00:00Z");
    const base = { sport: "ride" as const, name: "Ausfahrt", startTime: start, durationSec: 3600, distanceM: 30000, normPower: 200 };
    const a = upsertActivities(user, { id: garmin.id, provider: "garmin" }, [{ ...base, externalId: "g-1" }]);
    const b = upsertActivities(user, { id: "c1", provider: "wahoo" }, [{ ...base, externalId: "w-1", startTime: new Date(start.getTime() + 60_000) }]);
    expect(a.inserted).toBe(1);
    expect(b.inserted).toBe(0);
  });

  it("merges repeated uploads and fills in metrics from another source", () => {
    const db = getDb();
    db.insert(schema.deviceConnections).values({ id: "c-icu", userId: user.id, provider: "intervals", mode: "live" }).run();
    const start = new Date("2024-03-10T17:00:00Z");
    // ELEMNT recording via Wahoo: heart rate, no power meter on the bike.
    upsertActivities(user, { id: "c1", provider: "wahoo" }, [
      { externalId: "w-indoor", sport: "ride", name: "Indoor", startTime: start, durationSec: 3600, avgHr: 140, deviceName: "Wahoo", sourceApp: "wahoo" },
    ]);
    // MyWhoosh uploads the same ride twice to intervals.icu (with trainer power).
    const mw = { sport: "ride" as const, name: "MyWhoosh – Sweet Spot", startTime: new Date(start.getTime() + 40_000), durationSec: 3550, avgPower: 210, normPower: 220, sourceApp: "mywhoosh" as const };
    const r1 = upsertActivities(user, { id: "c-icu", provider: "intervals" }, [{ ...mw, externalId: "i1" }]);
    const r2 = upsertActivities(user, { id: "c-icu", provider: "intervals" }, [{ ...mw, externalId: "i2" }]);
    expect(r1).toMatchObject({ inserted: 0, merged: 1 });
    expect(r2).toMatchObject({ inserted: 0 });
    const rows = db.select().from(schema.activities).all().filter((x) => x.userId === user.id && x.date === "2024-03-10");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "wahoo", avgHr: 140, normPower: 220, sourceApp: "mywhoosh", tssMethod: "power" });
    // Load now comes from power over the MyWhoosh ride's duration: (220/250)^2 * 100 * 3550/3600.
    expect(rows[0].tss).toBeCloseTo(76.4, 1);
  });

  it("recognizes the same session by start or overlap", () => {
    const t = (min: number) => new Date(Date.UTC(2024, 2, 11, 17, min));
    expect(isSameSession({ startTime: t(0), durationSec: 3600 }, { startTime: t(4), durationSec: 3300 })).toBe(true);
    // Watch started 12 minutes before the MyWhoosh ride.
    expect(isSameSession({ startTime: t(0), durationSec: 4200 }, { startTime: t(12), durationSec: 3600 })).toBe(true);
    // Two separate rides the same afternoon.
    expect(isSameSession({ startTime: t(0), durationSec: 1800 }, { startTime: t(40), durationSec: 1800 })).toBe(false);
    // Short warm-up ride before a longer one: barely overlapping.
    expect(isSameSession({ startTime: t(0), durationSec: 1200 }, { startTime: t(15), durationSec: 3600 })).toBe(false);
  });

  it("adds MyWhoosh power to a heart-rate-only watch recording started earlier", () => {
    const start = new Date("2024-04-02T16:50:00Z");
    upsertActivities(user, { id: null, provider: "manual" }, [
      { externalId: "watch-indoor", sport: "ride", name: "Indoor Cycling", startTime: start, durationSec: 4000, avgHr: 138, deviceName: "Garmin Forerunner 265" },
    ]);
    const r = upsertActivities(user, { id: null, provider: "manual" }, [
      { externalId: "fit-mywhoosh", sport: "ride", name: "MyWhoosh", startTime: new Date(start.getTime() + 11 * 60_000), durationSec: 3500, avgPower: 190, normPower: 205, sourceApp: "mywhoosh" },
    ]);
    expect(r).toMatchObject({ inserted: 0, merged: 1 });
    const row = getDb().select().from(schema.activities).all().find((x) => x.externalId === "watch-indoor")!;
    expect(row).toMatchObject({ avgHr: 138, normPower: 205, sourceApp: "mywhoosh", tssMethod: "power" });
    // Load from the MyWhoosh ride's own duration: (205/250)^2 * 100 * 3500/3600.
    expect(row.tss).toBeCloseTo(65.4, 1);
  });

  it("marks a planned workout as done when a matching activity arrives", () => {
    const db = getDb();
    const date = "2026-02-03";
    db.insert(schema.workouts)
      .values({ id: "w-match", userId: user.id, name: "Lauf", sport: "run", structure: { sport: "run", nodes: [] } })
      .run();
    db.insert(schema.scheduledWorkouts).values({ id: "s-match", userId: user.id, workoutId: "w-match", date }).run();
    upsertActivities(user, { id: "c1", provider: "wahoo" }, [
      { externalId: "w-run", sport: "run", name: "Lauf", startTime: new Date(`${date}T07:00:00Z`), durationSec: 2400, distanceM: 8000, avgHr: 150 },
    ]);
    const s = db.select().from(schema.scheduledWorkouts).all().find((x) => x.id === "s-match")!;
    expect(s.status).toBe("done");
    expect(s.activityId).toBeTruthy();
  });
});

describe("adaptation to load", () => {
  const db = () => getDb();
  let user: ReturnType<typeof makeUser>;
  const vo2 = {
    sport: "ride" as const,
    nodes: [
      { id: "a", type: "step" as const, kind: "warmup" as const, duration: { type: "time" as const, seconds: 900 }, target: { type: "power" as const, low: 50, high: 70 } },
      {
        id: "r",
        type: "repeat" as const,
        count: 5,
        steps: [
          { id: "b", type: "step" as const, kind: "active" as const, duration: { type: "time" as const, seconds: 240 }, target: { type: "power" as const, low: 110, high: 118 } },
          { id: "c", type: "step" as const, kind: "recovery" as const, duration: { type: "time" as const, seconds: 240 }, target: { type: "power" as const, low: 50, high: 50 } },
        ],
      },
    ],
  };

  beforeAll(() => {
    user = makeUser("u-adapt");
    // Moderate base for 6 weeks, then a brutal last week: deep fatigue.
    const today = todayFor(user);
    const list = [];
    for (let d = 42; d >= 1; d--) {
      const date = new Date(`${today}T06:00:00Z`);
      date.setUTCDate(date.getUTCDate() - d);
      list.push({ externalId: `x${d}`, sport: "ride" as const, name: "Fahrt", startTime: date, durationSec: d <= 7 ? 3 * 3600 : 3600, normPower: d <= 7 ? 225 : 170 });
    }
    upsertActivities(user, { id: null, provider: "manual" }, list);
    db().update(schema.users).set({ autoAdapt: true }).where(eq(schema.users.id, "u-adapt")).run();
    user = db().select().from(schema.users).all().find((u) => u.id === "u-adapt")!;
  });

  it("judges readiness from recent load", () => {
    const r = readinessFor(user)!;
    expect(r.formPct).toBeLessThan(-40);
    expect(r.mode).toBe("recover");
  });

  it("adapts today's workout automatically, restores the original, and leaves sent ones alone", () => {
    const today = todayFor(user);
    db().insert(schema.workouts).values({ id: "w-vo2", userId: user.id, name: "VO2max 5x4", sport: "ride", structure: vo2, tss: 80 }).run();
    db().insert(schema.scheduledWorkouts).values({ id: "s-today", userId: user.id, workoutId: "w-vo2", date: today }).run();

    expect(autoAdaptToday(user)).toBe(1);
    const s = db().select().from(schema.scheduledWorkouts).all().find((x) => x.id === "s-today")!;
    expect(s.originalWorkoutId).toBe("w-vo2");
    expect(s.workoutId).not.toBe("w-vo2");
    expect(s.adaptNote).toMatch(/lockere Einheit/i);
    const adapted = db().select().from(schema.workouts).all().find((w) => w.id === s.workoutId)!;
    expect(adapted.source).toBe("plan");
    expect(adapted.tss).toBeLessThan(80);
    // Idempotent.
    expect(autoAdaptToday(user)).toBe(0);
    expect(adaptScheduled(user, "s-today").ok).toBe(false);

    const r = restoreScheduled(user, "s-today");
    expect(r).toEqual({ ok: true, resendTo: [] });
    const back = db().select().from(schema.scheduledWorkouts).all().find((x) => x.id === "s-today")!;
    expect(back).toMatchObject({ workoutId: "w-vo2", originalWorkoutId: null, adaptNote: null });
    expect(db().select().from(schema.workouts).all().some((w) => w.id === s.workoutId)).toBe(false);

    // Once sent to a device, the automatic mode keeps its hands off.
    db().insert(schema.deliveries).values({ id: "d1", userId: user.id, workoutId: "w-vo2", provider: "wahoo", status: "sent", scheduledDate: today }).run();
    expect(autoAdaptToday(user)).toBe(0);
    // A manual adaptation reports where to re-send.
    const manual = adaptScheduled(user, "s-today");
    expect(manual.ok && manual.resendTo).toEqual(["Wahoo"]);
  });

  it("only adapts today's workouts", () => {
    db().insert(schema.scheduledWorkouts).values({ id: "s-later", userId: user.id, workoutId: "w-vo2", date: "2099-01-01" }).run();
    const r = adaptScheduled(user, "s-later");
    expect(r.ok).toBe(false);
  });
});

describe("coach (rules engine)", () => {
  it("builds a workout for a free-text request", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const user = makeUser("u-rules");
    const r = await handleCoachMessage(user, "Gib mir 60 Minuten Schwelle auf dem Rad");
    expect(r.engine).toBe("rules");
    expect(r.payload?.kind).toBe("workout");
  });

  it("builds a plan from the plan assistant", async () => {
    const user = makeUser("u-plan");
    const r = await handlePlanRequest(user, { goal: "10 km", sport: "run", eventDate: null, weeks: 6, hoursPerWeek: 4, trainingDays: [1, 3, 6], longDay: 6, strength: false });
    expect(r.payload?.kind).toBe("plan");
    if (r.payload?.kind === "plan") expect(r.payload.plan.weeks).toHaveLength(6);
  });
});

describe("coach (Claude)", () => {
  it("sends a structured-output request and repairs invalid notation once", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const user = makeUser("u-ai");
    const bad = { reply: "Hier ist dein Workout.", workout: { name: "VO2", description: "Hart.", sport: "ride", steps: "10min 50%\n5x (3min 110%, 2min" }, plan: null };
    const good = { ...bad, workout: { ...bad.workout, steps: "Aufwärmen 10min 50-65%\n5x (3min 110%, Erholung 2min 55%)\nCool-down 10min 50%" } };
    responses.push(
      { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(bad) }], parsed_output: bad },
      { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(good) }], parsed_output: good },
    );
    const r = await handleCoachMessage(user, "45 Minuten VO2max");
    expect(r.engine).toBe("ai");
    expect(r.payload?.kind).toBe("workout");
    if (r.payload?.kind === "workout") expect(r.payload.workout.structure.nodes).toHaveLength(3);

    expect(calls).toHaveLength(2);
    const req = calls[0] as { model: string; thinking: unknown; fallbacks: unknown; betas: string[]; output_config: { format: { type: string; schema: unknown } }; messages: { role: string; content: string }[] };
    expect(req.model).toBe("claude-opus-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toContain("server-side-fallback-2026-07-01");
    expect(req.output_config.format.type).toBe("json_schema");
    expect(JSON.stringify(req.output_config.format.schema)).toContain("steps");
    expect(req.messages[req.messages.length - 1].content).toContain("<trainingskontext>");
    const repair = calls[1] as { messages: { role: string; content: string }[] };
    expect(repair.messages[repair.messages.length - 1].content).toContain("ungültiger Schreibweise");
  });

  it("materializes an AI plan relative to the current week and drops past sessions", async () => {
    const user = makeUser("u-ai-plan");
    const session = (day: number) => ({ day, name: `S${day}`, description: "", sport: "run", steps: "40min Z2" });
    const out = {
      reply: "Plan steht.",
      workout: null,
      plan: { name: "Plan", goal: "HM", sport: "run", event_date: null, summary: "…", weeks: [0, 1, 2].map(() => ({ phase: "base", focus: "Basis", sessions: [session(0), session(3), session(6)] })) },
    };
    responses.push({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }], parsed_output: out });
    const r = await handleCoachMessage(user, "Plan bitte");
    expect(r.payload?.kind).toBe("plan");
    if (r.payload?.kind !== "plan") return;
    const today = todayFor(user);
    for (const w of r.payload.plan.weeks) {
      for (const s of w.sessions) {
        const d = new Date(Date.parse(w.startDate) + s.day * 86_400_000).toISOString().slice(0, 10);
        expect(d >= today).toBe(true);
      }
    }
    expect(r.payload.plan.weeks[2].sessions).toHaveLength(3);
  });

  it("falls back to the rules engine when the API fails", async () => {
    const user = makeUser("u-ai-fail");
    // No scripted response -> the mock throws.
    const r = await handleCoachMessage(user, "30 Minuten locker laufen");
    expect(r.engine).toBe("rules");
    expect(r.content).toMatch(/nicht erreichbar/);
    expect(r.payload?.kind).toBe("workout");
  });
});
