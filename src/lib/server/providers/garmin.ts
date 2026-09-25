import "server-only";
import { encodeGarminWorkout } from "@/lib/workout/export/garmin";
import { env } from "../env";
import { providerFetch } from "./http";
import { ProviderError, type NormalizedActivity, type ProviderAdapter, type TokenSet } from "./types";

/**
 * Garmin Connect Developer Program (OAuth 2.0 with PKCE).
 * - Training API: push workouts and schedule them to the calendar; Garmin
 *   Connect syncs them to the watch / Edge.
 * - Activity API: activity summaries arrive via push (or ping) webhooks;
 *   history is requested via backfill and also delivered to the webhook.
 */
const AUTHORIZE_URL = "https://connect.garmin.com/oauth2Confirm";
const TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const API = "https://apis.garmin.com";
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
  };
}

export const garminAdapter: ProviderAdapter = {
  id: "garmin",
  name: "Garmin",
  devices: ["Forerunner", "fēnix", "Edge", "Venu", "epix", "Enduro"],

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
    const res = await providerFetch("Garmin", `${API}/wellness-api/rest/user/id`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = (await res.json()) as { userId: string };
    return { externalUserId: json.userId, displayName: null };
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

  async sync(accessToken, _connection, since) {
    // Garmin delivers history asynchronously to the activity webhook.
    const end = new Date();
    let start = since;
    let requests = 0;
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
      } catch (e) {
        // 409 = this range was already requested; not an error for us.
        if (!(e instanceof ProviderError && e.status === 409)) throw e;
      }
      start = chunkEnd;
      requests++;
    }
    return { activities: [], asyncRequested: true, message: "Garmin liefert deine Historie in den nächsten Minuten nach." };
  },

  async revoke(accessToken) {
    await providerFetch("Garmin", `${API}/wellness-api/rest/user/registration`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },
};

/** Fetches summaries referenced by a ping notification's callback URL. */
export async function fetchGarminCallback(callbackURL: string, accessToken: string): Promise<GarminActivitySummary[]> {
  const url = new URL(callbackURL);
  if (url.hostname !== "apis.garmin.com") throw new ProviderError("Garmin: unerwartete Callback-URL");
  const res = await providerFetch("Garmin", url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json();
  return Array.isArray(json) ? (json as GarminActivitySummary[]) : [];
}
