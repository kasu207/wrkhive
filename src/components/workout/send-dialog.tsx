"use client";

import { CalendarDays, Check, Download, FileDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { sendToDevice } from "@/app/actions/workouts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { addDays, diffDays, displayDate, toISODate } from "@/lib/dates";
import { formatDayLong } from "@/lib/format";
import { wahooCompatibility } from "@/lib/workout/export/wahoo";
import type { WorkoutStructure } from "@/lib/workout/types";

export interface ConnectionInfo {
  provider: "garmin" | "wahoo";
  mode: "live" | "demo";
  status: "connected" | "error" | "revoked";
  displayName: string | null;
}

const PROVIDER_META = {
  garmin: { name: "Garmin Connect", devices: "Forerunner, fēnix, Edge, Venu …", note: "Landet in deinem Garmin-Connect-Kalender und wird beim nächsten Sync auf Uhr oder Radcomputer übertragen." },
  wahoo: { name: "Wahoo", devices: "ELEMNT BOLT, ROAM, ACE, RIVAL", note: "Erscheint nach dem nächsten Sync auf deinem ELEMNT bzw. RIVAL. Wahoo zeigt geplante Workouts von heute bis 6 Tage im Voraus." },
} as const;

type When = "today" | "tomorrow" | "date" | "library";

export function SendDialog({
  open,
  onClose,
  workoutId,
  structure,
  connections,
  ensureSaved,
  initialDate,
}: {
  open: boolean;
  onClose: () => void;
  workoutId: string | null;
  structure: WorkoutStructure;
  connections: ConnectionInfo[];
  ensureSaved: () => Promise<string | null>;
  initialDate?: string | null;
}) {
  const toast = useToast();
  const today = toISODate(new Date());
  const connected = connections.filter((c) => c.status !== "revoked");
  const [provider, setProvider] = useState<"garmin" | "wahoo" | null>(connected[0]?.provider ?? null);
  const [when, setWhen] = useState<When>(initialDate ? "date" : "today");
  const [date, setDate] = useState(initialDate ?? addDays(today, 2));
  const [pending, start] = useTransition();
  const [sentTo, setSentTo] = useState<string | null>(null);

  const targetDate = when === "today" ? today : when === "tomorrow" ? addDays(today, 1) : when === "date" ? date : null;
  const issues = useMemo(() => {
    if (provider !== "wahoo") return [];
    const list = wahooCompatibility(structure);
    if (when === "library") list.push("Wahoo braucht ein Datum, damit das Workout auf dem Gerät erscheint.");
    if (targetDate) {
      const ahead = diffDays(targetDate, today);
      if (ahead < 0 || ahead > 6) list.push("Wahoo zeigt geplante Workouts nur für heute bis 6 Tage im Voraus.");
    }
    return list;
  }, [provider, structure, when, targetDate, today]);

  const send = () => {
    if (!provider) return;
    start(async () => {
      const id = workoutId ?? (await ensureSaved());
      if (!id) return;
      const res = await sendToDevice({ workoutId: id, provider, date: targetDate, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (res.ok) {
        setSentTo(provider);
        toast({ tone: "success", title: `An ${PROVIDER_META[provider].name} gesendet`, description: res.message });
      } else {
        toast({ tone: "error", title: "Senden fehlgeschlagen", description: res.error });
      }
    });
  };

  const download = async (format: "fit" | "zwo" | "txt") => {
    const id = workoutId ?? (await ensureSaved());
    if (!id) return;
    const a = document.createElement("a");
    a.href = `/api/workouts/${id}/export?format=${format}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        setSentTo(null);
        onClose();
      }}
      title="An Gerät senden"
      description="Sende das Workout direkt an dein Gerät oder lade es als Datei herunter."
      footer={
        connected.length ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Schließen
            </Button>
            <Button variant="primary" onClick={send} loading={pending} disabled={!provider || issues.length > 0 || (when === "date" && !date)}>
              {sentTo === provider ? <Check /> : null}
              {sentTo === provider ? "Erneut senden" : "Senden"}
            </Button>
          </>
        ) : null
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-2.5 text-[13px] font-semibold text-ink-2">Gerät</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["garmin", "wahoo"] as const).map((p) => {
              const conn = connections.find((c) => c.provider === p);
              const usable = conn && conn.status !== "revoked";
              const active = provider === p && usable;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!usable}
                  onClick={() => setProvider(p)}
                  className={cn(
                    "relative flex flex-col items-start rounded-xl border p-3.5 text-left transition-all",
                    active ? "border-ink bg-surface shadow-[0_0_0_1px_var(--ink)]" : "border-border bg-surface hover:border-border-strong",
                    !usable && "cursor-default opacity-100",
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-[15px] font-semibold">{PROVIDER_META[p].name}</span>
                    {active ? (
                      <span className="grid size-5 place-items-center rounded-full bg-ink text-white">
                        <Check className="size-3" />
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-0.5 text-[12px] text-ink-3">{PROVIDER_META[p].devices}</span>
                  <div className="mt-2.5">
                    {!conn ? (
                      <Link href="/devices" className="text-[13px] font-medium text-focus hover:underline">
                        Verbinden
                      </Link>
                    ) : conn.status === "revoked" ? (
                      <Badge tone="critical">Neu verbinden</Badge>
                    ) : conn.mode === "demo" ? (
                      <Badge tone="brand">Demo-Verbindung</Badge>
                    ) : (
                      <Badge tone="good">Verbunden{conn.displayName ? ` · ${conn.displayName}` : ""}</Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {connected.length ? (
          <section>
            <h3 className="mb-2.5 text-[13px] font-semibold text-ink-2">Wann</h3>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["today", "Heute"],
                  ["tomorrow", "Morgen"],
                  ["date", "Datum wählen"],
                  ["library", "Nur in die Bibliothek"],
                ] as [When, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setWhen(v)}
                  className={cn(
                    "h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                    when === v ? "border-ink bg-ink text-white" : "border-border-strong bg-surface text-ink-2 hover:border-ink/40 hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {when === "date" ? (
              <div className="mt-3 flex items-center gap-2">
                <CalendarDays className="size-4 text-ink-3" />
                <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="w-auto" />
              </div>
            ) : null}
            {targetDate ? <p className="mt-2 text-[13px] text-ink-3">Geplant für {formatDayLong(displayDate(targetDate))}</p> : null}
            {provider ? <p className="mt-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">{PROVIDER_META[provider].note}</p> : null}
            {issues.length ? (
              <ul className="mt-3 space-y-1 rounded-xl border border-[#f5dca6] bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning-ink">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : (
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
            Noch kein Gerät verbunden.{" "}
            <Link href="/devices" className="font-medium text-focus hover:underline">
              Garmin oder Wahoo verbinden
            </Link>{" "}
            oder das Workout als Datei herunterladen.
          </p>
        )}

        <section>
          <h3 className="mb-2.5 text-[13px] font-semibold text-ink-2">Als Datei</h3>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            <FileRow title="FIT-Workout" description="Für Garmin per USB (Ordner GARMIN/NewFiles) und andere FIT-fähige Geräte" onClick={() => download("fit")} />
            {structure.sport !== "strength" ? <FileRow title="Zwift (.zwo)" description="Für Zwift und andere Apps mit ZWO-Import" onClick={() => download("zwo")} /> : null}
            <FileRow title="Text" description="Zum Teilen oder Ausdrucken" onClick={() => download("txt")} />
          </div>
        </section>
      </div>
    </Dialog>
  );
}

function FileRow({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2">
      <FileDown className="size-[18px] shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-[12px] text-ink-3">{description}</span>
      </span>
      <span className={buttonClass("ghost", "icon-sm")}>
        <Download />
      </span>
    </button>
  );
}
