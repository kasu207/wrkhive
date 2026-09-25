import { and, count, eq } from "drizzle-orm";
import { FileDown } from "lucide-react";
import type { Metadata } from "next";
import { DeviceCard } from "@/components/devices/device-card";
import { Card, PageHeader } from "@/components/ui/card";
import { getDb } from "@/db";
import { activities, deliveries, deviceConnections } from "@/db/schema";
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
} as const;

export default async function DevicesPage(props: PageProps<"/devices">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const db = getDb();
  const conns = db.select().from(deviceConnections).where(eq(deviceConnections.userId, user.id)).all();
  const error = typeof sp.error === "string" ? sp.error : null;

  const cards = (["garmin", "wahoo"] as const).map((p) => {
    const c = conns.find((x) => x.provider === p);
    const adapter = PROVIDERS[p];
    return {
      provider: p,
      name: adapter.name,
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
      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((c) => (
          <DeviceCard key={c.provider} {...c} />
        ))}
      </div>

      <Card className="mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-ink-2">
          <FileDown className="size-5" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold">Anderes Gerät?</h2>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-ink-2">
            Jedes Workout lässt sich als FIT-Datei herunterladen. Garmin-Geräte übernehmen sie per USB aus dem Ordner <code className="rounded bg-surface-2 px-1 py-0.5 text-[13px]">GARMIN/NewFiles</code>, viele andere Radcomputer und Uhren importieren FIT-Workouts ebenfalls. Für Zwift und andere Indoor-Apps gibt es den ZWO-Export. Öffne dazu ein Workout und wähle „An Gerät senden“.
          </p>
        </div>
      </Card>
    </div>
  );
}
