"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createManualActivity } from "@/app/actions/activities";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, UnitInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { RPE_TSS_PER_HOUR } from "@/lib/analytics/load";

/** Session-RPE after Foster (CR-10). */
export const RPE_LABEL: Record<number, string> = {
  1: "Sehr leicht",
  2: "Leicht",
  3: "Moderat",
  4: "Etwas anstrengend",
  5: "Anstrengend",
  6: "Deutlich anstrengend",
  7: "Sehr anstrengend",
  8: "Sehr, sehr anstrengend",
  9: "Fast maximal",
  10: "Maximal",
};

/** Value for <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Default start: on a past day 18:00, today a session that just ended. */
function defaultStart(day: string | null): string {
  const now = new Date();
  const today = toLocalInput(now).slice(0, 10);
  if (day && day < today) return `${day}T18:00`;
  const begin = new Date(now.getTime() - 60 * 60_000);
  begin.setMinutes(Math.floor(begin.getMinutes() / 5) * 5, 0, 0);
  return toLocalInput(begin);
}

/**
 * Records a session without a device (e.g. Jiu-Jitsu) from duration and
 * Session-RPE, also for past days. Mounted only while open, so every opening
 * starts from fresh defaults.
 */
export function ManualActivityDialog({ open, day = null, onClose }: { open: boolean; day?: string | null; onClose: () => void }) {
  return open ? <ManualActivityForm day={day} onClose={onClose} /> : null;
}

function ManualActivityForm({ day, onClose }: { day: string | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("Jiu-Jitsu");
  const [startsAt, setStartsAt] = useState(() => defaultStart(day));
  const [duration, setDuration] = useState("60");
  const [rpe, setRpe] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const minutes = Number(duration);
  const preview = rpe && minutes > 0 ? Math.round((minutes / 60) * RPE_TSS_PER_HOUR[Number(rpe)]) : null;
  const valid = name.trim() && startsAt && Number.isInteger(minutes) && minutes >= 5 && minutes <= 360 && rpe;

  const save = () =>
    start(async () => {
      setError(null);
      const begin = new Date(startsAt);
      if (Number.isNaN(begin.getTime())) return setError("Beginn ungültig.");
      const r = await createManualActivity({ name, startsAt: begin.toISOString(), utcOffsetSec: -begin.getTimezoneOffset() * 60, durationMin: minutes, rpe: Number(rpe) });
      if (!r.ok) return setError(r.error);
      onClose();
      toast({ tone: "success", title: "Einheit nachgetragen", description: r.message });
      router.refresh();
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Aktivität nachtragen"
      description="Für Einheiten ohne Uhr, etwa Jiu-Jitsu, auch für vergangene Tage. Die Belastung ergibt sich aus Dauer und Anstrengung."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={save} loading={pending} disabled={!valid}>
            Speichern
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
        <Field label="Bezeichnung" htmlFor="manual-name">
          <Input id="manual-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label="Beginn" htmlFor="manual-start">
            <Input id="manual-start" type="datetime-local" value={startsAt} max={toLocalInput(new Date())} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label="Dauer" htmlFor="manual-duration">
            <UnitInput id="manual-duration" unit="min" type="number" inputMode="numeric" min={5} max={360} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        </div>
        <Field
          label="Anstrengung (RPE)"
          htmlFor="manual-rpe"
          hint="Gesamteindruck der ganzen Einheit, nicht nur der härtesten Runde."
          suffix={preview !== null ? <span className="text-[13px] tabular text-ink-3">ca. {preview} TSS</span> : null}
        >
          <Select id="manual-rpe" value={rpe} onChange={(e) => setRpe(e.target.value)}>
            <option value="" disabled>
              Bitte wählen
            </option>
            {Object.entries(RPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {value} · {label}
              </option>
            ))}
          </Select>
        </Field>
        {error ? <p className="text-[13px] text-critical-ink">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Button that opens the dialog, for page headers and empty states. */
export function ManualActivityButton({ variant = "secondary", day = null }: { variant?: "secondary" | "primary"; day?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus />
        Aktivität nachtragen
      </Button>
      <ManualActivityDialog open={open} day={day} onClose={() => setOpen(false)} />
    </>
  );
}
