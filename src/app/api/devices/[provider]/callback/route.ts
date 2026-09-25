import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { oauthStates } from "@/db/schema";
import { getCurrentUser } from "@/lib/server/auth";
import { createConnection, redirectUri } from "@/lib/server/connections";
import { env } from "@/lib/server/env";
import { PROVIDERS } from "@/lib/server/sync";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/devices/[provider]/callback">) {
  const { provider } = await ctx.params;
  const back = (query: string) => NextResponse.redirect(`${env.appUrl()}/devices?${query}`);
  if (provider !== "garmin" && provider !== "wahoo") return back("error=unknown_provider");

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${env.appUrl()}/login`);

  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");
  if (params.get("error")) return back(`error=${encodeURIComponent(params.get("error")!)}`);
  if (!state || !code) return back("error=missing_code");

  const db = getDb();
  const row = db
    .select()
    .from(oauthStates)
    .where(and(eq(oauthStates.state, state), eq(oauthStates.userId, user.id), eq(oauthStates.provider, provider)))
    .get();
  db.delete(oauthStates).where(eq(oauthStates.state, state)).run();
  if (!row || row.createdAt.getTime() < Date.now() - 30 * 60_000) return back("error=invalid_state");

  const adapter = PROVIDERS[provider as "garmin" | "wahoo"];
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
