import { and, count, eq } from "drizzle-orm";
import { Bike, FileDown, Upload } from "lucide-react";
import { ImportButton } from "@/components/import-button";
import type { Metadata } from "next";
import { DeviceCard } from "@/components/devices/device-card";
import { Card, PageHeader } from "@/components/ui/card";
import { getDb } from "@/db";
import { activities, deliveries, deviceConnections } from "@/db/schema";
import { missingPermissions } from "@/lib/permissions";
import { requireUser } from "@/lib/server/auth";
import { PROVIDERS } from "@/lib/server/sync";

export const metadata: Metadata = { title: "Geräte" };

const FEATURES = {
  garmin: [
    "Workouts landen im Garmin-Connect-Kalender und synchronisieren auf Uhr und Edge",
    "Rad, Laufen und Krafttraining mit Übungsanimationen",
    "Aktivitäten werden automatisch importiert (Push-Benachrichtigung)",
  ],
  wahoo: [
    "Workouts erscheinen auf ELEMNT BOLT, ROAM, ACE und RIVAL",
    "Rad und Laufen, geplant für heute bis 6 Tage im Voraus",
    "Aktivitäten werden automatisch importiert (Webhook)",
  ],
  intervals: [
    "Workouts landen im intervals.icu-Kalender und gehen von dort an Garmin Connect und Wahoo",
    "Rad-Workouts mit Leistungszielen steuern den Smart-Trainer über den Radcomputer im ERG-Modus",
    "Aktivitäten von Garmin und Wahoo kommen über intervals.icu zurück, Duplikate werden erkannt",
  ],
} as const;

const INTRO = {
  intervals:
    "Der schnellste Weg ohne eigenen Garmin- oder Wahoo-Entwicklerzugang: Verbinde in intervals.icu (kostenlos) einmal Garmin Connect und Wahoo, aktiviere dort jeweils „Upload planned workouts“ und hinterlege hier deinen persönlichen API-Schlüssel.",
} as Partial<Record<"garmin" | "wahoo" | "intervals", string>>;

export default async function DevicesPage(props: PageProps<"/devices">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const db = getDb();
  const conns = db.select().from(deviceConnections).where(eq(deviceConnections.userId, user.id)).all();
  const error = typeof sp.error === "string" ? sp.error : null;

  // Without own Garmin/Wahoo API credentials the intervals.icu bridge is the way to real devices: show it first.
  const direct = PROVIDERS.garmin.isConfigured() || PROVIDERS.wahoo.isConfigured();
  const order = direct ? (["garmin", "wahoo", "intervals"] as const) : (["intervals", "garmin", "wahoo"] as const);
  const cards = order.map((p) => {
    const c = conns.find((x) => x.provider === p);
    const adapter = PROVIDERS[p];
    return {
      provider: p,
      name: adapter.name,
      auth: adapter.auth,
      intro: INTRO[p],
      devices: adapter.devices,
      features: [...FEATURES[p]],
      configured: adapter.isConfigured(),
      connection: c
        ? {
            mode: c.mode,
            status: c.status,
            statusMessage: c.statusMessage,
            displayName: c.displayName,
            autoSync: c.autoSync,
            lastSyncAt: c.lastSyncAt?.getTime() ?? null,
            activityCount: db.select({ n: count() }).from(activities).where(and(eq(activities.userId, user.id), eq(activities.provider, p))).get()?.n ?? 0,
            missingPermissions: missingPermissions(p, c.scopes),
            deliveries: db.select({ n: count() }).from(deliveries).where(and(eq(deliveries.userId, user.id), eq(deliveries.provider, p), eq(deliveries.status, "sent"))).get()?.n ?? 0,
          }
        : null,
    };
  });

  return (
    <div className="animate-fade-up">
      <PageHeader title="Geräte" description="Verbinde deine Konten, um Workouts direkt zu senden und Aktivitäten dauerhaft zu synchronisieren." />
      {error ? (
        <div className="mb-5 rounded-xl border border-[#f2caca] bg-critical-soft px-4 py-3 text-[14px] text-critical-ink" role="alert">
          Die Verbindung konnte nicht hergestellt werden: {error}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {cards.map((c) => (
          <DeviceCard key={c.provider} {...c} />
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col p-5">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-ink-2">
              <Upload className="size-5" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold">Aktivitäten als Datei importieren</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
                Funktioniert ohne API-Zugang: FIT-Dateien direkt vom Gerät (Garmin per USB aus <code className="rounded bg-surface-2 px-1 py-0.5 text-[13px]">GARMIN/Activity</code>, Wahoo über die ELEMNT-App „Teilen“) oder ZIP-Archive aus Garmin Connect („Original exportieren“). Duplikate werden erkannt.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <ImportButton />
          </div>
        </Card>
        <Card className="flex flex-col p-5">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-ink-2">
              <FileDown className="size-5" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold">Workouts als Datei aufs Gerät</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
                Jedes Workout lässt sich als FIT-Datei herunterladen. Garmin-Geräte übernehmen sie per USB aus dem Ordner <code className="rounded bg-surface-2 px-1 py-0.5 text-[13px]">GARMIN/NewFiles</code>. Für Zwift und andere Indoor-Apps gibt es den ZWO-Export. Öffne dazu ein Workout und wähle „An Gerät senden“.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-ink-2">
            <Bike className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Indoor mit Smart-Trainer (ERG)</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
              Ein Wahoo ELEMNT steuert Rollentrainer anderer Hersteller über ANT+ FE-C und hält im ERG-Modus die Leistungsziele des Workouts.
            </p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed text-ink-2">
              <li>Trainer in der Wahoo-App unter Sensoren mit dem ELEMNT koppeln, während du trittst, damit er aufwacht.</li>
              <li>Rad-Workout mit Leistungszielen (% FTP) bauen, beim Senden „Rollentrainer (ERG)“ wählen.</li>
              <li>Auf dem ELEMNT unter „Geplante Workouts“ starten, der Trainer folgt den Zielwerten automatisch.</li>
            </ol>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
              Van Rysel D500 und D900: Firmware vorher mit der App OneLap Fit aktualisieren. Decathlon bestätigt für Firmware 104 einen Fehler, bei dem ERG über ANT+ mit Radcomputern abbricht. Erkennt der ELEMNT den Trainer nur als Leistungsmesser, fehlt die FE-C-Steuerung; dann das Workout als ZWO-Datei in Zwift fahren (Steuerung per Bluetooth FTMS) und den ELEMNT nur aufzeichnen lassen.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
