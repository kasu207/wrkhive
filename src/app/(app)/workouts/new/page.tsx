import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { WorkoutBuilder } from "@/components/workout/builder";
import { getDb } from "@/db";
import { deviceConnections } from "@/db/schema";
import { requireUser, thresholdsOf } from "@/lib/server/auth";
import { starterStructure } from "@/lib/workout/edit";
import type { Sport } from "@/lib/workout/types";

export const metadata: Metadata = { title: "Neues Workout" };

export default async function NewWorkoutPage(props: PageProps<"/workouts/new">) {
  const user = await requireUser();
  const { sport: sportParam } = await props.searchParams;
  const sport: Sport = sportParam === "run" || sportParam === "strength" ? sportParam : "ride";
  const connections = getDb().select().from(deviceConnections).where(eq(deviceConnections.userId, user.id)).all();
  return (
    <WorkoutBuilder
      key={sport}
      initial={{ id: null, name: "", description: "", structure: starterStructure(sport) }}
      thresholds={thresholdsOf(user)}
      connections={connections.map((c) => ({ provider: c.provider, mode: c.mode, status: c.status, displayName: c.displayName }))}
    />
  );
}
