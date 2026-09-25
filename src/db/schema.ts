import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { WorkoutStructure } from "@/lib/workout/types";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  ftp: integer("ftp").notNull().default(230),
  lthr: integer("lthr").notNull().default(165),
  maxHr: integer("max_hr").notNull().default(188),
  restHr: integer("rest_hr").notNull().default(52),
  thresholdPace: integer("threshold_pace").notNull().default(285),
  weightKg: real("weight_kg"),
  timeZone: text("time_zone").notNull().default("Europe/Berlin"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  /** Devices and apps the athlete uses (onboarding), see lib/apps.ts. */
  apps: text("apps", { mode: "json" }).$type<string[]>(),
  /** Adjust planned, not yet sent workouts to the current load automatically. */
  autoAdapt: integer("auto_adapt", { mode: "boolean" }).notNull().default(false),
  onboardedAt: integer("onboarded_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const workouts = sqliteTable(
  "workouts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    sport: text("sport", { enum: ["ride", "run", "strength"] }).notNull(),
    structure: text("structure", { mode: "json" }).$type<WorkoutStructure>().notNull(),
    durationSec: integer("duration_sec").notNull().default(0),
    distanceM: integer("distance_m").notNull().default(0),
    tss: integer("tss").notNull().default(0),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    source: text("source", { enum: ["manual", "coach", "template", "plan"] })
      .notNull()
      .default("manual"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("workouts_user_idx").on(t.userId, t.updatedAt)],
);

export const trainingPlans = sqliteTable(
  "training_plans",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal").notNull(),
    sport: text("sport", { enum: ["ride", "run", "strength", "mixed"] }).notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    summary: text("summary").notNull().default(""),
    /** Week metadata: focus and target load per week. */
    weeks: text("weeks", { mode: "json" }).$type<PlanWeekMeta[]>().notNull(),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: createdAt(),
  },
  (t) => [index("plans_user_idx").on(t.userId)],
);

export interface PlanWeekMeta {
  index: number;
  startDate: string;
  focus: string;
  phase: "base" | "build" | "peak" | "taper" | "recovery" | "race";
  targetTss: number;
}

export const scheduledWorkouts = sqliteTable(
  "scheduled_workouts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workoutId: text("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => trainingPlans.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    status: text("status", { enum: ["planned", "done", "skipped"] })
      .notNull()
      .default("planned"),
    activityId: text("activity_id"),
    /** Set when the workout was adapted to the athlete's load: the planned original. */
    originalWorkoutId: text("original_workout_id").references(() => workouts.id, { onDelete: "set null" }),
    adaptNote: text("adapt_note"),
    createdAt: createdAt(),
  },
  (t) => [index("scheduled_user_date_idx").on(t.userId, t.date)],
);

export const deviceConnections = sqliteTable(
  "device_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["garmin", "wahoo", "intervals"] }).notNull(),
    /** "demo" connections simulate the provider when no API credentials are configured. */
    mode: text("mode", { enum: ["live", "demo"] }).notNull(),
    externalUserId: text("external_user_id"),
    displayName: text("display_name"),
    /** AES-256-GCM encrypted tokens. */
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: integer("token_expires_at", { mode: "timestamp_ms" }),
    scopes: text("scopes"),
    autoSync: integer("auto_sync", { mode: "boolean" }).notNull().default(true),
    lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
    status: text("status", { enum: ["connected", "error", "revoked"] })
      .notNull()
      .default("connected"),
    statusMessage: text("status_message"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("connections_user_provider_idx").on(t.userId, t.provider),
    index("connections_external_idx").on(t.provider, t.externalUserId),
  ],
);

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workoutId: text("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").references(() => deviceConnections.id, { onDelete: "set null" }),
    provider: text("provider", { enum: ["garmin", "wahoo", "intervals"] }).notNull(),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    scheduledDate: text("scheduled_date"),
    externalIds: text("external_ids", { mode: "json" }).$type<Record<string, string | number>>(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("deliveries_workout_idx").on(t.workoutId)],
);

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").references(() => deviceConnections.id, { onDelete: "set null" }),
    provider: text("provider", { enum: ["garmin", "wahoo", "intervals", "manual"] }).notNull(),
    externalId: text("external_id").notNull(),
    sport: text("sport", { enum: ["ride", "run", "strength", "other"] }).notNull(),
    name: text("name").notNull(),
    startTime: integer("start_time", { mode: "timestamp_ms" }).notNull(),
    /** Local calendar day of the start (YYYY-MM-DD). */
    date: text("date").notNull(),
    durationSec: integer("duration_sec").notNull(),
    movingSec: integer("moving_sec"),
    distanceM: real("distance_m"),
    elevationGainM: real("elevation_gain_m"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    avgPower: integer("avg_power"),
    normPower: integer("norm_power"),
    avgCadence: integer("avg_cadence"),
    avgSpeed: real("avg_speed"),
    calories: integer("calories"),
    tss: real("tss"),
    tssMethod: text("tss_method", { enum: ["power", "pace", "hr", "estimate"] }),
    /** Seconds per heart-rate zone 1..5 when available. */
    hrZoneSec: text("hr_zone_sec", { mode: "json" }).$type<number[]>(),
    vo2maxEst: real("vo2max_est"),
    deviceName: text("device_name"),
    /** App or device the activity was recorded with (lib/apps.ts), independent of the sync route. */
    sourceApp: text("source_app"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("activities_provider_external_idx").on(t.userId, t.provider, t.externalId),
    index("activities_user_date_idx").on(t.userId, t.date),
  ],
);

export const coachMessages = sqliteTable(
  "coach_messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    /** Structured attachment: a proposed workout or plan. */
    payload: text("payload", { mode: "json" }).$type<CoachPayload | null>(),
    createdAt: createdAt(),
  },
  (t) => [index("coach_user_idx").on(t.userId, t.createdAt)],
);

export type CoachPayload =
  | { kind: "workout"; workout: { name: string; description: string; sport: "ride" | "run" | "strength"; structure: WorkoutStructure }; savedWorkoutId?: string }
  | { kind: "plan"; plan: import("@/lib/coach/types").PlanProposal; savedPlanId?: string };

/**
 * API app credentials entered in the UI for self-hosted installs (the
 * installation owner registers a personal Wahoo developer app). Environment
 * variables take precedence. The secret is AES-GCM encrypted.
 */
export const providerApps = sqliteTable("provider_apps", {
  provider: text("provider", { enum: ["wahoo"] }).primaryKey(),
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret").notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["garmin", "wahoo", "intervals"] }).notNull(),
  codeVerifier: text("code_verifier").notNull(),
  /** Origin the user started from (the OAuth redirect may arrive via a public tunnel URL). */
  returnTo: text("return_to"),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type DeviceConnection = typeof deviceConnections.$inferSelect;
export type ScheduledWorkout = typeof scheduledWorkouts.$inferSelect;
export type TrainingPlan = typeof trainingPlans.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
export type CoachMessage = typeof coachMessages.$inferSelect;
