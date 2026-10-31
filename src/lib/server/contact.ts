import "server-only";
import { count, desc, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { contactMessages, type User } from "@/db/schema";
import { isInstallationOwner } from "./auth";

/** Unread contact messages for the owner's navigation badge (0 for everyone else). */
export function unreadContactCount(user: Pick<User, "id" | "isDemo">): number {
  if (!isInstallationOwner(user)) return 0;
  return getDb().select({ n: count() }).from(contactMessages).where(isNull(contactMessages.readAt)).get()?.n ?? 0;
}

export function listContactMessages() {
  return getDb().select().from(contactMessages).orderBy(desc(contactMessages.createdAt)).limit(200).all();
}
