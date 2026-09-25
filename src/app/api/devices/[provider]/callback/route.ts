import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { oauthStates, users } from "@/db/schema";
import { createConnection, redirectUri } from "@/lib/server/connections";
import { env } from "@/lib/server/env";
import { PROVIDERS } from "@/lib/server/sync";

const STATE_TTL_MS = 30 * 60_000;

/**
 * OAuth redirect target for Garmin and Wahoo.
 *
 * The user is identified by the single-use, unguessable `state` created when
 * they clicked "Verbinden" (not by the session cookie): the provider redirects
 * to the public APP_URL, which can differ from the address the user browses
 * (e.g. a tunnel domain vs. localhost), where no session cookie exists.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/devices/[provider]/callback">) {
  const { provider } = await ctx.params;
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const db = getDb();
  const row = state ? db.select().from(oauthStates).where(eq(oauthStates.state, state)).get() : undefined;
  if (state) db.delete(oauthStates).where(eq(oauthStates.state, state)).run();

  const base = safeReturn(row?.returnTo) ?? env.appUrl();
  const back = (query: string) => NextResponse.redirect(`${base}/devices?${query}`);

  if (provider !== "garmin" && provider !== "wahoo") return back("error=unknown_provider");
  if (params.get("error")) return back(`error=${encodeURIComponent(params.get("error_description") ?? params.get("error")!)}`);
  const code = params.get("code");
  if (!row || row.provider !== provider || !code || row.createdAt.getTime() < Date.now() - STATE_TTL_MS) {
    return back(`error=${encodeURIComponent("Die Anmeldung ist abgelaufen oder ungültig. Bitte erneut verbinden.")}`);
  }
  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) return back("error=user_not_found");

  const adapter = PROVIDERS[provider];
  try {
    const tokens = await adapter.exchangeCode({ code, codeVerifier: row.codeVerifier, redirectUri: redirectUri(provider) });
    const account = await adapter.account(tokens.accessToken);
    await createConnection(user, provider, { mode: "live", tokens, ...account });
    return back(`connected=${provider}`);
  } catch (e) {
    console.error(`[${provider}] OAuth callback failed`, e);
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "connect_failed")}`);
  }
}

/** Only allow http(s) origins without path, to avoid open redirects. */
function safeReturn(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}
