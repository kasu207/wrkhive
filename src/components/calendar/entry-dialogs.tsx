"use client";

import { Check, Clock, Repeat, Trash2, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmCalendarEntry, createCalendarEntry, deleteCalendarEntry, moveCalendarEntry, reopenCalendarEntry, skipCalendarEntry } from "@/app/actions/entries";
import { SportTile } from "@/components/brand";
import { RPE_LABEL } from "@/components/manual-activity-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, UnitInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { RPE_TSS_PER_HOUR } from "@/lib/analytics/load";
import { cn } from "@/lib/cn";
import { displayDate } from "@/lib/dates";
import { formatDayLong, formatDuration } from "@/lib/format";

export type EntrySport = "ride" | "run" | "strength" | "other";

export interface CalEntry {
  id: string;
  date: string;
  time: string | null;
  name: string;
  sport: EntrySport;
  durationMin: number;
  rpe: number | null;
  note: string | null;
  status: "planned" | "done" | "skipped";
  completion: "rated" | "synced" | null;
  activityId: string | null;
  seriesId: string | null;
  /** Took place and waits for confirmation. */
  due: boolean;
  tss: number;
}

export const ENTRY_SPORT_LABEL: Record<EntrySport, string> = { other: "Kampfsport / Sonstiges", strength: "Krafttraining", run: "Laufen", ride: "Radfahren" };

const PRESETS: { name: string; sport: EntrySport; durationMin: number; rpe: number }[] = [
  { name: "Jiu-Jitsu", sport: "other", durationMin: 90, rpe: 7 },
  { name: "Krafttraining", sport: "strength", durationMin: 60, rpe: 6 },
  { name: "Yoga", sport: "other", durationMin: 60, rpe: 3 },
  { name: "Lauftreff", sport: "run", durationMin: 60, rpe: 5 },
  { name: "Gruppenausfahrt", sport: "ride", durationMin: 150, rpe: 6 },
];

const REPEAT_OPTIONS = [
  { value: 0, label: "Einmalig" },
  { value: 3, label: "4 Wochen, wöchentlich" },
  { value: 7, label: "8 Wochen, wöchentlich" },
  { value: 11, label: "12 Wochen, wöchentlich" },
  { value: 25, label: "26 Wochen, wöchentlich" },
];

function RpeSelect({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {Object.entries(RPE_LABEL).map(([v, label]) => (
        <option key={v} value={v}>
          {v} · {label}
        </option>
      ))}
    </Select>
  );
}

/** Plans a session without a structured workout (Jiu-Jitsu, gym, group ride), optionally as a weekly series. */
export function EntryFormDialog({ day, onClose }: { day: string | null; onClose: () => void }) {
  return day ? <EntryForm day={day} onClose={onClose} /> : null;
}

function EntryForm({ day, onClose }: { day: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("Jiu-Jitsu");
  const [sport, setSport] = useState<EntrySport>("other");
  const [date, setDate] = useState(day);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("90");
  const [rpe, setRpe] = useState("7");
  const [repeat, setRepeat] = useState("0");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const minutes = Number(duration);
  const preview = minutes > 0 ? Math.round((minutes / 60) * RPE_TSS_PER_HOUR[Number(rpe) || 5]) : null;
  const valid = name.trim() && date && Number.isInteger(minutes) && minutes >= 5 && minutes <= 600;

  const save = () =>
    start(async () => {
      setError(null);
      const r = await createCalendarEntry({ date, time: time || null, name, sport, durationMin: minutes, rpe: rpe ? Number(rpe) : null, note: note.trim() || null, repeatWeeks: Number(repeat) });
      if (!r.ok) return setError(r.error);
      onClose();
      toast({ tone: "success", title: r.data!.count > 1 ? `${r.data!.count} Termine geplant` : "Termin geplant", description: "Nach dem Training bestätigst und bewertest du ihn. Zeichnet deine Uhr die Einheit auf, übernimmt Wrkhive sie automatisch." });
      router.refresh();
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Termin planen"
      description="Für Einheiten ohne strukturiertes Workout, etwa Jiu-Jitsu oder Krafttraining im Studio."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={save} loading={pending} disabled={!valid}>
            Planen
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save();
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                setName(p.name);
                setSport(p.sport);
                setDuration(String(p.durationMin));
                setRpe(String(p.rpe));
              }}
              className={cn(
                "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors",
                name === p.name ? "border-ink bg-ink text-white" : "border-border-strong bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bezeichnung" htmlFor="entry-name">
            <Input id="entry-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Art" htmlFor="entry-sport" hint="Bestimmt, welche Aufzeichnung deiner Uhr den Termin erledigt.">
            <Select id="entry-sport" value={sport} onChange={(e) => setSport(e.target.value as EntrySport)}>
              {Object.entries(ENTRY_SPORT_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Datum" htmlFor="entry-date">
            <Input id="entry-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Uhrzeit (optional)" htmlFor="entry-time">
            <Input id="entry-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Dauer" htmlFor="entry-duration">
            <UnitInput id="entry-duration" unit="min" type="number" inputMode="numeric" min={5} max={600} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Erwartete Anstrengung" htmlFor="entry-rpe" suffix={preview !== null ? <span className="text-[13px] tabular text-ink-3">ca. {preview} TSS</span> : null}>
            <RpeSelect id="entry-rpe" value={rpe} onChange={setRpe} placeholder="Keine Angabe (5)" />
          </Field>
          <Field label="Wiederholen" htmlFor="entry-repeat">
            <Select id="entry-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
              {REPEAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notiz (optional)" htmlFor="entry-note">
          <Input id="entry-note" value={note} maxLength={300} placeholder="z. B. Open Mat, Beine" onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error ? <p className="text-[13px] text-critical-ink">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Confirm and rate a session that took place, or mark it as missed. */
export function RateEntryForm({ entry, compact = false, onDone }: { entry: CalEntry; compact?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [duration, setDuration] = useState(String(entry.durationMin));
  const [rpe, setRpe] = useState(entry.rpe ? String(entry.rpe) : "");
  const [pending, start] = useTransition();
  const minutes = Number(duration);
  const valid = rpe && Number.isInteger(minutes) && minutes >= 5 && minutes <= 600;
  const preview = valid ? Math.round((minutes / 60) * RPE_TSS_PER_HOUR[Number(rpe)]) : null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, title: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast({ tone: "error", title: "Das hat nicht geklappt", description: r.error });
        return;
      }
      toast({ tone: "success", title, description: r.message });
      onDone?.();
      router.refresh();
    });

  return (
    <div className={cn("grid gap-3", compact ? "sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-end" : "sm:grid-cols-[8rem_minmax(0,1fr)]")}>
      <Field label="Dauer" htmlFor={`rate-duration-${entry.id}`}>
        <UnitInput id={`rate-duration-${entry.id}`} unit="min" type="number" inputMode="numeric" min={5} max={600} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
      </Field>
      <Field label="Anstrengung (RPE)" htmlFor={`rate-rpe-${entry.id}`} suffix={preview !== null && !compact ? <span className="text-[13px] tabular text-ink-3">ca. {preview} TSS</span> : null}>
        <RpeSelect id={`rate-rpe-${entry.id}`} value={rpe} onChange={setRpe} placeholder="Bitte wählen" />
      </Field>
      <div className={cn("flex flex-wrap gap-2", !compact && "sm:col-span-2")}>
        <Button size="sm" className="h-10" loading={pending} disabled={!valid} onClick={() => run(() => confirmCalendarEntry(entry.id, { durationMin: minutes, rpe: Number(rpe) }), "Einheit bestätigt")}>
          <Check /> Bestätigen
        </Button>
        <Button variant="ghost" size="sm" className="h-10" disabled={pending} onClick={() => run(() => skipCalendarEntry(entry.id), "Als ausgefallen markiert")}>
          <X /> Ausgefallen
        </Button>
      </div>
    </div>
  );
}

export function EntryDetailDialog({ entry, onClose }: { entry: CalEntry | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  if (!entry) return null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, title: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast({ tone: "error", title: "Das hat nicht geklappt", description: r.error });
        return;
      }
      toast({ tone: "success", title, description: r.message });
      onClose();
      router.refresh();
    });

  const status =
    entry.status === "done" ? (
      <Badge tone="good">{entry.completion === "synced" ? "Aufgezeichnet" : "Bestätigt"}</Badge>
    ) : entry.status === "skipped" ? (
      <Badge>Ausgefallen</Badge>
    ) : entry.due ? (
      <Badge tone="warning">Freigeben und bewerten</Badge>
    ) : (
      <Badge tone="info">Geplant</Badge>
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry.name}
      description={`${formatDayLong(displayDate(entry.date))}${entry.time ? `, ${entry.time} Uhr` : ""}`}
      footer={
        <>
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() => {
              const series = entry.seriesId && entry.status === "planned" && window.confirm("Auch alle folgenden offenen Termine dieser Serie löschen? (Abbrechen löscht nur diesen Termin)");
              run(() => deleteCalendarEntry(entry.id, Boolean(series)), "Termin gelöscht");
            }}
          >
            <Trash2 /> Löschen
          </Button>
          <span className="flex-1" />
          {entry.status !== "planned" ? (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => reopenCalendarEntry(entry.id), "Termin wieder offen")}>
              <Undo2 /> Zurücksetzen
            </Button>
          ) : !entry.due ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => skipCalendarEntry(entry.id), "Als ausgefallen markiert")}>
              <X /> Fällt aus
            </Button>
          ) : null}
          {entry.activityId ? (
            <Link href={`/activities?open=${entry.activityId}`} className="inline-flex h-8 items-center rounded-[9px] border border-border-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
              Aktivität ansehen
            </Link>
          ) : null}
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SportTile sport={entry.sport} size="sm" />
        <span className="text-[14px] text-ink-2 tabular">
          {ENTRY_SPORT_LABEL[entry.sport]} · {formatDuration(entry.durationMin * 60, { compact: true })} · ca. {entry.tss} TSS
        </span>
        {status}
        {entry.seriesId ? (
          <Badge>
            <Repeat /> Wöchentlich
          </Badge>
        ) : null}
      </div>
      {entry.note ? <p className="mb-4 text-[14px] leading-relaxed text-ink-2">{entry.note}</p> : null}
      {entry.status === "planned" && entry.due ? (
        <div className="rounded-xl border border-border bg-surface-2/60 p-4">
          <p className="mb-3 text-[13px] text-ink-2">Hat die Einheit stattgefunden? Bestätige Dauer und Anstrengung, dann zählt sie zu deiner Belastung.</p>
          <RateEntryForm entry={entry} onDone={onClose} />
        </div>
      ) : entry.status === "planned" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("date");
            if (typeof value !== "string" || !value || value === entry.date) return;
            run(() => moveCalendarEntry(entry.id, value), "Verschoben");
          }}
        >
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
            Datum
            <Input type="date" name="date" defaultValue={entry.date} className="w-auto" required />
          </label>
          <Button type="submit" variant="secondary" size="sm" className="h-10">
            Verschieben
          </Button>
          <p className="flex w-full items-center gap-1.5 text-[12px] leading-relaxed text-ink-3">
            <Clock className="size-3.5" />
            Nach dem Termin fragt Wrkhive nach deiner Bewertung, außer deine Uhr hat die Einheit aufgezeichnet.
          </p>
        </form>
      ) : entry.completion === "synced" ? (
        <p className="text-[13px] text-ink-3">Deine Uhr oder App hat die Einheit aufgezeichnet, Wrkhive hat sie mit dem Termin verknüpft.</p>
      ) : entry.status === "done" ? (
        <p className="text-[13px] text-ink-3">Von dir bestätigt{entry.rpe ? ` mit RPE ${entry.rpe}` : ""}. Kommt noch eine Aufzeichnung deiner Uhr für diesen Tag, ersetzt sie den manuellen Eintrag.</p>
      ) : null}
    </Dialog>
  );
}
