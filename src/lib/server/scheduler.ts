import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { deviceConnections } from "@/db/schema";
import { autoAdaptAll } from "./adapt";
import { syncConnection } from "./sync";

const globalScheduler = globalThis as unknown as { __wrkhiveScheduler?: NodeJS.Timeout };

/** Syncs every connection with continuous sync enabled. Returns per-connection results. */
export async function syncAllConnections() {
  const conns = getDb().select().from(deviceConnections).where(eq(deviceConnections.autoSync, true)).all();
  const results: { id: string; provider: string; ok: boolean; inserted: number; message: string }[] = [];
  for (const c of conns) {
    if (c.status === "revoked") continue;
    try {
      const r = await syncConnection(c);
      results.push({ id: c.id, provider: c.provider, ...r });
    } catch (e) {
      results.push({ id: c.id, provider: c.provider, ok: false, inserted: 0, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/**
 * Periodic pull (default every 30 minutes, SYNC_INTERVAL_MINUTES to change,
 * 0 disables). Webhooks deliver in real time when the app is reachable from
 * the internet; this keeps local installs up to date as well.
 */
export function startSyncScheduler() {
  if (globalScheduler.__wrkhiveScheduler) return;
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 30);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const run = async () => {
    try {
      const results = await syncAllConnections();
      const inserted = results.reduce((a, r) => a + r.inserted, 0);
      if (results.length) console.log(`[wrkhive] background sync: ${results.length} connection(s), ${inserted} new activities`);
      // After fresh data: adapt today's workouts for athletes with the automatic mode.
      const adapted = autoAdaptAll();
      if (adapted) console.log(`[wrkhive] adapted ${adapted} planned workout(s) to the current load`);
    } catch (e) {
      console.error("[wrkhive] background sync failed", e);
    }
  };
  // First run shortly after start, then on the interval.
  setTimeout(run, 60_000).unref();
  globalScheduler.__wrkhiveScheduler = setInterval(run, minutes * 60_000);
  globalScheduler.__wrkhiveScheduler.unref();
  console.log(`[wrkhive] background sync every ${minutes} min`);
}
