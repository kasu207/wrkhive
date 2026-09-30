"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateFuelSettings } from "@/app/actions/nutrition";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, UnitInput } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { SweatSodium } from "@/lib/nutrition";

export interface FuelSettingsValues {
  maxCarb: number;
  sweatSodium: SweatSodium;
  caffeine: boolean;
  preferNatural: boolean;
}

export function FuelSettingsCard({ initial, weightKg, weightKnown }: { initial: FuelSettingsValues; weightKg: number; weightKnown: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [maxCarb, setMaxCarb] = useState(String(initial.maxCarb));
  const [sweatSodium, setSweatSodium] = useState(initial.sweatSodium);
  const [caffeine, setCaffeine] = useState(initial.caffeine);
  const [preferNatural, setPreferNatural] = useState(initial.preferNatural);
  const dirty = maxCarb !== String(initial.maxCarb) || sweatSodium !== initial.sweatSodium || caffeine !== initial.caffeine || preferNatural !== initial.preferNatural;

  return (
    <Card>
      <CardHeader title="Deine Werte" description={weightKnown ? `Gewicht ${String(weightKg).replace(".", ",")} kg aus Profil oder Check-in` : "Ohne Gewicht rechnen wir mit 70 kg. Trag es in den Einstellungen ein."} />
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await updateFuelSettings({ maxCarb: Number(maxCarb) || 0, sweatSodium, caffeine, preferNatural });
            if (r.ok) {
              toast({ tone: "success", title: "Gespeichert", description: r.message });
              router.refresh();
            } else toast({ tone: "error", title: "Nicht gespeichert", description: r.error });
          });
        }}
      >
        <Field label="Verträglichkeit" htmlFor="maxCarb" hint="Wie viel Kohlenhydrate pro Stunde dein Magen verträgt. Unsicher? 60 g/h. Mit Darmtraining bis 90–120 g/h.">
          <UnitInput id="maxCarb" unit="g/h" inputMode="numeric" value={maxCarb} onChange={(e) => setMaxCarb(e.target.value)} />
        </Field>
        <Field label="Salziger Schweiß" hint="Weiße Ränder auf Kleidung oder Helmriemen, brennende Augen: eher hoch.">
          <Segmented
            size="sm"
            className="w-full"
            label="Salziger Schweiß"
            value={sweatSodium}
            onChange={setSweatSodium}
            options={[
              { value: "low", label: "Wenig" },
              { value: "average", label: "Normal" },
              { value: "high", label: "Viel" },
            ]}
          />
        </Field>
        <label className="flex items-center justify-between gap-3 text-[14px] text-ink">
          <span>
            Koffein nutzen
            <span className="block text-[12px] text-ink-3">Nur bei Schlüsseleinheiten und Wettkämpfen, 3 mg/kg</span>
          </span>
          <Switch checked={caffeine} onChange={setCaffeine} label="Koffein nutzen" />
        </label>
        <label className="flex items-center justify-between gap-3 text-[14px] text-ink">
          <span>
            Natürliche Lebensmittel bevorzugen
            <span className="block text-[12px] text-ink-3">Datteln, Bananen, Reiskuchen vor Gels</span>
          </span>
          <Switch checked={preferNatural} onChange={setPreferNatural} label="Natürliche Lebensmittel bevorzugen" />
        </label>
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={pending} disabled={!dirty}>
            Speichern
          </Button>
        </div>
      </form>
    </Card>
  );
}
