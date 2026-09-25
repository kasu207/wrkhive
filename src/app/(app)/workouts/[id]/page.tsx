import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkoutBuilder } from "@/components/workout/builder";
import { getDb } from "@/db";
import { deviceConnections, workouts } from "@/db/schema";
import { requireUser, thresholdsOf } from "@/lib/server/auth";

export async function generateMetadata(props: PageProps<"/workouts/[id]">): Promise<Metadata> {
  const user = await requireUser();
  const { id } = await props.params;
  const w = getDb().select({ name: workouts.name }).from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, user.id))).get();
  return { title: w?.name ?? "Workout" };
}

export default async function WorkoutPage(props: PageProps<"/workouts/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const db = getDb();
  const w = db.select().from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, user.id))).get();
  if (!w) notFound();
  const connections = db.select().from(deviceConnections).where(eq(deviceConnections.userId, user.id)).all();
  return (
    <WorkoutBuilder
      key={w.id}
      initial={{ id: w.id, name: w.name, description: w.description, structure: w.structure }}
      thresholds={thresholdsOf(user)}
      connections={connections.map((c) => ({ provider: c.provider, mode: c.mode, status: c.status, displayName: c.displayName }))}
    />
  );
}
