import "server-only";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "wh_session";
const SESSION_DAYS = 30;

export async function createSession(userId: string): Promise<void> {
  const db = getDb();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.insert(sessions).values({ id: sha256(token), userId, expiresAt }).run();
  // Opportunistic cleanup of expired sessions.
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) getDb().delete(sessions).where(eq(sessions.id, sha256(token))).run();
  jar.delete(SESSION_COOKIE);
}

/** Current user or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const row = db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .get();
  return row?.user ?? null;
});

/** For pages and server actions: redirects to /login when signed out. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export class UnauthorizedError extends Error {}

/** For route handlers: throws instead of redirecting. */
export async function requireApiUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export function thresholdsOf(user: Pick<User, "ftp" | "lthr" | "maxHr" | "thresholdPace">) {
  return { ftp: user.ftp, lthr: user.lthr, maxHr: user.maxHr, thresholdPace: user.thresholdPace };
}
