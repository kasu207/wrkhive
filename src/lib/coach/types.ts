import type { PlanWeekMeta } from "@/db/schema";
import type { Sport, WorkoutStructure } from "@/lib/workout/types";

export interface PlannedSession {
  /** 0 = Monday ... 6 = Sunday, relative to the week's start. */
  day: number;
  name: string;
  description: string;
  sport: Sport;
  structure: WorkoutStructure;
}

export interface PlanWeek extends PlanWeekMeta {
  sessions: PlannedSession[];
}

export interface PlanProposal {
  name: string;
  goal: string;
  sport: Sport | "mixed";
  startDate: string;
  endDate: string;
  summary: string;
  weeks: PlanWeek[];
}
