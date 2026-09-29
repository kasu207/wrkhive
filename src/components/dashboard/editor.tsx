"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, EyeOff, GripVertical, LayoutGrid, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { resetDashboard, saveDashboard } from "@/app/actions/dashboard";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { DEFAULT_GOAL, GROUP_LABEL, WIDGET_IDS, WIDGETS, type DashboardLayout, type LayoutItem, type WidgetGroup, type WidgetId, type WidgetSize } from "@/lib/dashboard";

const SIZE_LABEL: Record<WidgetSize, string> = { s: "Kachel", m: "Halb", l: "Breit" };
const GROUPS = Object.keys(GROUP_LABEL) as WidgetGroup[];

/**
 * Assembles the athlete's own dashboard: switch widgets on and off, reorder
 * them (drag, keyboard or arrows) and pick a size. Widgets without data say
 * where their data would come from.
 */
export function DashboardEditor({ layout, hints }: { layout: DashboardLayout; hints: Partial<Record<WidgetId, string>> }) {
  const router = useRouter();
  const toast = useToast();
  const dndId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DashboardLayout>(layout);
  const [pending, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const visible = new Set(items.map((i) => i.id));
  const hidden = WIDGET_IDS.filter((id) => !visible.has(id));

  const update = (id: WidgetId, patch: Partial<LayoutItem>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const move = (index: number, by: number) => setItems((list) => (index + by < 0 || index + by >= list.length ? list : arrayMove(list, index, index + by)));
  const remove = (id: WidgetId) => setItems((list) => list.filter((i) => i.id !== id));
  const add = (id: WidgetId) => setItems((list) => [...list, { id, size: WIDGETS[id].sizes[0] === "s" ? "s" : "m", ...(id === "consistency" ? { goal: DEFAULT_GOAL } : {}) }]);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setItems((list) => arrayMove(list, list.findIndex((i) => i.id === e.active.id), list.findIndex((i) => i.id === e.over!.id)));
  };

  const save = () =>
    start(async () => {
      const r = await saveDashboard(items);
      if (!r.ok) return toast({ tone: "error", title: "Nicht gespeichert", description: r.error });
      toast({ tone: "success", title: "Übersicht gespeichert" });
      setOpen(false);
      router.refresh();
    });
  const reset = () =>
    start(async () => {
      const r = await resetDashboard();
      if (!r.ok) return toast({ tone: "error", title: "Fehler", description: r.error });
      toast({ tone: "success", title: "Standard wiederhergestellt" });
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setItems(layout);
          setOpen(true);
        }}
      >
        <LayoutGrid /> Anpassen
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Übersicht anpassen"
        description="Zeig nur, was du auch erfasst und nutzt. Ziehen oder Pfeile ändern die Reihenfolge."
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
              Standard wiederherstellen
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Abbrechen
              </Button>
              <Button onClick={save} loading={pending}>
                Speichern
              </Button>
            </div>
          </div>
        }
      >
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Angezeigt ({items.length})</h3>
          {items.length ? (
            <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-1.5">
                  {items.map((item, index) => (
                    <SortableRow
                      key={item.id}
                      item={item}
                      hint={hints[item.id]}
                      first={index === 0}
                      last={index === items.length - 1}
                      onMove={(by) => move(index, by)}
                      onRemove={() => remove(item.id)}
                      onChange={(patch) => update(item.id, patch)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="rounded-xl bg-surface-2/70 p-4 text-[13px] text-ink-2">Nichts ausgewählt. Füge unten Widgets hinzu.</p>
          )}
        </section>

        {hidden.length ? (
          <section className="mt-6">
            <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Ausgeblendet</h3>
            <div className="space-y-4">
              {GROUPS.map((group) => {
                const ids = hidden.filter((id) => WIDGETS[id].group === group);
                if (!ids.length) return null;
                return (
                  <div key={group}>
                    <p className="mb-1.5 text-[12px] font-medium text-ink-3">{GROUP_LABEL[group]}</p>
                    <ul className="space-y-1.5">
                      {ids.map((id) => (
                        <li key={id} className="flex items-start gap-3 rounded-xl border border-dashed border-border-strong px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-medium">{WIDGETS[id].title}</div>
                            <p className="text-[12px] leading-relaxed text-ink-3">{WIDGETS[id].description}</p>
                            {hints[id] ? <p className="mt-0.5 text-[12px] leading-relaxed text-warning-ink">Noch keine Daten: {hints[id]}</p> : null}
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => add(id)} aria-label={`${WIDGETS[id].title} hinzufügen`}>
                            <Plus /> Hinzufügen
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </Dialog>
    </>
  );
}

function SortableRow({
  item,
  hint,
  first,
  last,
  onMove,
  onRemove,
  onChange,
}: {
  item: LayoutItem;
  hint?: string;
  first: boolean;
  last: boolean;
  onMove: (by: number) => void;
  onRemove: () => void;
  onChange: (patch: Partial<LayoutItem>) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const meta = WIDGETS[item.id];
  const sizes: readonly WidgetSize[] = meta.sizes;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-xl border border-border bg-surface px-2 py-2", isDragging && "relative z-10 shadow-overlay")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`${meta.title} verschieben`}
        className="grid w-6 cursor-grab touch-none place-items-center self-stretch rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{meta.title}</div>
        {hint ? <p className="truncate text-[12px] text-warning-ink">Noch keine Daten</p> : <p className="truncate text-[12px] text-ink-3">{meta.description}</p>}
        {sizes.length > 1 || item.id === "consistency" ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {sizes.length > 1 ? (
              <Segmented size="sm" label={`Größe ${meta.title}`} value={item.size} onChange={(size) => onChange({ size })} options={sizes.map((s) => ({ value: s, label: SIZE_LABEL[s] }))} />
            ) : null}
            {item.id === "consistency" ? (
              <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
                Ziel
                <select
                  value={item.goal ?? DEFAULT_GOAL}
                  onChange={(e) => onChange({ goal: Number(e.target.value) })}
                  className="h-7 rounded-lg border border-border bg-surface px-1.5 text-[13px] text-ink"
                  aria-label="Einheiten pro Woche"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14].map((n) => (
                    <option key={n} value={n}>
                      {n} pro Woche
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0">
        <Button size="icon-sm" variant="ghost" onClick={() => onMove(-1)} disabled={first} aria-label={`${meta.title} nach oben`}>
          <ArrowUp />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => onMove(1)} disabled={last} aria-label={`${meta.title} nach unten`}>
          <ArrowDown />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label={`${meta.title} ausblenden`}>
          <EyeOff />
        </Button>
      </div>
    </li>
  );
}
