"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteSweatTest, saveSweatTest } from "@/app/actions/nutrition";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, UnitInput } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { displayDate } from "@/lib/dates";
import { formatDate, formatNumber } from "@/lib/format";
import { sweatRate, TEMP_LABEL, tempClassOf, type FuelSport, type TempClass } from "@/lib/nutrition";
import { SPORT_LABEL } from "@/lib/workout/types";
import { num, SPORT_OPTIONS, type RecentActivity } from "./shared";

export interface SweatTestRow {
  id: string;
  date: string;
  sport: FuelSport;
  durationSec: number;
  tempC: number;
  tempClass: TempClass;
  rateLh: number;
  preKg: number;
  postKg: number;
  fluidMl: number;
}

const STEPS = [
  "Vor der Einheit auf die Toilette, dann nackt wiegen.",
  "Mindestens 60 min trainieren, möglichst gleichmäßig. Trinkflaschen vorher und nachher wiegen (1 g = 1 ml).",
  "Danach abtrocknen und wieder nackt wiegen, bevor du etwas trinkst.",
  "Mehrere Tests bei unterschiedlichen Temperaturen machen die Pläne genauer.",
];

export function SweatPanel({ tests, activities, today, preselect }: { tests: SweatTestRow[]; activities: RecentActivity[]; today: string; preselect?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const initialActivity = activities.find((a) => a.id === preselect && a.sport !== "other");
  const [activityId, setActivityId] = useState(initialActivity?.id ?? "");
  const [v, setV] = useState({
    date: initialActivity?.date ?? today,
    sport: (initialActivity && initialActivity.sport !== "other" ? initialActivity.sport : "ride") as FuelSport,
    durationMin: initialActivity ? String(Math.round(initialActivity.durationSec / 60)) : "60",
    tempC: "18",
    preKg: "",
    postKg: "",
    fluidMl: "0",
    urineMl: "0",
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const preview = useMemo(
    () => (v.preKg && v.postKg ? sweatRate({ preKg: num(v.preKg), postKg: num(v.postKg), fluidMl: num(v.fluidMl), urineMl: num(v.urineMl), durationSec: num(v.durationMin) * 60 }) : null),
    [v],
  );

  const pick = (id: string) => {
    setActivityId(id);
    const a = activities.find((x) => x.id === id);
    if (a && a.sport !== "other") setV((s) => ({ ...s, date: a.date, sport: a.sport as FuelSport, durationMin: String(Math.round(a.durationSec / 60)) }));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader title="Schweißtest" description="Die genaueste Grundlage für deinen Trinkplan, ganz ohne Labor." />
        <ol className="mx-5 mt-4 list-decimal space-y-1 rounded-xl bg-surface-2/70 py-3 pl-9 pr-4 text-[13px] leading-snug text-ink-2">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <form
          className="grid gap-4 p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveSweatTest({
                date: v.date,
                sport: v.sport,
                durationMin: Math.round(num(v.durationMin)),
                tempC: num(v.tempC),
                preKg: num(v.preKg),
                postKg: num(v.postKg),
                fluidMl: Math.round(num(v.fluidMl)),
                urineMl: Math.round(num(v.urineMl)),
                activityId: activityId || null,
              });
              if (r.ok) {
                toast({ tone: "success", title: "Gespeichert", description: r.message });
                setV((s) => ({ ...s, preKg: "", postKg: "", fluidMl: "0", urineMl: "0" }));
                router.refresh();
              } else toast({ tone: "error", title: "Nicht gespeichert", description: r.error });
            });
          }}
        >
          {activities.length ? (
            <Field label="Einheit (optional)" htmlFor="st-activity" className="sm:col-span-2">
              <Select id="st-activity" value={activityId} onChange={(e) => pick(e.target.value)}>
                <option value="">Ohne Verknüpfung</option>
                {activities
                  .filter((a) => a.sport !== "other")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatDate(displayDate(a.date))} · {a.name} · {Math.round(a.durationSec / 60)} min
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Sportart" className="sm:col-span-2">
            <Segmented size="sm" label="Sportart" value={v.sport} onChange={(sport) => setV((s) => ({ ...s, sport }))} options={SPORT_OPTIONS} />
          </Field>
          <Field label="Datum" htmlFor="st-date">
            <Input id="st-date" type="date" value={v.date} max={today} onChange={set("date")} required />
          </Field>
          <Field label="Dauer" htmlFor="st-dur">
            <UnitInput id="st-dur" unit="min" inputMode="numeric" value={v.durationMin} onChange={set("durationMin")} />
          </Field>
          <Field label="Temperatur" htmlFor="st-temp" hint={TEMP_LABEL[tempClassOf(num(v.tempC))]}>
            <UnitInput id="st-temp" unit="°C" inputMode="decimal" value={v.tempC} onChange={set("tempC")} />
          </Field>
          <Field label="Getrunken" htmlFor="st-fluid">
            <UnitInput id="st-fluid" unit="ml" inputMode="numeric" value={v.fluidMl} onChange={set("fluidMl")} />
          </Field>
          <Field label="Gewicht vorher" htmlFor="st-pre">
            <UnitInput id="st-pre" unit="kg" inputMode="decimal" value={v.preKg} onChange={set("preKg")} required />
          </Field>
          <Field label="Gewicht nachher" htmlFor="st-post">
            <UnitInput id="st-post" unit="kg" inputMode="decimal" value={v.postKg} onChange={set("postKg")} required />
          </Field>
          <Field label="Urin während der Einheit" htmlFor="st-urine" hint="Meist 0">
            <UnitInput id="st-urine" unit="ml" inputMode="numeric" value={v.urineMl} onChange={set("urineMl")} />
          </Field>
          <div className="flex items-end justify-between gap-3 sm:col-span-2">
            <p className="text-[14px] text-ink-2">
              {preview !== null ? (
                <>
                  Schweißrate <span className="text-[18px] font-semibold text-ink tabular">{formatNumber(preview, 2)} l/h</span>
                </>
              ) : v.preKg && v.postKg ? (
                <span className="text-critical-ink">Unplausibel, prüfe die Werte.</span>
              ) : null}
            </p>
            <Button type="submit" loading={pending}>
              Speichern
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Deine Messungen" description="Die Pläne nutzen den Median je Sportart und Temperatur. Tests älter als zwei Jahre zählen nicht mehr." />
        {tests.length ? (
          <ul className="divide-y divide-border pt-3">
            {tests.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-ink">
                    {SPORT_LABEL[t.sport]} · {formatNumber(t.rateLh, 2)} l/h
                  </div>
                  <div className="text-[12px] text-ink-3">
                    {formatDate(displayDate(t.date))} · {Math.round(t.durationSec / 60)} min · {formatNumber(t.tempC, 0)} °C · {formatNumber(t.preKg - t.postKg, 1)} kg Verlust bei {t.fluidMl} ml getrunken
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Messung löschen"
                  onClick={() =>
                    start(async () => {
                      const r = await deleteSweatTest(t.id);
                      if (!r.ok) toast({ tone: "error", title: "Nicht gelöscht", description: r.error });
                      router.refresh();
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-[14px] text-ink-3">Noch keine Messung. Bis dahin schätzen wir deine Schweißrate aus Sportart, Intensität, Gewicht und Temperatur.</p>
        )}
      </Card>
    </div>
  );
}
