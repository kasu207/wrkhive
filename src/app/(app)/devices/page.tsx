import { and, count, eq, isNotNull, max } from "drizzle-orm";
import { Bike, FileDown, Upload } from "lucide-react";
import { ImportButton } from "@/components/import-button";
import type { Metadata } from "next";
import { AppHub } from "@/components/devices/app-hub";
import { DeviceCard } from "@/components/devices/device-card";
import { Card, PageHeader } from "@/components/ui/card";
import { getDb } from "@/db";
import { activities, deliveries, deviceConnections } from "@/db/schema";
import { missingPermissions } from "@/lib/permissions";
import type { AppInfo } from "@/lib/apps";
import { isInstallationOwner, requireUser } from "@/lib/server/auth";
import { redirectUri } from "@/lib/server/connections";
import { env } from "@/lib/server/env";
import { WAHOO_SCOPES } from "@/lib/server/providers/wahoo";
import { PROVIDERS } from "@/lib/server/sync";

export const metadata: Metadata = { title: "Apps & Geräte" };

const FEATURES = {
  garmin: [
    "Workouts landen im Garmin-Connect-Kalender und synchronisieren auf Uhr und Edge",
    "Rad, Laufen und Krafttraining mit Übungsanimationen",
    "Aktivitäten werden automatisch importiert (Push-Benachrichtigung)",
  ],
  wahoo: [
    "Workouts erscheinen auf ELEMNT BOLT, ROAM, ACE und RIVAL",
    "Rollentrainer-Workouts steuern den Smart-Trainer im ERG-Modus",
    "Aktivitäten werden automatisch importiert",
  ],
  intervals: [
    "Brücke zu Zwift, MyWhoosh, ROUVY und Freeletics (über Apple Health)",
    "Workouts gehen über intervals.icu auch an Garmin Connect und Wahoo",
    "Aktivitäten aller dort verbundenen Apps kommen zurück, Duplikate werden zusammengeführt",
  ],
} as const;

const INTRO = {
  intervals:
    "Nur nötig für Zwift, MyWhoosh, ROUVY oder Freeletics. Kostenloses intervals.icu-Konto anlegen, dort die Apps verbinden und hier den persönlichen API-Schlüssel aus Settings > Developer Settings eintragen (erscheint nach bestätigter E-Mail-Adresse). Eine Bewerbung oder eigene Website ist dafür nicht nötig.",
} as Partial<Record<"garmin" | "wahoo" | "intervals", string>>;

export default async function DevicesPage(props: PageProps<"/devices">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const db = getDb();
  const conns = db.select().from(deviceConnections).where(eq(deviceConnections.userId, user.id)).all();
  const error = typeof sp.error === "string" ? sp.error : null;
  const owner = isInstallationOwner(user);
  const wahooEnv = env.wahoo();
  const selfService = { allowed: owner, source: wahooEnv.source, redirectUri: redirectUri("wahoo"), scopes: WAHOO_SCOPES };

  // Direct device connections first (Wahoo before Garmin for ELEMNT riders), the app bridge last.
  const mine = new Set(user.apps ?? []);
  const order = (["wahoo", "garmin", "intervals"] as const).slice().sort((a, b) => Number(mine.has(b)) - Number(mine.has(a)) || 0);
  const cards = order.map((p) => {
    const c = conns.find((x) => x.provider === p);
    const adapter = PROVIDERS[p];
    return {
      provider: p,
      name: adapter.name,
      auth: adapter.auth,
      intro: INTRO[p],
      selfService: p === "wahoo" ? selfService : undefined,
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

  // Last activity per source app, for the hub.
  const lastSeen = Object.fromEntries(
    db
      .select({ app: activities.sourceApp, last: max(activities.startTime) })
      .from(activities)
      .where(and(eq(activities.userId, user.id), isNotNull(activities.sourceApp)))
      .groupBy(activities.sourceApp)
      .all()
      .filter((r) => r.last)
      .map((r) => [r.app, (r.last as Date).getTime()]),
  ) as Partial<Record<AppInfo["id"], number>>;
  const hubConns = conns.filter((c) => c.status !== "revoked").map((c) => ({ provider: c.provider, live: c.mode === "live" }));

  return (
    <div className="animate-fade-up">
      <PageHeader title="Apps & Geräte" description="Alle Quellen an einem Ort: woher deine Aktivitäten kommen und wohin deine Workouts gehen." />
      {error ? (
        <div className="mb-5 rounded-xl border border-[#f2caca] bg-critical-soft px-4 py-3 text-[14px] text-critical-ink" role="alert">
          Die Verbindung konnte nicht hergestellt werden: {error}
        </div>
      ) : null}

      <section aria-labelledby="hub-title">
        <h2 id="hub-title" className="mb-3 text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-3">
          Deine Apps
        </h2>
        <AppHub selected={user.apps ?? []} conns={hubConns} lastSeen={lastSeen} />
      </section>

      <section aria-labelledby="conn-title" className="mt-8">
        <h2 id="conn-title" className="mb-3 text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-3">
          Verbindungen
        </h2>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {cards.map((c) => (
            <DeviceCard key={c.provider} {...c} />
          ))}
        </div>
      </section>

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
