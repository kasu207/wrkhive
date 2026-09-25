import "server-only";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, deliveries, deviceConnections, scheduledWorkouts, users, workouts, type DeviceConnection, type User } from "@/db/schema";
import { activityLoad, effectiveVo2max } from "@/lib/analytics/load";
import { addDays, type ISODate } from "@/lib/dates";
import { newId } from "@/lib/id";
import { decrypt, encrypt } from "./crypto";
import { detectSourceApp, isTrainingApp, type SourceAppId } from "@/lib/apps";
import { generateDemoActivities } from "./providers/demo";
import { garminAdapter } from "./providers/garmin";
import { intervalsAdapter } from "./providers/intervals";
import { ProviderError, type NormalizedActivity, type ProviderAdapter, type ProviderId } from "./providers/types";
import { wahooAdapter } from "./providers/wahoo";

export const PROVIDERS: Record<ProviderId, ProviderAdapter> = { garmin: garminAdapter, wahoo: wahooAdapter, intervals: intervalsAdapter };

const HISTORY_DAYS = 365;
const DEMO_HISTORY_DAYS = 420;

/** Calendar day of an instant in a time zone. */
export function localDate(instant: Date, timeZone: string, utcOffsetSec?: number | null): ISODate {
  if (typeof utcOffsetSec === "number") return new Date(instant.getTime() + utcOffsetSec * 1000).toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

export function todayFor(user: Pick<User, "timeZone">): ISODate {
  return localDate(new Date(), user.timeZone);
}

/** Returns a valid access token, refreshing (and persisting) it when needed. */
export async function accessTokenFor(conn: DeviceConnection): Promise<string> {
  if (conn.mode !== "live" || !conn.accessToken) throw new ProviderError("Keine Live-Verbindung");
  const adapter = PROVIDERS[conn.provider];
  const expiresSoon = conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() < Date.now() + 60_000;
  if (!expiresSoon) return decrypt(conn.accessToken);
  if (!conn.refreshToken) throw new ProviderError(`${adapter.name}: Sitzung abgelaufen, bitte neu verbinden.`, 401, true);
  try {
    const tokens = await adapter.refresh(decrypt(conn.refreshToken));
    getDb()
      .update(deviceConnections)
      .set({
        accessToken: encrypt(tokens.accessToken),
        // Refresh tokens may be single use (Wahoo): always store the newest one.
        refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : conn.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        status: "connected",
        statusMessage: null,
      })
      .where(eq(deviceConnections.id, conn.id))
      .run();
    return tokens.accessToken;
  } catch (e) {
    markError(conn.id, e);
    throw e;
  }
}

function markError(connectionId: string, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const authExpired = e instanceof ProviderError && e.authExpired;
  getDb()
    .update(deviceConnections)
    .set({ status: authExpired ? "revoked" : "error", statusMessage: message.slice(0, 300) })
    .where(eq(deviceConnections.id, connectionId))
    .run();
}

/** Metrics a duplicate from another source may fill in when the kept record lacks them. */
const MERGEABLE = ["movingSec", "distanceM", "elevationGainM", "avgHr", "maxHr", "avgPower", "normPower", "avgCadence", "avgSpeed", "calories", "hrZoneSec"] as const;

/** Two recordings are the same session when sport matches and they start within this window. */
const DUPLICATE_WINDOW_MS = 5 * 60_000;

/**
 * Inserts or updates activities and derives training load.
 *
 * The same session often arrives more than once: from several sources (the
 * ELEMNT via Wahoo and the MyWhoosh ride via intervals.icu) or repeatedly
 * from one source with new ids (MyWhoosh uploads rides to intervals.icu
 * multiple times). Recordings of the same sport starting within 5 minutes
 * are merged into the first record: missing metrics (e.g. power from the
 * trainer app, heart rate from the watch) are filled in, the training app
 * is preferred as the source, and the load is recomputed. Matching planned
 * workouts are marked as done.
 */
export function upsertActivities(user: User, conn: { id: string | null; provider: ProviderId | "manual" }, list: NormalizedActivity[]): { inserted: number; updated: number; merged: number } {
  const db = getDb();
  let inserted = 0;
  let updated = 0;
  let merged = 0;
  const touchedDates = new Set<ISODate>();
  const model = { ftp: user.ftp, lthr: user.lthr, maxHr: user.maxHr, restHr: user.restHr, thresholdPace: user.thresholdPace };
  const vo2Of = (a: Pick<NormalizedActivity, "sport" | "distanceM" | "movingSec" | "durationSec" | "avgHr">) =>
    a.sport === "run" && a.distanceM ? effectiveVo2max({ distanceM: a.distanceM, durationSec: a.movingSec ?? a.durationSec, avgHr: a.avgHr }, user.maxHr) : null;

  db.transaction((tx) => {
    for (const a of list) {
      const date = localDate(a.startTime, user.timeZone, a.utcOffsetSec);
      const load = activityLoad(a, model);
      const sourceApp = a.sourceApp ?? detectSourceApp({ hints: [a.deviceName], name: a.name, fallback: conn.provider === "manual" ? "file" : null });
      const values = {
        sport: a.sport,
        name: a.name.slice(0, 120),
        startTime: a.startTime,
        date,
        durationSec: a.durationSec,
        movingSec: a.movingSec ?? null,
        distanceM: a.distanceM ?? null,
        elevationGainM: a.elevationGainM ?? null,
        avgHr: a.avgHr ?? null,
        maxHr: a.maxHr ?? null,
        avgPower: a.avgPower ?? null,
        normPower: a.normPower ?? null,
        avgCadence: a.avgCadence ?? null,
        avgSpeed: a.avgSpeed ?? null,
        calories: a.calories ?? null,
        tss: load.tss,
        tssMethod: load.method,
        hrZoneSec: a.hrZoneSec ?? null,
        vo2maxEst: vo2Of(a),
        deviceName: a.deviceName ?? null,
        sourceApp,
      };

      const existing = tx
        .select({ id: activities.id })
        .from(activities)
        .where(and(eq(activities.userId, user.id), eq(activities.provider, conn.provider), eq(activities.externalId, a.externalId)))
        .get();
      if (existing) {
        tx.update(activities).set(values).where(eq(activities.id, existing.id)).run();
        updated++;
        touchedDates.add(date);
        continue;
      }

      const duplicate = tx
        .select()
        .from(activities)
        .where(
          and(
            eq(activities.userId, user.id),
            eq(activities.sport, a.sport),
            gte(activities.startTime, new Date(a.startTime.getTime() - DUPLICATE_WINDOW_MS)),
            lte(activities.startTime, new Date(a.startTime.getTime() + DUPLICATE_WINDOW_MS)),
          ),
        )
        .get();
      if (duplicate) {
        const patch: Partial<typeof activities.$inferInsert> = {};
        for (const k of MERGEABLE) {
          if ((duplicate[k] === null || duplicate[k] === undefined) && values[k] !== null && values[k] !== undefined) (patch as Record<string, unknown>)[k] = values[k];
        }
        if (isTrainingApp(sourceApp) && !isTrainingApp(duplicate.sourceApp as SourceAppId | null)) patch.sourceApp = sourceApp;
        else if (!duplicate.sourceApp && sourceApp) patch.sourceApp = sourceApp;
        if (Object.keys(patch).length) {
          const combined = { ...duplicate, ...patch };
          const l = activityLoad(combined, model);
          tx.update(activities)
            .set({ ...patch, tss: l.tss, tssMethod: l.method, vo2maxEst: vo2Of(combined) ?? duplicate.vo2maxEst })
            .where(eq(activities.id, duplicate.id))
            .run();
          merged++;
          touchedDates.add(duplicate.date);
        }
        continue;
      }

      const res = tx
        .insert(activities)
        .values({ id: newId(), userId: user.id, connectionId: conn.id, provider: conn.provider, externalId: a.externalId, ...values })
        .onConflictDoNothing()
        .run();
      if (res.changes) inserted++;
      touchedDates.add(date);
    }
  });

  if (touchedDates.size) matchPlannedWorkouts(user.id, [...touchedDates]);
  return { inserted, updated, merged };
}

/** Marks planned workouts as done when an activity of the same sport exists on that day. */
export function matchPlannedWorkouts(userId: string, dates: ISODate[]) {
  const db = getDb();
  const planned = db
    .select({ id: scheduledWorkouts.id, date: scheduledWorkouts.date, sport: workouts.sport })
    .from(scheduledWorkouts)
    .innerJoin(workouts, eq(workouts.id, scheduledWorkouts.workoutId))
    .where(and(eq(scheduledWorkouts.userId, userId), eq(scheduledWorkouts.status, "planned"), inArray(scheduledWorkouts.date, dates)))
    .all();
  if (!planned.length) return;
  const acts = db
    .select({ id: activities.id, date: activities.date, sport: activities.sport })
    .from(activities)
    .where(and(eq(activities.userId, userId), inArray(activities.date, dates)))
    .all();
  const used = new Set(
    db
      .select({ a: scheduledWorkouts.activityId })
      .from(scheduledWorkouts)
      .where(and(eq(scheduledWorkouts.userId, userId), inArray(scheduledWorkouts.date, dates)))
      .all()
      .map((r) => r.a)
      .filter(Boolean),
  );
  for (const p of planned) {
    const match = acts.find((a) => a.date === p.date && a.sport === p.sport && !used.has(a.id));
    if (match) {
      used.add(match.id);
      db.update(scheduledWorkouts).set({ status: "done", activityId: match.id }).where(eq(scheduledWorkouts.id, p.id)).run();
    }
  }
}

export interface SyncOutcome {
  ok: boolean;
  inserted: number;
  message: string;
}

const inFlight = new Map<string, Promise<SyncOutcome>>();

/** Syncs a connection; concurrent calls for the same connection share one run. */
export function syncConnection(conn: DeviceConnection, opts: { full?: boolean } = {}): Promise<SyncOutcome> {
  const running = inFlight.get(conn.id);
  if (running) return running;
  const p = runSync(conn, opts).finally(() => inFlight.delete(conn.id));
  inFlight.set(conn.id, p);
  return p;
}

async function runSync(conn: DeviceConnection, opts: { full?: boolean }): Promise<SyncOutcome> {
  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, conn.userId)).get();
  if (!user) return { ok: false, inserted: 0, message: "Nutzer nicht gefunden" };
  const now = new Date();

  if (conn.mode === "demo") {
    // Only one demo source feeds activities, otherwise the demo would double count.
    const other = db
      .select()
      .from(deviceConnections)
      .where(and(eq(deviceConnections.userId, user.id), eq(deviceConnections.mode, "demo"), ne(deviceConnections.id, conn.id)))
      .all()
      .find((c) => c.createdAt < conn.createdAt);
    if (other) {
      db.update(deviceConnections).set({ lastSyncAt: now }).where(eq(deviceConnections.id, conn.id)).run();
      return { ok: true, inserted: 0, message: `Aktivitäten kommen bereits über ${PROVIDERS[other.provider].name} (Demo).` };
    }
    const today = todayFor(user);
    const historyStart = addDays(today, -DEMO_HISTORY_DAYS);
    const from = opts.full || !conn.lastSyncAt ? historyStart : addDays(localDate(conn.lastSyncAt, user.timeZone), -1);
    // Today's activities only once they are plausibly done.
    const to = now.getHours() >= 20 ? today : addDays(today, -1);
    const list = generateDemoActivities(user.id, from, to, user, historyStart);
    const r = upsertActivities(user, conn, list);
    db.update(deviceConnections).set({ lastSyncAt: now, status: "connected", statusMessage: null }).where(eq(deviceConnections.id, conn.id)).run();
    return { ok: true, inserted: r.inserted, message: r.inserted ? `${r.inserted} neue Aktivitäten (Demo-Daten).` : "Alles aktuell." };
  }

  const adapter = PROVIDERS[conn.provider];
  try {
    const token = await accessTokenFor(conn);
    const since = opts.full || !conn.lastSyncAt ? new Date(now.getTime() - HISTORY_DAYS * 86_400_000) : new Date(conn.lastSyncAt.getTime() - 2 * 86_400_000);
    const result = await adapter.sync(token, conn, since);
    const r = upsertActivities(user, conn, result.activities);
    db.update(deviceConnections).set({ lastSyncAt: now, status: "connected", statusMessage: null }).where(eq(deviceConnections.id, conn.id)).run();
    const message = result.message ?? (r.inserted ? `${r.inserted} neue Aktivitäten importiert.` : "Alles aktuell.");
    return { ok: true, inserted: r.inserted, message };
  } catch (e) {
    markError(conn.id, e);
    return { ok: false, inserted: 0, message: e instanceof Error ? e.message : "Synchronisierung fehlgeschlagen" };
  }
}

export interface SendOutcome {
  ok: boolean;
  message: string;
}

export async function sendWorkoutToDevice(
  user: User,
  workoutId: string,
  provider: ProviderId,
  date: ISODate | null,
  timeZone: string,
  opts: { indoor?: boolean } = {},
): Promise<SendOutcome> {
  const db = getDb();
  const workout = db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, user.id)))
    .get();
  if (!workout) return { ok: false, message: "Workout nicht gefunden." };
  const conn = db
    .select()
    .from(deviceConnections)
    .where(and(eq(deviceConnections.userId, user.id), eq(deviceConnections.provider, provider)))
    .get();
  const adapter = PROVIDERS[provider];
  if (!conn) return { ok: false, message: `${adapter.name} ist nicht verbunden.` };

  const issues = adapter.compatibility(workout.structure, date);
  if (issues.length) return { ok: false, message: issues.join(" ") };

  const record = (status: "sent" | "failed", externalIds: Record<string, string | number> | null, error: string | null) =>
    db
      .insert(deliveries)
      .values({ id: newId(), userId: user.id, workoutId, connectionId: conn.id, provider, status, scheduledDate: date, externalIds, error })
      .run();

  if (conn.mode === "demo") {
    record("sent", { demo: newId(8) }, null);
    return {
      ok: true,
      message: date
        ? `Demo: „${workout.name}“ wäre jetzt für ${date} an ${adapter.name} übertragen. Verbinde ein echtes Konto, um es auf dein Gerät zu senden.`
        : `Demo: „${workout.name}“ wäre jetzt in deiner ${adapter.name}-Bibliothek.`,
    };
  }

  try {
    const token = await accessTokenFor(conn);
    const res = await adapter.send(token, {
      name: workout.name,
      description: workout.description,
      structure: workout.structure,
      date,
      timeZone,
      user,
      workoutId,
      indoor: Boolean(opts.indoor),
    });
    record("sent", res.externalIds, null);
    return { ok: true, message: res.message };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Senden fehlgeschlagen";
    record("failed", null, message);
    if (e instanceof ProviderError && e.authExpired) markError(conn.id, e);
    return { ok: false, message };
  }
}

/** Connections with continuous sync enabled whose last sync is older than `maxAgeMs`. */
export function staleConnections(userId: string, maxAgeMs: number): DeviceConnection[] {
  const now = Date.now();
  return getDb()
    .select()
    .from(deviceConnections)
    .where(eq(deviceConnections.userId, userId))
    .all()
    .filter((c) => c.autoSync && c.status !== "revoked" && (!c.lastSyncAt || now - c.lastSyncAt.getTime() > maxAgeMs));
}
