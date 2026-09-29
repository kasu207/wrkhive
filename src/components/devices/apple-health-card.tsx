"use client";

import { FileUp, KeyRound, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createAppleHealthKey, removeAppleHealthKey } from "@/app/actions/apple-health";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { readAppleHealthExport, type AppleWorkout } from "@/lib/apple-health";
import { formatNumber, relativeTime } from "@/lib/format";
import { CopyValue } from "./wahoo-setup";

export interface AppleHealthCardProps {
  hasKey: boolean;
  lastDeliveryAt: number | null;
  activityCount: number;
  webhookUrl: string;
  demo: boolean;
}

const BATCH = 500;

type ImportState = { phase: "idle" } | { phase: "reading"; fraction: number } | { phase: "sending"; done: number; total: number };

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

const strong = "font-medium text-ink";

/**
 * Apple Health has no web API. Workouts arrive from the Health app's export
 * (read in the browser, only workouts are uploaded) and continuously from the
 * iOS app Health Auto Export via a per-user webhook key.
 */
export function AppleHealthCard({ hasKey, lastDeliveryAt, activityCount, webhookUrl, demo }: AppleHealthCardProps) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [state, setState] = useState<ImportState>({ phase: "idle" });
  const [key, setKey] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = state.phase !== "idle";

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setState({ phase: "reading", fraction: 0 });
    try {
      const r = await readAppleHealthExport(file, (fraction) => setState({ phase: "reading", fraction }));
      if (!r.foundXml) {
        toast({ tone: "error", title: "Keine Health-Daten gefunden", description: "Wähle die ZIP-Datei aus „Alle Gesundheitsdaten exportieren“ oder die darin enthaltene export.xml." });
        return;
      }
      if (!r.workouts.length) {
        toast({ tone: "error", title: "Keine Workouts im Export", description: "Der Export enthält keine aufgezeichneten Trainings." });
        return;
      }
      const totals = { inserted: 0, updated: 0, merged: 0, skipped: r.skipped };
      for (let i = 0; i < r.workouts.length; i += BATCH) {
        setState({ phase: "sending", done: i, total: r.workouts.length });
        const batch: AppleWorkout[] = r.workouts.slice(i, i + BATCH);
        const res = await fetch("/api/activities/import/apple-health", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workouts: batch }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
        totals.inserted += data.inserted;
        totals.updated += data.updated;
        totals.merged += data.merged;
        totals.skipped += data.skipped;
      }
      const parts = [`${formatNumber(totals.inserted)} neu`];
      if (totals.updated) parts.push(`${formatNumber(totals.updated)} aktualisiert`);
      if (totals.merged) parts.push(`${formatNumber(totals.merged)} mit vorhandenen zusammengeführt`);
      if (totals.skipped) parts.push(`${formatNumber(totals.skipped)} übersprungen`);
      toast({ tone: "success", title: `${formatNumber(r.workouts.length)} Workouts gelesen`, description: parts.join(", ") });
      setImportOpen(false);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Import fehlgeschlagen", description: e instanceof Error ? e.message : "Die Datei konnte nicht gelesen werden." });
    } finally {
      setState({ phase: "idle" });
      if (input.current) input.current.value = "";
    }
  };

  const createKey = () =>
    start(async () => {
      const r = await createAppleHealthKey();
      if (!r.ok) return toast({ tone: "error", title: "Fehler", description: r.error });
      setKey(r.data!.key);
      router.refresh();
    });

  const disconnect = () => {
    if (!window.confirm("Automatischen Sync beenden? Der Schlüssel wird ungültig, importierte Aktivitäten bleiben erhalten.")) return;
    start(async () => {
      const r = await removeAppleHealthKey();
      if (!r.ok) return toast({ tone: "error", title: "Fehler", description: r.error });
      setKey(null);
      toast({ tone: "success", title: "Automatischer Sync beendet" });
      router.refresh();
    });
  };

  const progress = state.phase === "reading" ? state.fraction : state.phase === "sending" ? state.done / state.total : 0;

  const progressView = (
    <div className="mt-5" role="status" aria-live="polite">
      <div className="mb-1.5 flex justify-between gap-3 text-[13px] text-ink-2">
        <span>{state.phase === "reading" ? "Export wird gelesen" : `Workouts werden übertragen (${formatNumber(state.phase === "sending" ? state.done : 0)} von ${formatNumber(state.phase === "sending" ? state.total : 0)})`}</span>
        <span className="tabular">{Math.round(progress * 100)} %</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${Math.max(2, progress * 100)}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-ink-3">Große Exporte (mehrere GB) brauchen einige Minuten. Die Seite bitte offen lassen.</p>
    </div>
  );

  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-4 p-5">
        <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#d23c5a] text-[15px] font-bold tracking-tight text-white">A</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Apple Health</h2>
            {hasKey ? lastDeliveryAt ? <Badge tone="good">Automatisch</Badge> : <Badge tone="warning">Wartet auf erste Lieferung</Badge> : activityCount ? <Badge>Importiert</Badge> : null}
          </div>
          <p className="mt-0.5 text-[13px] text-ink-3">Apple Watch, iPhone und Apps, die in Health schreiben</p>
        </div>
      </div>
      <p className="px-5 pb-3 text-[14px] leading-relaxed text-ink-2">
        Apple bietet keine Web-Schnittstelle zu Health. Bisherige Workouts holst du einmalig über den Export der Health-App, neue kommen laufend über die iPhone-App Health Auto Export.
      </p>
      <ul className="space-y-1.5 px-5 pb-4 text-[14px] text-ink-2">
        {["Dauer, Distanz, Puls, Höhenmeter und Kalorien jedes Workouts", "Auch Einheiten anderer Apps, die in Health schreiben, z. B. Freeletics", "Doppelte Einheiten mit Garmin, Wahoo oder intervals.icu werden zusammengeführt"].map((f) => (
          <li key={f} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-3" />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-auto border-t border-border">
        {hasKey || activityCount ? (
          <div className="grid grid-cols-2 border-b border-border text-center">
            <div className="border-r border-border px-3 py-3">
              <div className="text-[18px] font-semibold tabular">{formatNumber(activityCount)}</div>
              <div className="text-[12px] text-ink-3">Aktivitäten</div>
            </div>
            <div className="px-3 py-3">
              <div className="truncate text-[14px] font-semibold leading-[27px]">{lastDeliveryAt ? relativeTime(lastDeliveryAt) : "–"}</div>
              <div className="text-[12px] text-ink-3">Letzte Lieferung</div>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 bg-surface-2/60 px-5 py-3">
          <Button size="sm" variant={activityCount ? "secondary" : "primary"} onClick={() => setImportOpen(true)} disabled={demo}>
            <FileUp /> Export importieren
          </Button>
          <Button size="sm" variant={hasKey || !activityCount ? "secondary" : "primary"} onClick={() => setAutoOpen(true)} disabled={demo}>
            <KeyRound /> {hasKey ? "Automatischer Sync" : "Automatisch synchronisieren"}
          </Button>
          <span className="flex-1" />
          {hasKey ? (
            <Button size="sm" variant="ghost" onClick={disconnect} disabled={pending} className="text-critical-ink hover:bg-critical-soft hover:text-critical-ink">
              <Unlink /> Trennen
            </Button>
          ) : null}
        </div>
        {busy && !importOpen ? <div className="px-5 pb-4">{progressView}</div> : null}
        {demo ? <p className="px-5 pb-3 text-[12px] text-ink-3">Im Demo-Konto nicht verfügbar.</p> : null}
      </div>

      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Apple-Health-Export importieren"
        description="Holt alle bisherigen Workouts. Die Datei wird in deinem Browser gelesen; übertragen werden nur die Workouts, keine anderen Gesundheitsdaten."
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              {busy ? "Schließen" : "Abbrechen"}
            </Button>
            <Button variant="primary" onClick={() => input.current?.click()} loading={busy}>
              {busy ? null : <FileUp />}
              Datei auswählen
            </Button>
          </>
        }
      >
        <input ref={input} type="file" accept=".zip,.xml,application/zip,text/xml,application/xml" hidden onChange={(e) => importFile(e.target.files?.[0])} />
        <ol className="space-y-4 text-[14px] leading-relaxed text-ink-2">
          <Step n={1}>
            In der <strong className={strong}>Health-App</strong> oben rechts auf dein Profilbild tippen, ganz nach unten scrollen und <strong className={strong}>Alle Gesundheitsdaten exportieren</strong> wählen. Das dauert je nach Datenmenge einige Minuten.
          </Step>
          <Step n={2}>
            Die Datei <code className="rounded bg-surface-2 px-1 py-0.5 text-[13px]">Export.zip</code> in <strong className={strong}>Dateien sichern</strong> oder per AirDrop an deinen Mac schicken. Öffnest du Wrkhive direkt auf dem iPhone, kannst du sie dort auswählen.
          </Step>
          <Step n={3}>
            Hier <strong className={strong}>Datei auswählen</strong>. Hat der Mac das Archiv entpackt, geht auch die <code className="rounded bg-surface-2 px-1 py-0.5 text-[13px]">export.xml</code> aus dem Ordner.
          </Step>
        </ol>
        {busy ? (
          progressView
        ) : (
          <p className="mt-5 text-[12px] leading-relaxed text-ink-3">Mehrfaches Importieren ist unbedenklich: Bereits vorhandene Workouts werden aktualisiert, nicht verdoppelt.</p>
        )}
      </Dialog>

      <Dialog
        open={autoOpen}
        onClose={() => {
          setAutoOpen(false);
          setKey(null);
        }}
        title="Apple Health automatisch synchronisieren"
        description="Die iPhone-App Health Auto Export schickt neue Workouts im Hintergrund an Wrkhive."
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setAutoOpen(false);
              setKey(null);
            }}
          >
            Fertig
          </Button>
        }
      >
        <ol className="space-y-4 text-[14px] leading-relaxed text-ink-2">
          <Step n={1}>
            Im App Store <strong className={strong}>Health Auto Export – JSON+CSV</strong> installieren und den Zugriff auf Workouts, Herzfrequenz, Distanzen und Aktivitätsenergie erlauben. Automationen sind in der App kostenpflichtig (Premium); den aktuellen Preis zeigt der App Store.
          </Step>
          <Step n={2}>
            <div className="space-y-2.5">
              <span>Deinen persönlichen Schlüssel erzeugen:</span>
              {key ? (
                <>
                  <CopyValue label="URL" value={webhookUrl} />
                  <CopyValue label="Header api-key" value={key} />
                  <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning-ink">Der Schlüssel wird nur jetzt angezeigt. Wer ihn kennt, kann Workouts in dein Konto schreiben.</p>
                </>
              ) : hasKey ? (
                <>
                  <CopyValue label="URL" value={webhookUrl} />
                  <p className="text-[13px] text-ink-3">
                    Ein Schlüssel ist aktiv{lastDeliveryAt ? `, letzte Lieferung ${relativeTime(lastDeliveryAt)}` : ", bisher ohne Lieferung"}. Ein neuer Schlüssel ersetzt ihn; der alte funktioniert dann nicht mehr.
                  </p>
                  <Button size="sm" variant="secondary" onClick={createKey} loading={pending}>
                    Neuen Schlüssel erzeugen
                  </Button>
                </>
              ) : (
                <div>
                  <Button size="sm" onClick={createKey} loading={pending}>
                    <KeyRound /> Schlüssel erzeugen
                  </Button>
                </div>
              )}
            </div>
          </Step>
          <Step n={3}>
            In Health Auto Export unter <strong className={strong}>Automations</strong> eine neue Automation anlegen: Typ <strong className={strong}>REST API</strong>, die URL eintragen und unter Headers den Key <code className="rounded bg-surface-2 px-1 py-0.5 text-[13px]">api-key</code> mit deinem Schlüssel als Wert.
          </Step>
          <Step n={4}>
            Data Type <strong className={strong}>Workouts</strong>, Export Format <strong className={strong}>JSON</strong>, Export Version <strong className={strong}>2</strong>. Routen-Daten weglassen und <strong className={strong}>Batch Requests</strong> einschalten, dann bleiben die Lieferungen klein.
          </Step>
          <Step n={5}>Automation aktivieren und mit „Manual Export“ testen. Die Karte zeigt danach die letzte Lieferung.</Step>
        </ol>
        <p className="mt-5 text-[12px] leading-relaxed text-ink-3">
          iOS gibt Health-Daten nur bei entsperrtem iPhone frei. Neue Workouts kommen deshalb meist an, sobald du das iPhone nach dem Training wieder benutzt. Kostenlose Alternative: die App „Intervals.icu Companion“ schickt Workouts an intervals.icu, von dort holt Wrkhive sie über die intervals.icu-Verbindung.
        </p>
      </Dialog>
    </Card>
  );
}
