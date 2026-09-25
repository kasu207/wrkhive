"use client";

import { ArrowUp, CalendarCheck, CalendarPlus, Check, ExternalLink, RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { acceptPlan, clearCoach, requestPlan, saveCoachWorkout, sendCoachMessage } from "@/app/actions/coach";
import { SPORT_COLOR, SportIcon, SportTile } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, UnitInput } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { WorkoutChart, WorkoutSparkline } from "@/components/workout/workout-chart";
import type { CoachPayload } from "@/db/schema";
import { cn } from "@/lib/cn";
import { addDays, displayDate, toISODate } from "@/lib/dates";
import { formatDateShort, formatDuration } from "@/lib/format";
import { summarize } from "@/lib/workout/metrics";
import type { Thresholds } from "@/lib/workout/types";

export interface CoachMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload: CoachPayload | null;
}

const SUGGESTIONS = [
  "45 Minuten auf der Rolle, gern knackig",
  "Lockerer Lauf, 40 Minuten",
  "Wie ist meine Form gerade?",
  "Krafttraining für Läufer",
  "Ich hab 2 Stunden und müde Beine",
];

const PHASE_LABEL: Record<string, string> = { base: "Grundlage", build: "Aufbau", peak: "Spitze", taper: "Tapering", recovery: "Entlastung", race: "Wettkampf" };

/** Minimal, safe markdown: **bold**, "- " lists, paragraphs. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>));
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                {inline(l)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function CoachView({ messages, thresholds, engine, initialTab }: { messages: CoachMsg[]; thresholds: Thresholds; engine: "ai" | "rules"; initialTab: "chat" | "plan" }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"chat" | "plan">(initialTab);
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pendingText]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || pending) return;
    setDraft("");
    setPendingText(t);
    setTab("chat");
    start(async () => {
      const r = await sendCoachMessage(t);
      if (!r.ok) toast({ tone: "error", title: "Nachricht nicht gesendet", description: r.error });
      router.refresh();
      setPendingText(null);
    });
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          label="Bereich"
          options={[
            { value: "chat", label: "Chat" },
            { value: "plan", label: "Trainingsplan" },
          ]}
        />
        <div className="flex items-center gap-2">
          <Badge tone={engine === "ai" ? "info" : "neutral"}>{engine === "ai" ? "KI-Coach aktiv" : "Regelbasierter Coach"}</Badge>
          {messages.length ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm("Unterhaltung löschen? Gespeicherte Workouts und Pläne bleiben erhalten.")) start(async () => { await clearCoach(); router.refresh(); });
              }}
            >
              <RotateCcw /> Neu beginnen
            </Button>
          ) : null}
        </div>
      </div>

      {tab === "plan" ? (
        <PlanForm
          onSubmit={(input) =>
            new Promise<void>((resolve) => {
              setPendingText("Erstelle mir einen Trainingsplan …");
              setTab("chat");
              start(async () => {
                const r = await requestPlan(input);
                if (!r.ok) toast({ tone: "error", title: "Plan konnte nicht erstellt werden", description: r.error });
                router.refresh();
                setPendingText(null);
                resolve();
              });
            })
          }
        />
      ) : (
        <div className="mx-auto max-w-3xl">
          {!messages.length && !pendingText ? (
            <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center shadow-card sm:p-10">
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand-ink">
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 17h3v-4h3V8h3v7h3v-3h4" />
                </svg>
              </div>
              <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.02em]">Was steht heute an?</h2>
              <p className="mx-auto mt-1.5 max-w-md text-[15px] text-ink-2">
                Sag mir, wie viel Zeit du hast und worauf du Lust hast. Ich kenne deine Form aus den letzten Wochen und baue dir die passende Einheit oder einen ganzen Plan.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-border-strong bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink/40 hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-6">
            {messages.map((m, i) => (
              <Message key={m.id} msg={m} thresholds={thresholds} animate={i >= messages.length - 2} />
            ))}
            {pendingText ? (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[85%] animate-fade-up rounded-[18px] rounded-br-md bg-ink px-4 py-2.5 text-[15px] leading-relaxed text-white">{pendingText}</div>
                </div>
                <div className="flex items-center gap-2 text-[14px] text-ink-3" role="status">
                  <span className="inline-flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <span key={d} className="size-1.5 animate-bounce rounded-full bg-ink-3" style={{ animationDelay: `${d * 120}ms` }} />
                    ))}
                  </span>
                  Coach denkt nach …
                </div>
              </>
            ) : null}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="sticky bottom-[84px] z-10 mt-8 lg:bottom-6"
          >
            <div className="flex items-end gap-2 rounded-[20px] border border-border-strong bg-surface p-2 pl-4 shadow-raised focus-within:border-focus focus-within:shadow-[0_0_0_3px_rgb(42_120_214/0.15)]">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                rows={1}
                placeholder="z. B. 60 Minuten Rad, Schwelle, draußen"
                aria-label="Nachricht an den Coach"
                className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] outline-none [field-sizing:content] placeholder:text-ink-3"
              />
              <Button type="submit" size="icon" disabled={!draft.trim() || pending} aria-label="Senden" className="rounded-[14px]">
                <ArrowUp />
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Message({ msg, thresholds, animate }: { msg: CoachMsg; thresholds: Thresholds; animate: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-ink px-4 py-2.5 text-[15px] leading-relaxed text-white", animate && "animate-fade-up")}>{msg.content}</div>
      </div>
    );
  }
  return (
    <div className={cn("space-y-3", animate && "animate-fade-up")}>
      <div className="text-[15px] leading-relaxed text-ink-2">
        <RichText text={msg.content} />
      </div>
      {msg.payload?.kind === "workout" ? <WorkoutProposal messageId={msg.id} payload={msg.payload} thresholds={thresholds} /> : null}
      {msg.payload?.kind === "plan" ? <PlanProposalCard messageId={msg.id} payload={msg.payload} thresholds={thresholds} /> : null}
    </div>
  );
}

function WorkoutProposal({ messageId, payload, thresholds }: { messageId: string; payload: Extract<CoachPayload, { kind: "workout" }>; thresholds: Thresholds }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [savedId, setSavedId] = useState(payload.savedWorkoutId ?? null);
  const w = payload.workout;
  const s = summarize(w.structure, thresholds);
  const save = (date: string | null) =>
    start(async () => {
      const r = await saveCoachWorkout(messageId, date);
      if (!r.ok) return toast({ tone: "error", title: "Fehler", description: r.error });
      setSavedId(r.data!.id);
      toast({ tone: "success", title: date ? "Für heute eingeplant" : "In deiner Bibliothek gespeichert" });
      router.refresh();
    });
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-card">
      <div className="flex items-center gap-3 px-4 pt-4">
        <SportTile sport={w.sport} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{w.name}</div>
          <div className="text-[13px] text-ink-3 tabular">
            {formatDuration(s.durationSec, { compact: true })} · {s.tss} TSS{w.sport !== "strength" ? ` · IF ${s.intensityFactor.toFixed(2).replace(".", ",")}` : ` · ${s.sets} Sätze`}
          </div>
        </div>
      </div>
      <div className="px-3 pb-1 pt-3">
        <WorkoutChart structure={w.structure} thresholds={thresholds} height={150} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2/60 px-4 py-3">
        {savedId ? (
          <>
            <Badge tone="good">
              <Check /> Gespeichert
            </Badge>
            <span className="flex-1" />
            <ButtonLink href={`/workouts/${savedId}`} size="sm" variant="secondary">
              <ExternalLink /> Öffnen & senden
            </ButtonLink>
            <Button size="sm" variant="ghost" onClick={() => save(toISODate(new Date()))} loading={pending}>
              <CalendarPlus /> Heute einplanen
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={() => save(null)} loading={pending}>
              <Save /> Speichern
            </Button>
            <Button size="sm" onClick={() => save(toISODate(new Date()))} loading={pending}>
              <CalendarPlus /> Heute einplanen
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function PlanProposalCard({ messageId, payload, thresholds }: { messageId: string; payload: Extract<CoachPayload, { kind: "plan" }>; thresholds: Thresholds }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(Boolean(payload.savedPlanId));
  const [openWeek, setOpenWeek] = useState<number | null>(0);
  const plan = payload.plan;
  const maxTss = Math.max(1, ...plan.weeks.map((w) => w.targetTss));
  const sessions = plan.weeks.reduce((a, w) => a + w.sessions.length, 0);

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-card">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[16px] font-semibold tracking-[-0.01em]">{plan.name}</div>
            <div className="text-[13px] text-ink-3">
              {formatDateShort(displayDate(plan.startDate))} – {formatDateShort(displayDate(plan.endDate))} · {plan.weeks.length} Wochen · {sessions} Einheiten
            </div>
          </div>
          {saved ? (
            <Badge tone="good">
              <CalendarCheck /> Im Kalender
            </Badge>
          ) : null}
        </div>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{plan.summary}</p>
      </div>
      <div className="divide-y divide-border border-t border-border">
        {plan.weeks.map((w, i) => {
          const hours = w.sessions.reduce((a, s) => a + summarize(s.structure, thresholds).durationSec, 0);
          const open = openWeek === i;
          return (
            <div key={w.startDate}>
              <button type="button" onClick={() => setOpenWeek(open ? null : i)} aria-expanded={open} className="grid w-full grid-cols-[64px_1fr_auto] items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2/60 sm:grid-cols-[72px_120px_1fr_auto]">
                <span className="text-[13px] font-semibold">Woche {i + 1}</span>
                <span className="hidden sm:block">
                  <Badge tone={w.phase === "recovery" || w.phase === "taper" ? "neutral" : w.phase === "race" ? "brand" : "info"}>{PHASE_LABEL[w.phase] ?? w.phase}</Badge>
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-2 flex-1 rounded-full bg-surface-2">
                    <span className="block h-2 rounded-full bg-ink/80" style={{ width: `${(w.targetTss / maxTss) * 100}%` }} />
                  </span>
                </span>
                <span className="whitespace-nowrap text-right text-[12px] text-ink-3 tabular">
                  {formatDuration(hours, { compact: true })} · {w.targetTss} TSS
                </span>
              </button>
              {open ? (
                <div className="grid gap-2 bg-surface-2/40 px-4 pb-3 pt-1 sm:grid-cols-2">
                  {w.sessions.map((s, j) => (
                    <div key={j} className="rounded-xl border border-border bg-surface p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-ink-3">{new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" }).format(displayDate(addDays(w.startDate, s.day)))}</span>
                        <span className="ml-auto inline-flex items-center" style={{ color: SPORT_COLOR[s.sport] }}>
                          <SportIcon sport={s.sport} className="size-3.5" />
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[14px] font-semibold">{s.name}</div>
                      <div className="mt-2">
                        <WorkoutSparkline structure={s.structure} thresholds={thresholds} height={28} />
                      </div>
                    </div>
                  ))}
                  {!w.sessions.length ? <p className="text-[13px] text-ink-3">Keine Einheiten (bereits vergangen).</p> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2/60 px-4 py-3">
        {saved ? (
          <ButtonLink href={`/calendar?start=${plan.startDate}`} size="sm" variant="secondary">
            Im Kalender ansehen
          </ButtonLink>
        ) : (
          <Button
            size="sm"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await acceptPlan(messageId);
                if (!r.ok) return toast({ tone: "error", title: "Fehler", description: r.error });
                setSaved(true);
                toast({ tone: "success", title: "Plan übernommen", description: `${sessions} Einheiten wurden in deinen Kalender eingetragen.` });
                router.refresh();
              })
            }
          >
            <CalendarPlus /> In Kalender übernehmen
          </Button>
        )}
      </div>
    </div>
  );
}

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function PlanForm({ onSubmit }: { onSubmit: (input: Parameters<typeof requestPlan>[0]) => Promise<void> }) {
  const [goal, setGoal] = useState("");
  const [sport, setSport] = useState<"ride" | "run" | "mixed">("run");
  const [hasEvent, setHasEvent] = useState(true);
  const [eventDate, setEventDate] = useState(addDays(toISODate(new Date()), 84));
  const [weeks, setWeeks] = useState("8");
  const [hours, setHours] = useState("6");
  const [days, setDays] = useState<number[]>([1, 3, 5, 6]);
  const [longDay, setLongDay] = useState(6);
  const [strength, setStrength] = useState(true);
  const [busy, setBusy] = useState(false);

  const toggleDay = (d: number) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()));
  const valid = days.length >= 2 && Number(hours) > 0 && (!hasEvent || eventDate > toISODate(new Date()));

  return (
    <form
      className="mx-auto max-w-2xl rounded-[var(--radius-card)] border border-border bg-surface shadow-card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        await onSubmit({
          goal,
          sport,
          eventDate: hasEvent ? eventDate : null,
          weeks: Math.min(24, Math.max(3, Number(weeks) || 8)),
          hoursPerWeek: Math.min(30, Math.max(1, Number(hours.replace(",", ".")) || 6)),
          trainingDays: days,
          longDay: days.includes(longDay) ? longDay : days[days.length - 1],
          strength,
        });
        setBusy(false);
      }}
    >
      <div className="border-b border-border px-6 py-5">
        <h2 className="text-[17px] font-semibold">Trainingsplan erstellen</h2>
        <p className="mt-0.5 text-[14px] text-ink-2">Periodisiert, mit Entlastungswochen und Tapering. Du kannst jede Einheit später anpassen.</p>
      </div>
      <div className="space-y-5 px-6 py-5">
        <Field label="Ziel" htmlFor="goal" hint="z. B. Halbmarathon unter 1:45, Alpenüberquerung, erstes 100-km-Rennen">
          <Input id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Wofür trainierst du?" maxLength={120} />
        </Field>
        <Field label="Sportart">
          <Segmented
            value={sport}
            onChange={setSport}
            label="Sportart"
            options={[
              { value: "run", label: "Laufen" },
              { value: "ride", label: "Rad" },
              { value: "mixed", label: "Rad + Laufen" },
            ]}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Zeitrahmen">
            <Segmented
              value={hasEvent ? "event" : "weeks"}
              onChange={(v) => setHasEvent(v === "event")}
              label="Zeitrahmen"
              options={[
                { value: "event", label: "Wettkampf" },
                { value: "weeks", label: "Wochen" },
              ]}
            />
          </Field>
          {hasEvent ? (
            <Field label="Wettkampfdatum" htmlFor="event">
              <Input id="event" type="date" value={eventDate} min={addDays(toISODate(new Date()), 14)} onChange={(e) => setEventDate(e.target.value)} />
            </Field>
          ) : (
            <Field label="Dauer" htmlFor="weeks">
              <UnitInput id="weeks" unit="Wochen" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label="Zeit pro Woche" htmlFor="hours">
          <UnitInput id="hours" unit="Std." inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} className="max-w-40" />
        </Field>
        <Field label="Trainingstage" hint="Tippe auf den Tag für deine lange Einheit, um ihn zweimal zu markieren.">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = days.includes(i);
              const long = on && longDay === i;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    if (on && longDay !== i) setLongDay(i);
                    else toggleDay(i);
                  }}
                  aria-pressed={on}
                  className={cn(
                    "relative h-10 w-12 rounded-xl border text-[13px] font-semibold transition-colors",
                    on ? "border-ink bg-ink text-white" : "border-border-strong bg-surface text-ink-2 hover:text-ink",
                  )}
                >
                  {d}
                  {long ? <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-brand px-1.5 text-[9px] font-bold leading-4 text-ink">LANG</span> : null}
                </button>
              );
            })}
          </div>
        </Field>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3.5">
          <input type="checkbox" checked={strength} onChange={(e) => setStrength(e.target.checked)} className="size-4 accent-[var(--ink)]" />
          <span>
            <span className="block text-[14px] font-medium">Krafttraining einbauen</span>
            <span className="block text-[13px] text-ink-3">1–2 Einheiten pro Woche in der Grundlagen- und Aufbauphase</span>
          </span>
        </label>
      </div>
      <div className="flex justify-end border-t border-border bg-surface-2/60 px-6 py-4">
        <Button type="submit" disabled={!valid} loading={busy}>
          Plan erstellen
        </Button>
      </div>
    </form>
  );
}

