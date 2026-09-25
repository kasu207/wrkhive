"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setAutoAdapt } from "@/app/actions/adapt";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

export function AutoAdaptCard({ initial }: { initial: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">Workouts an Belastung anpassen</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
            Wrkhive bewertet jeden Morgen deine Form im Verhältnis zur Fitness. Bist du stark ermüdet, wird das harte Workout des Tages kürzer und etwas leichter, bei sehr hoher Ermüdung durch eine lockere Einheit ersetzt. Bereits an ein Gerät gesendete Workouts werden nie automatisch geändert, dafür gibt es einen Vorschlag auf der Übersicht. Das Original lässt sich jederzeit wiederherstellen.
          </p>
        </div>
        <Switch
          checked={on}
          label="Automatisch anpassen"
          disabled={pending}
          onChange={(v) => {
            setOn(v);
            start(async () => {
              const r = await setAutoAdapt(v);
              if (!r.ok) {
                setOn(!v);
                toast({ tone: "error", title: "Fehler", description: r.error });
                return;
              }
              toast({ tone: "success", title: v ? "Automatische Anpassung an" : "Automatische Anpassung aus", description: v ? undefined : "Du bekommst weiterhin Vorschläge auf der Übersicht." });
              router.refresh();
            });
          }}
        />
      </div>
    </Card>
  );
}
