/**
 * Integration tests for the server layer against a real (temporary) SQLite
 * database. The Anthropic SDK is mocked; everything else runs for real.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
const { upsertActivities, syncConnection, todayFor } = await import("./sync");
const { createConnection } = await import("./connections");
const { handleCoachMessage, handlePlanRequest } = await import("./coach");
const { pmcFor } = await import("./training");

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
