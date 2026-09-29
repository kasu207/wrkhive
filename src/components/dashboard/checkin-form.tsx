"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { submitCheckin } from "@/app/actions/dashboard";
import { Button } from "@/components/ui/button";
import { UnitInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

type Feelings = { legs: number | null; sleepFeel: number | null; motivation: number | null };

const QUESTIONS: { key: keyof Feelings; label: string; low: string; high: string }[] = [
  { key: "legs", label: "Beine", low: "schwer", high: "frisch" },
  { key: "sleepFeel", label: "Schlaf", low: "schlecht", high: "erholsam" },
  { key: "motivation", label: "Motivation", low: "keine", high: "hoch" },
];

const num = (v: string) => {
  const n = Number(v.replace(",", "."));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

/**
 * Three taps in the morning, for athletes with and without a wearable.
 * Measured values are optional and meant for athletes whose device does not
 * sync (e.g. an HRV app on the phone).
 */
export function CheckinForm({ date, initial }: { date: string; initial: Feelings }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [f, setF] = useState<Feelings>(initial);
  const [open, setOpen] = useState(false);
  const [m, setM] = useState({ restingHr: "", hrv: "", sleepHours: "", weightKg: "" });
  const saved = initial.legs !== null || initial.sleepFeel !== null || initial.motivation !== null;
  const changed = f.legs !== initial.legs || f.sleepFeel !== initial.sleepFeel || f.motivation !== initial.motivation || Object.values(m).some((v) => v.trim() !== "");

  const submit = () =>
    start(async () => {
      const r = await submitCheckin({ date, ...f, restingHr: num(m.restingHr), hrv: num(m.hrv), sleepHours: num(m.sleepHours), weightKg: num(m.weightKg) });
      if (!r.ok) return toast({ tone: "error", title: "Nicht gespeichert", description: r.error });
      toast({ tone: "success", title: "Check-in gespeichert" });
      setM({ restingHr: "", hrv: "", sleepHours: "", weightKg: "" });
      setOpen(false);
      router.refresh();
    });

  return (
    <div className="px-5 pb-5 pt-3">
      <div className="space-y-3">
        {QUESTIONS.map((q) => (
          <div key={q.key} className="grid grid-cols-[84px_1fr] items-center gap-3">
            <span className="text-[13px] font-medium">{q.label}</span>
            <div>
              <div role="radiogroup" aria-label={q.label} className="grid grid-cols-5 gap-1">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={f[q.key] === v}
                    aria-label={`${q.label} ${v} von 5`}
                    onClick={() => setF((s) => ({ ...s, [q.key]: s[q.key] === v ? null : v }))}
                    className={cn(
                      "h-8 rounded-lg border text-[13px] font-medium tabular transition-colors",
                      f[q.key] === v ? "border-ink bg-ink text-white" : "border-border bg-surface text-ink-2 hover:border-border-strong hover:bg-surface-2",
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="mt-0.5 flex justify-between text-[11px] text-ink-3">
                <span>{q.low}</span>
                <span>{q.high}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
        Messwerte eintragen <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[12px] text-ink-3">
            Ruhepuls
            <UnitInput className="mt-1" unit="bpm" inputMode="numeric" value={m.restingHr} onChange={(e) => setM((s) => ({ ...s, restingHr: e.target.value }))} />
          </label>
          <label className="text-[12px] text-ink-3">
            HRV (rMSSD)
            <UnitInput className="mt-1" unit="ms" inputMode="decimal" value={m.hrv} onChange={(e) => setM((s) => ({ ...s, hrv: e.target.value }))} />
          </label>
          <label className="text-[12px] text-ink-3">
            Schlaf
            <UnitInput className="mt-1" unit="h" inputMode="decimal" value={m.sleepHours} onChange={(e) => setM((s) => ({ ...s, sleepHours: e.target.value }))} />
          </label>
          <label className="text-[12px] text-ink-3">
            Gewicht
            <UnitInput className="mt-1" unit="kg" inputMode="decimal" value={m.weightKg} onChange={(e) => setM((s) => ({ ...s, weightKg: e.target.value }))} />
          </label>
          <p className="col-span-2 text-[11px] leading-relaxed text-ink-3">Nur ausfüllen, was dein Gerät nicht ohnehin überträgt. Leere Felder bleiben unverändert.</p>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[12px] text-ink-3">{saved ? "Heute bereits eingetragen, änderbar bis morgen." : "1 = schlecht, 5 = sehr gut"}</span>
        <Button size="sm" onClick={submit} loading={pending} disabled={!changed}>
          Speichern
        </Button>
      </div>
    </div>
  );
}
