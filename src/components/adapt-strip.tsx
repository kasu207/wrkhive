"use client";

import { RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adaptToday, restoreOriginal } from "@/app/actions/adapt";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Shown under today's planned workout: either a suggestion to adapt it to the
 * current load, or the note of an adaptation with a way back to the original.
 */
export function AdaptStrip({ scheduledId, workoutId, state, note, reason }: { scheduledId: string; workoutId: string; state: "suggest" | "adapted"; note: string; reason: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [resend, setResend] = useState<{ to: string[]; workoutId: string } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; data?: unknown }>, title: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast({ tone: "error", title: "Nicht möglich", description: r.error });
        return;
      }
      toast({ tone: "success", title, description: r.message });
      const data = r.data as { workoutId: string; resendTo: string[] } | undefined;
      setResend(data?.resendTo.length ? { to: data.resendTo, workoutId: data.workoutId } : null);
      router.refresh();
    });

  return (
    <div className="mt-2.5 rounded-xl border border-border bg-surface-2/60 px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-ink" />
        <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
          <p className="font-medium text-ink">{state === "adapted" ? "An deine Belastung angepasst" : `Vorschlag: ${reason}`}</p>
          <p className="text-ink-2">{note}</p>
          {resend ? (
            <p className="mt-1 text-ink-2">
              Bereits an {resend.to.join(" und ")} gesendet.{" "}
              <Link href={`/workouts/${resend.workoutId}?send=1`} className="font-medium text-focus hover:underline">
                Neue Version senden
              </Link>
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex justify-end gap-2">
        {state === "adapted" ? (
          <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => restoreOriginal(scheduledId), "Original wiederhergestellt")}>
            <RotateCcw /> Original fahren
          </Button>
        ) : (
          <>
            <Link href={`/workouts/${workoutId}`} className="inline-flex h-8 items-center px-2 text-[13px] font-medium text-ink-2 hover:text-ink">
              Wie geplant
            </Link>
            <Button size="sm" loading={pending} onClick={() => run(() => adaptToday(scheduledId), "Workout angepasst")}>
              Anpassen
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
