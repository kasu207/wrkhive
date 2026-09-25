import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { coachMessages, type CoachPayload, type User } from "@/db/schema";
import { focusForForm, FOCUS_LABEL, generatePlan, generateWorkout, interpretRequest, isHard, nextMonday, type PlanRequest } from "@/lib/coach/generator";
import { COACH_SYSTEM_PROMPT } from "@/lib/coach/prompt";
import type { PlanProposal, PlanWeek } from "@/lib/coach/types";
import { addDays, dayOfWeek, isISODate, startOfWeek } from "@/lib/dates";
import { newId } from "@/lib/id";
import { summarize } from "@/lib/workout/metrics";
import { parseWorkoutText } from "@/lib/workout/text";
import type { Sport, WorkoutStructure } from "@/lib/workout/types";
import { thresholdsOf } from "./auth";
import { env } from "./env";
import { todayFor } from "./sync";
import { pmcFor, trainingContext, weeklyVolume } from "./training";

// ---------------------------------------------------------------------------
// Structured output schema
// ---------------------------------------------------------------------------

const SportEnum = z.enum(["ride", "run", "strength"]);

const WorkoutOut = z.object({
  name: z.string().describe("Kurzer Name, max. 40 Zeichen"),
  description: z.string().describe("1-2 Sätze: Ziel und Ausführungshinweise"),
  sport: SportEnum,
  steps: z.string().describe("Workout in Wrkhive-Schreibweise, ein Schritt oder eine Wiederholung pro Zeile"),
});

const PlanOut = z.object({
  name: z.string(),
  goal: z.string(),
  sport: z.enum(["ride", "run", "strength", "mixed"]),
  event_date: z.string().nullable().describe("YYYY-MM-DD oder null"),
  summary: z.string().describe("2-3 Sätze zur Struktur des Plans"),
  weeks: z.array(
    z.object({
      phase: z.enum(["base", "build", "peak", "taper", "recovery", "race"]),
      focus: z.string().describe("Wochenschwerpunkt in wenigen Worten"),
      sessions: z.array(
        z.object({
          day: z.number().int().describe("0 = Montag ... 6 = Sonntag"),
          name: z.string(),
          description: z.string(),
          sport: SportEnum,
          steps: z.string(),
        }),
      ),
    }),
  ),
});

const CoachOut = z.object({
  reply: z.string(),
  workout: WorkoutOut.nullable(),
  plan: PlanOut.nullable(),
});
type CoachOutput = z.infer<typeof CoachOut>;

export interface CoachResult {
  content: string;
  payload: CoachPayload | null;
  engine: "ai" | "rules";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function coachHistory(userId: string, limit = 40) {
  return getDb().select().from(coachMessages).where(eq(coachMessages.userId, userId)).orderBy(desc(coachMessages.createdAt)).limit(limit).all().reverse();
}

export function clearCoachHistory(userId: string) {
  getDb().delete(coachMessages).where(eq(coachMessages.userId, userId)).run();
}

export async function handleCoachMessage(user: User, message: string): Promise<CoachResult> {
  const db = getDb();
  db.insert(coachMessages).values({ id: newId(), userId: user.id, role: "user", content: message.slice(0, 4000) }).run();
  let result: CoachResult;
  if (env.anthropicConfigured()) {
    try {
      result = await aiReply(user);
    } catch (e) {
      console.error("[coach] AI request failed, using rules", e);
      result = rulesReply(user, message);
      result.content = `Die KI ist gerade nicht erreichbar, hier ein Vorschlag aus meinen Trainingsregeln.\n\n${result.content}`;
    }
  } else {
    result = rulesReply(user, message);
  }
  db.insert(coachMessages).values({ id: newId(), userId: user.id, role: "assistant", content: result.content, payload: result.payload }).run();
  return result;
}

/** Structured plan request from the plan assistant form. */
export async function handlePlanRequest(user: User, req: Omit<PlanRequest, "startDate">): Promise<CoachResult> {
  const days = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const sportLabel = { ride: "Radfahren", run: "Laufen", strength: "Krafttraining", mixed: "Rad und Laufen" }[req.sport];
  const text = [
    `Erstelle mir einen Trainingsplan: ${req.goal || "allgemeine Form verbessern"}.`,
    `Sportart: ${sportLabel}.`,
    req.eventDate ? `Wettkampf am ${req.eventDate}.` : `Dauer: ${req.weeks} Wochen.`,
    `Zeit: ca. ${req.hoursPerWeek} Stunden pro Woche an ${req.trainingDays.map((d) => days[d]).join(", ")}; lange Einheit am ${days[req.longDay]}.`,
    req.strength ? "Krafttraining einbauen." : "Kein Krafttraining.",
  ].join(" ");

  if (env.anthropicConfigured()) return handleCoachMessage(user, text);

  const db = getDb();
  db.insert(coachMessages).values({ id: newId(), userId: user.id, role: "user", content: text }).run();
  const plan = generatePlan({ ...req, startDate: todayFor(user) }, thresholdsOf(user));
  const result: CoachResult = {
    content: `Hier ist dein Plan **${plan.name}**. Schau ihn dir an und übernimm ihn mit einem Klick in deinen Kalender. Jede Einheit kannst du danach noch anpassen.`,
    payload: { kind: "plan", plan },
    engine: "rules",
  };
  db.insert(coachMessages).values({ id: newId(), userId: user.id, role: "assistant", content: result.content, payload: result.payload }).run();
  return result;
}

// ---------------------------------------------------------------------------
// AI coach (Claude)
// ---------------------------------------------------------------------------

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ maxRetries: 2, timeout: 5 * 60_000 });
  return client;
}

function historyAsMessages(userId: string): Anthropic.Beta.BetaMessageParam[] {
  const rows = getDb().select().from(coachMessages).where(eq(coachMessages.userId, userId)).orderBy(asc(coachMessages.createdAt)).all().slice(-16);
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const r of rows) {
    let content = r.content;
    if (r.role === "assistant" && r.payload?.kind === "workout") content += `\n[Vorgeschlagenes Workout: ${r.payload.workout.name}]`;
    if (r.role === "assistant" && r.payload?.kind === "plan") content += `\n[Vorgeschlagener Plan: ${r.payload.plan.name}, ${r.payload.plan.weeks.length} Wochen]`;
    const last = out[out.length - 1];
    // Keep strict user/assistant alternation.
    if (last && last.role === r.role && typeof last.content === "string") last.content += `\n\n${content}`;
    else out.push({ role: r.role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function callModel(messages: Anthropic.Beta.BetaMessageParam[]) {
  return anthropic().beta.messages.parse({
    model: env.coachModel(),
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(CoachOut) },
    system: [{ type: "text", text: COACH_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages,
  });
}

async function aiReply(user: User): Promise<CoachResult> {
  const t = thresholdsOf(user);
  const messages = historyAsMessages(user.id);
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") throw new Error("No user message");
  last.content = `<trainingskontext>\n${trainingContext(user)}\n</trainingskontext>\n\n${last.content as string}`;

  let response = await callModel(messages);
  if (response.stop_reason === "refusal") {
    return { content: "Dabei kann ich dir leider nicht helfen. Frag mich gern etwas zu deinem Training.", payload: null, engine: "ai" };
  }
  let out = response.parsed_output as CoachOutput | null;
  if (!out) throw new Error(`Unparseable coach output (stop_reason ${response.stop_reason})`);

  // Validate every workout; give the model one chance to repair invalid notation.
  let problems = collectProblems(out, t);
  if (problems.length) {
    const assistantText = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const repair: Anthropic.Beta.BetaMessageParam[] = [
      ...messages,
      { role: "assistant", content: assistantText },
      {
        role: "user",
        content: `Einige Workouts sind in ungültiger Schreibweise:\n${problems.slice(0, 12).join("\n")}\nBitte gib die vollständige Antwort erneut mit korrigierten "steps" aus.`,
      },
    ];
    response = await callModel(repair);
    const repaired = response.parsed_output as CoachOutput | null;
    if (repaired && response.stop_reason !== "refusal") {
      out = repaired;
      problems = collectProblems(out, t);
    }
  }

  let payload: CoachPayload | null = null;
  if (out.plan) {
    const plan = materializePlan(user, out.plan);
    if (plan.weeks.some((w) => w.sessions.length)) payload = { kind: "plan", plan };
  } else if (out.workout) {
    const parsed = parseWorkoutText(out.workout.steps, out.workout.sport, t);
    let structure: WorkoutStructure;
    if (parsed.errors.length || !parsed.structure.nodes.length) {
      const req = interpretRequest(`${out.workout.name} ${out.workout.description}`);
      structure = generateWorkout(out.workout.sport, req.focus ?? "endurance", req.minutes ?? 60, t).structure;
    } else structure = parsed.structure;
    payload = {
      kind: "workout",
      workout: { name: out.workout.name.slice(0, 60), description: out.workout.description.slice(0, 400), sport: out.workout.sport, structure },
    };
  }
  return { content: out.reply.trim(), payload, engine: "ai" };
}

function collectProblems(out: CoachOutput, t: ReturnType<typeof thresholdsOf>): string[] {
  const problems: string[] = [];
  const check = (label: string, sport: Sport, steps: string) => {
    const r = parseWorkoutText(steps, sport, t);
    if (!r.structure.nodes.length) problems.push(`${label}: keine Schritte`);
    for (const e of r.errors) problems.push(`${label}, Zeile ${e.line}: ${e.message}`);
  };
  if (out.workout) check(`Workout „${out.workout.name}“`, out.workout.sport, out.workout.steps);
  out.plan?.weeks.forEach((w, i) => w.sessions.forEach((s) => check(`Woche ${i + 1}, „${s.name}“`, s.sport, s.steps)));
  return problems;
}

function materializePlan(user: User, p: NonNullable<CoachOutput["plan"]>): PlanProposal {
  const t = thresholdsOf(user);
  const today = todayFor(user);
  // Start this week when there are still at least 4 days left, otherwise next Monday.
  const start = dayOfWeek(today) <= 2 ? startOfWeek(today) : nextMonday(today);
  const eventDate = p.event_date && isISODate(p.event_date) && p.event_date > today ? p.event_date : null;
  const weeks: PlanWeek[] = p.weeks.slice(0, 24).map((w, i) => {
    const weekStart = addDays(start, i * 7);
    const sessions = w.sessions
      .filter((s) => Number.isInteger(s.day) && s.day >= 0 && s.day <= 6)
      .filter((s) => addDays(weekStart, s.day) >= today && (!eventDate || addDays(weekStart, s.day) <= eventDate))
      .flatMap((s) => {
        const parsed = parseWorkoutText(s.steps, s.sport, t);
        if (parsed.errors.length || !parsed.structure.nodes.length) return [];
        return [{ day: s.day, name: s.name.slice(0, 60), description: s.description.slice(0, 400), sport: s.sport, structure: parsed.structure }];
      });
    const targetTss = Math.round(sessions.reduce((a, s) => a + summarize(s.structure, t).tss, 0));
    return { index: i, startDate: weekStart, phase: w.phase, focus: w.focus.slice(0, 60), targetTss, sessions };
  });
  return {
    name: p.name.slice(0, 60),
    goal: p.goal.slice(0, 200),
    sport: p.sport,
    startDate: start,
    endDate: eventDate ?? addDays(start, weeks.length * 7 - 1),
    summary: p.summary.slice(0, 600),
    weeks,
  };
}

// ---------------------------------------------------------------------------
// Rule-based coach
// ---------------------------------------------------------------------------

function formText(tsb: number | null): string {
  if (tsb === null) return "Mir fehlen noch Trainingsdaten, um deine Form einzuschätzen.";
  if (tsb < -25) return `Deine Form (TSB ${Math.round(tsb)}) zeigt hohe Ermüdung.`;
  if (tsb < -10) return `Du bist im produktiven Trainingsbereich (TSB ${Math.round(tsb)}), aber spürbar ermüdet.`;
  if (tsb < 5) return `Deine Form ist ausgeglichen (TSB ${Math.round(tsb)}).`;
  if (tsb < 25) return `Du bist frisch (TSB ${Math.round(tsb)}), ein guter Tag für Qualität.`;
  return `Du bist sehr ausgeruht (TSB ${Math.round(tsb)}), dein Fitnesslevel sinkt langsam, wenn das so bleibt.`;
}

function rulesReply(user: User, message: string): CoachResult {
  const t = thresholdsOf(user);
  const pmc = pmcFor(user, 7);
  const now = pmc[pmc.length - 1] ?? null;
  const tsb = now && now.ctl > 0 ? now.tsb : null;
  const s = message.toLowerCase();

  if (/(plan|vorbereitung|marathon|halbmarathon|wettkampf|rennen|event|saison|wochen)/.test(s)) {
    const weeksMatch = /(\d+)\s*wochen/.exec(s);
    const hoursMatch = /(\d+(?:[.,]\d+)?)\s*(?:h|std|stunden)/.exec(s);
    const dateMatch = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
    const req = interpretRequest(message);
    const sport: PlanRequest["sport"] = /marathon|10\s*km|5\s*km|lauf/.test(s) ? "run" : req.sport && req.sport !== "strength" ? req.sport : "ride";
    const eventDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}` : null;
    const plan = generatePlan(
      {
        goal: message.slice(0, 60),
        sport,
        eventDate: eventDate && isISODate(eventDate) && eventDate > todayFor(user) ? eventDate : null,
        weeks: weeksMatch ? Number(weeksMatch[1]) : 8,
        hoursPerWeek: hoursMatch ? Number(hoursMatch[1].replace(",", ".")) : Math.max(4, Math.round(avgWeeklyHours(user))),
        trainingDays: [1, 3, 5, 6],
        longDay: 6,
        strength: /kraft/.test(s),
        startDate: todayFor(user),
      },
      t,
    );
    return {
      content: `Hier ist ein Vorschlag: **${plan.name}**. Mit dem Planassistenten (Reiter „Trainingsplan“) kannst du Trainingstage, Umfang und Wettkampfdatum genau festlegen.`,
      payload: { kind: "plan", plan },
      engine: "rules",
    };
  }

  if (/(form|müde|erholt|wie geht|status|belastung|ctl|tsb)/.test(s) && !/(workout|einheit|training für|gib mir)/.test(s)) {
    const recommendation = focusForForm(tsb);
    return {
      content: `${formText(tsb)} ${now ? `Fitness (CTL) liegt bei ${Math.round(now.ctl)}, Ermüdung (ATL) bei ${Math.round(now.atl)}.` : ""} Meine Empfehlung für heute: **${FOCUS_LABEL[recommendation]}**. Sag mir Sportart und Zeit, dann baue ich dir die Einheit.`,
      payload: null,
      engine: "rules",
    };
  }

  const req = interpretRequest(message);
  const sport: Sport = req.sport ?? preferredSport(user);
  let focus = req.focus ?? (sport === "strength" ? "strength-full" : focusForForm(tsb));
  let note = "";
  if (tsb !== null && tsb < -25 && isHard(focus)) {
    note = ` Da deine Form (TSB ${Math.round(tsb)}) gerade hohe Ermüdung zeigt, habe ich statt ${FOCUS_LABEL[focus]} eine lockere Grundlageneinheit gewählt.`;
    focus = "endurance";
  }
  const minutes = req.minutes ?? (sport === "strength" ? 45 : 60);
  const w = generateWorkout(sport, focus, minutes, t);
  const sum = summarize(w.structure, t);
  return {
    content: `${req.focus ? "" : `${formText(tsb)} `}Hier ist **${w.name}**: ${Math.round(sum.durationSec / 60)} Minuten, geschätzt ${sum.tss} TSS.${note} ${w.description}`.trim(),
    payload: { kind: "workout", workout: { name: w.name, description: w.description, sport: w.sport, structure: w.structure } },
    engine: "rules",
  };
}

function avgWeeklyHours(user: User): number {
  const weeks = weeklyVolume(user, 4).slice(0, 3);
  const total = weeks.reduce((a, w) => a + w.ride + w.run + w.strength + w.other, 0);
  return weeks.length ? total / weeks.length : 5;
}

function preferredSport(user: User): Sport {
  const weeks = weeklyVolume(user, 4);
  const ride = weeks.reduce((a, w) => a + w.ride, 0);
  const run = weeks.reduce((a, w) => a + w.run, 0);
  return run > ride ? "run" : "ride";
}
