import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkoutBuilder } from "@/components/workout/builder";
import { getDb } from "@/db";
import { deviceConnections, workouts } from "@/db/schema";
import { requireUser, thresholdsOf } from "@/lib/server/auth";
import { starterStructure } from "@/lib/workout/edit";
import type { Sport } from "@/lib/workout/types";

export async function generateMetadata(props: PageProps<"/workouts/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  if (id === "new") return { title: "Neues Workout" };
  const user = await requireUser();
  const w = getDb().select({ name: workouts.name }).from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, user.id))).get();
  return { title: w?.name ?? "Workout" };
}

/**
 * One route for new and existing workouts: after the first save the builder
 * swaps the URL to /workouts/<id> without remounting (keeps edits and dialogs).
 */
export default async function WorkoutPage(props: PageProps<"/workouts/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const db = getDb();
  const connections = db
    .select()
    .from(deviceConnections)
    .where(eq(deviceConnections.userId, user.id))
    .all()
    .map((c) => ({ provider: c.provider, mode: c.mode, status: c.status, displayName: c.displayName }));

  if (id === "new") {
    const { sport: sportParam } = await props.searchParams;
    const sport: Sport = sportParam === "run" || sportParam === "strength" ? sportParam : "ride";
    return (
      <WorkoutBuilder
        resetKey={`new-${sport}`}
        initial={{ id: null, name: "", description: "", structure: starterStructure(sport) }}
        thresholds={thresholdsOf(user)}
        connections={connections}
      />
    );
  }

  const w = db.select().from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, user.id))).get();
  if (!w) notFound();
  return (
    <WorkoutBuilder
      resetKey={w.id}
      initial={{ id: w.id, name: w.name, description: w.description, structure: w.structure }}
      thresholds={thresholdsOf(user)}
      connections={connections}
    />
  );
}
