"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, UnitInput } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { EXERCISE_GROUPS, EXERCISES, getExercise } from "@/lib/workout/exercises";

export interface ExerciseChoice {
  key: string;
  sets: number;
  reps: number;
  weightKg?: number;
  restSeconds: number;
}

export function ExercisePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: ExerciseChoice) => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sets, setSets] = useState("3");
  const [reps, setReps] = useState("10");
  const [weight, setWeight] = useState("");
  const [rest, setRest] = useState("90");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? EXERCISES.filter((e) => e.label.toLowerCase().includes(q) || e.group.toLowerCase().includes(q)) : EXERCISES;
  }, [query]);
  const ex = selected ? getExercise(selected) : undefined;

  const reset = () => {
    setSelected(null);
    setQuery("");
  };
  const submit = () => {
    if (!ex) return;
    const s = Math.min(20, Math.max(1, Number(sets) || 3));
    const r = Math.min(100, Math.max(1, Number(reps) || 10));
    const w = Number(weight.replace(",", "."));
    onPick({ key: ex.key, sets: s, reps: r, weightKg: ex.weighted && w > 0 ? w : undefined, restSeconds: Math.min(600, Math.max(0, Number(rest) || 0)) });
    reset();
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={ex ? ex.label : "Übung hinzufügen"}
      description={ex ? `${ex.group} · wird auf Garmin-Uhren mit Animation und Wiederholungszählung angezeigt` : "Alle Übungen sind mit Garmin-Geräten kompatibel."}
      footer={
        ex ? (
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Zurück
            </Button>
            <Button onClick={submit}>Hinzufügen</Button>
          </>
        ) : null
      }
    >
      {ex ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Sätze" htmlFor="ex-sets">
            <Input id="ex-sets" inputMode="numeric" value={sets} onChange={(e) => setSets(e.target.value)} />
          </Field>
          <Field label="Wiederholungen" htmlFor="ex-reps">
            <Input id="ex-reps" inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
          </Field>
          <Field label="Gewicht" htmlFor="ex-weight" hint={ex.weighted ? undefined : "Körpergewicht"}>
            <UnitInput id="ex-weight" unit="kg" inputMode="decimal" disabled={!ex.weighted} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="–" />
          </Field>
          <Field label="Pause" htmlFor="ex-rest">
            <UnitInput id="ex-rest" unit="s" inputMode="numeric" value={rest} onChange={(e) => setRest(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div>
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input autoFocus placeholder="Übung suchen, z. B. Kniebeuge" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
          </div>
          <div className="space-y-5">
            {EXERCISE_GROUPS.map((g) => {
              const items = filtered.filter((e) => e.group === g);
              if (!items.length) return null;
              return (
                <section key={g}>
                  <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{g}</h3>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {items.map((e) => (
                      <button
                        key={e.key}
                        type="button"
                        onClick={() => setSelected(e.key)}
                        className={cn("flex items-center justify-between rounded-xl border border-border px-3 py-2.5 text-left text-sm transition-colors hover:border-border-strong hover:bg-surface-2")}
                      >
                        <span className="font-medium text-ink">{e.label}</span>
                        <span className="text-[12px] text-ink-3">{e.weighted ? "mit Gewicht" : "Körpergewicht"}</span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            {!filtered.length ? <p className="py-8 text-center text-sm text-ink-3">Keine Übung gefunden.</p> : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}
