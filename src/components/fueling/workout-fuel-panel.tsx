"use client";

import { Apple, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { planFueling, sessionFromStructure, TEMP_CLASSES, TEMP_LABEL, type FuelProduct, type FuelProfile, type TempClass } from "@/lib/nutrition";
import type { Thresholds, WorkoutStructure } from "@/lib/workout/types";
import { FuelFigures, FuelSlots, FuelTimeline, FuelWarnings, PackingBlock, fuelSummary } from "./fuel-plan";

export interface FuelContext {
  profile: FuelProfile;
  pantry: FuelProduct[];
}

/** Live fueling plan for the workout being edited. */
export function WorkoutFuelPanel({ structure, thresholds, fuel }: { structure: WorkoutStructure; thresholds: Thresholds; fuel: FuelContext }) {
  const [open, setOpen] = useState(false);
  const [tempClass, setTempClass] = useState<TempClass>("mild");
  const plan = useMemo(() => planFueling(sessionFromStructure(structure, thresholds, { tempClass }), fuel.profile, fuel.pantry), [structure, thresholds, tempClass, fuel]);
  if (!structure.nodes.length) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-2/60">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-brand-soft text-brand-ink [&_svg]:size-4">
          <Apple />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-ink">Verpflegung</span>
          <span className="block truncate text-[13px] text-ink-3">{fuelSummary(plan)}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="border-t border-border">
          <FuelFigures plan={plan} />
          <FuelTimeline plan={plan} />
          <div className="mt-2 border-t border-border">
            <FuelSlots plan={plan} />
          </div>
          <div className="space-y-4 border-t border-border p-4 sm:p-5">
            <FuelWarnings plan={plan} />
            <PackingBlock plan={plan} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                Temperatur
                <Select value={tempClass} onChange={(e) => setTempClass(e.target.value as TempClass)} className="w-52" aria-label="Temperatur">
                  {TEMP_CLASSES.map((t) => (
                    <option key={t} value={t}>
                      {TEMP_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </label>
              <Link href="/fueling" className="text-[13px] font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline">
                Vorher, danach und Vorrat
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
