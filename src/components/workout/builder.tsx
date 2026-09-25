"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, Copy, Dumbbell, LayoutList, MoreHorizontal, Plus, Redo2, Repeat as RepeatIcon, Send, Trash2, Type, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useState, useTransition } from "react";
import { deleteWorkout, duplicateWorkout, saveWorkout } from "@/app/actions/workouts";
import { SportIcon } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDistance, formatDuration } from "@/lib/format";
import { ZONE_COLOR } from "@/lib/workout/display";
import {
  convertSport,
  duplicateById,
  moveNode,
  moveStepInRepeat,
  newExerciseBlock,
  newRepeat,
  newStep,
  removeById,
  unwrapRepeat,
  updateRepeat,
  updateStep,
  wrapInRepeat,
} from "@/lib/workout/edit";
import { summarize } from "@/lib/workout/metrics";
import { parseWorkoutText, serializeWorkoutText, type ParseIssue } from "@/lib/workout/text";
import { SPORT_LABEL, type Sport, type Step, type Thresholds, type WorkoutNode, type WorkoutStructure } from "@/lib/workout/types";
import { zonesFor } from "@/lib/workout/zones";
import { RepeatBlock, SortableNode, StepRow, type StepHandlers } from "./builder-nodes";
import { ExercisePicker } from "./exercise-picker";
import { SendDialog, type ConnectionInfo } from "./send-dialog";
import { WorkoutChart } from "./workout-chart";

interface Initial {
  id: string | null;
  name: string;
  description: string;
  structure: WorkoutStructure;
}

type Mode = "visual" | "text";

export function WorkoutBuilder({
  initial,
  thresholds,
  connections,
  resetKey,
  openSend = false,
}: {
  initial: Initial;
  thresholds: Thresholds;
  connections: ConnectionInfo[];
  resetKey: string;
  /** Open the send dialog right away (e.g. to re-send an adapted workout). */
  openSend?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [id, setId] = useState(initial.id);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [history, setHistory] = useState<{ past: WorkoutStructure[]; present: WorkoutStructure; future: WorkoutStructure[] }>({
    past: [],
    present: initial.structure,
    future: [],
  });
  const structure = history.present;
  const past = history.past;
  const future = history.future;
  const [dirty, setDirty] = useState(initial.id === null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("visual");
  const [text, setText] = useState("");
  const [textErrors, setTextErrors] = useState<ParseIssue[]>([]);
  const [saving, startSaving] = useTransition();
  const [sendOpen, setSendOpen] = useState(openSend && initial.id !== null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sport = structure.sport;

  // Navigating to another workout re-renders this same component instance:
  // reset local state, unless the change is our own first save (new -> id).
  const [loadedKey, setLoadedKey] = useState(resetKey);
  if (resetKey !== loadedKey) {
    setLoadedKey(resetKey);
    if (resetKey !== id) {
      setId(initial.id);
      setName(initial.name);
      setDescription(initial.description);
      setHistory({ past: [], present: initial.structure, future: [] });
      setDirty(initial.id === null);
      setSelected(null);
      setMode("visual");
      setSendOpen(false);
    }
  }

  // Pure updaters only (safe under React strict mode double invocation).
  const setStructure = useCallback((next: WorkoutStructure | ((s: WorkoutStructure) => WorkoutStructure)) => {
    setHistory((h) => {
      const value = typeof next === "function" ? next(h.present) : next;
      if (value === h.present) return h;
      return { past: [...h.past.slice(-49), h.present], present: value, future: [] };
    });
    setDirty(true);
  }, []);
  const setNodes = useCallback((fn: (nodes: WorkoutNode[]) => WorkoutNode[]) => setStructure((s) => ({ ...s, nodes: fn(s.nodes) })), [setStructure]);

  const undo = useCallback(() => {
    setHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
    setDirty(true);
  }, []);
  const redo = useCallback(() => {
    setHistory((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));
    setDirty(true);
  }, []);

  const summary = useMemo(() => summarize(structure, thresholds), [structure, thresholds]);

  // --- persistence -----------------------------------------------------------
  const save = useCallback(async (opts: { navigate?: boolean } = {}): Promise<string | null> => {
    if (!structure.nodes.length) {
      toast({ tone: "error", title: "Das Workout ist leer", description: "Füge mindestens einen Schritt hinzu." });
      return null;
    }
    if (mode === "text" && textErrors.length) {
      toast({ tone: "error", title: "Bitte korrigiere den Text", description: textErrors[0].message });
      return null;
    }
    const res = await saveWorkout({ id: id ?? undefined, name: name.trim() || "Unbenanntes Workout", description, structure });
    if (!res.ok) {
      toast({ tone: "error", title: "Speichern fehlgeschlagen", description: res.error });
      return null;
    }
    setDirty(false);
    const newId = res.data!.id;
    if (!id) {
      setId(newId);
      // Moving from /workouts/new to /workouts/<id> remounts the page segment.
      // Do it right away for a plain save; while a dialog is open, defer it.
      if (opts.navigate !== false) router.replace(`/workouts/${newId}`, { scroll: false });
    }
    return newId;
  }, [structure, mode, textErrors, id, name, description, toast, router]);

  const onSave = () =>
    startSaving(async () => {
      if (await save()) toast({ tone: "success", title: "Gespeichert" });
    });

  // Keyboard shortcuts
  const onSaveShortcut = useEffectEvent(onSave);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSaveShortcut();
      }
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key.toLowerCase() === "z" && !inField) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // --- text mode ---------------------------------------------------------------
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === "text") {
      setText(serializeWorkoutText(structure, thresholds));
      setTextErrors([]);
    } else if (textErrors.length) {
      toast({ tone: "error", title: "Text enthält Fehler", description: "Korrigiere die markierten Zeilen, bevor du wechselst." });
      return;
    }
    setMode(next);
  };

  useEffect(() => {
    if (mode !== "text") return;
    const handle = setTimeout(() => {
      const r = parseWorkoutText(text, sport, thresholds);
      setTextErrors(r.errors);
      if (!r.errors.length && r.structure.nodes.length) {
        const same = serializeWorkoutText(r.structure, thresholds) === serializeWorkoutText(structure, thresholds);
        if (!same) setStructure(r.structure);
      }
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, mode, sport, thresholds]);

  // --- visual editing ------------------------------------------------------------
  const dndId = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = structure.nodes.findIndex((n) => n.id === e.active.id);
    const to = structure.nodes.findIndex((n) => n.id === e.over!.id);
    setNodes((nodes) => moveNode(nodes, from, to));
  };

  const selectStep = (stepId: string) => {
    setSelected(stepId);
  };
  const selectFromChart = (stepId: string) => {
    setSelected(stepId);
    if (mode === "visual") document.getElementById(`step-${stepId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const topHandlers = (step: Step, index: number): StepHandlers => ({
    onChange: (s) => setNodes((nodes) => updateStep(nodes, step.id, () => s)),
    onRemove: () => setNodes((nodes) => removeById(nodes, step.id)),
    onDuplicate: () => setNodes((nodes) => duplicateById(nodes, step.id)),
    onSelect: () => selectStep(step.id),
    onWrap: () => setNodes((nodes) => wrapInRepeat(nodes, step.id)),
    onMoveUp: index > 0 ? () => setNodes((nodes) => moveNode(nodes, index, index - 1)) : undefined,
    onMoveDown: index < structure.nodes.length - 1 ? () => setNodes((nodes) => moveNode(nodes, index, index + 1)) : undefined,
  });

  const addStep = (kind: Step["kind"]) => {
    const s = newStep(sport, kind);
    setNodes((nodes) => (kind === "cooldown" ? [...nodes, s] : kind === "warmup" ? [s, ...nodes] : [...nodes, s]));
    setSelected(s.id);
  };

  const changeSport = (next: Sport) => {
    if (next === sport) return;
    if ((next === "strength" || sport === "strength") && structure.nodes.length && !window.confirm("Beim Wechsel zu bzw. von Krafttraining wird das Workout neu begonnen. Fortfahren?")) return;
    setStructure(convertSport(structure, next));
    if (mode === "text") setText(serializeWorkoutText(convertSport(structure, next), thresholds));
  };

  const zoneType = sport === "ride" ? "power" : sport === "run" ? "pace" : null;

  return (
    <div className="animate-fade-up">
      {/* Top bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/workouts" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink">
          <ArrowLeft className="size-4" />
          Workouts
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[13px] text-ink-3 sm:inline">{dirty ? "Nicht gespeichert" : "Gespeichert"}</span>
          <Button variant="ghost" size="icon" onClick={undo} disabled={!past.length} aria-label="Rückgängig" title="Rückgängig (Strg+Z)">
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon" onClick={redo} disabled={!future.length} aria-label="Wiederholen" title="Wiederholen (Strg+Umschalt+Z)">
            <Redo2 />
          </Button>
          <Button variant="secondary" onClick={onSave} loading={saving} disabled={!dirty && !!id}>
            Speichern
          </Button>
          <Button variant="primary" onClick={() => setSendOpen(true)}>
            <Send />
            <span className="hidden sm:inline">An Gerät senden</span>
            <span className="sm:hidden">Senden</span>
          </Button>
          {id ? (
            <div className="relative">
              <Button variant="ghost" size="icon" aria-label="Weitere Aktionen" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                <MoreHorizontal />
              </Button>
              {menuOpen ? (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-11 z-30 w-52 animate-pop overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-overlay">
                    <MenuItem
                      icon={<Copy />}
                      label="Duplizieren"
                      onClick={async () => {
                        setMenuOpen(false);
                        const r = await duplicateWorkout(id);
                        if (r.ok) router.push(`/workouts/${r.data!.id}`);
                      }}
                    />
                    <MenuItem
                      icon={<Trash2 />}
                      label="Löschen"
                      danger
                      onClick={async () => {
                        setMenuOpen(false);
                        if (!window.confirm("Workout wirklich löschen? Geplante Termine werden ebenfalls entfernt.")) return;
                        await deleteWorkout(id);
                        setDirty(false);
                        router.push("/workouts");
                      }}
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Title & meta */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <input
            aria-label="Name des Workouts"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            placeholder="Workout benennen"
            maxLength={80}
            className="w-full rounded-lg border border-transparent bg-transparent px-1 -ml-1 text-[26px] font-semibold tracking-[-0.025em] text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-border focus:border-focus sm:text-[30px]"
          />
          <textarea
            aria-label="Beschreibung"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            rows={1}
            placeholder="Beschreibung oder Hinweise zur Ausführung (optional)"
            maxLength={1000}
            className="mt-1 w-full resize-none rounded-lg border border-transparent bg-transparent px-1 -ml-1 text-[15px] leading-relaxed text-ink-2 outline-none transition-colors [field-sizing:content] placeholder:text-ink-3 hover:border-border focus:border-focus"
          />
        </div>
        <Segmented
          label="Sportart"
          value={sport}
          onChange={changeSport}
          options={(["ride", "run", "strength"] as Sport[]).map((s) => ({
            value: s,
            label: (
              <>
                <SportIcon sport={s} />
                {SPORT_LABEL[s]}
              </>
            ),
          }))}
        />
      </div>

      {/* Summary + chart */}
      <div className="mb-6 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-card">
        <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
          <Stat label="Dauer" value={formatDuration(summary.durationSec, { compact: true })} approx={summary.estimated} />
          {sport === "strength" ? (
            <Stat label="Sätze" value={`${summary.sets}`} />
          ) : (
            <Stat label="Distanz" value={summary.distanceM ? formatDistance(summary.distanceM) : "–"} approx={sport !== "run" || summary.estimated} />
          )}
          <Stat label="Belastung" value={`${summary.tss} TSS`} approx />
          {sport === "strength" ? <Stat label="Wiederholungen" value={`${summary.reps}`} /> : <Stat label="Intensität" value={`IF ${summary.intensityFactor.toFixed(2).replace(".", ",")}`} approx />}
        </div>
        <div className="px-3 pb-2 pt-4 sm:px-5">
          {structure.nodes.length ? (
            <WorkoutChart structure={structure} thresholds={thresholds} height={200} selectedStepId={selected} onSelectStep={selectFromChart} />
          ) : (
            <div className="grid h-[200px] place-items-center text-sm text-ink-3">Füge Schritte hinzu, um das Profil zu sehen.</div>
          )}
        </div>
        {zoneType ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-5 py-2.5">
            {zonesFor(zoneType).map((z) => (
              <span key={z.zone} className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
                <span className="size-2 rounded-full" style={{ background: ZONE_COLOR[z.zone] }} />Z{z.zone} {z.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Editor */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Ablauf</h2>
        <Segmented
          size="sm"
          label="Editor"
          value={mode}
          onChange={switchMode}
          options={[
            { value: "visual", label: (<><LayoutList />Visuell</>) },
            { value: "text", label: (<><Type />Text</>) },
          ]}
        />
      </div>

      {mode === "visual" ? (
        <div className="space-y-2.5">
          <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={structure.nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              {structure.nodes.map((node, index) => (
                <SortableNode key={node.id} id={node.id}>
                  {(handle) =>
                    node.type === "step" ? (
                      <StepRow step={node} sport={sport} thresholds={thresholds} selected={selected === node.id} handlers={topHandlers(node, index)} dragHandle={handle} />
                    ) : (
                      <RepeatBlock
                        repeat={node}
                        sport={sport}
                        thresholds={thresholds}
                        selectedStepId={selected}
                        dragHandle={handle}
                        onChange={(r) => setNodes((nodes) => updateRepeat(nodes, node.id, () => r))}
                        onRemove={() => setNodes((nodes) => removeById(nodes, node.id))}
                        onDuplicate={() => setNodes((nodes) => duplicateById(nodes, node.id))}
                        onUnwrap={() => setNodes((nodes) => unwrapRepeat(nodes, node.id))}
                        onSelectStep={selectStep}
                        onAddStep={() => setNodes((nodes) => updateRepeat(nodes, node.id, (r) => ({ ...r, steps: [...r.steps, newStep(sport, "recovery")] })))}
                        stepHandlers={(s, i) => ({
                          onChange: (next) => setNodes((nodes) => updateStep(nodes, s.id, () => next)),
                          onRemove: () => setNodes((nodes) => removeById(nodes, s.id)),
                          onDuplicate: () => setNodes((nodes) => duplicateById(nodes, s.id)),
                          onSelect: () => selectStep(s.id),
                          onMoveUp: i > 0 ? () => setNodes((nodes) => moveStepInRepeat(nodes, node.id, i, i - 1)) : undefined,
                          onMoveDown: i < node.steps.length - 1 ? () => setNodes((nodes) => moveStepInRepeat(nodes, node.id, i, i + 1)) : undefined,
                        })}
                      />
                    )
                  }
                </SortableNode>
              ))}
            </SortableContext>
          </DndContext>

          {!structure.nodes.length ? (
            <div className="rounded-2xl border border-dashed border-border-strong px-6 py-10 text-center">
              <p className="text-sm font-medium text-ink">Noch keine Schritte</p>
              <p className="mt-1 text-[13px] text-ink-3">Starte mit einem Aufwärmblock oder tippe dein Workout im Text-Modus.</p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {sport === "strength" ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                  <Dumbbell />
                  Übung
                </Button>
                <Button variant="secondary" size="sm" onClick={() => addStep("warmup")}>
                  <Plus />
                  Aufwärmen
                </Button>
                <Button variant="secondary" size="sm" onClick={() => addStep("rest")}>
                  <Plus />
                  Pause
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => addStep("active")}>
                  <Plus />
                  Schritt
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setNodes((nodes) => [...nodes, newRepeat(sport)])}>
                  <RepeatIcon />
                  Intervallblock
                </Button>
                {!structure.nodes.some((n) => n.type === "step" && n.kind === "warmup") ? (
                  <Button variant="ghost" size="sm" onClick={() => addStep("warmup")}>
                    <Plus />
                    Aufwärmen
                  </Button>
                ) : null}
                {!structure.nodes.some((n) => n.type === "step" && n.kind === "cooldown") ? (
                  <Button variant="ghost" size="sm" onClick={() => addStep("cooldown")}>
                    <Plus />
                    Cool-down
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : (
        <TextEditor text={text} onChange={setText} errors={textErrors} sport={sport} />
      )}

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(c) => {
          setPickerOpen(false);
          setNodes((nodes) => [...nodes, newExerciseBlock(c.key, c.sets, c.reps, c.weightKg, c.restSeconds)]);
        }}
      />
      <SendDialog
        open={sendOpen}
        onClose={() => {
          setSendOpen(false);
          if (id && initial.id === null) router.replace(`/workouts/${id}`, { scroll: false });
        }}
        workoutId={dirty ? null : id}
        structure={structure}
        connections={connections}
        ensureSaved={() => save({ navigate: false })}
      />
    </div>
  );
}

function Stat({ label, value, approx }: { label: string; value: string; approx?: boolean }) {
  return (
    <div className="border-border px-5 py-3.5 [&:not(:last-child)]:border-r max-sm:[&:nth-child(2)]:border-r-0 max-sm:[&:nth-child(-n+2)]:border-b">
      <div className="text-[12px] font-medium text-ink-3">{label}</div>
      <div className="mt-0.5 text-[19px] font-semibold tracking-[-0.02em] text-ink">
        {approx && value !== "–" ? <span className="mr-0.5 text-ink-3">≈</span> : null}
        {value}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors [&_svg]:size-4", danger ? "text-critical-ink hover:bg-critical-soft" : "text-ink hover:bg-surface-2")}
    >
      {icon}
      {label}
    </button>
  );
}

const CHEATSHEET: Record<Sport, string[]> = {
  ride: ["Aufwärmen 10min 50-65%", "5x (3min 110%, Erholung 2min 55%)", "2x 20min 88-94% 90rpm / 5min 55%", "15min Z2   ·   250W   ·   GA1", "Cool-down 10min 50%"],
  run: ["Aufwärmen 2km Z1-Z2", "6x (800m 4:00/km, Pause 2min)", "20min 4:40-4:50/km", "30min 145-155bpm", "Cool-down 10min Z1"],
  strength: ["Aufwärmen 5min RPE 3", "4x6 Kniebeuge (Langhantel) 60kg Pause 2min", "3x12 Liegestütz Pause 60s", "3x (45s Unterarmstütz, Pause 30s)"],
};

function TextEditor({ text, onChange, errors, sport }: { text: string; onChange: (t: string) => void; errors: ParseIssue[]; sport: Sport }) {
  const lines = text.split("\n").length;
  const errorLines = new Set(errors.map((e) => e.line));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="self-start overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-card focus-within:border-focus focus-within:shadow-[0_0_0_3px_rgb(42_120_214/0.15)]">
        <div className="flex">
          <div aria-hidden className="select-none border-r border-border bg-surface-2 px-2.5 py-3 text-right font-mono text-[13px] leading-6 text-ink-3">
            {Array.from({ length: Math.max(lines, 6) }, (_, i) => (
              <div key={i} className={cn(errorLines.has(i + 1) && "font-semibold text-critical")}>
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            aria-label="Workout als Text"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            rows={Math.max(lines, 6)}
            className="min-h-[168px] flex-1 resize-y bg-transparent px-3 py-3 font-mono text-[13px] leading-6 text-ink outline-none"
          />
        </div>
        <div className={cn("border-t px-4 py-2.5 text-[13px]", errors.length ? "border-[#f2caca] bg-critical-soft text-critical-ink" : "border-border bg-surface-2/60 text-ink-3")}>
          {errors.length ? (
            <ul className="space-y-0.5">
              {errors.slice(0, 4).map((e, i) => (
                <li key={i}>
                  Zeile {e.line}: {e.message}
                </li>
              ))}
            </ul>
          ) : (
            "Änderungen werden live übernommen."
          )}
        </div>
      </div>
      <aside className="rounded-[var(--radius-card)] border border-border bg-surface-2/60 p-4 text-[13px]">
        <h3 className="font-semibold text-ink">Schreibweise</h3>
        <p className="mt-1 text-ink-2">Ein Schritt pro Zeile. Dauer, Ziel und optional die Rolle.</p>
        <ul className="mt-3 space-y-1.5 font-mono text-[12px] text-ink">
          {CHEATSHEET[sport].map((l) => (
            <li key={l} className="rounded-md bg-surface px-2 py-1 ring-1 ring-border">
              {l}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-ink-3">
          Einheiten: h, min, s, km, m · Ziele: %, W, /km, bpm, Z1–Z7, RPE · Rollen: Aufwärmen, Erholung, Pause, Cool-down
        </p>
      </aside>
    </div>
  );
}
