"use client";

import { Sparkles, X } from "lucide-react";
import { useState, useTransition } from "react";
import { generateBuilderWorkout } from "@/app/actions/coach";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, UnitInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { Focus } from "@/lib/coach/generator";
import type { Sport, WorkoutStructure } from "@/lib/workout/types";

type FocusChoice = Focus | "auto";

const FOCUS_OPTIONS: Record<"endurance" | "strength", { value: FocusChoice; label: string }[]> = {
  endurance: [
    { value: "auto", label: "Passend zur Form" },
    { value: "recovery", label: "Regeneration" },
    { value: "endurance", label: "Grundlage" },
    { value: "tempo", label: "Tempo" },
    { value: "threshold", label: "Schwelle" },
    { value: "vo2", label: "VO2max" },
    { value: "anaerobic", label: "Sprints" },
  ],
  strength: [
    { value: "auto", label: "Automatisch" },
    { value: "strength-full", label: "Ganzkörper" },
    { value: "strength-legs", label: "Beine" },
    { value: "strength-upper", label: "Oberkörper" },
  ],
};

export interface GeneratedDraft {
  name: string;
  description: string;
  structure: WorkoutStructure;
}

/** Generates a workout (AI coach or rule engine) straight into the builder. */
export function GeneratePanel({ sport, engine, onGenerated }: { sport: Sport; engine: "ai" | "rules"; onGenerated: (d: GeneratedDraft) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const [focus, setFocus] = useState<FocusChoice>("auto");
  const [minutes, setMinutes] = useState("60");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = FOCUS_OPTIONS[sport === "strength" ? "strength" : "endurance"];
  const focusValue = options.some((o) => o.value === focus) ? focus : "auto";

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="mb-5" onClick={() => setOpen(true)}>
        <Sparkles />
        Automatisch erzeugen
      </Button>
    );
  }

  const generate = () =>
    startTransition(async () => {
      const m = Math.round(Number(minutes));
      if (!Number.isFinite(m) || m < 20 || m > 360) {
        toast({ tone: "error", title: "Ungültige Dauer", description: "Wähle zwischen 20 und 360 Minuten." });
        return;
      }
      const res = await generateBuilderWorkout({ sport, focus: focusValue, minutes: m, note });
      if (!res.ok) {
        toast({ tone: "error", title: "Erzeugen fehlgeschlagen", description: res.error });
        return;
      }
      const d = res.data!;
      onGenerated({ name: d.name, description: d.description, structure: d.structure });
      setReason(d.reason.replace(/\*\*/g, "") || null);
      toast({ tone: "success", title: "Workout erzeugt", description: "Du kannst es jetzt anpassen und speichern." });
    });

  return (
    <div className="mb-6 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Sparkles className="size-4" />
            Automatisch erzeugen
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {engine === "ai" ? "Der Coach erstellt ein Workout passend zu deiner aktuellen Form." : "Erstellt ein Workout aus den Trainingsregeln, abgestimmt auf deine aktuelle Form."} Das
            Ergebnis ersetzt den aktuellen Ablauf und lässt sich rückgängig machen.
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Ausblenden" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_140px] lg:grid-cols-[200px_140px_1fr_auto] lg:items-end">
        <Field label="Schwerpunkt" htmlFor="gen-focus">
          <Select id="gen-focus" value={focusValue} onChange={(e) => setFocus(e.target.value as FocusChoice)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dauer" htmlFor="gen-minutes">
          <UnitInput id="gen-minutes" unit="min" type="number" inputMode="numeric" min={20} max={360} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
        <Field label="Wunsch (optional)" htmlFor="gen-note" className="sm:col-span-2 lg:col-span-1">
          <Input
            id="gen-note"
            value={note}
            maxLength={300}
            placeholder={sport === "strength" ? "z. B. nur Kurzhanteln" : "z. B. mit Kadenzwechseln"}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !pending) generate();
            }}
          />
        </Field>
        <Button variant="primary" onClick={generate} loading={pending} className="sm:col-span-2 lg:col-span-1">
          <Sparkles />
          Erzeugen
        </Button>
      </div>
      {reason ? <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{reason}</p> : null}
    </div>
  );
}
