"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { contactMessages } from "@/db/schema";
import { newId } from "@/lib/id";
import { getCurrentUser, isInstallationOwner, requireUser } from "@/lib/server/auth";
import { rateLimit } from "@/lib/server/rate-limit";
import type { ActionResult } from "./workouts";

export type ContactState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; values?: { name: string; email: string; message: string } } | undefined;

const contact = z.object({
  name: z.string().trim().min(1, "Bitte gib deinen Namen an.").max(100, "Höchstens 100 Zeichen."),
  email: z.email("Bitte gib eine gültige E-Mail-Adresse ein.").max(200).transform((e) => e.toLowerCase().trim()),
  message: z.string().trim().min(10, "Bitte schreib mindestens 10 Zeichen.").max(5000, "Höchstens 5000 Zeichen."),
});

export async function sendContactMessage(_: ContactState, form: FormData): Promise<ContactState> {
  // Honeypot: real users never see or fill this field. Pretend success for bots.
  if (form.get("website")) return { ok: true };

  const str = (k: string) => String(form.get(k) ?? "").slice(0, 5000);
  // Sent back so the form keeps what was typed (React resets it after the action).
  const values = { name: str("name"), email: str("email"), message: str("message") };
  const parsed = contact.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors, values };
  }

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limit = rateLimit(`contact:${ip}`, 5, 60 * 60_000);
  if (!limit.ok) return { error: `Zu viele Nachrichten. Bitte in ${Math.ceil(limit.retryAfterSec / 60)} Minuten erneut probieren.`, values };

  const user = await getCurrentUser();
  getDb()
    .insert(contactMessages)
    .values({ id: newId(), ...parsed.data, userId: user && !user.isDemo ? user.id : null })
    .run();
  revalidatePath("/settings");
  return { ok: true };
}

const messageId = z.string().min(1).max(40);

async function requireOwner() {
  const user = await requireUser();
  if (!isInstallationOwner(user)) throw new Error("Nicht erlaubt.");
  return user;
}

export async function setContactMessageRead(id: string, read: boolean): Promise<ActionResult> {
  await requireOwner();
  if (!messageId.safeParse(id).success) return { ok: false, error: "Ungültige Nachricht." };
  getDb()
    .update(contactMessages)
    .set({ readAt: read ? new Date() : null })
    .where(eq(contactMessages.id, id))
    .run();
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteContactMessage(id: string): Promise<ActionResult> {
  await requireOwner();
  if (!messageId.safeParse(id).success) return { ok: false, error: "Ungültige Nachricht." };
  getDb().delete(contactMessages).where(eq(contactMessages.id, id)).run();
  revalidatePath("/", "layout");
  return { ok: true };
}

