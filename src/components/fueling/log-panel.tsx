"use client";

import { Minus, Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { applyMaxCarb, deleteFuelLog, saveFuelLog } from "@/app/actions/nutrition";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea, UnitInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { displayDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import type { FuelProduct, ProgressionAdvice } from "@/lib/nutrition";
import { SPORT_LABEL } from "@/lib/workout/types";
import { num, type RecentActivity } from "./shared";

export interface FuelLogRow {
  id: string;
  date: string;
  sport: "ride" | "run" | "strength" | "other";
  durationSec: number;
  carbsG: number;
  fluidMl: number | null;
  gutScore: number | null;
  energyScore: number | null;
  notes: string | null;
}

const GUT = ["", "Alles gut", "Leicht", "Spürbar", "Deutlich", "Stark"];
const ENERGY = ["", "Leer", "Müde", "Okay", "Gut", "Stark"];

export function ProgressionCard({ advice }: { advice: ProgressionAdvice }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Darmtraining</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">Der Magen gewöhnt sich an Kohlenhydrate wie Muskeln an Belastung.</p>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-ink-3">Verträglichkeit</div>
          <div className="text-[22px] font-semibold tracking-[-0.02em] tabular">{advice.current} g/h</div>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, ((advice.current - 30) / 90) * 100)}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-3 tabular">
        <span>30</span>
        <span>60</span>
        <span>90</span>
        <span>120 g/h</span>
      </div>
      <p className="mt-3 text-[14px] text-ink-2">{advice.reason}</p>
      {advice.direction !== "hold" ? (
        <Button
          size="sm"
          className="mt-3"
          variant={advice.direction === "up" ? "primary" : "secondary"}
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await applyMaxCarb(advice.suggested);
              if (r.ok) toast({ tone: "success", title: "Übernommen", description: r.message });
              else toast({ tone: "error", title: "Fehler", description: r.error });
              router.refresh();
            })
          }
        >
          {advice.direction === "up" ? <TrendingUp /> : <TrendingDown />}
          Auf {advice.suggested} g/h {advice.direction === "up" ? "erhöhen" : "senken"}
        </Button>
      ) : null}
    </Card>
  );
}

function Scale({ label, value, onChange, words }: { label: string; value: number | null; onChange: (v: number | null) => void; words: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(value === n ? null : n)}
            className={cn(
              "h-12 rounded-[10px] border text-[12px] font-medium leading-tight transition-colors",
              value === n ? "border-ink bg-ink text-white" : "border-border-strong bg-surface text-ink-2 hover:bg-surface-2",
            )}
          >
            <span className="block text-[15px] font-semibold">{n}</span>
            {words[n]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LogPanel({
  logs,
  activities,
  pantry,
  advice,
  maxCarb,
  today,
  preselect,
}: {
  logs: FuelLogRow[];
  activities: RecentActivity[];
  pantry: FuelProduct[];
  advice: ProgressionAdvice;
  maxCarb: number;
  today: string;
  preselect?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const initial = activities.find((a) => a.id === preselect) ?? activities.find((a) => !a.logged && a.durationSec >= 45 * 60);
  const [activityId, setActivityId] = useState(initial?.id ?? "");
  const [v, setV] = useState({
    date: initial?.date ?? today,
    sport: (initial?.sport ?? "ride") as FuelLogRow["sport"],
    durationMin: initial ? String(Math.round(initial.durationSec / 60)) : "90",
    extraCarbs: "0",
    fluidMl: "",
    notes: "",
  });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [gut, setGut] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const eaten = pantry.filter((p) => p.kind !== "salt" && p.carbsG > 0);
  const carbs = useMemo(() => Math.round(eaten.reduce((s, p) => s + (counts[p.id] ?? 0) * p.carbsG, 0) + num(v.extraCarbs)), [eaten, counts, v.extraCarbs]);
  const perHour = num(v.durationMin) > 0 ? Math.round(carbs / (num(v.durationMin) / 60)) : 0;

  const pick = (id: string) => {
    setActivityId(id);
    const a = activities.find((x) => x.id === id);
    if (a) setV((s) => ({ ...s, date: a.date, sport: a.sport, durationMin: String(Math.round(a.durationSec / 60)) }));
  };
  const bump = (id: string, d: number) => setCounts((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + d) }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader title="Einheit protokollieren" description="Was hast du gegessen und getrunken, wie ging es dem Magen? Daraus lernt dein Plan." />
        <form
          className="grid gap-4 p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveFuelLog({
                date: v.date,
                sport: v.sport,
                durationMin: Math.round(num(v.durationMin)),
                targetCarbsPerHour: maxCarb,
                carbsG: carbs,
                fluidMl: v.fluidMl ? Math.round(num(v.fluidMl)) : null,
                gutScore: gut,
                energyScore: energy,
                activityId: activityId || null,
                notes: v.notes,
              });
              if (r.ok) {
                toast({ tone: "success", title: "Gespeichert", description: r.message });
                setCounts({});
                setGut(null);
                setEnergy(null);
                setV((s) => ({ ...s, extraCarbs: "0", fluidMl: "", notes: "" }));
                router.refresh();
              } else toast({ tone: "error", title: "Nicht gespeichert", description: r.error });
            });
          }}
        >
          {activities.length ? (
            <Field label="Einheit" htmlFor="log-activity" className="sm:col-span-2">
              <Select id="log-activity" value={activityId} onChange={(e) => pick(e.target.value)}>
                <option value="">Ohne Verknüpfung</option>
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatDate(displayDate(a.date))} · {a.name} · {Math.round(a.durationSec / 60)} min{a.logged ? " (protokolliert)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Datum" htmlFor="log-date">
            <Input id="log-date" type="date" max={today} value={v.date} onChange={set("date")} required />
          </Field>
          <Field label="Dauer" htmlFor="log-dur">
            <UnitInput id="log-dur" unit="min" inputMode="numeric" value={v.durationMin} onChange={set("durationMin")} />
          </Field>
          <div className="sm:col-span-2">
            <span className="text-[13px] font-medium text-ink-2">Gegessen und getrunken</span>
            <ul className="mt-1.5 divide-y divide-border rounded-xl border border-border">
              {eaten.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                    {p.name} <span className="text-[12px] text-ink-3">{p.carbsG} g</span>
                  </span>
                  <Button variant="ghost" size="icon-sm" aria-label={`${p.name} weniger`} onClick={() => bump(p.id, -1)} disabled={!counts[p.id]}>
                    <Minus />
                  </Button>
                  <span className="w-6 text-center text-[14px] font-semibold tabular">{counts[p.id] ?? 0}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={`${p.name} mehr`} onClick={() => bump(p.id, 1)}>
                    <Plus />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <Field label="Weitere Kohlenhydrate" htmlFor="log-extra" hint="Alles, was nicht in der Liste steht">
            <UnitInput id="log-extra" unit="g" inputMode="numeric" value={v.extraCarbs} onChange={set("extraCarbs")} />
          </Field>
          <Field label="Getrunken" htmlFor="log-fluid">
            <UnitInput id="log-fluid" unit="ml" inputMode="numeric" value={v.fluidMl} onChange={set("fluidMl")} placeholder="optional" />
          </Field>
          <p className="text-[14px] text-ink-2 sm:col-span-2">
            Summe <span className="font-semibold text-ink tabular">{carbs} g</span> · <span className="font-semibold text-ink tabular">{perHour} g/h</span>
            <span className="text-ink-3"> (Ziel bis {maxCarb} g/h)</span>
          </p>
          <div className="sm:col-span-2">
            <Scale label="Magen-Darm-Beschwerden" value={gut} onChange={setGut} words={GUT} />
          </div>
          <div className="sm:col-span-2">
            <Scale label="Energie am Ende" value={energy} onChange={setEnergy} words={ENERGY} />
          </div>
          <Field label="Notiz" htmlFor="log-notes" className="sm:col-span-2">
            <Textarea id="log-notes" value={v.notes} onChange={set("notes")} maxLength={500} className="min-h-16" placeholder="z. B. Gel mit Koffein schlecht vertragen, Datteln super" />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" loading={pending}>
              Speichern
            </Button>
          </div>
        </form>
      </Card>

      <div className="space-y-6">
        <ProgressionCard advice={advice} />
        <Card>
          <CardHeader title="Verlauf" />
          {logs.length ? (
            <ul className="divide-y divide-border pt-3">
              {logs.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-ink">
                      {l.sport === "other" ? "Sonstiges" : SPORT_LABEL[l.sport]} · {Math.round(l.durationSec / 60)} min · {Math.round(l.carbsG / (l.durationSec / 3600))} g/h
                    </div>
                    <div className="text-[12px] text-ink-3">
                      {formatDate(displayDate(l.date))}
                      {l.gutScore ? ` · Magen ${GUT[l.gutScore].toLowerCase()}` : ""}
                      {l.energyScore ? ` · Energie ${ENERGY[l.energyScore].toLowerCase()}` : ""}
                      {l.fluidMl ? ` · ${l.fluidMl} ml` : ""}
                    </div>
                    {l.notes ? <div className="mt-0.5 text-[12px] text-ink-2">{l.notes}</div> : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Eintrag löschen"
                    onClick={() =>
                      start(async () => {
                        const r = await deleteFuelLog(l.id);
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
            <p className="px-5 py-8 text-center text-[14px] text-ink-3">Noch keine Einträge.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
