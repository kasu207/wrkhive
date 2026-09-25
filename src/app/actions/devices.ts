"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { activities, deviceConnections } from "@/db/schema";
import { requireUser } from "@/lib/server/auth";
import { beginConnect, createConnection } from "@/lib/server/connections";
import { decrypt } from "@/lib/server/crypto";
import { PROVIDERS, syncConnection } from "@/lib/server/sync";
import type { ActionResult } from "./workouts";

type Provider = "garmin" | "wahoo" | "intervals";
const isProvider = (p: string): p is Provider => p === "garmin" || p === "wahoo" || p === "intervals";

export async function connectDevice(provider: string): Promise<ActionResult<{ url: string }>> {
  const user = await requireUser();
  if (!isProvider(provider)) return { ok: false, error: "Unbekannter Anbieter." };
  try {
    // Remember where the user started, so the callback (which may arrive via
    // the public APP_URL, e.g. a tunnel) can send them back there.
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
    const url = await beginConnect(user, provider, host ? `${proto}://${host}` : null);
    revalidatePath("/devices");
    revalidatePath("/dashboard");
    return { ok: true, data: { url } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Verbindung fehlgeschlagen." };
  }
}

/** Connects a provider that uses a personal API key (intervals.icu). */
export async function connectWithApiKey(provider: string, athleteId: string, apiKey: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!isProvider(provider)) return { ok: false, error: "Unbekannter Anbieter." };
  const adapter = PROVIDERS[provider];
  if (adapter.auth !== "apikey" || !adapter.connectWithKey) return { ok: false, error: "Dieser Anbieter wird per Anmeldung verbunden." };
  if (typeof athleteId !== "string" || typeof apiKey !== "string" || athleteId.length > 200 || apiKey.length > 200) return { ok: false, error: "Ungültige Eingabe." };
  try {
    const { token, ...account } = await adapter.connectWithKey({ athleteId, apiKey });
    const conn = await createConnection(user, provider, {
      mode: "live",
      tokens: { accessToken: token, refreshToken: null, expiresAt: null, scopes: null },
      ...account,
    });
    revalidatePath("/devices");
    revalidatePath("/dashboard");
    revalidatePath("/activities");
    return conn.status === "connected"
      ? { ok: true, message: `Verbunden als ${account.displayName ?? account.externalUserId}.` }
      : { ok: true, message: conn.statusMessage ?? "Verbunden, der erste Abgleich ist fehlgeschlagen." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Verbindung fehlgeschlagen." };
  }
}

export async function disconnectDevice(provider: string, removeActivities: boolean): Promise<ActionResult> {
  const user = await requireUser();
  if (!isProvider(provider)) return { ok: false, error: "Unbekannter Anbieter." };
  const db = getDb();
  const conn = db.select().from(deviceConnections).where(and(eq(deviceConnections.userId, user.id), eq(deviceConnections.provider, provider))).get();
  if (!conn) return { ok: true };
  if (conn.mode === "live" && conn.accessToken) {
    // Best effort: revoke access at the provider too.
    try {
      await PROVIDERS[provider].revoke(decrypt(conn.accessToken));
    } catch (e) {
      console.warn(`[${provider}] revoke failed`, e);
    }
  }
  if (removeActivities) db.delete(activities).where(and(eq(activities.userId, user.id), eq(activities.provider, provider))).run();
  db.delete(deviceConnections).where(eq(deviceConnections.id, conn.id)).run();
  revalidatePath("/devices");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function setAutoSync(provider: string, enabled: boolean): Promise<ActionResult> {
  const user = await requireUser();
  if (!isProvider(provider)) return { ok: false, error: "Unbekannter Anbieter." };
  getDb()
    .update(deviceConnections)
    .set({ autoSync: enabled })
    .where(and(eq(deviceConnections.userId, user.id), eq(deviceConnections.provider, provider)))
    .run();
  revalidatePath("/devices");
  return { ok: true };
}

export async function syncNow(provider: string, full = false): Promise<ActionResult> {
  const user = await requireUser();
  if (!isProvider(provider)) return { ok: false, error: "Unbekannter Anbieter." };
  const conn = getDb()
    .select()
    .from(deviceConnections)
    .where(and(eq(deviceConnections.userId, user.id), eq(deviceConnections.provider, provider)))
    .get();
  if (!conn) return { ok: false, error: "Nicht verbunden." };
  const r = await syncConnection(conn, { full });
  revalidatePath("/devices");
  revalidatePath("/dashboard");
  revalidatePath("/activities");
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}
