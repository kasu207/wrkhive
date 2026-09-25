#!/usr/bin/env node
/**
 * Mock Garmin + Wahoo + intervals.icu provider APIs for end-to-end testing without real
 * developer credentials. Emulates the documented request/response formats and
 * validates everything Wrkhive sends (OAuth + PKCE, plan/workout payloads,
 * token rotation, backfill limits). Garmin backfill requests are answered like
 * the real service: asynchronously, by POSTing notifications to the app's webhook.
 *
 *   node scripts/mock-providers.mjs
 *
 * intervals.icu: athlete i424242, API key "mock-intervals-key" (HTTP Basic, user API_KEY).
 *
 * Env: MOCK_PORT (4010), APP_WEBHOOK_BASE (http://localhost:3000),
 *      GARMIN_WEBHOOK_TOKEN, MOCK_LOG (./mock-providers.log.json)
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const APP = (process.env.APP_WEBHOOK_BASE ?? "http://localhost:3000").replace(/\/$/, "");
const GARMIN_WEBHOOK_TOKEN = process.env.GARMIN_WEBHOOK_TOKEN ?? "";
const PUBLIC = (process.env.MOCK_PUBLIC_BASE ?? `http://localhost:${PORT}`).replace(/\/$/, "");
const LOG = process.env.MOCK_LOG ?? "./mock-providers.log.json";
const CLIENTS = {
  wahoo: { id: process.env.WAHOO_CLIENT_ID ?? "wahoo-client", secret: process.env.WAHOO_CLIENT_SECRET ?? "wahoo-secret" },
  garmin: { id: process.env.GARMIN_CLIENT_ID ?? "garmin-client", secret: process.env.GARMIN_CLIENT_SECRET ?? "garmin-secret" },
};

const events = [];
const problems = [];
const codes = new Map(); // code -> { provider, challenge, redirectUri }
const tokens = new Map(); // access token -> provider
const refreshTokens = new Map(); // refresh token -> provider (single use)
const wahooPlans = new Map();
const wahooWorkouts = [];
const garminWorkouts = new Map();
const garminSchedules = [];
const pendingPings = new Map(); // id -> summaries
const intervalsEvents = [];

function log(entry) {
  events.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(LOG, JSON.stringify({ events, problems, wahooPlans: [...wahooPlans.values()], wahooWorkouts, garminWorkouts: [...garminWorkouts.values()], garminSchedules, intervalsEvents }, null, 2));
}
function problem(msg) {
  problems.push(msg);
  console.error("PROBLEM:", msg);
}
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
const bearer = (req, provider) => {
  const t = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  return tokens.get(t) === provider;
};
function issueTokens(provider, expiresIn) {
  const access = `${provider}-at-${randomBytes(6).toString("hex")}`;
  const refresh = `${provider}-rt-${randomBytes(6).toString("hex")}`;
  tokens.set(access, provider);
  refreshTokens.set(refresh, provider);
  return { access_token: access, refresh_token: refresh, expires_in: expiresIn, token_type: "bearer", scope: provider === "wahoo" ? "user_read workouts_read workouts_write plans_read plans_write power_zones_read offline_data" : undefined };
}

function authorize(provider, url, res) {
  const q = url.searchParams;
  const need = ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method"];
  for (const k of need) if (!q.get(k)) problem(`${provider} authorize: missing ${k}`);
  if (q.get("client_id") !== CLIENTS[provider].id) problem(`${provider} authorize: wrong client_id`);
  if (q.get("response_type") !== "code") problem(`${provider} authorize: response_type must be code`);
  if (q.get("code_challenge_method") !== "S256") problem(`${provider} authorize: PKCE method must be S256`);
  if (provider === "wahoo") {
    const scopes = (q.get("scope") ?? "").split(" ");
    for (const s of ["user_read", "workouts_read", "workouts_write", "plans_write", "offline_data"]) if (!scopes.includes(s)) problem(`wahoo authorize: scope ${s} missing`);
  }
  const code = `code-${randomBytes(6).toString("hex")}`;
  codes.set(code, { provider, challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri") });
  log({ provider, type: "authorize", redirectUri: q.get("redirect_uri") });
  const target = new URL(q.get("redirect_uri"));
  target.searchParams.set("code", code);
  target.searchParams.set("state", q.get("state"));
  send(res, 302, "", { location: target.toString() });
}

function token(provider, body, res, expiresIn) {
  const p = new URLSearchParams(body);
  if (p.get("client_id") !== CLIENTS[provider].id || p.get("client_secret") !== CLIENTS[provider].secret) {
    problem(`${provider} token: bad client credentials`);
    return send(res, 401, { error: "invalid_client" });
  }
  if (p.get("grant_type") === "authorization_code") {
    const c = codes.get(p.get("code"));
    codes.delete(p.get("code"));
    if (!c || c.provider !== provider) return send(res, 400, { error: "invalid_grant" });
    if (c.redirectUri !== p.get("redirect_uri")) problem(`${provider} token: redirect_uri mismatch`);
    const challenge = createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url");
    if (challenge !== c.challenge) {
      problem(`${provider} token: PKCE verifier does not match challenge`);
      return send(res, 400, { error: "invalid_grant" });
    }
    log({ provider, type: "token", grant: "authorization_code" });
    return send(res, 200, issueTokens(provider, expiresIn));
  }
  if (p.get("grant_type") === "refresh_token") {
    const rt = p.get("refresh_token");
    if (refreshTokens.get(rt) !== provider) {
      problem(`${provider} token: refresh token reused or unknown`);
      return send(res, 400, { error: "invalid_grant" });
    }
    refreshTokens.delete(rt); // single use
    log({ provider, type: "token", grant: "refresh_token" });
    return send(res, 200, issueTokens(provider, expiresIn));
  }
  problem(`${provider} token: unsupported grant ${p.get("grant_type")}`);
  send(res, 400, { error: "unsupported_grant_type" });
}

// ---------------------------------------------------------------------------
// Wahoo validation
// ---------------------------------------------------------------------------

const WAHOO_TARGETS = new Set(["rpm", "rpe", "watts", "hr", "speed", "ftp", "map", "ac", "nm", "threshold_hr", "threshold_speed", "max_hr"]);
function validateWahooInterval(iv, path, header) {
  if (iv.exit_trigger_type === "repeat") {
    if (!Number.isInteger(iv.exit_trigger_value) || iv.exit_trigger_value < 0) problem(`${path}: repeat count invalid`);
    if (!Array.isArray(iv.intervals) || !iv.intervals.length) problem(`${path}: repeat without intervals`);
    (iv.intervals ?? []).forEach((c, i) => validateWahooInterval(c, `${path}.intervals[${i}]`, header));
    return;
  }
  if (!["time", "distance", "kj2"].includes(iv.exit_trigger_type)) problem(`${path}: exit_trigger_type ${iv.exit_trigger_type}`);
  if (!(iv.exit_trigger_value > 0)) problem(`${path}: exit_trigger_value must be > 0`);
  if (!Array.isArray(iv.targets) || !iv.targets.length) problem(`${path}: targets must be non-empty`);
  for (const t of iv.targets ?? []) {
    if (!WAHOO_TARGETS.has(t.type)) problem(`${path}: target type ${t.type}`);
    if (typeof t.low !== "number" || typeof t.high !== "number" || t.low > t.high) problem(`${path}: target range ${t.low}-${t.high}`);
    if (t.type === "ftp" && !header.ftp) problem(`${path}: ftp target without header.ftp`);
    if (t.type === "threshold_hr" && !header.threshold_hr) problem(`${path}: threshold_hr without header value`);
    if (t.type === "threshold_speed" && !header.threshold_speed) problem(`${path}: threshold_speed without header value`);
  }
}
function validateWahooPlan(plan) {
  const h = plan.header ?? {};
  if (!h.name) problem("plan.header.name missing");
  if (h.version !== "1.0.0") problem("plan.header.version must be 1.0.0");
  if (!h.description) problem("plan.header.description missing (production validator requires it)");
  if (![0, 1].includes(h.workout_type_family)) problem("plan.header.workout_type_family must be 0/1");
  if (![0, 1].includes(h.workout_type_location)) problem("plan.header.workout_type_location must be 0/1");
  if (h.ftp !== undefined && !Number.isInteger(h.ftp)) problem("plan.header.ftp must be an integer");
  if (!Array.isArray(plan.intervals) || !plan.intervals.length) problem("plan.intervals empty");
  (plan.intervals ?? []).forEach((iv, i) => validateWahooInterval(iv, `plan.intervals[${i}]`, h));
}

const WAHOO_HISTORY = [
  { id: 7001, starts: new Date(Date.now() - 2 * 86400e3).toISOString(), minutes: 62, name: "Zwift – Sweet Spot", workout_type_id: 12, workout_summary: { duration_total_accum: "3720.0", duration_active_accum: "3700.0", distance_accum: "34500.0", power_bike_avg: "205.0", power_bike_np_last: "221.0", heart_rate_avg: "146.0", cadence_avg: "88.0", ascent_accum: "0.0", calories_accum: "760.0", speed_avg: "9.32" } },
  { id: 7002, starts: new Date(Date.now() - 4 * 86400e3).toISOString(), minutes: 145, name: "Sonntagsrunde", workout_type_id: 15, workout_summary: { duration_total_accum: "8700.0", duration_active_accum: "8300.0", distance_accum: "72100.0", power_bike_avg: "178.0", heart_rate_avg: "138.0", cadence_avg: "85.0", ascent_accum: "820.0", calories_accum: "1650.0", speed_avg: "8.69" } },
  { id: 7003, starts: new Date(Date.now() + 1 * 86400e3).toISOString(), minutes: 60, name: "Geplantes Workout", workout_type_id: 0, workout_summary: null },
];

async function wahoo(req, res, url, path) {
  if (path === "/oauth/authorize") return authorize("wahoo", url, res);
  if (path === "/oauth/token" && req.method === "POST") return token("wahoo", await readBody(req), res, 60);
  if (!bearer(req, "wahoo")) {
    log({ provider: "wahoo", type: "unauthorized", path });
    return send(res, 401, { error: "unauthorized" });
  }
  if (path === "/v1/user") return send(res, 200, { id: 555, first: "Mock", last: "Rider", email: "mock@wahoo.test" });
  if (path === "/v1/workouts" && req.method === "GET") {
    log({ provider: "wahoo", type: "list-workouts", page: url.searchParams.get("page") });
    return send(res, 200, { workouts: [...wahooWorkouts.map((w) => ({ ...w, workout_summary: null })), ...WAHOO_HISTORY].sort((a, b) => b.starts.localeCompare(a.starts)), total: WAHOO_HISTORY.length, page: 1, per_page: 50, order: "descending", sort: "starts" });
  }
  if (path === "/v1/plans" && req.method === "POST") {
    if (!(req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded")) problem("wahoo plans: must be form-encoded");
    const p = new URLSearchParams(await readBody(req));
    const file = p.get("plan[file]") ?? "";
    const m = /^data:application\/json;base64,(.+)$/.exec(file);
    if (!m) {
      problem("wahoo plans: plan[file] must be a base64 JSON data URI");
      return send(res, 422, { error: "invalid plan" });
    }
    const plan = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    validateWahooPlan(plan);
    for (const k of ["plan[filename]", "plan[external_id]", "plan[provider_updated_at]"]) if (!p.get(k)) problem(`wahoo plans: ${k} missing`);
    const id = 8000 + wahooPlans.size + 1;
    wahooPlans.set(id, { id, externalId: p.get("plan[external_id]"), plan });
    log({ provider: "wahoo", type: "create-plan", id, name: plan.header?.name });
    return send(res, 201, { id, name: plan.header?.name });
  }
  if (path === "/v1/workouts" && req.method === "POST") {
    const p = new URLSearchParams(await readBody(req));
    const w = Object.fromEntries([...p.entries()].map(([k, v]) => [k.replace(/^workout\[(.+)\]$/, "$1"), v]));
    for (const k of ["name", "workout_token", "workout_type_id", "starts", "minutes", "plan_id"]) if (!w[k]) problem(`wahoo workouts: workout[${k}] missing`);
    if (!/^\d+$/.test(w.minutes ?? "")) problem("wahoo workouts: minutes must be an integer");
    if (Number.isNaN(Date.parse(w.starts))) problem("wahoo workouts: starts not ISO");
    if (!wahooPlans.has(Number(w.plan_id))) problem("wahoo workouts: unknown plan_id");
    if (!["0", "1", "61"].includes(w.workout_type_id)) problem(`wahoo workouts: unexpected workout_type_id ${w.workout_type_id}`);
    const header = wahooPlans.get(Number(w.plan_id))?.plan.header;
    if (header && header.workout_type_family === 0 && (header.workout_type_location === 0) !== (w.workout_type_id === "61")) problem("wahoo workouts: indoor plan must use BIKING_INDOOR_TRAINER (61) and vice versa");
    const ahead = (Date.parse(w.starts) - Date.now()) / 86400e3;
    if (ahead < -1 || ahead > 7) problem(`wahoo workouts: starts ${w.starts} outside the device window`);
    const id = 9000 + wahooWorkouts.length + 1;
    wahooWorkouts.push({ id, starts: w.starts, minutes: Number(w.minutes), name: w.name, workout_type_id: Number(w.workout_type_id), plan_id: Number(w.plan_id) });
    log({ provider: "wahoo", type: "create-workout", id, name: w.name, starts: w.starts, plan_id: w.plan_id });
    return send(res, 201, { id, name: w.name });
  }
  if (path === "/v1/permissions" && req.method === "DELETE") {
    log({ provider: "wahoo", type: "revoke" });
    return send(res, 204, "");
  }
  send(res, 404, { error: `unknown ${req.method} ${path}` });
}

// ---------------------------------------------------------------------------
// Garmin validation
// ---------------------------------------------------------------------------

const G_SPORTS = new Set(["RUNNING", "CYCLING", "LAP_SWIMMING", "STRENGTH_TRAINING", "CARDIO_TRAINING", "GENERIC", "YOGA", "PILATES", "MULTI_SPORT"]);
const G_INTENSITY = new Set(["REST", "WARMUP", "COOLDOWN", "RECOVERY", "ACTIVE", "INTERVAL"]);
const G_DURATION = new Set(["TIME", "DISTANCE", "HR_LESS_THAN", "HR_GREATER_THAN", "CALORIES", "OPEN", "POWER_LESS_THAN", "POWER_GREATER_THAN", "TIME_AT_VALID_CDA", "FIXED_REST", "REPS", "REPETITION_SWIM_CSS_OFFSET", "FIXED_REPETITION"]);
const G_TARGET = new Set(["SPEED", "HEART_RATE", "OPEN", "CADENCE", "POWER", "GRADE", "RESISTANCE", "POWER_3S", "POWER_10S", "POWER_30S", "POWER_LAP", "SPEED_LAP", "HEART_RATE_LAP", "PACE"]);

function validateGarminStep(s, path, expectOrder) {
  if (s.stepOrder !== expectOrder) problem(`${path}: stepOrder ${s.stepOrder}, expected ${expectOrder}`);
  if (s.type === "WorkoutRepeatStep") {
    if (s.repeatType !== "REPEAT_UNTIL_STEPS_CMPLT") problem(`${path}: repeatType`);
    if (!(s.repeatValue >= 1)) problem(`${path}: repeatValue`);
    let order = expectOrder;
    for (const [i, c] of (s.steps ?? []).entries()) {
      order += 1;
      if (c.type === "WorkoutRepeatStep") problem(`${path}: nested repeat`);
      validateGarminStep(c, `${path}.steps[${i}]`, order);
    }
    return order;
  }
  if (s.type !== "WorkoutStep") problem(`${path}: type ${s.type}`);
  if (!G_INTENSITY.has(s.intensity)) problem(`${path}: intensity ${s.intensity}`);
  if (!G_DURATION.has(s.durationType)) problem(`${path}: durationType ${s.durationType}`);
  if (s.durationType !== "OPEN" && !(s.durationValue > 0)) problem(`${path}: durationValue`);
  if (s.durationType === "DISTANCE" && s.durationValueType !== "METER") problem(`${path}: distance needs METER`);
  if (s.targetType !== null && !G_TARGET.has(s.targetType)) problem(`${path}: targetType ${s.targetType}`);
  if (s.targetType && s.targetType !== "OPEN") {
    if (typeof s.targetValueLow !== "number" || typeof s.targetValueHigh !== "number" || s.targetValueLow > s.targetValueHigh) problem(`${path}: target range`);
  }
  if (s.secondaryTargetType && !G_TARGET.has(s.secondaryTargetType)) problem(`${path}: secondaryTargetType`);
  if (s.exerciseCategory && !/^[A-Z_]+$/.test(s.exerciseCategory)) problem(`${path}: exerciseCategory format`);
  return expectOrder;
}
function validateGarminWorkout(w) {
  if (!w.workoutName) problem("garmin workout: workoutName missing");
  if (!G_SPORTS.has(w.sport)) problem(`garmin workout: sport ${w.sport}`);
  if (!Array.isArray(w.segments) || w.segments.length !== 1) problem("garmin workout: one segment expected");
  const steps = w.segments?.[0]?.steps ?? [];
  if (!steps.length) problem("garmin workout: no steps");
  let order = 0;
  steps.forEach((s, i) => {
    order = validateGarminStep(s, `steps[${i}]`, order + 1);
  });
}

function garminActivity(id, daysAgo, type, extra = {}) {
  const start = Math.floor(Date.now() / 1000 - daysAgo * 86400 - 3600 * 5);
  return {
    userId: "g-user-1",
    summaryId: `${id}-detail`,
    activityId: id,
    activityName: extra.name ?? "Garmin Aktivität",
    activityType: type,
    startTimeInSeconds: start,
    startTimeOffsetInSeconds: 7200,
    durationInSeconds: extra.duration ?? 3600,
    distanceInMeters: extra.distance ?? 10000,
    averageHeartRateInBeatsPerMinute: extra.hr ?? 145,
    maxHeartRateInBeatsPerMinute: (extra.hr ?? 145) + 25,
    averageSpeedInMetersPerSecond: (extra.distance ?? 10000) / (extra.duration ?? 3600),
    activeKilocalories: 600,
    totalElevationGainInMeters: 120,
    deviceName: "Forerunner 965",
  };
}

async function pushToApp(body) {
  const url = `${APP}/api/webhooks/garmin?token=${encodeURIComponent(GARMIN_WEBHOOK_TOKEN)}`;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    log({ provider: "garmin", type: "webhook-delivery", status: r.status });
    if (!r.ok) problem(`garmin webhook delivery answered ${r.status}`);
  } catch (e) {
    problem(`garmin webhook delivery failed: ${e.message}`);
  }
}

async function garmin(req, res, url, path) {
  if (path === "/oauth2Confirm") return authorize("garmin", url, res);
  if (path === "/token" && req.method === "POST") return token("garmin", await readBody(req), res, 86400);
  if (path.startsWith("/pull/")) {
    // Ping/pull: callback URL handed out in a ping notification.
    if (!bearer(req, "garmin")) return send(res, 401, { error: "unauthorized" });
    const items = pendingPings.get(path) ?? [];
    log({ provider: "garmin", type: "pull", count: items.length });
    return send(res, 200, items);
  }
  if (!bearer(req, "garmin")) {
    log({ provider: "garmin", type: "unauthorized", path });
    return send(res, 401, { error: "unauthorized" });
  }
  if (path === "/wellness-api/rest/user/id") return send(res, 200, { userId: "g-user-1" });
  if (path === "/wellness-api/rest/user/permissions") return send(res, 200, ["ACTIVITY_EXPORT", "WORKOUT_IMPORT", "HEALTH_EXPORT"]);
  if (path === "/wellness-api/rest/backfill/activities") {
    const s = Number(url.searchParams.get("summaryStartTimeInSeconds"));
    const e = Number(url.searchParams.get("summaryEndTimeInSeconds"));
    if (!(s > 0 && e > s)) problem("garmin backfill: invalid range");
    if (e - s > 90 * 86400) problem("garmin backfill: range exceeds 90 days");
    log({ provider: "garmin", type: "backfill", days: Math.round((e - s) / 86400) });
    // Deliver asynchronously like Garmin: a push for recent history...
    if (Date.now() / 1000 - e < 86400) {
      setTimeout(() => {
        pushToApp({
          activities: [
            garminActivity(3001, 1, "RUNNING", { name: "Lockerer Lauf", duration: 2700, distance: 8200, hr: 142 }),
            garminActivity(3002, 3, "ROAD_BIKING", { name: "Rennrad-Runde", duration: 7200, distance: 60000, hr: 135 }),
            garminActivity(3003, 5, "STRENGTH_TRAINING", { name: "Krafttraining", duration: 2400, distance: 0, hr: 110 }),
          ],
        });
        // ...and a ping whose data the app must pull with its token.
        const pullPath = `/pull/${randomBytes(4).toString("hex")}`;
        pendingPings.set(pullPath, [garminActivity(3004, 6, "TRAIL_RUNNING", { name: "Trail am Samstag", duration: 5400, distance: 14000, hr: 150 })]);
        pushToApp({ activities: [{ userId: "g-user-1", callbackURL: `${PUBLIC_API_FOR_APP}${pullPath}` }] });
      }, 1500);
    }
    return send(res, 202, "");
  }
  if (path === "/workoutportal/workout/v2" && req.method === "POST") {
    if (!(req.headers["content-type"] ?? "").includes("application/json")) problem("garmin workout: must be JSON");
    const w = JSON.parse(await readBody(req));
    validateGarminWorkout(w);
    const workoutId = 50000 + garminWorkouts.size + 1;
    garminWorkouts.set(workoutId, { workoutId, ...w });
    log({ provider: "garmin", type: "create-workout", workoutId, name: w.workoutName, sport: w.sport });
    return send(res, 200, { workoutId, ownerId: 1, ...w });
  }
  if (path === "/training-api/schedule/" && req.method === "POST") {
    const b = JSON.parse(await readBody(req));
    if (!garminWorkouts.has(b.workoutId)) problem("garmin schedule: unknown workoutId");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "")) problem("garmin schedule: date must be YYYY-MM-DD");
    const id = 70000 + garminSchedules.length + 1;
    garminSchedules.push({ id, ...b });
    log({ provider: "garmin", type: "schedule", id, date: b.date });
    return send(res, 200, String(id));
  }
  if (path === "/wellness-api/rest/user/registration" && req.method === "DELETE") {
    log({ provider: "garmin", type: "deregister" });
    return send(res, 204, "");
  }
  send(res, 404, { error: `unknown ${req.method} ${path}` });
}

// --- intervals.icu -----------------------------------------------------------------

const ICU_ATHLETE = "i424242";
const ICU_KEY = "mock-intervals-key";

/** Strict parser for the workout-text subset Wrkhive emits; returns steps or pushes problems. */
function parseIntervalsText(text) {
  const steps = [];
  const blocks = text.replace(/\n+$/, "").split(/\n\n/);
  for (const block of blocks) {
    const lines = block.split("\n");
    let reps = null;
    let first = 0;
    if (/^(Warmup|Cooldown)$/.test(lines[0])) first = 1;
    else if (/^\d+x$/.test(lines[0])) {
      reps = Number(lines[0].slice(0, -1));
      if (reps < 2) problem(`intervals text: repeat count ${reps} < 2`);
      first = 1;
    }
    const body = lines.slice(first);
    if (!body.length) problem(`intervals text: empty block "${block}"`);
    const parsed = [];
    for (const line of body) {
      const m = line.match(/^- (\S+)(.*)$/);
      if (!m) {
        problem(`intervals text: not a step line "${line}"`);
        continue;
      }
      const [, dur, rest] = m;
      if (!/^(\d+m|\d+s|\d+mtr|\d+(\.\d+)?km)$/.test(dur)) problem(`intervals text: bad duration "${dur}"`);
      if (/^\d+m$/.test(dur) && Number(dur.slice(0, -1)) === 0) problem(`intervals text: zero duration`);
      const tokens = rest.trim() ? rest.trim().split(/\s+/) : [];
      let i = 0;
      if (tokens[i] && /^\d+(-\d+)?%$/.test(tokens[i])) {
        i++;
        if (tokens[i] === "LTHR" || tokens[i] === "Pace") i++;
      }
      if (tokens[i] && /^\d+(-\d+)?rpm$/.test(tokens[i])) i++;
      for (const w of tokens.slice(i)) if (!/^[\p{L}-]{2,}$/u.test(w)) problem(`intervals text: cue word "${w}" could be misparsed`);
      parsed.push({ duration: dur });
    }
    steps.push(reps ? { reps, steps: parsed } : { steps: parsed });
  }
  return steps;
}

async function intervals(req, res, url, path) {
  const auth = req.headers.authorization ?? "";
  const expected = `Basic ${Buffer.from(`API_KEY:${ICU_KEY}`).toString("base64")}`;
  if (auth !== expected) return send(res, 401, { status: 401, error: "Access denied" });
  const m = path.match(/^\/api\/v1\/athlete\/(0|i\d+)(\/.*)?$/);
  if (!m) return send(res, 404, { error: "not found" });
  if (m[1] !== "0" && m[1] !== ICU_ATHLETE) return send(res, 403, { error: "forbidden" });
  const sub = m[2] ?? "";
  log({ provider: "intervals", method: req.method, path });

  if (req.method === "GET" && sub === "") return send(res, 200, { id: ICU_ATHLETE, name: "Mock Athlet" });

  if (req.method === "POST" && sub === "/events") {
    if (!(req.headers["content-type"] ?? "").includes("application/json")) problem("intervals events: must be JSON");
    const b = JSON.parse(await readBody(req));
    if (b.category !== "WORKOUT") problem("intervals events: category must be WORKOUT");
    if (!/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(b.start_date_local ?? "")) problem("intervals events: start_date_local must be YYYY-MM-DDT00:00:00");
    if (!["Ride", "Run"].includes(b.type)) problem(`intervals events: unexpected type ${b.type}`);
    if (!b.name) problem("intervals events: name missing");
    if (!Number.isInteger(b.moving_time) || b.moving_time <= 0) problem("intervals events: moving_time must be a positive integer");
    const steps = typeof b.description === "string" ? parseIntervalsText(b.description) : (problem("intervals events: description missing"), []);
    const id = 90000 + intervalsEvents.length;
    intervalsEvents.push({ id, ...b });
    return send(res, 200, { id, ...b, workout_doc: { steps } });
  }

  if (req.method === "DELETE" && /^\/events\/\d+$/.test(sub)) return send(res, 200, {});

  if (req.method === "GET" && sub === "/activities") {
    const oldest = url.searchParams.get("oldest");
    const newest = url.searchParams.get("newest");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(oldest ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(newest ?? "")) problem("intervals activities: oldest/newest must be YYYY-MM-DD");
    const at = (daysAgo, hour) => {
      const d = new Date(Date.now() - daysAgo * 86400e3);
      d.setUTCHours(hour, 0, 0, 0);
      return d;
    };
    const act = (id, daysAgo, type, name, extra) => {
      const start = at(daysAgo, 17);
      const local = new Date(start.getTime() + 2 * 3600e3).toISOString().slice(0, 19);
      return { id, type, name, start_date: start.toISOString().replace(".000", ""), start_date_local: local, ...extra };
    };
    // Days chosen so no other simulated source has the same sport on that day (no accidental merges).
    return send(res, 200, [
      act("i9001", 5, "VirtualRide", "Rolle – Sweet Spot ERG", { moving_time: 3600, elapsed_time: 3660, distance: 33000, icu_average_watts: 205, icu_weighted_avg_watts: 214, average_heartrate: 142, device_name: "ELEMNT BOLT" }),
      act("i9002", 7, "Run", "Intervalle am Dienstag", { moving_time: 2900, elapsed_time: 3000, distance: 9100, average_heartrate: 156, device_name: "Forerunner 265" }),
      // MyWhoosh uploads the same ride twice (known behaviour); Wrkhive must merge them.
      act("i9004", 9, "VirtualRide", "MyWhoosh – Sweet Spot", { source: "OAUTH_CLIENT", oauth_client_name: "MyWhoosh", moving_time: 3500, elapsed_time: 3500, distance: 31000, icu_average_watts: 198, icu_weighted_avg_watts: 207 }),
      act("i9005", 9, "VirtualRide", "MyWhoosh – Sweet Spot", { source: "OAUTH_CLIENT", oauth_client_name: "MyWhoosh", moving_time: 3500, elapsed_time: 3500, distance: 31000, icu_average_watts: 198, icu_weighted_avg_watts: 207 }),
      act("i9006", 8, "VirtualRide", "Watopia Flat", { source: "ZWIFT", device_name: "Zwift", moving_time: 2700, elapsed_time: 2700, distance: 25000, icu_average_watts: 180 }),
      { id: "i9003", source: "STRAVA", _note: "Strava activities are not available via the API" },
    ]);
  }

  send(res, 404, { error: "not found" });
}

// Base URL the *app* uses to reach this mock (may differ from the browser's).
const PUBLIC_API_FOR_APP = (process.env.MOCK_APP_FACING_BASE ?? PUBLIC).replace(/\/$/, "") + "/garmin";

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, PUBLIC);
    try {
      if (url.pathname.startsWith("/wahoo")) return await wahoo(req, res, url, url.pathname.slice("/wahoo".length));
      if (url.pathname.startsWith("/intervals")) return await intervals(req, res, url, url.pathname.slice("/intervals".length));
      if (url.pathname.startsWith("/garmin")) return await garmin(req, res, url, url.pathname.slice("/garmin".length));
      if (url.pathname === "/report") return send(res, 200, { problems, events: events.length, intervalsEvents: intervalsEvents.length, wahooIndoorWorkouts: wahooWorkouts.filter((w) => w.workout_type_id === 61).length });
      send(res, 404, { error: "not found" });
    } catch (e) {
      problem(`mock crashed on ${url.pathname}: ${e.message}`);
      send(res, 500, { error: e.message });
    }
  })
  .listen(PORT, "0.0.0.0", () => console.log(`mock providers on :${PORT} (webhooks -> ${APP})`));
