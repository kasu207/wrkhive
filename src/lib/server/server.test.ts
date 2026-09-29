/**
 * Integration tests for the server layer against a real (temporary) SQLite
 * database. The Anthropic SDK is mocked; everything else runs for real.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
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
const { applyProviderMoves, ensureScheduled, isSameSession, upsertActivities, syncConnection, todayFor } = await import("./sync");
const { createConnection } = await import("./connections");
const { handleCoachMessage, handlePlanRequest } = await import("./coach");
const { formCalibration, pmcFor } = await import("./training");
const { adaptScheduled, autoAdaptToday, readinessFor, restoreScheduled } = await import("./adapt");
const { importAppleWorkouts, rotateAppleHealthKey, userByAppleHealthKey, revokeAppleHealthKey } = await import("./apple-health");
const { POST: appleHealthWebhook } = await import("@/app/api/ingest/apple-health/route");
const { purgeStrayDemoData } = await import("./demo-cleanup");
const { beginConnect } = await import("./connections");
const { saveCheckin, upsertWellness, wellnessBetween, recoveryFor } = await import("./wellness");
const { dashboardData, emptyHint } = await import("./dashboard");

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

describe("moves made at the provider", () => {
  it("moves the calendar entry along, marks deleted ones and keeps sending idempotent", () => {
    const db = getDb();
    const user = makeUser("u-move");
    db.insert(schema.deviceConnections).values({ id: "c-move", userId: user.id, provider: "intervals", mode: "live" }).run();
    db.insert(schema.workouts).values([
      { id: "w-a", userId: user.id, name: "A", sport: "ride", structure: { sport: "ride", nodes: [] } },
      { id: "w-b", userId: user.id, name: "B", sport: "ride", structure: { sport: "ride", nodes: [] } },
    ]).run();
    ensureScheduled(user.id, "w-a", "2030-05-01");
    ensureScheduled(user.id, "w-a", "2030-05-01");
    ensureScheduled(user.id, "w-b", "2030-05-02");
    const entries = () => db.select().from(schema.scheduledWorkouts).all().filter((x) => x.userId === user.id);
    expect(entries()).toHaveLength(2);
    db.insert(schema.deliveries).values([
      { id: "d-a", userId: user.id, workoutId: "w-a", connectionId: "c-move", provider: "intervals", status: "sent", scheduledDate: "2030-05-01", externalIds: { event: 11 } },
      { id: "d-b", userId: user.id, workoutId: "w-b", connectionId: "c-move", provider: "intervals", status: "sent", scheduledDate: "2030-05-02", externalIds: { event: 12 } },
    ]).run();

    // Event 11 moved to May 3 in intervals.icu, event 12 deleted there.
    const r = applyProviderMoves(user, { provider: "intervals" }, { key: "event", items: [{ id: "11", date: "2030-05-03" }], complete: { from: "2030-04-20", to: "2030-06-30" } });
    expect(r).toMatchObject({ moved: 1, removed: 1, moves: [{ workoutId: "w-a", from: "2030-05-01", to: "2030-05-03" }] });
    expect(entries().find((x) => x.workoutId === "w-a")!.date).toBe("2030-05-03");
    const del = db.select().from(schema.deliveries).all();
    expect(del.find((d) => d.id === "d-a")).toMatchObject({ scheduledDate: "2030-05-03", status: "sent" });
    expect(del.find((d) => d.id === "d-b")!.status).toBe("removed");
    // The Wrkhive plan of the deleted one stays.
    expect(entries().find((x) => x.workoutId === "w-b")!.date).toBe("2030-05-02");
    // Running again changes nothing.
    expect(applyProviderMoves(user, { provider: "intervals" }, { key: "event", items: [{ id: "11", date: "2030-05-03" }] })).toEqual({ moved: 0, removed: 0, moves: [] });
    // Instants (Wahoo) are converted with the athlete's time zone: 23:30 UTC is already the next day in Berlin.
    db.insert(schema.deliveries).values({ id: "d-w", userId: user.id, workoutId: "w-a", connectionId: "c-move", provider: "wahoo", status: "sent", scheduledDate: "2030-05-03", externalIds: { workout: 77 } }).run();
    applyProviderMoves(user, { provider: "wahoo" }, { key: "workout", items: [{ id: "77", date: "2030-05-04T23:30:00Z" }] });
    expect(entries().find((x) => x.workoutId === "w-a")!.date).toBe("2030-05-05");
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

describe("Apple Health", () => {
  const run = {
    type: "Running",
    start: "2026-03-02T06:00:00.000Z",
    utcOffsetSec: 3600,
    durationSec: 2700,
    distanceM: 8600,
    calories: 510,
    avgHr: 152,
    maxHr: 176,
    source: "Apple Watch von Test",
  };
  const webhook = (key: string | null, body: unknown) =>
    appleHealthWebhook(
      new Request("http://localhost/api/ingest/apple-health", {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { "api-key": key } : {}) },
        body: JSON.stringify(body),
      }) as never,
    );

  it("imports export workouts idempotently with load and attribution", () => {
    const user = makeUser("u-apple");
    const r1 = importAppleWorkouts(user, [run, { ...run, start: "2026-03-03T17:00:00.000Z", type: "MartialArts", distanceM: null, durationSec: 5400 }, { ...run, start: "2026-03-04T07:00:00.000Z", durationSec: 30 }]);
    expect(r1).toMatchObject({ inserted: 2, skipped: 1 });
    const r2 = importAppleWorkouts(user, [run]);
    expect(r2).toMatchObject({ inserted: 0, updated: 1 });
    const rows = getDb().select().from(schema.activities).where(eq(schema.activities.userId, user.id)).all();
    const lauf = rows.find((a) => a.sport === "run")!;
    expect(lauf).toMatchObject({ provider: "apple", sourceApp: "apple", name: "Lauf", date: "2026-03-02", tssMethod: "pace", deviceName: "Apple Watch von Test" });
    expect(rows.find((a) => a.sport === "other")).toMatchObject({ name: "Kampfsport", tssMethod: "hr" });
  });

  it("merges a workout another app also wrote into Apple Health", () => {
    const user = makeUser("u-apple-merge");
    upsertActivities(user, { id: null, provider: "manual" }, [
      { externalId: "garmin-fit-1", sport: "ride", name: "Abendrunde", startTime: new Date("2026-03-05T17:00:00Z"), durationSec: 3600, distanceM: 30000, normPower: 200, deviceName: "Edge 540" },
    ]);
    const r = importAppleWorkouts(user, [{ ...run, type: "Cycling", start: "2026-03-05T17:00:30.000Z", durationSec: 3590, distanceM: 29900, source: "Garmin Connect" }]);
    expect(r).toMatchObject({ inserted: 0, merged: 1 });
    const rows = getDb().select().from(schema.activities).where(eq(schema.activities.userId, user.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ avgHr: 152, tssMethod: "power" });
  });

  it("accepts Health Auto Export deliveries only with a valid key", async () => {
    const user = makeUser("u-hae");
    const key = rotateAppleHealthKey(user.id);
    expect(userByAppleHealthKey(key)?.id).toBe(user.id);
    const payload = {
      data: {
        workouts: [
          { id: "HK-1", name: "Outdoor Run", start: "2026-03-06 07:00:00 +0100", end: "2026-03-06 07:45:00 +0100", duration: 2700, distance: { qty: 8.6, units: "km" }, heartRate: { avg: { qty: 150, units: "bpm" }, max: { qty: 172, units: "bpm" } } },
        ],
      },
    };
    expect((await webhook(null, payload)).status).toBe(401);
    expect((await webhook("wh_wrong", payload)).status).toBe(401);
    const ok = await webhook(key, payload);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, workouts: 1, inserted: 1 });
    const again = await webhook(key, payload);
    expect(await again.json()).toMatchObject({ inserted: 0, updated: 1 });
    const metricsOnly = await webhook(key, { data: { metrics: [] } });
    expect((await metricsOnly.json()).note).toBeTruthy();
    expect(getDb().select().from(schema.users).where(eq(schema.users.id, user.id)).get()!.appleHealthLastAt).toBeInstanceOf(Date);

    const rotated = rotateAppleHealthKey(user.id);
    expect((await webhook(key, payload)).status).toBe(401);
    revokeAppleHealthKey(user.id);
    expect((await webhook(rotated, payload)).status).toBe(401);
  });
});

describe("demo data on a personal server", () => {
  const withDemo = async <T,>(value: string | undefined, fn: () => T | Promise<T>) => {
    const before = process.env.DEMO_ENABLED;
    if (value === undefined) delete process.env.DEMO_ENABLED;
    else process.env.DEMO_ENABLED = value;
    try {
      return await fn();
    } finally {
      if (before === undefined) delete process.env.DEMO_ENABLED;
      else process.env.DEMO_ENABLED = before;
    }
  };
  const rows = (userId: string) => getDb().select().from(schema.activities).where(eq(schema.activities.userId, userId)).all();

  it("never merges sample training with a real recording", () => {
    const user = makeUser("u-demo-merge");
    const start = new Date("2026-02-10T17:00:00Z");
    upsertActivities(user, { id: null, provider: "manual" }, [{ externalId: "d1", sport: "ride", name: "Demo", startTime: start, durationSec: 3600, sourceApp: "demo" }]);
    const r = upsertActivities(user, { id: null, provider: "manual" }, [{ externalId: "r1", sport: "ride", name: "Echt", startTime: start, durationSec: 3600, avgHr: 150, deviceName: "Edge 540" }]);
    expect(r).toMatchObject({ inserted: 1, merged: 0 });
  });

  it("does not create demo connections for real accounts when the demo is off", async () => {
    const user = makeUser("u-demo-off");
    await withDemo("false", async () => {
      await expect(beginConnect(user, "garmin")).rejects.toThrow(/intervals\.icu/);
    });
    expect(getDb().select().from(schema.deviceConnections).where(eq(schema.deviceConnections.userId, user.id)).all()).toHaveLength(0);
  });

  it("removes stray sample data and re-reads the real history", async () => {
    const user = makeUser("u-demo-purge");
    const demo = await createConnection(user, "garmin", { mode: "demo" });
    const live = { id: "c-live-purge" };
    getDb().insert(schema.deviceConnections).values({ id: live.id, userId: user.id, provider: "intervals", mode: "live", lastSyncAt: new Date() }).run();
    upsertActivities(user, { id: live.id, provider: "intervals" }, [{ externalId: "real-1", sport: "run", name: "Lauf", startTime: new Date("2026-01-05T07:00:00Z"), durationSec: 2400, sourceApp: "garmin" }]);
    const sample = rows(user.id).filter((a) => a.sourceApp === "demo").length;
    expect(sample).toBeGreaterThan(100);

    expect(await withDemo(undefined, () => purgeStrayDemoData())).toMatchObject({ users: 0 });
    // Other accounts in this test database carry demo connections too.
    const r = await withDemo("false", () => purgeStrayDemoData());
    expect(r.connections).toBeGreaterThanOrEqual(1);
    expect(r.activities).toBeGreaterThanOrEqual(sample);
    expect(rows(user.id).map((a) => a.externalId)).toEqual(["real-1"]);
    const conns = getDb().select().from(schema.deviceConnections).where(eq(schema.deviceConnections.userId, user.id)).all();
    expect(conns.map((c) => c.id)).toEqual([live.id]);
    expect(conns[0].lastSyncAt).toBeNull();
    expect(demo.id).toBeTruthy();
    expect(await withDemo("false", () => purgeStrayDemoData())).toMatchObject({ users: 0 });
  });
});

describe("form calibration", () => {
  it("does not judge form or adapt workouts on a short history until a baseline is given", () => {
    const user = makeUser("u-calib");
    const today = todayFor(user);
    const list = [1, 2, 3, 4, 5, 6].map((d) => ({
      externalId: `c-${d}`,
      sport: "ride" as const,
      name: "Runde",
      startTime: new Date(`${addDaysIso(today, -d)}T16:00:00Z`),
      durationSec: 5400,
      normPower: 220,
    }));
    upsertActivities(user, { id: null, provider: "manual" }, list);
    expect(formCalibration(user)).toMatchObject({ reliable: false, historyDays: 7, remainingDays: 35 });
    expect(readinessFor(user)).toBeNull();
    const cold = pmcFor(user, 1).at(-1)!;

    getDb().update(schema.users).set({ baselineWeeklyHours: 8 }).where(eq(schema.users.id, user.id)).run();
    const seeded = getDb().select().from(schema.users).where(eq(schema.users.id, user.id)).get()!;
    expect(formCalibration(seeded).reliable).toBe(true);
    const warm = pmcFor(seeded, 1).at(-1)!;
    expect(warm.ctl).toBeGreaterThan(cold.ctl + 40);
    expect(warm.tsb).toBeGreaterThan(cold.tsb);
    expect(readinessFor(seeded)).not.toBeNull();
  });
});

describe("daily health values", () => {
  it("merges sources per day, keeps sample data off real values and drops implausible ones", () => {
    const user = makeUser("u-well");
    const today = todayFor(user);
    upsertWellness(user.id, [{ date: today, restingHr: 48, sleepSec: 7 * 3600 }], "garmin");
    upsertWellness(user.id, [{ date: today, hrv: 66, restingHr: 300 }], "intervals");
    upsertWellness(user.id, [{ date: today, restingHr: 60, hrv: 20 }], "demo");
    saveCheckin(user.id, { date: today, legs: 4, sleepFeel: 3, motivation: 5 });
    const [row] = wellnessBetween(user.id, today, today);
    expect(row).toMatchObject({ restingHr: 48, hrv: 66, sleepSec: 7 * 3600, legs: 4, sleepFeel: 3, motivation: 5 });
  });

  it("stores Health Auto Export metrics and lets impaired recovery reduce hard sessions", async () => {
    makeUser("u-hae-metrics");
    // Stated volume before Wrkhive matches the synced training: fitness starts where it is.
    getDb().update(schema.users).set({ baselineWeeklyHours: 7 }).where(eq(schema.users.id, "u-hae-metrics")).run();
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, "u-hae-metrics")).get()!;
    const today = todayFor(user);
    // Steady load for eight weeks: the load model alone keeps the plan.
    upsertActivities(
      user,
      { id: null, provider: "manual" },
      Array.from({ length: 56 }, (_, i) => ({ externalId: `st-${i}`, sport: "ride" as const, name: "Runde", startTime: new Date(`${addDaysIso(today, -i - 1)}T16:00:00Z`), durationSec: 3600, normPower: 170 })),
    );
    expect(readinessFor(user)!.mode).toBe("keep");

    const key = rotateAppleHealthKey(user.id);
    const days = Array.from({ length: 60 }, (_, i) => addDaysIso(today, i - 59));
    const metrics = [
      { name: "resting_heart_rate", units: "count/min", data: days.map((d, i) => ({ date: `${d} 00:00:00 +0200`, qty: i >= 54 ? 58 : 48 + (i % 3) - 1 })) },
      { name: "heart_rate_variability", units: "ms", data: days.map((d, i) => ({ date: `${d} 00:00:00 +0200`, qty: i >= 54 ? 38 : 60 + ((i % 3) - 1) * 3 })) },
    ];
    const res = await appleHealthWebhook(
      new Request("http://localhost/api/ingest/apple-health", { method: "POST", headers: { "content-type": "application/json", "api-key": key }, body: JSON.stringify({ data: { metrics } }) }) as never,
    );
    expect(await res.json()).toMatchObject({ ok: true, workouts: 0, days: 60 });
    expect(wellnessBetween(user.id, days[0], today)[0]).toMatchObject({ hrvSdnn: 60 - 3 });

    const recovery = recoveryFor(user)!;
    expect(recovery.level).toBe("impaired");
    const r = readinessFor(user)!;
    expect(r.mode).toBe("reduce");
    expect(r.label).toBe("Erholung eingeschränkt");

    const d = dashboardData(user);
    expect(d.hrv().metric).toBe("hrvSdnn");
    expect(emptyHint("restingHr", d)).toBeNull();
    expect(emptyHint("sleep", d)).toContain("Apple Health");
    expect(d.consistency(3).streak).toBeGreaterThan(5);
    expect(d.thresholds().suggestions).toEqual([]);
  });

  it("fills the demo dashboard with health values and best efforts", async () => {
    const user = makeUser("u-demo-well");
    const conn = await createConnection(user, "wahoo", { mode: "demo" });
    await syncConnection(conn);
    const d = dashboardData(user);
    expect(d.restingHr().baseline).not.toBeNull();
    expect(d.hrv().metric).toBe("hrv");
    expect(Object.keys(d.bests().powerYear).length).toBeGreaterThan(3);
    expect(d.efficiency().length).toBeGreaterThan(0);
    expect(d.intensity().sessions).toBeGreaterThan(0);
  });
});
