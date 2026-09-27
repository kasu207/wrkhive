import "server-only";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

/**
 * Who may create accounts (SIGNUP_MODE):
 *  - open:   everyone (default, for local installs)
 *  - first:  only the first account; afterwards registration is closed
 *            (recommended for a personal server on the internet)
 *  - closed: nobody
 */
export function signupMode(): "open" | "first" | "closed" {
  const v = (process.env.SIGNUP_MODE ?? "open").trim().toLowerCase();
  return v === "first" || v === "closed" ? v : "open";
}

export function registrationOpen(): boolean {
  const mode = signupMode();
  if (mode === "open") return true;
  if (mode === "closed") return false;
  const n = getDb().select({ n: count() }).from(users).where(eq(users.isDemo, false)).get()?.n ?? 0;
  return n === 0;
}

/** Demo accounts with sample data (DEMO_ENABLED, default true). */
export function demoEnabled(): boolean {
  return !["false", "0", "no", "off"].includes((process.env.DEMO_ENABLED ?? "true").trim().toLowerCase());
}
