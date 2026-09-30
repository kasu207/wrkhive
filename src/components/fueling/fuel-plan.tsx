import { AlertTriangle, Backpack, Clock, Coffee, Droplets, Flame, Utensils } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { FuelPlan, FuelSchedule, PostTargets, PreTargets } from "@/lib/nutrition";

/** "1:20" for minutes into the session. */
export function clock(min: number) {
  return `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;
}

export const range = ([a, b]: [number, number], unit: string) => (a === b ? `${a} ${unit}` : `${a}–${b} ${unit}`);

/** One line for lists and the calendar: targets and what to take along. */
export function fuelSummary(plan: FuelPlan): string {
  const d = plan.during;
  const parts: string[] = [];
  if (d.carbsPerHour) parts.push(`${d.carbsPerHour} g KH/h`);
  if (d.fluidMlPerHour) parts.push(`${d.fluidMlPerHour} ml/h`);
  else if (d.fluidToThirst) parts.push("nach Durst trinken");
  if (d.sodiumMgPerHour) parts.push(`${d.sodiumMgPerHour} mg Natrium/h`);
  if (!d.carbsPerHour && !d.fluidMlPerHour && !d.fluidToThirst) parts.push("keine Verpflegung nötig");
  if (!d.carbsPerHour && d.fluidToThirst) parts.unshift("Essen nicht nötig");
  return parts.join(" · ");
}

export function packingSummary(schedule: FuelSchedule): string {
  return schedule.packing.map((p) => `${p.count + p.spare}× ${p.name}`).join(", ");
}

function Figure({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="border-border px-4 py-3 sm:px-5 [&:not(:last-child)]:border-r max-sm:[&:nth-child(2)]:border-r-0 max-sm:[&:nth-child(-n+2)]:border-b">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3 [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-[19px] font-semibold tracking-[-0.02em] text-ink tabular">{value}</div>
      {sub ? <div className="text-[12px] text-ink-3">{sub}</div> : null}
    </div>
  );
}

export function FuelFigures({ plan }: { plan: FuelPlan }) {
  const d = plan.during;
  const caffeine = plan.pre.caffeineMg + d.caffeineMg;
  return (
    <div className={cn("grid grid-cols-2 border-b border-border", caffeine ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
      <Figure icon={<Flame />} label="Kohlenhydrate" value={d.carbsPerHour ? `${d.carbsPerHour} g/h` : "–"} sub={plan.schedule.totals.carbsG ? `${plan.schedule.totals.carbsG} g gesamt` : "nicht nötig"} />
      <Figure
        icon={<Droplets />}
        label="Trinken"
        value={d.fluidMlPerHour ? `${d.fluidMlPerHour} ml/h` : "nach Durst"}
        sub={`Schweiß ${d.sweatMeasured ? "gemessen" : "≈"} ${formatNumber(d.sweatRateLh, 1)} l/h`}
      />
      <Figure icon={<Utensils />} label="Natrium" value={d.sodiumMgPerHour ? `${d.sodiumMgPerHour} mg/h` : "optional"} sub={plan.schedule.totals.sodiumMg ? `${plan.schedule.totals.sodiumMg} mg geplant` : undefined} />
      {caffeine ? <Figure icon={<Coffee />} label="Koffein" value={`${caffeine} mg`} sub={d.caffeineMg ? `${plan.pre.caffeineMg} vorher, ${d.caffeineMg} unterwegs` : "vor dem Start"} /> : null}
    </div>
  );
}

/** Horizontal session bar with a marker per intake. */
export function FuelTimeline({ plan }: { plan: FuelPlan }) {
  const total = plan.input.durationSec / 60;
  const slots = plan.schedule.slots;
  if (!slots.length || total <= 0) return null;
  return (
    <div className="px-4 pt-4 sm:px-5">
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-3" />
        {slots.map((s) => {
          const food = s.items.some((it) => it.productId !== "salt-tab");
          return (
            <span
              key={s.atMin}
              title={`${clock(s.atMin)}: ${s.items.map((it) => `${it.count}× ${it.name}`).join(", ") || "trinken"}`}
              className={cn("absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface", food ? "bg-brand" : "bg-focus")}
              style={{ left: `${(s.atMin / total) * 100}%` }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-ink-3 tabular">
        <span>0:00</span>
        <span>{clock(total)}</span>
      </div>
    </div>
  );
}

export function FuelSlots({ plan }: { plan: FuelPlan }) {
  const slots = plan.schedule.slots;
  if (!slots.length) return null;
  return (
    <ol className="divide-y divide-border">
      {slots.map((s) => (
        <li key={s.atMin} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
          <span className="w-11 shrink-0 pt-px text-[13px] font-semibold text-ink tabular">{clock(s.atMin)}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] text-ink">{s.items.length ? s.items.map((it) => `${it.count}× ${it.name}`).join(" + ") : <span className="text-ink-2">Aus der Flasche trinken</span>}</div>
            {s.note ? <div className="text-[12px] text-ink-3">{s.note}</div> : null}
          </div>
          <span className="shrink-0 text-right text-[12px] leading-5 text-ink-3 tabular">
            {s.carbsG ? `${s.carbsG} g` : ""}
            {s.carbsG && s.fluidMl ? " · " : ""}
            {s.fluidMl ? `${s.fluidMl} ml` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Block({ title, icon, children, className }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-surface p-4", className)}>
      <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-ink [&_svg]:size-4 [&_svg]:text-ink-3">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <ul className="mt-2 space-y-1.5 text-[13px] leading-snug text-ink-2">
      {notes.map((n) => (
        <li key={n} className="flex gap-2">
          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" />
          {n}
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
      <span className="text-ink-2">{label}</span>
      <span className="whitespace-nowrap text-right font-medium text-ink tabular">{value}</span>
    </div>
  );
}

export function PreBlock({ pre }: { pre: PreTargets }) {
  return (
    <Block title="Vorher" icon={<Clock />}>
      {pre.loading ? <Row label={`Carb-Loading, ${range(pre.loading.hours, "h")} vorher`} value={`${range(pre.loading.carbsGPerDay, "g")}/Tag`} /> : null}
      {pre.meal ? <Row label={`Mahlzeit ${range(pre.meal.hoursBefore, "h")} vorher`} value={`${range(pre.meal.carbsG, "g")} KH`} /> : null}
      {pre.snack ? <Row label={`Snack ${range(pre.snack.minutesBefore, "min")} vorher`} value={`${range(pre.snack.carbsG, "g")} KH`} /> : null}
      <Row label="Trinken 2–4 h vorher" value={range(pre.fluidMl, "ml")} />
      {pre.caffeineMg ? <Row label="Koffein 45–60 min vorher" value={`${pre.caffeineMg} mg`} /> : null}
      <Notes notes={pre.notes} />
    </Block>
  );
}

export function PostBlock({ post }: { post: PostTargets }) {
  return (
    <Block title="Danach" icon={<Utensils />}>
      {post.carbsG[1] > 0 ? <Row label={post.urgent ? `Kohlenhydrate pro Stunde, ${post.carbsHours} h lang` : "Kohlenhydrate mit der nächsten Mahlzeit"} value={`${range(post.carbsG, "g")}`} /> : null}
      <Row label="Protein" value={`${post.proteinG} g`} />
      {post.fluidMl >= 300 ? <Row label="Trinken" value={`${post.fluidMl} ml`} /> : null}
      <Notes notes={post.notes} />
    </Block>
  );
}

export function PackingBlock({ plan }: { plan: FuelPlan }) {
  const s = plan.schedule;
  if (!s.packing.length && !s.waterMl) return null;
  const bottle = plan.input.sport === "run" ? 500 : 750;
  const bottles = Math.ceil(s.waterMl / bottle);
  return (
    <Block title="Packliste" icon={<Backpack />}>
      <ul className="grid gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
        {s.packing.map((p) => (
          <li key={p.productId} className="flex items-baseline justify-between gap-3">
            <span className="text-ink">
              <span className="font-semibold tabular">{p.count}×</span> {p.name}
              {p.spare ? <span className="text-ink-3"> + {p.spare} Reserve</span> : null}
            </span>
            <span className="text-right text-[12px] text-ink-3">{p.servingLabel}</span>
          </li>
        ))}
        {s.waterMl ? (
          <li className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5 sm:col-span-2">
            <span className="text-ink">
              <span className="font-semibold tabular">{formatNumber(s.waterMl / 1000, 1)} l</span> Flüssigkeit
            </span>
            <span className="text-right text-[12px] text-ink-3">
              {bottles}× {plan.input.sport === "run" ? "Softflask" : "Flasche"} à {bottle} ml
            </span>
          </li>
        ) : null}
      </ul>
    </Block>
  );
}

export function FuelWarnings({ plan }: { plan: FuelPlan }) {
  const warnings = [...plan.during.warnings, ...plan.schedule.warnings];
  if (!warnings.length) return null;
  return (
    <div className="space-y-1.5 rounded-xl border border-[#f5dca6] bg-warning-soft px-4 py-3 text-[13px] text-warning-ink">
      {warnings.map((w) => (
        <p key={w} className="flex gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {w}
        </p>
      ))}
    </div>
  );
}

export function FuelRationale({ plan }: { plan: FuelPlan }) {
  return (
    <details className="group rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-[13px]">
      <summary className="cursor-pointer select-none font-medium text-ink-2 hover:text-ink">Warum diese Werte?</summary>
      <Notes notes={plan.during.rationale} />
      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        Grundlage: Positionspapiere von ACSM (2007, 2016), DGE (2020), ISSN (2017, 2021) und aktuelle Studien zu Kohlenhydraten bis 120 g/h. Die Werte sind Orientierung, keine medizinische Beratung. Probiere Neues im Training aus, nie im Wettkampf.
      </p>
    </details>
  );
}

/** Full plan: figures, warnings, timeline, before/after and packing list. */
export function FuelPlanView({ plan, header }: { plan: FuelPlan; header?: ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-card">
        {header}
        <FuelFigures plan={plan} />
        {plan.schedule.slots.length ? (
          <>
            <FuelTimeline plan={plan} />
            <div className="mt-2 border-t border-border">
              <FuelSlots plan={plan} />
            </div>
          </>
        ) : (
          <p className="px-5 py-4 text-[14px] text-ink-2">{plan.during.rationale[0] ?? "Während der Einheit ist keine Verpflegung nötig."}</p>
        )}
      </div>
      <FuelWarnings plan={plan} />
      <PackingBlock plan={plan} />
      <div className="grid gap-4 md:grid-cols-2">
        <PreBlock pre={plan.pre} />
        <PostBlock post={plan.post} />
      </div>
      <FuelRationale plan={plan} />
    </div>
  );
}
