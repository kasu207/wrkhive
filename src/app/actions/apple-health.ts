"use server";

import { revalidatePath } from "next/cache";
import { rotateAppleHealthKey, revokeAppleHealthKey } from "@/lib/server/apple-health";
import { requireUser } from "@/lib/server/auth";
import type { ActionResult } from "./workouts";

/** Creates the key for the Health Auto Export webhook; an existing key stops working. */
export async function createAppleHealthKey(): Promise<ActionResult<{ key: string }>> {
  const user = await requireUser();
  if (user.isDemo) return { ok: false, error: "Im Demo-Konto nicht verfügbar." };
  const key = rotateAppleHealthKey(user.id);
  revalidatePath("/devices");
  return { ok: true, data: { key } };
}

/** Disables the webhook. Imported activities stay. */
export async function removeAppleHealthKey(): Promise<ActionResult> {
  const user = await requireUser();
  revokeAppleHealthKey(user.id);
  revalidatePath("/devices");
  return { ok: true };
}
