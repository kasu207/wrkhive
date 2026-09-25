"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { activities, deviceConnections } from "@/db/schema";
import { requireUser } from "@/lib/server/auth";
import { beginConnect } from "@/lib/server/connections";
import { decrypt } from "@/lib/server/crypto";
import { PROVIDERS, syncConnection } from "@/lib/server/sync";
import type { ActionResult } from "./workouts";

type Provider = "garmin" | "wahoo";
const isProvider = (p: string): p is Provider => p === "garmin" || p === "wahoo";

export async function connectDevice(provider: string): Promise<ActionResult<{ url: string }>> {
  const user = await requireUser();
  if (!isProvider(provider)) return { ok: false, error: "Unbekannter Anbieter." };
  try {
    const url = await beginConnect(user, provider);
    revalidatePath("/devices");
    revalidatePath("/dashboard");
    return { ok: true, data: { url } };
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
