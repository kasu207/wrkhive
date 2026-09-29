"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyThreshold } from "@/app/actions/dashboard";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ThresholdSuggestion } from "@/lib/analytics/threshold-check";

/** Suggested thresholds with a one-click takeover (loads are recomputed on the server). */
export function ThresholdSuggestions({ suggestions }: { suggestions: ThresholdSuggestion[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const apply = (s: ThresholdSuggestion) => {
    setBusy(s.field);
    start(async () => {
      const r = await applyThreshold({ field: s.field, value: s.suggested });
      setBusy(null);
      if (!r.ok) return toast({ tone: "error", title: "Nicht übernommen", description: r.error });
      toast({ tone: "success", title: `${s.label} aktualisiert`, description: r.message });
      router.refresh();
    });
  };

  return (
    <ul className="space-y-2.5">
      {suggestions.map((s) => (
        <li key={s.field} className="rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[14px]">
              <span className="font-semibold">{s.label}</span>
              <span className="text-ink-3 tabular">{s.current}</span>
              <ArrowRight className="size-3.5 text-ink-3" />
              <span className="font-semibold tabular">
                {s.suggested} {s.unit}
              </span>
            </div>
            <Button size="sm" variant="secondary" onClick={() => apply(s)} loading={pending && busy === s.field} disabled={pending}>
              Übernehmen
            </Button>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{s.reason}</p>
        </li>
      ))}
    </ul>
  );
}
