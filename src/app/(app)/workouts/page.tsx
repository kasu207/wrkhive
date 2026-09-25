import { desc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { WorkoutLibrary } from "@/components/workout/library";
import { getDb } from "@/db";
import { workouts } from "@/db/schema";
import { requireUser, thresholdsOf } from "@/lib/server/auth";
import { TEMPLATES } from "@/lib/workout/templates";
import { parseWorkoutText } from "@/lib/workout/text";

export const metadata: Metadata = { title: "Workouts" };

export default async function WorkoutsPage() {
  const user = await requireUser();
  const t = thresholdsOf(user);
  const rows = getDb().select().from(workouts).where(eq(workouts.userId, user.id)).orderBy(desc(workouts.updatedAt)).all();
  const templateStructures = Object.fromEntries(TEMPLATES.map((tpl) => [tpl.id, parseWorkoutText(tpl.text, tpl.sport, t).structure]));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Workouts"
        description="Deine Bibliothek. Öffne ein Workout, um es zu bearbeiten oder an dein Gerät zu senden."
        actions={
          <ButtonLink href="/workouts/new">
            <Plus />
            Neues Workout
          </ButtonLink>
        }
      />
      <WorkoutLibrary
        items={rows.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          sport: w.sport,
          structure: w.structure,
          durationSec: w.durationSec,
          distanceM: w.distanceM,
          tss: w.tss,
          favorite: w.favorite,
          source: w.source,
          updatedAt: w.updatedAt.getTime(),
        }))}
        templates={TEMPLATES}
        templateStructures={templateStructures}
        thresholds={t}
      />
    </div>
  );
}
