import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, deviceConnections, oauthStates, type User } from "@/db/schema";
import { newId } from "@/lib/id";
import { encrypt, pkcePair, randomToken } from "./crypto";
import { env } from "./env";
import type { ProviderId, TokenSet } from "./providers/types";
import { PROVIDERS, syncConnection } from "./sync";

export function redirectUri(provider: ProviderId) {
  return `${env.appUrl()}/api/devices/${provider}/callback`;
}

/** Starts OAuth for a configured provider, or creates a demo connection. Returns the URL to navigate to. */
export async function beginConnect(user: User, provider: ProviderId, returnTo: string | null = null): Promise<string> {
  const adapter = PROVIDERS[provider];
  if (adapter.auth !== "oauth") throw new Error(`${adapter.name} wird mit einem API-Schlüssel verbunden.`);
  if (!adapter.isConfigured()) {
    await createConnection(user, provider, { mode: "demo" });
    return `/devices?connected=${provider}`;
  }
  const db = getDb();
  db.delete(oauthStates).where(lt(oauthStates.createdAt, new Date(Date.now() - 30 * 60_000))).run();
  const state = randomToken(24);
  const { verifier, challenge } = pkcePair();
  db.insert(oauthStates).values({ state, userId: user.id, provider, codeVerifier: verifier, returnTo }).run();
  return adapter.authorizeUrl({ state, codeChallenge: challenge, redirectUri: redirectUri(provider) });
}

export async function createConnection(
  user: User,
  provider: ProviderId,
  opts: { mode: "demo" } | { mode: "live"; tokens: TokenSet; externalUserId: string; displayName: string | null; permissions?: string[] },
) {
  const db = getDb();
  const values =
    opts.mode === "demo"
      ? { mode: "demo" as const, displayName: "Demo-Konto", externalUserId: null, accessToken: null, refreshToken: null, tokenExpiresAt: null, scopes: null }
      : {
          mode: "live" as const,
          displayName: opts.displayName,
          externalUserId: opts.externalUserId,
          accessToken: encrypt(opts.tokens.accessToken),
          refreshToken: opts.tokens.refreshToken ? encrypt(opts.tokens.refreshToken) : null,
          tokenExpiresAt: opts.tokens.expiresAt,
          scopes: opts.permissions ? opts.permissions.join(" ") : opts.tokens.scopes,
        };
  const existing = db
    .select()
    .from(deviceConnections)
    .where(and(eq(deviceConnections.userId, user.id), eq(deviceConnections.provider, provider)))
    .get();
  let id: string;
  if (existing) {
    id = existing.id;
    // Demo data must never mix with the real account's history.
    if (existing.mode === "demo" && values.mode === "live") db.delete(activities).where(eq(activities.connectionId, id)).run();
    db.update(deviceConnections)
      .set({ ...values, status: "connected", statusMessage: null, lastSyncAt: null })
      .where(eq(deviceConnections.id, id))
      .run();
  } else {
    id = newId();
    db.insert(deviceConnections).values({ id, userId: user.id, provider, autoSync: true, ...values }).run();
  }
  const conn = db.select().from(deviceConnections).where(eq(deviceConnections.id, id)).get()!;
  // Import history right away so the dashboard is useful immediately.
  await syncConnection(conn, { full: true });
  return db.select().from(deviceConnections).where(eq(deviceConnections.id, id)).get() ?? conn;
}
