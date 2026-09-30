import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { Metadata } from "next";
import { FuelingView, type FuelTab, type UpcomingPlan } from "@/components/fueling/fueling-view";
import { PageHeader } from "@/components/ui/card";
import { getDb } from "@/db";
import { activities, fuelLogs } from "@/db/schema";
import { addDays } from "@/lib/dates";
import { DEFAULT_PANTRY } from "@/lib/nutrition";
import { requireUser } from "@/lib/server/auth";
import { allProducts, fuelLogsOf, fuelProfileOf, pantryOf, planForScheduled, progressionFor, sweatTestsOf } from "@/lib/server/nutrition";
import { todayFor } from "@/lib/server/sync";
import { scheduledBetween } from "@/lib/server/training";

export const metadata: Metadata = { title: "Verpflegung" };

const TABS: FuelTab[] = ["plan", "pantry", "sweat", "log"];

export default async function FuelingPage(props: PageProps<"/fueling">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const tab = typeof sp.tab === "string" && (TABS as string[]).includes(sp.tab) ? (sp.tab as FuelTab) : "plan";
  const today = todayFor(user);
  const db = getDb();

  const toUpcoming = (id: string): UpcomingPlan | null => {
    const p = planForScheduled(user, id);
    return p ? { scheduledId: p.scheduledId, date: p.date, workout: p.workout, tempClass: p.tempClass, flags: p.flags, plan: p.plan } : null;
  };
  const upcoming = scheduledBetween(user.id, today, addDays(today, 6))
    .filter((s) => s.scheduled.status === "planned")
    .slice(0, 8)
    .map((s) => toUpcoming(s.scheduled.id))
    .filter((p): p is UpcomingPlan => p !== null);
  const open = typeof sp.plan === "string" ? toUpcoming(sp.plan) : null;

  const logged = new Set(
    db
      .select({ id: fuelLogs.activityId })
      .from(fuelLogs)
      .where(and(eq(fuelLogs.userId, user.id), isNotNull(fuelLogs.activityId)))
      .all()
      .map((r) => r.id),
  );
  const recent = db
    .select({ id: activities.id, date: activities.date, sport: activities.sport, name: activities.name, durationSec: activities.durationSec })
    .from(activities)
    .where(and(eq(activities.userId, user.id), gte(activities.date, addDays(today, -20))))
    .orderBy(desc(activities.startTime))
    .limit(30)
    .all()
    .map((a) => ({ ...a, logged: logged.has(a.id) }));

  const profile = fuelProfileOf(user);
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Verpflegung"
        description="Was du vor, während und nach dem Training isst und trinkst: berechnet aus Dauer, Intensität, Gewicht, Temperatur und deinem Vorrat."
      />
      <FuelingView
        key={tab}
        tab={tab}
        today={today}
        profile={profile}
        settings={{ maxCarb: user.fuelMaxCarb, sweatSodium: user.fuelSweatSodium, caffeine: user.fuelCaffeine, preferNatural: user.fuelPreferNatural }}
        pantry={pantryOf(user)}
        products={allProducts(user.id)}
        pantryIds={user.fuelPantry ?? DEFAULT_PANTRY}
        upcoming={upcoming}
        open={open}
        tests={sweatTestsOf(user.id).map((t) => ({ id: t.id, date: t.date, sport: t.sport, durationSec: t.durationSec, tempC: t.tempC, tempClass: t.tempClass, rateLh: t.rateLh, preKg: t.preKg, postKg: t.postKg, fluidMl: t.fluidMl }))}
        logs={fuelLogsOf(user.id).map((l) => ({ id: l.id, date: l.date, sport: l.sport, durationSec: l.durationSec, carbsG: l.carbsG, fluidMl: l.fluidMl, gutScore: l.gutScore, energyScore: l.energyScore, notes: l.notes }))}
        activities={recent}
        advice={progressionFor(user)}
        activityId={typeof sp.activity === "string" ? sp.activity : undefined}
      />
    </div>
  );
}
