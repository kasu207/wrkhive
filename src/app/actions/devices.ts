"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { activities, deviceConnections, providerApps } from "@/db/schema";
import { isInstallationOwner, requireUser } from "@/lib/server/auth";
import { beginConnect, createConnection } from "@/lib/server/connections";
import { decrypt, encrypt } from "@/lib/server/crypto";
import { env } from "@/lib/server/env";
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

const CREDENTIAL = /^[A-Za-z0-9._~-]{8,200}$/;

/**
 * Self-hosted setup: the installation owner registers a personal Wahoo
 * developer app (sandbox, free, no review) and enters its credentials here.
 */
export async function saveWahooApp(clientId: string, clientSecret: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!isInstallationOwner(user)) return { ok: false, error: "Nur der Besitzer dieser Installation kann die Wahoo-App hinterlegen." };
  if (env.wahoo().source === "env") return { ok: false, error: "Die Wahoo-Zugangsdaten sind bereits in der Server-Konfiguration hinterlegt." };
  const id = typeof clientId === "string" ? clientId.trim() : "";
  const secret = typeof clientSecret === "string" ? clientSecret.trim() : "";
  if (!CREDENTIAL.test(id)) return { ok: false, error: "Die Client-ID sieht nicht vollständig aus. Kopiere sie aus dem Wahoo-Entwicklerportal." };
  if (!CREDENTIAL.test(secret)) return { ok: false, error: "Das Client-Secret sieht nicht vollständig aus. Kopiere es aus dem Wahoo-Entwicklerportal." };
  const values = { clientId: id, clientSecret: encrypt(secret), updatedBy: user.id, updatedAt: new Date() };
  getDb().insert(providerApps).values({ provider: "wahoo", ...values }).onConflictDoUpdate({ target: providerApps.provider, set: values }).run();
  revalidatePath("/devices");
  return { ok: true, message: "Wahoo-App gespeichert." };
}

export async function removeWahooApp(): Promise<ActionResult> {
  const user = await requireUser();
  if (!isInstallationOwner(user)) return { ok: false, error: "Nur der Besitzer dieser Installation kann die Wahoo-App entfernen." };
  getDb().delete(providerApps).where(eq(providerApps.provider, "wahoo")).run();
  revalidatePath("/devices");
  return { ok: true, message: "Wahoo-App entfernt." };
}
