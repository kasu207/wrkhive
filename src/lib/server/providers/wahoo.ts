import "server-only";
import { detectSourceApp } from "@/lib/apps";
import { diffDays } from "@/lib/dates";
import { encodeWahooPlan, wahooCompatibility, wahooMinutes } from "@/lib/workout/export/wahoo";
import { env } from "../env";
import { localNoonInstant, providerFetch } from "./http";
import { ProviderError, type NormalizedActivity, type ProviderAdapter, type TokenSet } from "./types";

/** Overridable for integration tests against a mock server. */
const API = (process.env.WAHOO_API_BASE ?? "https://api.wahooligan.com").replace(/\/$/, "");
const AUTHORIZE_URL = process.env.WAHOO_AUTHORIZE_URL ?? `${API}/oauth/authorize`;
export const WAHOO_SCOPES = "user_read workouts_read workouts_write plans_read plans_write power_zones_read offline_data";

/** Wahoo only shows scheduled plans on devices from today through six days ahead. */
export const WAHOO_SCHEDULE_WINDOW_DAYS = 6;

const BIKE_TYPES = new Set([0, 11, 12, 13, 14, 15, 16, 21, 49, 61, 64, 68, 70]);
const RUN_TYPES = new Set([1, 3, 4, 5, 19, 67, 71]);
const STRENGTH_TYPES = new Set([42]);

/** Wahoo workout types (Cloud API data types): 0 BIKING, 61 BIKING_INDOOR_TRAINER, 1 RUNNING. */
export function wahooWorkoutType(sport: "ride" | "run" | "strength", indoor: boolean): number {
  if (sport === "ride") return indoor ? 61 : 0;
  return 1;
}

function sportOf(typeId: number): NormalizedActivity["sport"] {
  if (BIKE_TYPES.has(typeId)) return "ride";
  if (RUN_TYPES.has(typeId)) return "run";
  if (STRENGTH_TYPES.has(typeId)) return "strength";
  return "other";
}

function tokenSet(json: Record<string, unknown>): TokenSet {
  if (typeof json.access_token !== "string") throw new ProviderError("Wahoo: ungültige Token-Antwort");
  const expiresIn = Number(json.expires_in ?? 7200);
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresAt: new Date(Date.now() + (expiresIn - 60) * 1000),
    scopes: typeof json.scope === "string" ? json.scope : null,
  };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

interface WahooWorkout {
  id: number;
  starts: string;
  minutes?: number;
  name?: string;
  workout_type_id: number;
  workout_summary?: Record<string, unknown> | null;
}

export function normalizeWahooWorkout(w: WahooWorkout): NormalizedActivity | null {
  const s = w.workout_summary;
  if (!s) return null;
  const durationTotal = num(s.duration_total_accum) ?? (w.minutes ? w.minutes * 60 : null);
  if (!durationTotal || durationTotal <= 0) return null;
  const sport = sportOf(w.workout_type_id);
  const speed = num(s.speed_avg);
  return {
    externalId: String(w.id),
    sport,
    name: w.name?.trim() || defaultName(sport),
    startTime: new Date(w.starts),
    durationSec: Math.round(durationTotal),
    movingSec: num(s.duration_active_accum) !== null ? Math.round(num(s.duration_active_accum)!) : null,
    distanceM: num(s.distance_accum),
    elevationGainM: num(s.ascent_accum),
    avgHr: roundOrNull(num(s.heart_rate_avg)),
    avgPower: roundOrNull(num(s.power_bike_avg)),
    normPower: roundOrNull(num(s.power_bike_np_last)),
    avgCadence: roundOrNull(num(s.cadence_avg)),
    avgSpeed: speed,
    calories: roundOrNull(num(s.calories_accum)),
    deviceName: "Wahoo",
    sourceApp: detectSourceApp({ name: w.name, fallback: "wahoo" }),
  };
}

function roundOrNull(n: number | null) {
  return n === null || n === 0 ? null : Math.round(n);
}

function defaultName(sport: NormalizedActivity["sport"]) {
  return sport === "ride" ? "Radfahrt" : sport === "run" ? "Lauf" : sport === "strength" ? "Krafttraining" : "Aktivität";
}

export const wahooAdapter: ProviderAdapter = {
  id: "wahoo",
  name: "Wahoo",
  devices: ["ELEMNT BOLT", "ELEMNT ROAM", "ELEMNT ACE", "ELEMNT RIVAL", "KICKR"],
  auth: "oauth",

  isConfigured() {
    const c = env.wahoo();
    return Boolean(c.clientId && c.clientSecret);
  },

  authorizeUrl({ state, codeChallenge, redirectUri }) {
    const q = new URLSearchParams({
      client_id: env.wahoo().clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: WAHOO_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `${AUTHORIZE_URL}?${q}`;
  },

  async exchangeCode({ code, codeVerifier, redirectUri }) {
    const c = env.wahoo();
    const res = await providerFetch("Wahoo", `${API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    return tokenSet(await res.json());
  },

  async refresh(refreshToken) {
    const c = env.wahoo();
    const res = await providerFetch("Wahoo", `${API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    return tokenSet(await res.json());
  },

  async account(accessToken) {
    const res = await providerFetch("Wahoo", `${API}/v1/user`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const u = (await res.json()) as { id: number; first?: string; last?: string; email?: string };
    const display = [u.first, u.last].filter(Boolean).join(" ") || u.email || null;
    return { externalUserId: String(u.id), displayName: display };
  },

  compatibility(structure, date) {
    const issues = wahooCompatibility(structure);
    if (date) {
      const today = new Date().toISOString().slice(0, 10);
      const ahead = diffDays(date, today);
      if (ahead < -1 || ahead > WAHOO_SCHEDULE_WINDOW_DAYS) {
        issues.push(`Wahoo zeigt geplante Workouts nur für heute bis ${WAHOO_SCHEDULE_WINDOW_DAYS} Tage im Voraus an.`);
      }
    }
    return issues;
  },

  async send(accessToken, input) {
    const plan = encodeWahooPlan({
      name: input.name,
      description: input.description,
      structure: input.structure,
      thresholds: { ftp: input.user.ftp, lthr: input.user.lthr, maxHr: input.user.maxHr, thresholdPace: input.user.thresholdPace },
      indoor: input.structure.sport === "ride" && input.indoor,
    });
    const auth = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" };
    const externalId = `wrkhive-${input.workoutId}-${Date.now()}`;

    const planRes = await providerFetch("Wahoo", `${API}/v1/plans`, {
      method: "POST",
      headers: auth,
      body: new URLSearchParams({
        "plan[file]": `data:application/json;base64,${Buffer.from(JSON.stringify(plan)).toString("base64")}`,
        "plan[filename]": "plan.json",
        "plan[external_id]": externalId,
        "plan[provider_updated_at]": new Date().toISOString(),
      }),
    });
    const planJson = (await planRes.json()) as { id: number };

    // A plan only reaches the ELEMNT / RIVAL when it is attached to a workout
    // scheduled within the next days, so always schedule (default: today).
    const date = input.date ?? new Date().toISOString().slice(0, 10);
    const workoutRes = await providerFetch("Wahoo", `${API}/v1/workouts`, {
      method: "POST",
      headers: auth,
      body: new URLSearchParams({
        "workout[name]": input.name,
        "workout[workout_token]": externalId,
        "workout[workout_type_id]": String(wahooWorkoutType(input.structure.sport, input.indoor)),
        "workout[starts]": localNoonInstant(date, input.timeZone).toISOString(),
        "workout[minutes]": String(wahooMinutes(input.structure, input.user)),
        "workout[plan_id]": String(planJson.id),
      }),
    });
    const workoutJson = (await workoutRes.json()) as { id: number };
    return {
      externalIds: { plan: planJson.id, workout: workoutJson.id },
      message:
        input.structure.sport === "ride" && input.indoor
          ? `Geplant für ${date} als Rollentrainer-Workout. Nach dem nächsten Sync auf dem ELEMNT unter „Geplante Workouts“ starten; ein per ANT+ FE-C gekoppelter Smart-Trainer wird im ERG-Modus gesteuert.`
          : `Geplant für ${date}. Das Workout erscheint nach dem nächsten Sync auf deinem ELEMNT bzw. RIVAL.`,
    };
  },

  async sync(accessToken, _connection, since) {
    const out: NormalizedActivity[] = [];
    // Newest first; stop once we are past `since`.
    for (let page = 1; page <= 20; page++) {
      const res = await providerFetch("Wahoo", `${API}/v1/workouts?page=${page}&per_page=50`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as { workouts?: WahooWorkout[] };
      const rows = json.workouts ?? [];
      let reachedEnd = rows.length < 50;
      for (const w of rows) {
        if (new Date(w.starts) < since) {
          reachedEnd = true;
          continue;
        }
        const a = normalizeWahooWorkout(w);
        if (a) out.push(a);
      }
      if (reachedEnd) break;
    }
    return { activities: out };
  },

  async revoke(accessToken) {
    await providerFetch("Wahoo", `${API}/v1/permissions`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
  },
};

