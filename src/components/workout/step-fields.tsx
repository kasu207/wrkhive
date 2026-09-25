"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatPace } from "@/lib/format";
import type { Duration, Sport, Step, Target, TargetType, Thresholds } from "@/lib/workout/types";
import { zoneRange, zonesFor, type ZoneIndex } from "@/lib/workout/zones";
import { ZONE_COLOR } from "@/lib/workout/display";

const inputBase =
  "h-9 rounded-[9px] border border-border-strong bg-surface px-2.5 text-sm text-ink tabular outline-none transition-[border-color,box-shadow] hover:border-[#c4c3bb] focus:border-focus focus:shadow-[0_0_0_3px_rgb(42_120_214/0.15)] aria-[invalid=true]:border-critical";

const selectBase = cn(inputBase, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><path d=%22M4 6l4 4 4-4%22 fill=%22none%22 stroke=%22%2382817b%22 stroke-width=%221.6%22 stroke-linecap=%22round%22/></svg>')] bg-[length:14px] bg-[right_8px_center] bg-no-repeat pr-7");

/** Parses "10" (min), "10:30", "1:00:00", "90s", "1h 5min". */
export function parseTimeInput(text: string): number | null {
  const s = text.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60);
  const hms = /^(\d+):([0-5]?\d)(?::([0-5]\d))?$/.exec(s);
  if (hms) return hms[3] !== undefined ? Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) : Number(hms[1]) * 60 + Number(hms[2]);
  let total = 0;
  let found = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|std|min|m|s|sek)/g)) {
    found = true;
    const v = Number(m[1]);
    total += m[2] === "h" || m[2] === "std" ? v * 3600 : m[2] === "s" || m[2] === "sek" ? v : v * 60;
  }
  return found ? Math.round(total) : null;
}

export function formatTimeInput(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

interface CommitInputProps {
  value: number;
  format: (v: number) => string;
  parse: (s: string) => number | null;
  className?: string;
  "aria-label": string;
  onCommit: (v: number) => void;
  inputMode?: "numeric" | "decimal" | "text";
}

/**
 * Text input that commits a parsed value on blur / Enter and flags invalid
 * input. Keyed by the formatted value so external changes reset the draft.
 */
function CommitInput(props: CommitInputProps) {
  const formatted = props.format(props.value);
  return <CommitInputInner key={formatted} formatted={formatted} {...props} />;
}

function CommitInputInner({ formatted, parse, className, onCommit, inputMode, "aria-label": ariaLabel }: CommitInputProps & { formatted: string }) {
  const [draft, setDraft] = useState(formatted);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft.trim() === formatted) {
      setInvalid(false);
      return;
    }
    const v = parse(draft);
    if (v === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(v);
  };
  return (
    <input
      aria-label={ariaLabel}
      inputMode={inputMode}
      value={draft}
      aria-invalid={invalid || undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(formatted);
          setInvalid(false);
        }
      }}
      className={cn(inputBase, className)}
    />
  );
}

const fmtInt = (v: number) => String(Math.round(v));
const fmtKm = (m: number) => (m / 1000).toLocaleString("de-DE", { maximumFractionDigits: 3 });

export function DurationField({ duration, sport, onChange }: { duration: Duration; sport: Sport; onChange: (d: Duration) => void }) {
  const kinds: { value: Duration["type"]; label: string }[] =
    sport === "strength"
      ? [
          { value: "reps", label: "Wdh." },
          { value: "time", label: "Zeit" },
          { value: "open", label: "Offen" },
        ]
      : [
          { value: "time", label: "Zeit" },
          { value: "distance", label: "Distanz" },
          { value: "open", label: "Offen" },
        ];
  const switchType = (type: Duration["type"]) => {
    if (type === duration.type) return;
    if (type === "time") onChange({ type: "time", seconds: 300 });
    if (type === "distance") onChange({ type: "distance", meters: 1000 });
    if (type === "reps") onChange({ type: "reps", reps: 10 });
    if (type === "open") onChange({ type: "open" });
  };
  return (
    <div className="flex items-center gap-1.5">
      <select aria-label="Art der Dauer" className={cn(selectBase, "w-[92px]")} value={duration.type} onChange={(e) => switchType(e.target.value as Duration["type"])}>
        {kinds.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      {duration.type === "time" ? (
        <CommitInput
          aria-label="Dauer (mm:ss)"
          value={duration.seconds}
          format={formatTimeInput}
          parse={(s) => {
            const v = parseTimeInput(s);
            return v && v > 0 && v <= 12 * 3600 ? v : null;
          }}
          onCommit={(seconds) => onChange({ type: "time", seconds })}
          className="w-[84px] text-right"
        />
      ) : duration.type === "distance" ? (
        <div className="relative">
          <CommitInput
            aria-label="Distanz in km"
            inputMode="decimal"
            value={duration.meters}
            format={fmtKm}
            parse={(s) => {
              const v = Number(s.replace(",", "."));
              return Number.isFinite(v) && v > 0 && v <= 300 ? Math.round(v * 1000) : null;
            }}
            onCommit={(meters) => onChange({ type: "distance", meters })}
            className="w-[92px] pr-8 text-right"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">km</span>
        </div>
      ) : duration.type === "reps" ? (
        <CommitInput
          aria-label="Wiederholungen"
          inputMode="numeric"
          value={duration.reps}
          format={fmtInt}
          parse={(s) => {
            const v = Number(s);
            return Number.isInteger(v) && v >= 1 && v <= 500 ? v : null;
          }}
          onCommit={(reps) => onChange({ type: "reps", reps })}
          className="w-[64px] text-right"
        />
      ) : (
        <span className="px-1 text-[13px] text-ink-3">bis Runden-Taste</span>
      )}
    </div>
  );
}

function targetTypesFor(sport: Sport): { value: TargetType; label: string }[] {
  if (sport === "ride")
    return [
      { value: "power", label: "Leistung" },
      { value: "hr", label: "Puls" },
      { value: "rpe", label: "RPE" },
      { value: "none", label: "Kein Ziel" },
    ];
  if (sport === "run")
    return [
      { value: "pace", label: "Pace" },
      { value: "hr", label: "Puls" },
      { value: "rpe", label: "RPE" },
      { value: "none", label: "Kein Ziel" },
    ];
  return [
    { value: "rpe", label: "RPE" },
    { value: "none", label: "Kein Ziel" },
  ];
}

export function TargetField({ target, sport, kind, thresholds, onChange }: { target: Target; sport: Sport; kind: Step["kind"]; thresholds: Thresholds; onChange: (t: Target) => void }) {
  const t = thresholds;
  const switchType = (type: TargetType) => {
    if (type === target.type) return;
    if (type === "none") return onChange({ type: "none" });
    if (type === "rpe") return onChange({ type: "rpe", value: kind === "active" ? 7 : 3 });
    const zone: ZoneIndex = kind === "active" ? 4 : kind === "rest" ? 1 : 2;
    const r = zoneRange(type, zone);
    onChange({ type, low: r.low, high: r.high });
  };

  const range = target.type === "power" || target.type === "hr" || target.type === "pace" ? target : null;
  const setRange = (low: number, high: number) => {
    if (!range) return;
    const lo = Math.round(Math.min(low, high) * 10) / 10;
    const hi = Math.round(Math.max(low, high) * 10) / 10;
    onChange({ type: range.type, low: lo, high: hi } as Target);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select aria-label="Zieltyp" className={cn(selectBase, "w-[112px]")} value={target.type} onChange={(e) => switchType(e.target.value as TargetType)}>
        {targetTypesFor(sport).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {target.type === "power" ? (
        <RangeInputs
          low={target.low}
          high={target.high}
          unit="%"
          format={fmtInt}
          parse={(s) => {
            const v = Number(s.replace(",", "."));
            return Number.isFinite(v) && v >= 20 && v <= 250 ? v : null;
          }}
          onChange={setRange}
          hint={`${Math.round((target.low / 100) * t.ftp)}${target.low !== target.high ? `–${Math.round((target.high / 100) * t.ftp)}` : ""} W`}
        />
      ) : target.type === "hr" ? (
        <RangeInputs
          low={(target.low / 100) * t.lthr}
          high={(target.high / 100) * t.lthr}
          unit="bpm"
          format={fmtInt}
          parse={(s) => {
            const v = Number(s);
            return Number.isFinite(v) && v >= 60 && v <= 230 ? v : null;
          }}
          onChange={(lo, hi) => setRange((lo / t.lthr) * 100, (hi / t.lthr) * 100)}
          hint={`${Math.round(target.low)}${target.low !== target.high ? `–${Math.round(target.high)}` : ""} % LTHR`}
        />
      ) : target.type === "pace" ? (
        <RangeInputs
          // low % = slower pace (more seconds per km)
          low={t.thresholdPace / (target.low / 100)}
          high={t.thresholdPace / (target.high / 100)}
          unit="/km"
          format={(v) => formatPace(v)}
          parse={(s) => {
            const m = /^(\d{1,2}):([0-5]\d)$/.exec(s.trim());
            if (!m) return null;
            const v = Number(m[1]) * 60 + Number(m[2]);
            return v >= 120 && v <= 900 ? v : null;
          }}
          onChange={(slow, fast) => setRange((t.thresholdPace / Math.max(slow, fast)) * 100, (t.thresholdPace / Math.min(slow, fast)) * 100)}
          hint={`${Math.round(target.low)}${target.low !== target.high ? `–${Math.round(target.high)}` : ""} % Schwelle`}
        />
      ) : target.type === "rpe" ? (
        <select aria-label="RPE" className={cn(selectBase, "w-[76px]")} value={target.value} onChange={(e) => onChange({ type: "rpe", value: Number(e.target.value) })}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : null}

      {range ? <ZonePicker type={range.type} onPick={(z) => { const r = zoneRange(range.type, z); onChange({ type: range.type, low: r.low, high: r.high } as Target); }} /> : null}
    </div>
  );
}

function RangeInputs({
  low,
  high,
  unit,
  format,
  parse,
  onChange,
  hint,
}: {
  low: number;
  high: number;
  unit: string;
  format: (v: number) => string;
  parse: (s: string) => number | null;
  onChange: (low: number, high: number) => void;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <CommitInput aria-label={`Untergrenze (${unit})`} value={low} format={format} parse={parse} onCommit={(v) => onChange(v, high)} className="w-[64px] text-right" />
      <span className="text-ink-3">–</span>
      <CommitInput aria-label={`Obergrenze (${unit})`} value={high} format={format} parse={parse} onCommit={(v) => onChange(low, v)} className="w-[64px] text-right" />
      <span className="text-[12px] text-ink-3">{unit}</span>
      <span className="hidden text-[12px] text-ink-3 tabular xl:inline">· {hint}</span>
    </div>
  );
}

function ZonePicker({ type, onPick }: { type: "power" | "hr" | "pace"; onPick: (z: ZoneIndex) => void }) {
  const zones = zonesFor(type);
  return (
    <div className="flex items-center gap-0.5 rounded-[9px] border border-border bg-surface-2 p-0.5" role="group" aria-label="Zone wählen">
      {zones.map((z) => (
        <button
          key={z.zone}
          type="button"
          title={`Z${z.zone} · ${z.name}`}
          onClick={() => onPick(z.zone)}
          className="grid h-7 w-6 place-items-center rounded-[7px] text-[11px] font-semibold text-ink-2 transition-colors hover:bg-surface hover:text-ink"
        >
          <span className="relative">
            {z.zone}
            <span className="absolute -bottom-1 left-1/2 h-[3px] w-3 -translate-x-1/2 rounded-full" style={{ background: ZONE_COLOR[z.zone] }} />
          </span>
        </button>
      ))}
    </div>
  );
}

export function CadenceField({ cadence, onChange }: { cadence: Step["cadence"]; onChange: (c: Step["cadence"]) => void }) {
  if (!cadence) {
    return (
      <button type="button" onClick={() => onChange({ low: 85, high: 95 })} className="h-9 rounded-[9px] px-2 text-[13px] font-medium text-ink-3 hover:bg-surface-2 hover:text-ink">
        + Trittfrequenz
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <RangeInputs
        low={cadence.low}
        high={cadence.high}
        unit="rpm"
        format={fmtInt}
        parse={(s) => {
          const v = Number(s);
          return Number.isInteger(v) && v >= 30 && v <= 200 ? v : null;
        }}
        onChange={(lo, hi) => onChange({ low: Math.min(lo, hi), high: Math.max(lo, hi) })}
        hint="Kadenz"
      />
      <button type="button" onClick={() => onChange(undefined)} className="h-9 rounded-[9px] px-2 text-[13px] text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Trittfrequenz entfernen">
        ×
      </button>
    </div>
  );
}

export { selectBase, inputBase };
