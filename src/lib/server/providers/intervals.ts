import "server-only";
import { detectSourceApp, type SourceAppId } from "@/lib/apps";
import { encodeIntervalsWorkout, intervalsCompatibility, intervalsMovingTime, INTERVALS_SPORT_TYPE } from "@/lib/workout/export/intervals";
import { providerFetch } from "./http";
import { ProviderError, type NormalizedActivity, type ProviderAdapter } from "./types";

/**
 * intervals.icu as a bridge to the devices: the athlete connects Garmin
 * Connect and/or Wahoo once inside intervals.icu and enables "Upload planned
 * workouts" there. Wrkhive writes workouts into the intervals.icu calendar
 * (personal API key, no partner program needed); intervals.icu pushes the
 * next 7 days to Garmin Connect and the Wahoo cloud, from where they reach the
 * watch or ELEMNT. Activities recorded on the devices flow back the same way.
 *
 * Auth: HTTP Basic with the user name "API_KEY" and the personal key as the
 * password (intervals.icu > Settings > Developer Settings).
 */

/** Overridable for integration tests against a mock server. */
const API = (process.env.INTERVALS_API_BASE ?? "https://intervals.icu/api/v1").replace(/\/$/, "");

const ATHLETE_ID = /^i?\d{1,12}$/;

/** The stored access token is "<athleteId>:<apiKey>" (encrypted at rest like OAuth tokens). */
export function packIntervalsToken(athleteId: string, apiKey: string) {
  return `${athleteId}:${apiKey}`;
}

export function unpackIntervalsToken(token: string): { athleteId: string; apiKey: string } {
  const i = token.indexOf(":");
  if (i <= 0) throw new ProviderError("intervals.icu: ungültige Zugangsdaten, bitte neu verbinden.", 401, true);
  return { athleteId: token.slice(0, i), apiKey: token.slice(i + 1) };
}

function headers(apiKey: string, json = false): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/** Normalizes the athlete id the user typed ("i123456", "123456" or the profile URL). */
export function normalizeAthleteId(input: string): string | null {
  const v = input.trim();
  if (!v) return "0";
  const fromUrl = v.match(/athlete\/(i?\d+)/i)?.[1];
  const id = (fromUrl ?? v).toLowerCase();
  return ATHLETE_ID.test(id) ? id : null;
}

const RIDE = new Set(["Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "EBikeRide", "EMountainBikeRide", "TrackRide", "Velomobile", "Handcycle", "Cyclocross"]);
const RUN = new Set(["Run", "VirtualRun", "TrailRun"]);

export function intervalsSport(type: string | undefined): NormalizedActivity["sport"] {
  if (!type) return "other";
  if (RIDE.has(type)) return "ride";
  if (RUN.has(type)) return "run";
  if (type === "WeightTraining") return "strength";
  return "other";
}

export interface IntervalsActivity {
  id: string | number;
  name?: string | null;
  type?: string;
  start_date_local?: string;
  start_date?: string;
  moving_time?: number | null;
  elapsed_time?: number | null;
  distance?: number | null;
  total_elevation_gain?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  icu_average_watts?: number | null;
  icu_weighted_avg_watts?: number | null;
  average_cadence?: number | null;
  average_speed?: number | null;
  calories?: number | null;
  device_name?: string | null;
  /** Where intervals.icu got the activity from, e.g. GARMIN_CONNECT, WAHOO, ZWIFT, OAUTH_CLIENT, UPLOAD. */
  source?: string;
  /** Name of the uploading app for source OAUTH_CLIENT (e.g. MyWhoosh, ROUVY). */
  oauth_client_name?: string | null;
}

const SOURCE: Record<string, SourceAppId> = {
  GARMIN_CONNECT: "garmin",
  WAHOO: "wahoo",
  ZWIFT: "zwift",
  STRAVA: "strava",
  COROS: "coros",
  POLAR: "polar",
  SUUNTO: "suunto",
  UPLOAD: "file",
  DROPBOX: "file",
};

const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const posInt = (v: unknown): number | null => {
  const n = pos(v);
  return n === null ? null : Math.round(n);
};

export function normalizeIntervalsActivity(a: IntervalsActivity): NormalizedActivity | null {
  // Strava-sourced activities are only returned as stubs by the API.
  if (!a.start_date_local && !a.start_date) return null;
  const duration = pos(a.elapsed_time) ?? pos(a.moving_time);
  if (!duration) return null;
  const startTime = a.start_date ? new Date(a.start_date) : new Date(`${a.start_date_local}Z`);
  if (Number.isNaN(startTime.getTime())) return null;
  let utcOffsetSec: number | null = null;
  if (a.start_date && a.start_date_local) {
    const diff = (Date.parse(`${a.start_date_local.replace(/Z$/, "")}Z`) - startTime.getTime()) / 1000;
    if (Number.isFinite(diff) && Math.abs(diff) <= 14 * 3600) utcOffsetSec = Math.round(diff / 60) * 60;
  }
  const sport = intervalsSport(a.type);
  return {
    externalId: String(a.id),
    sport,
    name: a.name?.trim() || (sport === "ride" ? "Radfahrt" : sport === "run" ? "Lauf" : sport === "strength" ? "Krafttraining" : "Aktivität"),
    startTime,
    utcOffsetSec,
    durationSec: Math.round(duration),
    movingSec: posInt(a.moving_time),
    distanceM: pos(a.distance),
    elevationGainM: typeof a.total_elevation_gain === "number" && a.total_elevation_gain >= 0 ? a.total_elevation_gain : null,
    avgHr: posInt(a.average_heartrate),
    maxHr: posInt(a.max_heartrate),
    avgPower: posInt(a.icu_average_watts),
    normPower: posInt(a.icu_weighted_avg_watts),
    avgCadence: posInt(a.average_cadence),
    avgSpeed: pos(a.average_speed),
    calories: posInt(a.calories),
    deviceName: a.device_name?.trim() || a.oauth_client_name?.trim() || "intervals.icu",
    sourceApp: detectSourceApp({ hints: [a.device_name, a.oauth_client_name], name: a.name, fallback: a.source ? (SOURCE[a.source] ?? null) : null }),
  };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const intervalsAdapter: ProviderAdapter = {
  id: "intervals",
  name: "intervals.icu",
  devices: ["Garmin (Uhren und Edge)", "Wahoo ELEMNT", "Zwift", "Coros", "Suunto"],
  auth: "apikey",

  // Works without server-side credentials: every athlete brings their own key.
  isConfigured: () => true,

  authorizeUrl() {
    throw new ProviderError("intervals.icu wird mit einem API-Schlüssel verbunden.");
  },
  async exchangeCode() {
    throw new ProviderError("intervals.icu wird mit einem API-Schlüssel verbunden.");
  },
  async refresh() {
    throw new ProviderError("intervals.icu: API-Schlüssel ungültig, bitte neu verbinden.", 401, true);
  },

  async connectWithKey({ athleteId, apiKey }) {
    const id = normalizeAthleteId(athleteId);
    if (!id) throw new ProviderError("Die Athleten-ID hat das Format i123456.");
    const key = apiKey.trim();
    if (key.length < 8 || /\s/.test(key)) throw new ProviderError("Der API-Schlüssel ist unvollständig.");
    const res = await providerFetch("intervals.icu", `${API}/athlete/${id}`, { headers: headers(key) }).catch((e) => {
      if (e instanceof ProviderError && (e.status === 401 || e.status === 403)) throw new ProviderError("intervals.icu hat den API-Schlüssel abgelehnt. Prüfe Athleten-ID und Schlüssel.");
      if (e instanceof ProviderError && e.status === 404) throw new ProviderError("Athleten-ID bei intervals.icu nicht gefunden.");
      throw e;
    });
    const athlete = (await res.json()) as { id?: string; name?: string | null; firstname?: string | null; lastname?: string | null };
    const resolvedId = typeof athlete.id === "string" && ATHLETE_ID.test(athlete.id) ? athlete.id : id;
    const displayName = athlete.name?.trim() || [athlete.firstname, athlete.lastname].filter(Boolean).join(" ") || resolvedId;
    return { externalUserId: resolvedId, displayName, token: packIntervalsToken(resolvedId, key) };
  },

  async account(token) {
    return { externalUserId: unpackIntervalsToken(token).athleteId, displayName: null };
  },

  compatibility(structure, date) {
    const issues = intervalsCompatibility(structure);
    if (!date) issues.push("intervals.icu braucht ein Datum, damit das Workout auf die Geräte übertragen wird.");
    return issues;
  },

  async send(token, input) {
    const { athleteId, apiKey } = unpackIntervalsToken(token);
    if (!input.date) throw new ProviderError("intervals.icu braucht ein Datum.");
    if (input.structure.sport === "strength") throw new ProviderError("Krafttraining wird über intervals.icu nicht unterstützt.");
    const description = encodeIntervalsWorkout(input.structure);
    const res = await providerFetch("intervals.icu", `${API}/athlete/${athleteId}/events`, {
      method: "POST",
      headers: headers(apiKey, true),
      body: JSON.stringify({
        category: "WORKOUT",
        start_date_local: `${input.date}T00:00:00`,
        type: INTERVALS_SPORT_TYPE[input.structure.sport],
        name: input.name.slice(0, 120),
        description,
        moving_time: intervalsMovingTime(input.structure, input.user),
      }),
    });
    const event = (await res.json()) as { id?: number | string; workout_doc?: { steps?: unknown[] } | null };
    if (event.id === undefined) throw new ProviderError("intervals.icu: unerwartete Antwort beim Anlegen des Workouts.");
    // intervals.icu parses the text into its workout model. No steps means it
    // could not read it: remove the empty event instead of pushing it to devices.
    if (event.workout_doc && Array.isArray(event.workout_doc.steps) && event.workout_doc.steps.length === 0) {
      await providerFetch("intervals.icu", `${API}/athlete/${athleteId}/events/${event.id}`, { method: "DELETE", headers: headers(apiKey) }).catch(() => undefined);
      throw new ProviderError("intervals.icu konnte die Workout-Struktur nicht lesen.");
    }
    return {
      externalIds: { event: event.id },
      message: `Im intervals.icu-Kalender für ${input.date}. intervals.icu überträgt geplante Workouts der nächsten 7 Tage an Garmin Connect und Wahoo, sobald dort „Upload planned workouts“ aktiviert ist.`,
    };
  },

  async sync(token, _connection, since) {
    const { athleteId, apiKey } = unpackIntervalsToken(token);
    const newest = new Date(Date.now() + 86_400_000);
    const q = new URLSearchParams({ oldest: ymd(since), newest: ymd(newest) });
    const res = await providerFetch("intervals.icu", `${API}/athlete/${athleteId}/activities?${q}`, { headers: headers(apiKey), timeoutMs: 60_000 });
    const rows = (await res.json()) as IntervalsActivity[];
    const activities = (Array.isArray(rows) ? rows : []).map(normalizeIntervalsActivity).filter((a): a is NormalizedActivity => a !== null);
    return { activities };
  },

  // Personal API keys are revoked by the athlete in intervals.icu itself.
  async revoke() {},
};
