"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setBaselineHours } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { UnitInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

/** Inline form for the weekly training volume before Wrkhive (seeds fitness). */
export function BaselineForm() {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const hours = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(hours) && hours >= 0 && hours <= 40;

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        start(async () => {
          const r = await setBaselineHours(hours);
          if (!r.ok) return toast({ tone: "error", title: "Fehler", description: r.error });
          toast({ tone: "success", title: "Startwert gespeichert", description: r.message });
          router.refresh();
        });
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-[12px] font-medium text-ink-2">Training pro Woche vor Wrkhive</span>
        <UnitInput unit="h" inputMode="decimal" placeholder="z. B. 6" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Trainingsstunden pro Woche vor Wrkhive" />
      </label>
      <Button type="submit" variant="secondary" loading={pending} disabled={!valid}>
        Übernehmen
      </Button>
    </form>
  );
}
