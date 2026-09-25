"use client";

import { Check, ChevronLeft, ChevronRight, Plus, Search, Send, SkipForward, Sparkles, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deletePlan } from "@/app/actions/coach";
import { moveScheduled, scheduleWorkout, setScheduledStatus, unschedule } from "@/app/actions/workouts";
import { SPORT_COLOR, SportIcon, SportTile } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { SendDialog, type ConnectionInfo } from "@/components/workout/send-dialog";
import { WorkoutChart } from "@/components/workout/workout-chart";
import { cn } from "@/lib/cn";
import { addDays, displayDate, isoWeekNumber } from "@/lib/dates";
import { formatDateShort, formatDayLong, formatDuration } from "@/lib/format";
import type { Sport, Thresholds, WorkoutStructure } from "@/lib/workout/types";

export interface CalWorkout {
  scheduledId: string;
  date: string;
  status: "planned" | "done" | "skipped";
  planId: string | null;
  /** Adapted to the athlete's load (the original can be restored). */
  adapted: boolean;
  workout: { id: string; name: string; description: string; sport: Sport; structure: WorkoutStructure; durationSec: number; tss: number };
}

export interface CalActivity {
  id: string;
  date: string;
  sport: Sport | "other";
  name: string;
  durationSec: number;
  distanceM: number | null;
  tss: number | null;
  linked: boolean;
}

export interface CalPlan {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  weeks: { startDate: string; focus: string; phase: string; targetTss: number }[];
}

export interface LibraryOption {
  id: string;
  name: string;
  sport: Sport;
  durationSec: number;
  tss: number;
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const PHASE_LABEL: Record<string, string> = { base: "Grundlage", build: "Aufbau", peak: "Spitze", taper: "Tapering", recovery: "Entlastung", race: "Wettkampf" };

export function CalendarView({
  start,
  weeks,
  today,
  items,
  acts,
  plans,
  library,
  thresholds,
  connections,
}: {
  start: string;
  weeks: number;
  today: string;
  items: CalWorkout[];
  acts: CalActivity[];
  plans: CalPlan[];
  library: LibraryOption[];
  thresholds: Thresholds;
  connections: ConnectionInfo[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, start_] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [detail, setDetail] = useState<CalWorkout | null>(null);
  const [addDay, setAddDay] = useState<string | null>(null);
  const [sendItem, setSendItem] = useState<CalWorkout | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});

  const days = useMemo(() => Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i)), [start, weeks]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalWorkout[]>();
    for (const it of items) {
      const d = optimistic[it.scheduledId] ?? it.date;
      m.set(d, [...(m.get(d) ?? []), it]);
    }
    return m;
  }, [items, optimistic]);
  const actsByDay = useMemo(() => {
    const m = new Map<string, CalActivity[]>();
    for (const a of acts) m.set(a.date, [...(m.get(a.date) ?? []), a]);
    return m;
  }, [acts]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string } | { ok: true }>, success?: string) =>
    start_(async () => {
      const r = (await fn()) as { ok: boolean; error?: string };
      if (!r.ok) toast({ tone: "error", title: "Das hat nicht geklappt", description: r.error });
      else if (success) toast({ tone: "success", title: success });
      router.refresh();
    });

  const onDrop = (day: string) => {
    if (!dragId) return;
    const it = items.find((i) => i.scheduledId === dragId);
    setDropDay(null);
    setDragId(null);
    if (!it || (optimistic[it.scheduledId] ?? it.date) === day) return;
    setOptimistic((o) => ({ ...o, [it.scheduledId]: day }));
    act(() => moveScheduled(it.scheduledId, day));
  };

  const activePlan = plans.find((p) => p.startDate <= addDays(start, weeks * 7 - 1) && p.endDate >= start);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={`/calendar?start=${addDays(start, -7 * weeks)}`} className="grid size-9 place-items-center rounded-[10px] border border-border-strong bg-surface text-ink-2 shadow-card hover:text-ink" aria-label="Früher">
            <ChevronLeft className="size-[18px]" />
          </Link>
          <Link href={`/calendar?start=${addDays(start, 7 * weeks)}`} className="grid size-9 place-items-center rounded-[10px] border border-border-strong bg-surface text-ink-2 shadow-card hover:text-ink" aria-label="Später">
            <ChevronRight className="size-[18px]" />
          </Link>
          <Link href="/calendar" className="ml-1 inline-flex h-9 items-center rounded-[10px] px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
            Heute
          </Link>
          <span className="ml-2 text-[15px] font-semibold">
            {formatDateShort(displayDate(start))} – {formatDateShort(displayDate(addDays(start, weeks * 7 - 1)))}
          </span>
        </div>
        {activePlan ? (
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-[13px] shadow-card">
            <span className="size-2 rounded-full bg-brand" />
            <span className="font-medium">{activePlan.name}</span>
            <span className="text-ink-3">bis {formatDateShort(displayDate(activePlan.endDate))}</span>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Plan „${activePlan.name}“ mit allen zugehörigen Einheiten löschen?`)) act(() => deletePlan(activePlan.id), "Plan gelöscht");
              }}
              className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-critical-soft hover:text-critical-ink"
              aria-label="Plan löschen"
              title="Plan löschen"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      <div className="hidden grid-cols-[repeat(7,minmax(0,1fr))_128px] gap-px px-px pb-2 text-[12px] font-medium text-ink-3 lg:grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2">
            {d}
          </div>
        ))}
        <div className="px-2 text-right">Woche</div>
      </div>

      <div className="space-y-3">
        {Array.from({ length: weeks }, (_, w) => {
          const weekDays = days.slice(w * 7, w * 7 + 7);
          const planned = weekDays.flatMap((d) => byDay.get(d) ?? []);
          const done = weekDays.flatMap((d) => actsByDay.get(d) ?? []);
          const plannedSec = planned.reduce((a, p) => a + p.workout.durationSec, 0);
          const plannedTss = planned.reduce((a, p) => a + p.workout.tss, 0);
          const doneSec = done.reduce((a, p) => a + p.durationSec, 0);
          const doneTss = done.reduce((a, p) => a + (p.tss ?? 0), 0);
          const planWeek = plans.flatMap((p) => p.weeks).find((pw) => pw.startDate === weekDays[0]);
          return (
            <div key={weekDays[0]} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-border shadow-card">
              {planWeek ? (
                <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 text-[12px] text-ink-2">
                  <Badge tone="brand">{PHASE_LABEL[planWeek.phase] ?? planWeek.phase}</Badge>
                  <span className="truncate">{planWeek.focus}</span>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-px lg:grid-cols-[repeat(7,minmax(0,1fr))_128px]">
                {weekDays.map((day, i) => {
                  const isToday = day === today;
                  const past = day < today;
                  const dayItems = byDay.get(day) ?? [];
                  const dayActs = (actsByDay.get(day) ?? []).filter((a) => !a.linked);
                  return (
                    <div
                      key={day}
                      onDragOver={(e) => {
                        if (dragId) {
                          e.preventDefault();
                          setDropDay(day);
                        }
                      }}
                      onDragLeave={() => setDropDay((d) => (d === day ? null : d))}
                      onDrop={(e) => {
                        e.preventDefault();
                        onDrop(day);
                      }}
                      className={cn(
                        "group/day relative min-h-[64px] bg-surface p-2 transition-colors lg:min-h-[132px]",
                        past && "bg-[#fcfcfb]",
                        dropDay === day && "bg-brand-soft",
                      )}
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", isToday ? "text-ink" : "text-ink-3")}>
                          <span className="lg:hidden">{WEEKDAYS[i]}</span>
                          <span className={cn("grid h-6 min-w-6 place-items-center rounded-full px-1 tabular", isToday && "bg-ink text-white")}>{Number(day.slice(8))}</span>
                          {day.slice(8) === "01" || (w === 0 && i === 0) ? <span className="text-ink-3">{new Intl.DateTimeFormat("de-DE", { month: "short" }).format(displayDate(day))}</span> : null}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAddDay(day)}
                          className="grid size-6 place-items-center rounded-md text-ink-3 opacity-100 transition-opacity hover:bg-surface-2 hover:text-ink lg:opacity-0 lg:group-hover/day:opacity-100 lg:focus:opacity-100"
                          aria-label={`Workout am ${formatDayLong(displayDate(day))} planen`}
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {dayItems.map((it) => (
                          <button
                            key={it.scheduledId}
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setDragId(it.scheduledId);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              setDragId(null);
                              setDropDay(null);
                            }}
                            onClick={() => setDetail(it)}
                            className={cn(
                              "block w-full cursor-grab rounded-lg border px-2 py-1.5 text-left transition-[border-color,box-shadow,opacity] hover:border-border-strong hover:shadow-card active:cursor-grabbing",
                              it.status === "done" ? "border-[#c9e9c9] bg-good-soft/60" : it.status === "skipped" ? "border-border bg-surface-2 opacity-60" : "border-border bg-surface",
                              dragId === it.scheduledId && "opacity-40",
                            )}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="size-2 shrink-0 rounded-full" style={{ background: SPORT_COLOR[it.workout.sport] }} />
                              <span className={cn("truncate text-[12px] font-semibold", it.status === "skipped" && "line-through")}>{it.workout.name}</span>
                              {it.status === "done" ? (
                                <Check className="ml-auto size-3.5 shrink-0 text-good-ink" />
                              ) : it.adapted ? (
                                <Sparkles className="ml-auto size-3.5 shrink-0 text-brand-ink" aria-label="angepasst" />
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-[11px] text-ink-3 tabular">
                              {formatDuration(it.workout.durationSec, { compact: true })} · {it.workout.tss} TSS
                            </div>
                          </button>
                        ))}
                        {dayActs.map((a) => (
                          <Link key={a.id} href={`/activities?open=${a.id}`} className="block rounded-lg bg-surface-2 px-2 py-1.5 text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink">
                            <span className="flex items-center gap-1.5 text-[12px] font-medium">
                              <SportIcon sport={a.sport} className="size-3.5 shrink-0" />
                              <span className="truncate">{a.name}</span>
                            </span>
                            <span className="mt-0.5 block text-[11px] text-ink-3 tabular">
                              {formatDuration(a.durationSec, { compact: true })}
                              {a.tss ? ` · ${Math.round(a.tss)} TSS` : ""}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1 bg-surface-2/80 px-3 py-2 text-[12px] lg:flex-col lg:flex-nowrap lg:items-end lg:gap-2 lg:py-3">
                  <span className="font-semibold text-ink">KW {isoWeekNumber(weekDays[0])}</span>
                  <WeekFigure label="Geplant" sec={plannedSec} tss={plannedTss} />
                  <WeekFigure label="Absolviert" sec={doneSec} tss={Math.round(doneTss)} />
                  {planWeek ? <WeekFigure label="Planziel" tss={planWeek.targetTss} /> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 hidden text-[12px] text-ink-3 lg:block">Tipp: Einheiten per Drag & Drop auf einen anderen Tag ziehen.</p>

      {/* Detail */}
      <Dialog
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.workout.name ?? ""}
        description={detail ? formatDayLong(displayDate(optimistic[detail.scheduledId] ?? detail.date)) : undefined}
        size="lg"
        footer={
          detail ? (
            <>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  act(() => unschedule(detail.scheduledId), "Aus dem Kalender entfernt");
                  setDetail(null);
                }}
              >
                <Trash2 /> Entfernen
              </Button>
              <span className="flex-1" />
              {detail.status === "planned" ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => { act(() => setScheduledStatus(detail.scheduledId, "skipped")); setDetail(null); }}>
                    <SkipForward /> Auslassen
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => { act(() => setScheduledStatus(detail.scheduledId, "done"), "Als erledigt markiert"); setDetail(null); }}>
                    <Check /> Erledigt
                  </Button>
                </>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => { act(() => setScheduledStatus(detail.scheduledId, "planned")); setDetail(null); }}>
                  <Undo2 /> Wieder offen
                </Button>
              )}
              <ButtonLink href={`/workouts/${detail.workout.id}`} variant="secondary" size="sm">
                Bearbeiten
              </ButtonLink>
              <Button
                size="sm"
                onClick={() => {
                  setSendItem(detail);
                  setDetail(null);
                }}
              >
                <Send /> Senden
              </Button>
            </>
          ) : null
        }
      >
        {detail ? (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SportTile sport={detail.workout.sport} size="sm" />
              <span className="text-[14px] text-ink-2 tabular">
                {formatDuration(detail.workout.durationSec, { compact: true })} · {detail.workout.tss} TSS
              </span>
              {detail.status === "done" ? <Badge tone="good">Erledigt</Badge> : detail.status === "skipped" ? <Badge>Ausgelassen</Badge> : null}
              {detail.planId ? <Badge tone="brand">Aus Trainingsplan</Badge> : null}
              {detail.adapted ? <Badge tone="info">An Belastung angepasst</Badge> : null}
            </div>
            <WorkoutChart structure={detail.workout.structure} thresholds={thresholds} height={170} />
            {detail.workout.description ? <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{detail.workout.description}</p> : null}
          </div>
        ) : null}
      </Dialog>

      {sendItem ? (
        <SendDialog
          open
          onClose={() => setSendItem(null)}
          workoutId={sendItem.workout.id}
          structure={sendItem.workout.structure}
          connections={connections}
          ensureSaved={async () => sendItem.workout.id}
          initialDate={optimistic[sendItem.scheduledId] ?? sendItem.date}
        />
      ) : null}

      <AddDialog
        day={addDay}
        library={library}
        onClose={() => setAddDay(null)}
        onPick={(id) => {
          const day = addDay!;
          setAddDay(null);
          act(() => scheduleWorkout(id, day), "Eingeplant");
        }}
      />
    </div>
  );
}

function hm(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")} h`;
}

function WeekFigure({ label, sec, tss }: { label: string; sec?: number; tss: number }) {
  const empty = !tss && !sec;
  return (
    <span className="text-left lg:text-right">
      <span className="block text-[11px] text-ink-3">{label}</span>
      <span className="block whitespace-nowrap font-medium text-ink-2 tabular">{empty ? "–" : `${sec !== undefined ? `${hm(sec)} · ` : ""}${tss} TSS`}</span>
    </span>
  );
}

function AddDialog({ day, library, onClose, onPick }: { day: string | null; library: LibraryOption[]; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const list = library.filter((l) => !q.trim() || l.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60);
  return (
    <Dialog open={!!day} onClose={onClose} title="Workout einplanen" description={day ? formatDayLong(displayDate(day)) : undefined}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <Input autoFocus placeholder="In deiner Bibliothek suchen" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>
      {list.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {list.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => onPick(l.id)} className="flex w-full items-center gap-3 bg-surface px-3.5 py-2.5 text-left hover:bg-surface-2">
                <SportTile sport={l.sport} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
                <span className="shrink-0 text-[12px] text-ink-3 tabular">
                  {formatDuration(l.durationSec, { compact: true })} · {l.tss} TSS
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-ink-3">Keine Workouts gefunden.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <ButtonLink href="/workouts/new" variant="secondary" size="sm">
          <Plus /> Neues Workout
        </ButtonLink>
        <ButtonLink href="/coach" variant="ghost" size="sm">
          Coach fragen
        </ButtonLink>
      </div>
    </Dialog>
  );
}

