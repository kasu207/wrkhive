import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { providerApps } from "@/db/schema";
import { decrypt } from "./crypto";

function storedApp(provider: "wahoo"): { clientId: string; clientSecret: string } | null {
  const row = getDb().select().from(providerApps).where(eq(providerApps.provider, provider)).get();
  if (!row) return null;
  try {
    return { clientId: row.clientId, clientSecret: decrypt(row.clientSecret) };
  } catch {
    // Secret no longer decryptable (APP_SECRET changed): treat as not configured.
    return null;
  }
}

export const env = {
  appUrl: () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  anthropicConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  coachModel: () => process.env.COACH_MODEL ?? "claude-opus-5",
  garmin: () => ({
    clientId: process.env.GARMIN_CLIENT_ID ?? "",
    clientSecret: process.env.GARMIN_CLIENT_SECRET ?? "",
    webhookToken: process.env.GARMIN_WEBHOOK_TOKEN ?? "",
  }),
  /** Wahoo app credentials: environment first, then the app registered in the UI (self-hosted). */
  wahoo: (): { clientId: string; clientSecret: string; webhookToken: string; source: "env" | "ui" | null } => {
    const webhookToken = process.env.WAHOO_WEBHOOK_TOKEN ?? "";
    const clientId = process.env.WAHOO_CLIENT_ID ?? "";
    const clientSecret = process.env.WAHOO_CLIENT_SECRET ?? "";
    if (clientId && clientSecret) return { clientId, clientSecret, webhookToken, source: "env" };
    const stored = storedApp("wahoo");
    if (stored) return { ...stored, webhookToken, source: "ui" };
    return { clientId: "", clientSecret: "", webhookToken, source: null };
  },
  cronSecret: () => process.env.CRON_SECRET ?? "",
};
