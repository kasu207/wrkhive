import "server-only";
import { detectSourceApp } from "@/lib/apps";
import { encodeGarminWorkout } from "@/lib/workout/export/garmin";
import { env } from "../env";
import { providerFetch } from "./http";
import { ProviderError, type NormalizedActivity, type ProviderAdapter, type TokenSet, type WellnessInput } from "./types";

/**
 * Garmin Connect Developer Program (OAuth 2.0 with PKCE).
 * - Training API: push workouts and schedule them to the calendar; Garmin
 *   Connect syncs them to the watch / Edge.
 * - Activity API: activity summaries arrive via push (or ping) webhooks;
 *   history is requested via backfill and also delivered to the webhook.
 * - Health API (permission HEALTH_EXPORT): dailies (resting heart rate),
 *   sleeps, HRV and body composition arrive the same way.
 */
// Overridable for integration tests against a mock server.
const AUTHORIZE_URL = process.env.GARMIN_AUTHORIZE_URL ?? "https://connect.garmin.com/oauth2Confirm";
const TOKEN_URL = process.env.GARMIN_TOKEN_URL ?? "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const API = (process.env.GARMIN_API_BASE ?? "https://apis.garmin.com").replace(/\/$/, "");
/** Garmin limits a single backfill request to 90 days. */
const BACKFILL_MAX_DAYS = 90;

function tokenSet(json: Record<string, unknown>): TokenSet {
  if (typeof json.access_token !== "string") throw new ProviderError("Garmin: ungültige Token-Antwort");
  const expiresIn = Number(json.expires_in ?? 86400);
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresAt: new Date(Date.now() + (expiresIn - 120) * 1000),
    scopes: typeof json.scope === "string" ? json.scope : null,
  };
}

export function garminSport(activityType: string | undefined): NormalizedActivity["sport"] {
  const t = (activityType ?? "").toUpperCase();
  if (t.includes("MOTORCYCL")) return "other";
  if (t.includes("CYCLING") || t.includes("BIKING") || t.includes("RIDE") || t === "BMX" || t.includes("E_BIKE")) return "ride";
  if (t.includes("RUN")) return "run";
  if (t.includes("STRENGTH")) return "strength";
  return "other";
}

/** Activity summary as delivered by the Garmin Activity API. */
export interface GarminActivitySummary {
  userId?: string;
  summaryId: string;
  activityId?: number;
  activityName?: string;
  activityType?: string;
  startTimeInSeconds: number;
  startTimeOffsetInSeconds?: number;
  durationInSeconds: number;
  distanceInMeters?: number;
  averageHeartRateInBeatsPerMinute?: number;
  maxHeartRateInBeatsPerMinute?: number;
  averageSpeedInMetersPerSecond?: number;
  activeKilocalories?: number;
  totalElevationGainInMeters?: number;
  averageBikeCadenceInRoundsPerMinute?: number;
  averageRunCadenceInStepsPerMinute?: number;
  averagePowerInWatts?: number;
  deviceName?: string;
  manual?: boolean;
}

export function normalizeGarminActivity(a: GarminActivitySummary): NormalizedActivity {
  const sport = garminSport(a.activityType);
  return {
    externalId: String(a.activityId ?? a.summaryId),
    sport,
    name: a.activityName?.trim() || (sport === "ride" ? "Radfahrt" : sport === "run" ? "Lauf" : sport === "strength" ? "Krafttraining" : "Aktivität"),
    startTime: new Date(a.startTimeInSeconds * 1000),
    utcOffsetSec: a.startTimeOffsetInSeconds ?? null,
    durationSec: Math.round(a.durationInSeconds),
    distanceM: a.distanceInMeters ?? null,
    elevationGainM: a.totalElevationGainInMeters ?? null,
    avgHr: a.averageHeartRateInBeatsPerMinute ?? null,
    maxHr: a.maxHeartRateInBeatsPerMinute ?? null,
    avgPower: a.averagePowerInWatts ?? null,
    avgCadence: a.averageBikeCadenceInRoundsPerMinute ?? a.averageRunCadenceInStepsPerMinute ?? null,
    avgSpeed: a.averageSpeedInMetersPerSecond ?? null,
    calories: a.activeKilocalories ?? null,
    deviceName: a.deviceName ?? "Garmin",
    sourceApp: detectSourceApp({ hints: [a.deviceName], name: a.activityName, fallback: "garmin" }),
  };
}

/** Health API summary types Wrkhive reads, as named in webhook bodies and backfill paths. */
export const GARMIN_HEALTH_TYPES = ["dailies", "sleeps", "hrv", "bodyComps"] as const;
export type GarminHealthType = (typeof GARMIN_HEALTH_TYPES)[number];

const gPos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const calendarDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** One Health API summary as a daily wellness value; null for summaries without a usable value. */
export function normalizeGarminHealth(type: GarminHealthType, raw: Record<string, unknown>): WellnessInput | null {
  if (type === "dailies") {
    const date = calendarDate(raw.calendarDate);
    const restingHr = gPos(raw.restingHeartRateInBeatsPerMinute);
    return date && restingHr ? { date, restingHr } : null;
  }
  if (type === "sleeps") {
    const date = calendarDate(raw.calendarDate);
    // Asleep time: the stage sum excludes time awake in bed; the total is the fallback.
    const stages = [raw.deepSleepDurationInSeconds, raw.lightSleepDurationInSeconds, raw.remSleepInSeconds].map(gPos);
    const sleepSec = stages.some((v) => v !== null) ? stages.reduce<number>((a, b) => a + (b ?? 0), 0) : gPos(raw.durationInSeconds);
    return date && sleepSec ? { date, sleepSec } : null;
  }
  if (type === "hrv") {
    const date = calendarDate(raw.calendarDate);
    const hrv = gPos(raw.lastNightAvg);
    return date && hrv ? { date, hrv } : null;
  }
  const time = gPos(raw.measurementTimeInSeconds);
  const grams = gPos(raw.weightInGrams);
  if (!time || !grams) return null;
  const offset = typeof raw.measurementTimeOffsetInSeconds === "number" ? raw.measurementTimeOffsetInSeconds : 0;
  return { date: new Date((time + offset) * 1000).toISOString().slice(0, 10), weightKg: grams / 1000 };
}

export const garminAdapter: ProviderAdapter = {
  id: "garmin",
  name: "Garmin",
  devices: ["Forerunner", "fēnix", "Edge", "Venu", "epix", "Enduro"],
  auth: "oauth",

  isConfigured() {
    const c = env.garmin();
    return Boolean(c.clientId && c.clientSecret);
  },

  authorizeUrl({ state, codeChallenge, redirectUri }) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: env.garmin().clientId,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: redirectUri,
      state,
    });
    return `${AUTHORIZE_URL}?${q}`;
  },

  async exchangeCode({ code, codeVerifier, redirectUri }) {
    const c = env.garmin();
    const res = await providerFetch("Garmin", TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: c.clientId,
        client_secret: c.clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });
    return tokenSet(await res.json());
  },

  async refresh(refreshToken) {
    const c = env.garmin();
    const res = await providerFetch("Garmin", TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: c.clientId,
        client_secret: c.clientSecret,
        refresh_token: refreshToken,
      }),
    });
    return tokenSet(await res.json());
  },

  async account(accessToken) {
    const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
    const res = await providerFetch("Garmin", `${API}/wellness-api/rest/user/id`, auth);
    const json = (await res.json()) as { userId: string };
    // Users can deselect individual permissions on the Garmin consent screen.
    let permissions: string[] | undefined;
    try {
      const p = await providerFetch("Garmin", `${API}/wellness-api/rest/user/permissions`, auth);
      const list = await p.json();
      if (Array.isArray(list)) permissions = list.map(String);
    } catch {
      permissions = undefined;
    }
    return { externalUserId: json.userId, displayName: null, permissions };
  },

  compatibility() {
    return [];
  },

  async send(accessToken, input) {
    const payload = encodeGarminWorkout({
      name: input.name,
      description: input.description,
      structure: input.structure,
      thresholds: { ftp: input.user.ftp, lthr: input.user.lthr, maxHr: input.user.maxHr, thresholdPace: input.user.thresholdPace },
    });
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    const res = await providerFetch("Garmin", `${API}/workoutportal/workout/v2`, { method: "POST", headers, body: JSON.stringify(payload) });
    const created = (await res.json()) as { workoutId?: number };
    if (!created.workoutId) throw new ProviderError("Garmin: Workout-ID fehlt in der Antwort");
    const externalIds: Record<string, number> = { workout: created.workoutId };

    if (input.date) {
      const sched = await providerFetch("Garmin", `${API}/training-api/schedule/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ workoutId: created.workoutId, date: input.date }),
      });
      const text = await sched.text();
      const id = Number(text.trim()) || (JSON.parse(text || "{}") as { scheduleId?: number }).scheduleId;
      if (id) externalIds.schedule = id;
    }
    return {
      externalIds,
      message: input.date
        ? `Im Garmin-Connect-Kalender für ${input.date} eingetragen. Deine Uhr bzw. dein Edge lädt es beim nächsten Sync.`
        : "In deiner Garmin-Connect-Workoutbibliothek gespeichert. Es wird beim nächsten Sync auf dein Gerät übertragen.",
    };
  },

  async reschedule(accessToken, input) {
    const workoutId = input.externalIds.workout;
    if (workoutId === undefined) throw new ProviderError("Garmin: Workout unbekannt, bitte erneut senden.");
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    const scheduleId = input.externalIds.schedule;
    if (scheduleId !== undefined) {
      await providerFetch("Garmin", `${API}/training-api/schedule/${scheduleId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ scheduleId: Number(scheduleId), workoutId: Number(workoutId), date: input.date }),
      });
      return input.externalIds;
    }
    // Sent to the library only so far: add a calendar entry.
    const res = await providerFetch("Garmin", `${API}/training-api/schedule/`, { method: "POST", headers, body: JSON.stringify({ workoutId: Number(workoutId), date: input.date }) });
    const text = await res.text();
    const id = Number(text.trim()) || (JSON.parse(text || "{}") as { scheduleId?: number }).scheduleId;
    return id ? { ...input.externalIds, schedule: id } : input.externalIds;
  },

  async sync(accessToken, connection, since) {
    // Garmin delivers history asynchronously to the activity webhook.
    const end = new Date();
    let start = since;
    let requests = 0;
    let accepted = 0;
    let lastError: unknown = null;
    while (start < end && requests < 5) {
      const chunkEnd = new Date(Math.min(end.getTime(), start.getTime() + BACKFILL_MAX_DAYS * 86_400_000));
      const q = new URLSearchParams({
        summaryStartTimeInSeconds: String(Math.floor(start.getTime() / 1000)),
        summaryEndTimeInSeconds: String(Math.floor(chunkEnd.getTime() / 1000)),
      });
      try {
        await providerFetch("Garmin", `${API}/wellness-api/rest/backfill/activities?${q}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        accepted++;
      } catch (e) {
        if (e instanceof ProviderError && e.authExpired) throw e;
        // 409 = this range was already requested: fine. Other errors (e.g. a
        // range before Garmin's history limit) only affect this chunk.
        if (e instanceof ProviderError && e.status === 409) accepted++;
        else lastError = e;
      }
      start = chunkEnd;
      requests++;
    }
    if (!accepted && lastError) throw lastError;
    // Health summaries of the last 90 days (one request per type); only with the HEALTH_EXPORT permission.
    if (!connection.scopes || connection.scopes.includes("HEALTH_EXPORT")) {
      const q = new URLSearchParams({
        summaryStartTimeInSeconds: String(Math.floor(Math.max(since.getTime(), end.getTime() - BACKFILL_MAX_DAYS * 86_400_000) / 1000)),
        summaryEndTimeInSeconds: String(Math.floor(end.getTime() / 1000)),
      });
      for (const type of GARMIN_HEALTH_TYPES) {
        await providerFetch("Garmin", `${API}/wellness-api/rest/backfill/${type}?${q}`, { headers: { Authorization: `Bearer ${accessToken}` } }).catch((e) => {
          if (e instanceof ProviderError && e.authExpired) throw e;
        });
      }
    }
    return {
      activities: [],
      asyncRequested: true,
      message: "Garmin liefert die Aktivitäten in den nächsten Minuten an den Webhook. Dafür muss Wrkhive aus dem Internet erreichbar sein (siehe README, Tunnel).",
    };
  },

  async revoke(accessToken) {
    await providerFetch("Garmin", `${API}/wellness-api/rest/user/registration`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },
};

/** Fetches summaries referenced by a ping notification's callback URL. */
export async function fetchGarminCallback<T = GarminActivitySummary>(callbackURL: string, accessToken: string): Promise<T[]> {
  const url = new URL(callbackURL);
  // Only follow callback URLs that point at the Garmin API host (never arbitrary URLs with our token).
  if (url.origin !== new URL(API).origin) throw new ProviderError("Garmin: unerwartete Callback-URL");
  const res = await providerFetch("Garmin", url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json();
  return Array.isArray(json) ? (json as T[]) : [];
}
