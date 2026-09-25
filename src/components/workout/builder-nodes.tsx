"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Copy, GripVertical, Minus, Plus, Repeat as RepeatIcon, Trash2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { stepTitle, ZONE_COLOR } from "@/lib/workout/display";
import { getExercise } from "@/lib/workout/exercises";
import { stepSeconds } from "@/lib/workout/metrics";
import { STEP_KINDS, STEP_KIND_LABEL, type Repeat, type Sport, type Step, type Thresholds } from "@/lib/workout/types";
import { targetZone } from "@/lib/workout/zones";
import { CadenceField, DurationField, selectBase, TargetField } from "./step-fields";

function IconAction({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "grid size-8 place-items-center rounded-lg text-ink-3 transition-colors [&_svg]:size-4",
        danger ? "hover:bg-critical-soft hover:text-critical-ink" : "hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export interface StepHandlers {
  onChange: (s: Step) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSelect: () => void;
  onWrap?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function StepRow({
  step,
  sport,
  thresholds,
  selected,
  handlers,
  dragHandle,
  nested,
}: {
  step: Step;
  sport: Sport;
  thresholds: Thresholds;
  selected: boolean;
  handlers: StepHandlers;
  dragHandle?: ReactNode;
  nested?: boolean;
}) {
  const zone = targetZone(step.target, step.kind);
  const exercise = step.exercise ? getExercise(step.exercise.key) : undefined;
  const seconds = stepSeconds(step, sport, thresholds);

  return (
    <div
      id={`step-${step.id}`}
      onFocusCapture={handlers.onSelect}
      onClick={handlers.onSelect}
      className={cn(
        "group relative flex gap-2 rounded-xl border bg-surface p-2.5 pl-2 transition-[border-color,box-shadow] duration-150 sm:gap-3 sm:p-3",
        selected ? "border-ink/60 shadow-[0_0_0_3px_rgb(17_17_16/0.06)]" : "border-border hover:border-border-strong",
      )}
    >
      <div className="flex shrink-0 items-stretch gap-1.5">
        {dragHandle ?? <span className="w-5" />}
        <span className="w-1 rounded-full" style={{ background: ZONE_COLOR[zone] }} aria-hidden />
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {exercise ? (
            <span className="text-[14px] font-semibold text-ink">{exercise.label}</span>
          ) : (
            <select
              aria-label="Abschnitt"
              className={cn(selectBase, "h-8 w-[124px] font-medium")}
              value={step.kind}
              onChange={(e) => handlers.onChange({ ...step, kind: e.target.value as Step["kind"] })}
            >
              {STEP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {STEP_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
          {!exercise ? (
            <input
              aria-label="Name des Schritts"
              value={step.name ?? ""}
              placeholder={stepTitle({ ...step, name: undefined })}
              maxLength={60}
              onChange={(e) => handlers.onChange({ ...step, name: e.target.value || undefined })}
              className="h-8 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-border focus:border-focus"
            />
          ) : (
            <span className="flex-1" />
          )}
          <span className="text-[12px] text-ink-3 tabular">{step.duration.type === "open" || step.duration.type === "reps" ? "" : `≈ ${formatDuration(seconds, { compact: true })}`}</span>
          <div className="flex items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            {handlers.onMoveUp ? (
              <IconAction label="Nach oben" onClick={handlers.onMoveUp}>
                <ArrowUp />
              </IconAction>
            ) : null}
            {handlers.onMoveDown ? (
              <IconAction label="Nach unten" onClick={handlers.onMoveDown}>
                <ArrowDown />
              </IconAction>
            ) : null}
            {handlers.onWrap && !nested ? (
              <IconAction label="In Wiederholung umwandeln" onClick={handlers.onWrap}>
                <RepeatIcon />
              </IconAction>
            ) : null}
            <IconAction label="Duplizieren" onClick={handlers.onDuplicate}>
              <Copy />
            </IconAction>
            <IconAction label="Entfernen" onClick={handlers.onRemove} danger>
              <Trash2 />
            </IconAction>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <DurationField duration={step.duration} sport={sport} onChange={(duration) => handlers.onChange({ ...step, duration })} />
          {exercise ? (
            exercise.weighted ? (
              <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <input
                  aria-label="Gewicht in kg"
                  inputMode="decimal"
                  defaultValue={step.exercise?.weightKg ?? ""}
                  key={`${step.id}-${step.exercise?.weightKg ?? ""}`}
                  placeholder="–"
                  onBlur={(e) => {
                    const v = Number(e.target.value.replace(",", "."));
                    const weightKg = e.target.value.trim() === "" || !Number.isFinite(v) || v <= 0 ? undefined : Math.min(500, v);
                    handlers.onChange({ ...step, exercise: { key: step.exercise!.key, ...(weightKg !== undefined ? { weightKg } : {}) } });
                  }}
                  className="h-9 w-[72px] rounded-[9px] border border-border-strong bg-surface px-2.5 text-right text-sm tabular outline-none focus:border-focus"
                />
                kg
              </label>
            ) : (
              <span className="text-[13px] text-ink-3">Körpergewicht</span>
            )
          ) : (
            <TargetField target={step.target} sport={sport} kind={step.kind} thresholds={thresholds} onChange={(target) => handlers.onChange({ ...step, target })} />
          )}
          {sport === "ride" && !exercise ? <CadenceField cadence={step.cadence} onChange={(cadence) => handlers.onChange({ ...step, cadence })} /> : null}
        </div>
      </div>
    </div>
  );
}

export function RepeatBlock({
  repeat,
  sport,
  thresholds,
  selectedStepId,
  dragHandle,
  onChange,
  onRemove,
  onDuplicate,
  onUnwrap,
  onSelectStep,
  onAddStep,
  stepHandlers,
}: {
  repeat: Repeat;
  sport: Sport;
  thresholds: Thresholds;
  selectedStepId: string | null;
  dragHandle?: ReactNode;
  onChange: (r: Repeat) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onUnwrap: () => void;
  onSelectStep: (id: string) => void;
  onAddStep: () => void;
  stepHandlers: (step: Step, index: number) => StepHandlers;
}) {
  const exercise = sport === "strength" && repeat.steps[0]?.exercise;
  const setCount = (count: number) => onChange({ ...repeat, count: Math.min(99, Math.max(1, count)) });
  const totalSec = repeat.steps.reduce((a, s) => a + stepSeconds(s, sport, thresholds), 0) * repeat.count;

  return (
    <div className="rounded-2xl border border-border bg-surface-2/70 p-2 sm:p-2.5">
      <div className="flex flex-wrap items-center gap-2 px-1 pb-2 pt-0.5">
        {dragHandle}
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <RepeatIcon className="size-4 text-ink-3" />
          {exercise ? "Sätze" : "Wiederholung"}
        </span>
        <div className="flex items-center rounded-[10px] border border-border-strong bg-surface shadow-card">
          <button type="button" aria-label="Weniger" onClick={() => setCount(repeat.count - 1)} className="grid size-8 place-items-center rounded-l-[9px] text-ink-2 hover:bg-surface-2 disabled:opacity-40" disabled={repeat.count <= 1}>
            <Minus className="size-4" />
          </button>
          <input
            aria-label="Anzahl"
            inputMode="numeric"
            value={repeat.count}
            onChange={(e) => {
              const v = Number(e.target.value.replace(/\D/g, ""));
              if (v) setCount(v);
            }}
            className="h-8 w-10 border-x border-border bg-transparent text-center text-sm font-semibold tabular outline-none"
          />
          <button type="button" aria-label="Mehr" onClick={() => setCount(repeat.count + 1)} className="grid size-8 place-items-center rounded-r-[9px] text-ink-2 hover:bg-surface-2">
            <Plus className="size-4" />
          </button>
        </div>
        <span className="text-[12px] text-ink-3 tabular">× · ≈ {formatDuration(totalSec, { compact: true })}</span>
        <div className="ml-auto flex items-center">
          <IconAction label="Schritt hinzufügen" onClick={onAddStep}>
            <Plus />
          </IconAction>
          <IconAction label="Wiederholung auflösen" onClick={onUnwrap}>
            <Undo2 />
          </IconAction>
          <IconAction label="Block duplizieren" onClick={onDuplicate}>
            <Copy />
          </IconAction>
          <IconAction label="Block entfernen" onClick={onRemove} danger>
            <Trash2 />
          </IconAction>
        </div>
      </div>
      <div className="space-y-2">
        {repeat.steps.map((s, i) => (
          <StepRow key={s.id} step={s} sport={sport} thresholds={thresholds} selected={selectedStepId === s.id} handlers={{ ...stepHandlers(s, i), onSelect: () => onSelectStep(s.id) }} nested />
        ))}
      </div>
    </div>
  );
}

/** Sortable wrapper providing a drag handle for a top-level node. */
export function SortableNode({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Verschieben"
      className="grid w-5 cursor-grab touch-none place-items-center self-stretch rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink active:cursor-grabbing"
    >
      <GripVertical className="size-4" />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-90 [&>*]:shadow-overlay")}
    >
      {children(handle)}
    </div>
  );
}
