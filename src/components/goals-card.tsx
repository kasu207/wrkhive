"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateGoals } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { GOAL_IDS, GOALS, MAX_GOALS, type GoalId } from "@/lib/goals";

export function GoalsCard({ initial, initialNote }: { initial: GoalId[]; initialNote: string }) {
  const router = useRouter();
  const toast = useToast();
  const [goals, setGoals] = useState<GoalId[]>(initial);
  const [note, setNote] = useState(initialNote);
  const [pending, start] = useTransition();
  const dirty = goals.join() !== initial.join() || note.trim() !== initialNote;

  const toggle = (g: GoalId) =>
    setGoals((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : cur.length >= MAX_GOALS ? cur : [...cur, g]));

  const save = () =>
    start(async () => {
      const r = await updateGoals({ goals, note });
      if (!r.ok) {
        toast({ tone: "error", title: "Speichern fehlgeschlagen", description: r.error });
        return;
      }
      toast({ tone: "success", title: "Ziele gespeichert", description: r.message });
      router.refresh();
    });

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold">Deine Ziele</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
        Wähle bis zu {MAX_GOALS} Ziele. Das zuerst gewählte ist dein Hauptziel: Danach richten sich Schwerpunkte und Länge der vorgeschlagenen Workouts, der Anteil an Krafttraining und die Intensität neuer Trainingspläne.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {GOAL_IDS.map((g) => {
          const index = goals.indexOf(g);
          const on = index >= 0;
          const full = !on && goals.length >= MAX_GOALS;
          return (
            <button
              key={g}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={full}
              onClick={() => toggle(g)}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50",
                on ? "border-ink bg-surface-2" : "border-border hover:border-border-strong hover:bg-surface-2/50",
              )}
            >
              <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-semibold", on ? "border-ink bg-ink text-white" : "border-border-strong")}>
                {on ? index === 0 ? <Check className="size-3" /> : index + 1 : null}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-ink">
                  {GOALS[g].label}
                  {index === 0 ? <span className="ml-1.5 text-[12px] font-normal text-ink-3">Hauptziel</span> : null}
                </span>
                <span className="block text-[12px] leading-snug text-ink-3">{GOALS[g].description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <Field label="In eigenen Worten (optional)" htmlFor="goal-note" hint="Geht an den Coach, z. B. „Halbmarathon unter 1:45“ oder „10 Klimmzüge“." className="mt-4">
        <Input id="goal-note" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end">
        <Button onClick={save} loading={pending} disabled={!dirty}>
          Ziele speichern
        </Button>
      </div>
    </Card>
  );
}
