"use client";

import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { completeOnboarding, skipOnboarding } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { AppMark } from "@/components/app-mark";
import { APPS, recommendConnections, type AppInfo, type ConnectionId } from "@/lib/apps";
import { cn } from "@/lib/cn";

const CONNECTION_LABEL: Record<ConnectionId, string> = { intervals: "intervals.icu", garmin: "Garmin", wahoo: "Wahoo" };
const STEPS = ["Apps und Geräte", "Schwellenwerte", "Dein Weg"] as const;

/** Parses "4:45" (min/km) into seconds per km, or null. */
function parsePace(v: string): number | null {
  const m = v.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const s = Number(m[1]) * 60 + Number(m[2]);
  return s >= 120 && s <= 720 ? s : null;
}

export function Onboarding({ name, directAvailable, defaults }: { name: string; directAvailable: { garmin: boolean; wahoo: boolean }; defaults: { ftp: number; lthr: number; pace: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [apps, setApps] = useState<AppInfo["id"][]>([]);
  const [ftp, setFtp] = useState("");
  const [lthr, setLthr] = useState("");
  const [pace, setPace] = useState("");
  const [autoAdapt, setAutoAdapt] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rec = useMemo(() => recommendConnections(apps, directAvailable), [apps, directAvailable]);

  const toggle = (id: AppInfo["id"]) => setApps((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const validateThresholds = () => {
    const f = ftp.trim() ? Number(ftp) : null;
    const l = lthr.trim() ? Number(lthr) : null;
    const p = pace.trim() ? parsePace(pace) : null;
    if (f !== null && !(Number.isInteger(f) && f >= 50 && f <= 600)) return "FTP zwischen 50 und 600 Watt.";
    if (l !== null && !(Number.isInteger(l) && l >= 100 && l <= 220)) return "Schwellenpuls zwischen 100 und 220 bpm.";
    if (pace.trim() && p === null) return "Schwellenpace im Format 4:45 (min/km).";
    return null;
  };

  const finish = () =>
    start(async () => {
      const r = await completeOnboarding({
        apps,
        ftp: ftp.trim() ? Number(ftp) : null,
        lthr: lthr.trim() ? Number(lthr) : null,
        thresholdPace: pace.trim() ? parsePace(pace) : null,
        autoAdapt,
      });
      if (!r.ok) {
        setError(r.error);
        setStep(1);
        return;
      }
      router.push(rec.connections.length ? "/devices?setup=1" : "/dashboard");
    });

  const skip = () =>
    start(async () => {
      const r = await skipOnboarding();
      if (!r.ok) return toast({ tone: "error", title: "Fehler", description: r.error });
      router.push("/dashboard");
    });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <p className="text-[13px] font-medium text-ink-3">
          Schritt {step + 1} von {STEPS.length} · {STEPS[step]}
        </p>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={cn("h-1 flex-1 rounded-full transition-colors", i <= step ? "bg-ink" : "bg-surface-3")} />
          ))}
        </div>
      </div>

      {step === 0 ? (
        <section>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Willkommen, {name.split(" ")[0]}</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">Womit trainierst du? Wrkhive holt deine Aktivitäten aus allen Quellen an einen Ort und schickt deine Workouts dorthin, wo du trainierst.</p>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2" role="group" aria-label="Apps und Geräte">
            {APPS.map((a) => {
              const on = apps.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(a.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border bg-surface p-3.5 text-left transition-all",
                    on ? "border-ink shadow-[0_0_0_1px_var(--ink)]" : "border-border hover:border-border-strong",
                  )}
                >
                  <AppMark id={a.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">{a.name}</span>
                    <span className="block truncate text-[13px] text-ink-3">{a.tagline}</span>
                  </span>
                  <span className={cn("grid size-5 place-items-center rounded-full border", on ? "border-ink bg-ink text-white" : "border-border-strong")}>{on ? <Check className="size-3" /> : null}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Deine Schwellenwerte</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
            Workouts werden in Prozent deiner Schwellen gebaut, damit sie zu dir passen. Was du nicht kennst, lässt du leer; Wrkhive nimmt dann Standardwerte, die du später in den Einstellungen änderst.
          </p>
          <Card className="mt-5 space-y-4 p-5">
            <Field label="FTP (Rad)" htmlFor="ob-ftp" hint={`Leistung, die du etwa eine Stunde halten kannst. Standard ${defaults.ftp} W`} suffix="W">
              <Input id="ob-ftp" inputMode="numeric" value={ftp} onChange={(e) => setFtp(e.target.value.replace(/\D/g, ""))} placeholder={String(defaults.ftp)} />
            </Field>
            <Field label="Schwellenpuls" htmlFor="ob-lthr" hint={`Durchschnittspuls in einem 30-Minuten-Test. Standard ${defaults.lthr} bpm`} suffix="bpm">
              <Input id="ob-lthr" inputMode="numeric" value={lthr} onChange={(e) => setLthr(e.target.value.replace(/\D/g, ""))} placeholder={String(defaults.lthr)} />
            </Field>
            <Field label="Schwellenpace (Laufen)" htmlFor="ob-pace" hint={`Pace für etwa eine Stunde Wettkampf. Standard ${defaults.pace} min/km`} suffix="min/km">
              <Input id="ob-pace" value={pace} onChange={(e) => setPace(e.target.value)} placeholder={defaults.pace} />
            </Field>
            {error ? (
              <p className="rounded-xl bg-critical-soft px-3.5 py-2.5 text-[13px] text-critical-ink" role="alert">
                {error}
              </p>
            ) : null}
          </Card>
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">So kommt alles zusammen</h1>
          {rec.connections.length ? (
            <>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
                {rec.connections.length === 1
                  ? `Eine Verbindung reicht: ${CONNECTION_LABEL[rec.connections[0].id]} deckt alle deine Apps ab.`
                  : `Mit ${rec.connections.length} Verbindungen sind alle deine Apps abgedeckt.`}
              </p>
              <Card className="mt-5 divide-y divide-border">
                {rec.routes.map(({ app, activities, workouts }) => (
                  <div key={app.id} className="flex items-start gap-3 px-5 py-3.5">
                    <AppMark id={app.id} className="size-9 text-[13px]" />
                    <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
                      <p className="text-[15px] font-semibold">{app.name}</p>
                      <p className="text-ink-2">
                        <span className="text-ink-3">Aktivitäten: </span>
                        {activities?.text ?? "nicht möglich"}
                      </p>
                      <p className="text-ink-2">
                        <span className="text-ink-3">Workouts: </span>
                        {workouts?.text ?? "nimmt keine fremden Workouts an"}
                      </p>
                    </div>
                  </div>
                ))}
              </Card>
            </>
          ) : (
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">Du kannst sofort Workouts bauen und als Datei exportieren. Geräte und Apps verbindest du jederzeit unter „Geräte“.</p>
          )}
          <Card className="mt-4 flex items-start justify-between gap-4 p-5">
            <div>
              <p className="text-[15px] font-semibold">Workouts an meine Belastung anpassen</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">Bist du stark ermüdet, wird das harte Workout des Tages automatisch kürzer und leichter. Bereits gesendete Workouts bleiben unverändert, das Original lässt sich wiederherstellen.</p>
            </div>
            <Switch checked={autoAdapt} onChange={setAutoAdapt} label="Workouts an meine Belastung anpassen" />
          </Card>
        </section>
      ) : null}

      <div className="mt-6 flex items-center gap-2">
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={pending}>
            <ArrowLeft /> Zurück
          </Button>
        ) : (
          <Button variant="ghost" onClick={skip} loading={pending}>
            Überspringen
          </Button>
        )}
        <span className="flex-1" />
        {step < STEPS.length - 1 ? (
          <Button
            variant="primary"
            onClick={() => {
              if (step === 1) {
                const e = validateThresholds();
                setError(e);
                if (e) return;
              }
              setStep(step + 1);
            }}
          >
            Weiter <ArrowRight />
          </Button>
        ) : (
          <Button variant="primary" onClick={finish} loading={pending}>
            {rec.connections.length ? "Verbindungen einrichten" : "Los geht's"} <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}
