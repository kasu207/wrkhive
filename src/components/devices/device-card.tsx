"use client";

import { AlertTriangle, CloudDownload, ExternalLink, RefreshCw, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { connectDevice, connectWithApiKey, disconnectDevice, setAutoSync, syncNow } from "@/app/actions/devices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { WahooSetupDialog, type WahooSelfService } from "./wahoo-setup";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatNumber, relativeTime } from "@/lib/format";

export interface DeviceCardProps {
  provider: "garmin" | "wahoo" | "intervals";
  name: string;
  auth: "oauth" | "apikey";
  /** Optional lead text shown under the header. */
  intro?: string;
  /** Self-hosted Wahoo setup with a personal developer app. */
  selfService?: WahooSelfService;
  devices: string[];
  features: string[];
  configured: boolean;
  connection: null | {
    mode: "live" | "demo";
    status: "connected" | "error" | "revoked";
    statusMessage: string | null;
    displayName: string | null;
    autoSync: boolean;
    lastSyncAt: number | null;
    activityCount: number;
    deliveries: number;
    missingPermissions: string[];
  };
}

export function DeviceCard({ provider, name, auth, intro, selfService, devices, features, configured, connection: c }: DeviceCardProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [removeData, setRemoveData] = useState(false);
  const [auto, setAuto] = useState(c?.autoSync ?? true);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, title: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast({ tone: "success", title, description: r.message });
      else toast({ tone: "error", title: "Fehler", description: r.error });
      router.refresh();
    });

  const [keyForm, setKeyForm] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  // Without app credentials the owner can register a personal app instead of the demo.
  const canSetup = Boolean(selfService?.allowed && selfService.source !== "env");
  const [athleteId, setAthleteId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);

  const connectKey = () =>
    start(async () => {
      setKeyError(null);
      const r = await connectWithApiKey(provider, athleteId, apiKey);
      if (!r.ok) {
        setKeyError(r.error);
        return;
      }
      setKeyForm(false);
      setApiKey("");
      toast({ tone: "success", title: `${name} verbunden`, description: r.message });
      router.refresh();
    });

  const connect = () =>
    start(async () => {
      const r = await connectDevice(provider);
      if (!r.ok) return toast({ tone: "error", title: "Verbindung fehlgeschlagen", description: r.error });
      if (r.data!.url.startsWith("http")) window.location.href = r.data!.url;
      else {
        toast({ tone: "success", title: `${name} verbunden`, description: configured ? undefined : "Demo-Modus mit Beispieldaten aktiviert." });
        router.refresh();
      }
    });

  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-4 p-5">
        <div
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-2xl text-[15px] font-bold tracking-tight text-white",
            provider === "garmin" ? "bg-[#111110]" : provider === "wahoo" ? "bg-[#1a4fd6]" : "bg-[#0f766e]",
          )}
        >
          {provider === "garmin" ? "G" : provider === "wahoo" ? "W" : "i"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{name}</h2>
            {c ? (
              c.status === "connected" ? (
                <Badge tone={c.mode === "demo" ? "brand" : "good"}>{c.mode === "demo" ? "Demo verbunden" : "Verbunden"}</Badge>
              ) : c.status === "revoked" ? (
                <Badge tone="critical">Getrennt</Badge>
              ) : (
                <Badge tone="warning">Fehler</Badge>
              )
            ) : null}
          </div>
          <p className="mt-0.5 text-[13px] text-ink-3">{devices.join(", ")}</p>
        </div>
      </div>

      {intro ? <p className="px-5 pb-3 text-[14px] leading-relaxed text-ink-2">{intro}</p> : null}

      <ul className="space-y-1.5 px-5 pb-4 text-[14px] text-ink-2">
        {features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-3" />
            {f}
          </li>
        ))}
      </ul>

      {c && c.mode === "live" && c.missingPermissions.length ? (
        <div className="mx-5 mb-4 rounded-xl border border-[#f5dca6] bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning-ink">
          <p className="font-medium">Nicht freigegeben:</p>
          <ul className="mt-1 list-disc pl-5">
            {c.missingPermissions.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-1">Trenne die Verbindung und verbinde neu, um alle Berechtigungen zu erteilen.</p>
        </div>
      ) : null}

      {c && c.status !== "connected" && c.statusMessage ? (
        <div className="mx-5 mb-4 flex gap-2 rounded-xl border border-[#f5dca6] bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{c.statusMessage}</span>
        </div>
      ) : null}

      {c ? (
        <div className="mt-auto border-t border-border">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <div className="text-[14px] font-medium">Dauer-Sync</div>
              <div className="text-[13px] text-ink-3">
                Neue Aktivitäten automatisch importieren
                {c.mode === "live" ? (auth === "apikey" ? " (alle 30 Minuten abgeglichen)" : " (per Webhook, zusätzlich alle 30 Minuten abgeglichen)") : ""}
              </div>
            </div>
            <Switch
              checked={auto}
              label="Dauer-Sync"
              disabled={pending}
              onChange={(v) => {
                setAuto(v);
                run(() => setAutoSync(provider, v), v ? "Dauer-Sync aktiviert" : "Dauer-Sync pausiert");
              }}
            />
          </div>
          <div className="grid grid-cols-3 border-t border-border text-center">
            <div className="px-3 py-3">
              <div className="text-[18px] font-semibold tabular">{formatNumber(c.activityCount)}</div>
              <div className="text-[12px] text-ink-3">Aktivitäten</div>
            </div>
            <div className="border-x border-border px-3 py-3">
              <div className="text-[18px] font-semibold tabular">{formatNumber(c.deliveries)}</div>
              <div className="text-[12px] text-ink-3">Gesendet</div>
            </div>
            <div className="px-3 py-3">
              <div className="truncate text-[14px] font-semibold leading-[27px]">{c.lastSyncAt ? relativeTime(c.lastSyncAt) : "–"}</div>
              <div className="text-[12px] text-ink-3">Letzter Sync</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2/60 px-5 py-3">
            {c.mode === "demo" && canSetup ? (
              <Button size="sm" onClick={() => (configured ? connect() : setSetupOpen(true))} loading={pending}>
                Echtes Konto verbinden
              </Button>
            ) : null}
            {c.status === "revoked" ? (
              <Button size="sm" onClick={auth === "apikey" ? () => setKeyForm(true) : connect} loading={pending}>
                Neu verbinden
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => run(() => syncNow(provider), "Synchronisiert")} loading={pending}>
                  <RefreshCw /> Jetzt synchronisieren
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(() => syncNow(provider, true), "Historie angefordert")} disabled={pending}>
                  <CloudDownload /> Historie (12 Monate)
                </Button>
              </>
            )}
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} className="text-critical-ink hover:bg-critical-soft hover:text-critical-ink">
              <Unlink /> Trennen
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-auto border-t border-border bg-surface-2/60 px-5 py-4">
          {!configured && canSetup ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setSetupOpen(true)} className="w-full sm:w-auto">
                {name} einrichten
              </Button>
              <Button variant="ghost" onClick={connect} loading={pending}>
                Demo ansehen
              </Button>
            </div>
          ) : (
            <Button onClick={auth === "apikey" ? () => setKeyForm(true) : connect} loading={pending && auth !== "apikey"} className="w-full sm:w-auto">
              Mit {name} verbinden
            </Button>
          )}
          {!configured && auth === "oauth" ? (
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              {canSetup
                ? `Einmalig eine kostenlose persönliche ${name}-App anlegen (etwa 5 Minuten), dann ist dein Konto direkt verbunden.`
                : `Für diese Installation sind keine ${name}-API-Zugangsdaten hinterlegt. Die Verbindung startet im Demo-Modus mit Beispieldaten.`}
            </p>
          ) : null}
          {configured && canSetup && selfService?.source === "ui" ? (
            <button type="button" onClick={() => setSetupOpen(true)} className="mt-2 block text-[12px] font-medium text-ink-3 hover:text-ink">
              Wahoo-App ändern
            </button>
          ) : null}
        </div>
      )}

      {selfService && canSetup ? <WahooSetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} setup={selfService} /> : null}

      {auth === "apikey" ? (
        <Dialog
          open={keyForm}
          onClose={() => setKeyForm(false)}
          title={`${name} verbinden`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setKeyForm(false)}>
                Abbrechen
              </Button>
              <Button variant="primary" onClick={connectKey} loading={pending} disabled={!apiKey.trim()}>
                Verbinden
              </Button>
            </>
          }
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (apiKey.trim()) connectKey();
            }}
          >
            <p className="text-[14px] leading-relaxed text-ink-2">
              Beides findest du in intervals.icu unter{" "}
              <a href="https://intervals.icu/settings" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-focus hover:underline">
                Settings <ExternalLink className="size-3" />
              </a>{" "}
              im Abschnitt „Developer Settings“.
            </p>
            <Field label="Athleten-ID" htmlFor={`${provider}-athlete`} hint="Beginnt mit i, z. B. i123456">
              <Input id={`${provider}-athlete`} value={athleteId} onChange={(e) => setAthleteId(e.target.value)} placeholder="i123456" autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="API-Schlüssel" htmlFor={`${provider}-key`} error={keyError ?? undefined}>
              <Input id={`${provider}-key`} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!keyError} />
            </Field>
            <p className="text-[13px] leading-relaxed text-ink-3">Der Schlüssel wird verschlüsselt gespeichert und nur für deinen Kalender und deine Aktivitäten verwendet.</p>
            <button type="submit" hidden />
          </form>
        </Dialog>
      ) : null}

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`${name} trennen?`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                setConfirm(false);
                run(() => disconnectDevice(provider, removeData), `${name} getrennt`);
              }}
            >
              Trennen
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-ink-2">Wrkhive kann danach keine Workouts mehr an {name} senden und keine Aktivitäten mehr empfangen.{" "}
          {auth === "apikey" ? `Den API-Schlüssel kannst du zusätzlich in ${name} neu erzeugen.` : `Der Zugriff wird auch bei ${name} widerrufen.`}</p>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3.5">
          <input type="checkbox" checked={removeData} onChange={(e) => setRemoveData(e.target.checked)} className="mt-0.5 size-4 accent-[var(--critical)]" />
          <span className="text-[14px]">
            <span className="block font-medium">Importierte Aktivitäten löschen</span>
            <span className="block text-[13px] text-ink-3">{c ? formatNumber(c.activityCount) : 0} Aktivitäten werden aus Wrkhive entfernt.</span>
          </span>
        </label>
      </Dialog>
    </Card>
  );
}
