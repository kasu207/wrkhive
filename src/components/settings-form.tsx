"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteAccount, updateProfile } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, UnitInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatPace } from "@/lib/format";
import { ZONE_COLOR } from "@/lib/workout/display";
import { HR_ZONES, PACE_ZONES, POWER_ZONES } from "@/lib/workout/zones";

export interface ProfileValues {
  name: string;
  ftp: number;
  lthr: number;
  maxHr: number;
  restHr: number;
  thresholdPace: number;
  weightKg: number | null;
  timeZone: string;
}

const TIME_ZONES = ["Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/London", "Europe/Paris", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"];

export function SettingsForm({ initial, isDemo }: { initial: ProfileValues; isDemo: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    name: initial.name,
    ftp: String(initial.ftp),
    lthr: String(initial.lthr),
    maxHr: String(initial.maxHr),
    restHr: String(initial.restHr),
    paceMin: String(Math.floor(initial.thresholdPace / 60)),
    paceSec: String(initial.thresholdPace % 60).padStart(2, "0"),
    weightKg: initial.weightKg ? String(initial.weightKg) : "",
    timeZone: initial.timeZone,
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState("");

  const ftp = Number(v.ftp) || 0;
  const lthr = Number(v.lthr) || 0;
  const pace = (Number(v.paceMin) || 0) * 60 + (Number(v.paceSec) || 0);
  const zones = useMemo(
    () =>
      POWER_ZONES.map((z, i) => ({
        zone: z.zone,
        name: z.name,
        power: z.zone === 7 ? `> ${Math.round((z.low / 100) * ftp)} W` : `${Math.round((z.low / 100) * ftp)}–${Math.round((z.high / 100) * ftp)} W`,
        pace: pace ? (PACE_ZONES[i].zone === 7 ? `< ${formatPace(pace / (PACE_ZONES[i].low / 100))}` : `${formatPace(pace / (PACE_ZONES[i].low / 100))}–${formatPace(pace / (PACE_ZONES[i].high / 100))}`) : "–",
        hr: HR_ZONES[i].zone === 7 ? `> ${Math.round((HR_ZONES[i].low / 100) * lthr)}` : `${Math.round((HR_ZONES[i].low / 100) * lthr)}–${Math.round((HR_ZONES[i].high / 100) * lthr)}`,
      })),
    [ftp, lthr, pace],
  );
  const tzOptions = TIME_ZONES.includes(v.timeZone) ? TIME_ZONES : [v.timeZone, ...TIME_ZONES];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await updateProfile({
              name: v.name,
              ftp: v.ftp,
              lthr: v.lthr,
              maxHr: v.maxHr,
              restHr: v.restHr,
              thresholdPaceMin: v.paceMin,
              thresholdPaceSec: v.paceSec,
              weightKg: v.weightKg.replace(",", "."),
              timeZone: v.timeZone,
            });
            if (r.ok) {
              toast({ tone: "success", title: "Gespeichert", description: r.message });
              router.refresh();
            } else toast({ tone: "error", title: "Nicht gespeichert", description: r.error });
          });
        }}
      >
        <Card>
          <CardHeader title="Profil & Schwellenwerte" description="Workouts speichern Intensitäten relativ zu deinen Schwellen. Änderungen wirken sofort auf alle Workouts." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" className="sm:col-span-2">
              <Input id="name" value={v.name} onChange={set("name")} maxLength={60} required />
            </Field>
            <Field label="FTP (Rad)" htmlFor="ftp" hint="Funktionelle Schwellenleistung">
              <UnitInput id="ftp" unit="W" inputMode="numeric" value={v.ftp} onChange={set("ftp")} />
            </Field>
            <Field label="Schwellenpace (Lauf)" hint="Etwa dein 1-Stunden-Renntempo">
              <div className="flex items-center gap-1.5">
                <Input aria-label="Minuten" inputMode="numeric" value={v.paceMin} onChange={set("paceMin")} className="w-16 text-right tabular" />
                <span className="text-ink-3">:</span>
                <Input aria-label="Sekunden" inputMode="numeric" value={v.paceSec} onChange={set("paceSec")} className="w-16 tabular" />
                <span className="text-[13px] text-ink-3">/km</span>
              </div>
            </Field>
            <Field label="Schwellenpuls (LTHR)" htmlFor="lthr">
              <UnitInput id="lthr" unit="bpm" inputMode="numeric" value={v.lthr} onChange={set("lthr")} />
            </Field>
            <Field label="Maximalpuls" htmlFor="maxHr">
              <UnitInput id="maxHr" unit="bpm" inputMode="numeric" value={v.maxHr} onChange={set("maxHr")} />
            </Field>
            <Field label="Ruhepuls" htmlFor="restHr">
              <UnitInput id="restHr" unit="bpm" inputMode="numeric" value={v.restHr} onChange={set("restHr")} />
            </Field>
            <Field label="Gewicht" htmlFor="weight" hint="Optional, für W/kg">
              <UnitInput id="weight" unit="kg" inputMode="decimal" value={v.weightKg} onChange={set("weightKg")} />
            </Field>
            <Field label="Zeitzone" htmlFor="tz" className="sm:col-span-2" hint="Bestimmt, welchem Kalendertag Aktivitäten zugeordnet werden">
              <Select id="tz" value={v.timeZone} onChange={set("timeZone")}>
                {tzOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end border-t border-border bg-surface-2/60 px-5 py-3.5">
            <Button type="submit" loading={pending}>
              Speichern
            </Button>
          </div>
        </Card>
      </form>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Deine Zonen" description="Berechnet aus den Werten links" />
          <div className="overflow-x-auto p-5 pt-4">
            <table className="w-full text-[13px] tabular">
              <thead>
                <tr className="text-left text-[12px] text-ink-3">
                  <th className="pb-2 font-medium">Zone</th>
                  <th className="pb-2 font-medium">Leistung</th>
                  <th className="pb-2 font-medium">Pace /km</th>
                  <th className="pb-2 font-medium">Puls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {zones.map((z) => (
                  <tr key={z.zone}>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: ZONE_COLOR[z.zone] }} />
                        <span className="font-medium">Z{z.zone}</span>
                        <span className="hidden text-ink-3 sm:inline">{z.name}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3">{z.power}</td>
                    <td className="py-2 pr-3">{z.pace}</td>
                    <td className="py-2">{z.hr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Konto löschen</h2>
          <p className="mt-1 text-[14px] text-ink-2">
            {isDemo ? "Beendet die Demo und löscht alle Beispieldaten." : "Löscht dein Konto mit allen Workouts, Plänen und Aktivitäten dauerhaft. Verbindungen zu Garmin und Wahoo werden widerrufen."}
          </p>
          <Button variant="danger" size="sm" className="mt-4" onClick={() => setDelOpen(true)}>
            Konto löschen
          </Button>
        </Card>
      </div>

      <Dialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Konto wirklich löschen?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDelOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={delText.trim().toLowerCase() !== "löschen"}
              onClick={() =>
                start(async () => {
                  const r = await deleteAccount(delText);
                  if (r && !r.ok) toast({ tone: "error", title: "Fehler", description: r.error });
                })
              }
            >
              Endgültig löschen
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-ink-2">Das kann nicht rückgängig gemacht werden. Tippe „löschen“ zur Bestätigung.</p>
        <Input className="mt-3" value={delText} onChange={(e) => setDelText(e.target.value)} aria-label="Bestätigung" />
      </Dialog>
    </div>
  );
}
