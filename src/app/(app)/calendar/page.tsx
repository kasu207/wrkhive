import { and, desc, eq, gte, lte, ne } from "drizzle-orm";
import { MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar/calendar-view";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { getDb } from "@/db";
import { deviceConnections, trainingPlans, workouts } from "@/db/schema";
import { addDays, isISODate, startOfWeek } from "@/lib/dates";
import { requireUser, thresholdsOf } from "@/lib/server/auth";
import { todayFor } from "@/lib/server/sync";
import { activitiesBetween, scheduledBetween } from "@/lib/server/training";
import { connectionPreference } from "@/lib/apps";

export const metadata: Metadata = { title: "Kalender" };

const WEEKS = 4;

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const user = await requireUser();
  const db = getDb();
  const today = todayFor(user);
  const { start: startParam } = await props.searchParams;
  const start = typeof startParam === "string" && isISODate(startParam) ? startOfWeek(startParam) : addDays(startOfWeek(today), -7);
  const end = addDays(start, WEEKS * 7 - 1);

  const scheduled = scheduledBetween(user.id, start, end);
  const acts = activitiesBetween(user.id, start, end);
  const linked = new Set(scheduled.map((s) => s.scheduled.activityId).filter(Boolean));
  const plans = db
    .select()
    .from(trainingPlans)
    .where(and(eq(trainingPlans.userId, user.id), lte(trainingPlans.startDate, end), gte(trainingPlans.endDate, start)))
    .all();
  const library = db
    .select({ id: workouts.id, name: workouts.name, sport: workouts.sport, durationSec: workouts.durationSec, tss: workouts.tss })
    .from(workouts)
    .where(and(eq(workouts.userId, user.id), ne(workouts.source, "plan")))
    .orderBy(desc(workouts.favorite), desc(workouts.updatedAt))
    .all();
  const pref = connectionPreference(user.apps);
  const connections = db
    .select()
    .from(deviceConnections)
    .where(eq(deviceConnections.userId, user.id))
    .all()
    .sort((a, b) => pref.indexOf(a.provider) - pref.indexOf(b.provider));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Kalender"
        description="Plane deine Woche, verschiebe Einheiten und sieh, was du tatsächlich trainiert hast."
        actions={
          <ButtonLink href="/coach?tab=plan" variant="secondary">
            <MessageSquare />
            Trainingsplan erstellen
          </ButtonLink>
        }
      />
      <CalendarView
        start={start}
        weeks={WEEKS}
        today={today}
        items={scheduled.map(({ scheduled: s, workout: w }) => ({
          scheduledId: s.id,
          date: s.date,
          status: s.status,
          planId: s.planId,
          adapted: Boolean(s.originalWorkoutId),
          workout: { id: w.id, name: w.name, description: w.description, sport: w.sport, structure: w.structure, durationSec: w.durationSec, tss: w.tss },
        }))}
        acts={acts.map((a) => ({
          id: a.id,
          date: a.date,
          sport: a.sport,
          name: a.name,
          durationSec: a.durationSec,
          distanceM: a.distanceM,
          tss: a.tss,
          linked: linked.has(a.id),
        }))}
        plans={plans.map((p) => ({ id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate, weeks: p.weeks }))}
        library={library}
        thresholds={thresholdsOf(user)}
        connections={connections.map((c) => ({ provider: c.provider, mode: c.mode, status: c.status, displayName: c.displayName }))}
      />
    </div>
  );
}
