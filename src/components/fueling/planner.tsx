"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { INTENSITY_PRESETS, planFueling, TEMP_CLASSES, TEMP_LABEL, type FuelProduct, type FuelProfile, type FuelSport, type SessionFlags, type TempClass } from "@/lib/nutrition";
import { FuelPlanView } from "./fuel-plan";
import { SPORT_OPTIONS } from "./shared";

type Intensity = (typeof INTENSITY_PRESETS)[number]["value"];

/** Conditions the plan cannot know: temperature, race, key session, train low. */
export function ConditionsFields({
  tempClass,
  onTemp,
  flags,
  onFlags,
}: {
  tempClass: TempClass;
  onTemp: (t: TempClass) => void;
  flags: SessionFlags;
  onFlags: (f: SessionFlags) => void;
}) {
  const toggles: { key: keyof SessionFlags; label: string; hint: string }[] = [
    { key: "key", label: "Schlüsseleinheit", hint: "Leistung zählt, nicht nur Umfang" },
    { key: "race", label: "Wettkampf", hint: "Oberes Ende der Empfehlungen, Carb-Loading" },
    { key: "fasted", label: "Nüchtern (Train low)", hint: "Bewusst ohne Kohlenhydrate" },
  ];
  return (
    <>
      <Field label="Temperatur" htmlFor="fuel-temp">
        <Select id="fuel-temp" value={tempClass} onChange={(e) => onTemp(e.target.value as TempClass)}>
          {TEMP_CLASSES.map((t) => (
            <option key={t} value={t}>
              {TEMP_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="space-y-3">
        {toggles.map((t) => (
          <label key={t.key} className="flex items-center justify-between gap-3 text-[14px] text-ink">
            <span>
              {t.label}
              <span className="block text-[12px] text-ink-3">{t.hint}</span>
            </span>
            <Switch
              checked={!!flags[t.key]}
              label={t.label}
              onChange={(on) => {
                const next = { ...flags, [t.key]: on };
                // A race is never trained fasted, and vice versa.
                if (on && t.key === "race") next.fasted = false;
                if (on && t.key === "fasted") next.race = false;
                onFlags(next);
              }}
            />
          </label>
        ))}
      </div>
    </>
  );
}

/** Free planner for sessions without a structured workout (a race, a group ride). */
export function Planner({ profile, pantry }: { profile: FuelProfile; pantry: FuelProduct[] }) {
  const [sport, setSport] = useState<FuelSport>("ride");
  const [hours, setHours] = useState("2");
  const [minutes, setMinutes] = useState("30");
  const [intensity, setIntensity] = useState<Intensity>("moderate");
  const [tempClass, setTempClass] = useState<TempClass>("mild");
  const [flags, setFlags] = useState<SessionFlags>({});
  const [nextIn, setNextIn] = useState("");

  const durationSec = (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60;
  const plan = useMemo(() => {
    const preset = INTENSITY_PRESETS.find((p) => p.value === intensity)!;
    return planFueling(
      {
        sport,
        durationSec,
        intensityFactor: preset.intensityFactor,
        tempClass,
        flags: { ...flags, race: flags.race || intensity === "race" },
        hoursToNextSession: nextIn ? Number(nextIn) : null,
      },
      profile,
      pantry,
    );
  }, [sport, durationSec, intensity, tempClass, flags, nextIn, profile, pantry]);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="self-start">
        <CardHeader title="Einheit" description="Für alles ohne Workout im Kalender" />
        <div className="space-y-4 p-5">
          <Field label="Sportart">
            <Segmented size="sm" className="w-full" label="Sportart" value={sport} onChange={setSport} options={SPORT_OPTIONS} />
          </Field>
          <Field label="Dauer">
            <div className="flex items-center gap-1.5">
              <Input aria-label="Stunden" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} className="w-16 text-right tabular" />
              <span className="text-[13px] text-ink-3">h</span>
              <Input aria-label="Minuten" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-16 text-right tabular" />
              <span className="text-[13px] text-ink-3">min</span>
            </div>
          </Field>
          <Field label="Intensität">
            <Segmented size="sm" className="w-full" label="Intensität" value={intensity} onChange={setIntensity} options={INTENSITY_PRESETS.map((p) => ({ value: p.value, label: p.label }))} />
          </Field>
          <ConditionsFields tempClass={tempClass} onTemp={setTempClass} flags={flags} onFlags={setFlags} />
          <Field label="Nächste Einheit in" htmlFor="fuel-next" hint="Unter 8 h: schnelle Regeneration nötig">
            <Select id="fuel-next" value={nextIn} onChange={(e) => setNextIn(e.target.value)}>
              <option value="">Morgen oder später</option>
              <option value="4">etwa 4 h</option>
              <option value="6">etwa 6 h</option>
              <option value="12">etwa 12 h</option>
            </Select>
          </Field>
        </div>
      </Card>
      <FuelPlanView plan={plan} />
    </div>
  );
}
