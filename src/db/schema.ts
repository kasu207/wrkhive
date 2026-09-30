import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ActivityBests } from "@/lib/analytics/bests";
import type { DashboardLayout } from "@/lib/dashboard";
import type { ProductKind, SessionFlags, SweatSodium, TempClass } from "@/lib/nutrition/types";
import type { WorkoutStructure } from "@/lib/workout/types";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable(
  "users",
  {
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
    /** Weekly training hours before the first synced activity; seeds fitness so short histories are not read as overload. */
    baselineWeeklyHours: real("baseline_weekly_hours"),
    /** SHA-256 of the Apple Health webhook key (Health Auto Export); the key itself is shown once. */
    appleHealthKeyHash: text("apple_health_key_hash"),
    /** Last delivery from Health Auto Export. */
    appleHealthLastAt: integer("apple_health_last_at", { mode: "timestamp_ms" }),
    /** Widgets on the athlete's dashboard in display order; null = default layout (lib/dashboard.ts). */
    dashboard: text("dashboard", { mode: "json" }).$type<DashboardLayout>(),
    /** Carbohydrate the gut tolerates during exercise, g/h; raised step by step (gut training). */
    fuelMaxCarb: integer("fuel_max_carb").notNull().default(60),
    fuelSweatSodium: text("fuel_sweat_sodium", { enum: ["low", "average", "high"] }).$type<SweatSodium>().notNull().default("average"),
    fuelCaffeine: integer("fuel_caffeine", { mode: "boolean" }).notNull().default(false),
    fuelPreferNatural: integer("fuel_prefer_natural", { mode: "boolean" }).notNull().default(false),
    /** Product ids in the athlete's pantry (catalog and own products); null = default pantry. */
    fuelPantry: text("fuel_pantry", { mode: "json" }).$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_apple_health_key_idx").on(t.appleHealthKeyHash)],
);

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
    /** "removed": the workout was deleted at the provider after sending. */
    status: text("status", { enum: ["sent", "failed", "removed"] }).notNull(),
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
    /** Sync route: provider API, "apple" (Apple Health export or Health Auto Export) or "manual" (file import, manual entry). */
    provider: text("provider", { enum: ["garmin", "wahoo", "intervals", "apple", "manual"] }).notNull(),
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
    tssMethod: text("tss_method", { enum: ["power", "pace", "hr", "rpe", "estimate"] }),
    /** Session-RPE 1-10, nur bei manuell erfassten Einheiten. */
    rpe: integer("rpe"),
    /** Seconds per heart-rate zone 1..5 when available. */
    hrZoneSec: text("hr_zone_sec", { mode: "json" }).$type<number[]>(),
    vo2maxEst: real("vo2max_est"),
    /** Aerobic decoupling (Pa:Hr / Pw:Hr) of the second half against the first, in percent; from the record stream. */
    decouplingPct: real("decoupling_pct"),
    /** Best power and fastest distances within the session (lib/analytics/bests.ts). */
    bests: text("bests", { mode: "json" }).$type<ActivityBests>(),
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

/**
 * Daily health values, one row per athlete and calendar day. Device data
 * (Apple Health, Garmin, intervals.icu) and the morning check-in fill the
 * same row; a value that arrives later replaces the earlier one.
 */
export const wellness = sqliteTable(
  "wellness",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Local calendar day (YYYY-MM-DD); sleep counts for the day it ends. */
    date: text("date").notNull(),
    restingHr: integer("resting_hr"),
    /** Overnight HRV as rMSSD in ms (Garmin, Oura, Whoop, intervals.icu). */
    hrv: real("hrv"),
    /** HRV as SDNN in ms (Apple Watch); not comparable with rMSSD, kept apart. */
    hrvSdnn: real("hrv_sdnn"),
    sleepSec: integer("sleep_sec"),
    weightKg: real("weight_kg"),
    /** VO2max as the device reports it (Garmin: running, intervals.icu), ml/kg/min. */
    vo2max: real("vo2max"),
    /** Cycling VO2max as the device reports it (Garmin), ml/kg/min. */
    vo2maxRide: real("vo2max_ride"),
    /** Morning check-in, 1 (bad) to 5 (very good). */
    legs: integer("legs"),
    sleepFeel: integer("sleep_feel"),
    motivation: integer("motivation"),
    /** Last writer: apple, garmin, intervals, manual or demo (sample data, removed with the demo connection). */
    source: text("source").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

/** The athlete's own fueling products with the values from the pack. */
export const fuelProducts = sqliteTable(
  "fuel_products",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["gel", "chew", "bar", "fruit", "snack", "drink", "salt"] }).$type<ProductKind>().notNull(),
    carbsG: real("carbs_g").notNull(),
    sodiumMg: integer("sodium_mg").notNull().default(0),
    caffeineMg: integer("caffeine_mg").notNull().default(0),
    multiSource: integer("multi_source", { mode: "boolean" }).notNull().default(false),
    fluidMl: integer("fluid_ml"),
    servingLabel: text("serving_label").notNull().default("1 Portion"),
    createdAt: createdAt(),
  },
  (t) => [index("fuel_products_user_idx").on(t.userId)],
);

/** Weigh-in before and after a session: the athlete's sweat rate. */
export const sweatTests = sqliteTable(
  "sweat_tests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
    date: text("date").notNull(),
    sport: text("sport", { enum: ["ride", "run", "strength"] }).notNull(),
    durationSec: integer("duration_sec").notNull(),
    tempC: real("temp_c").notNull(),
    tempClass: text("temp_class", { enum: ["cool", "mild", "warm", "hot"] }).$type<TempClass>().notNull(),
    preKg: real("pre_kg").notNull(),
    postKg: real("post_kg").notNull(),
    fluidMl: integer("fluid_ml").notNull().default(0),
    urineMl: integer("urine_ml").notNull().default(0),
    rateLh: real("rate_lh").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("sweat_tests_user_idx").on(t.userId, t.date)],
);

/** What the athlete ate and drank in a session and how the gut took it. */
export const fuelLogs = sqliteTable(
  "fuel_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
    date: text("date").notNull(),
    sport: text("sport", { enum: ["ride", "run", "strength", "other"] }).notNull(),
    durationSec: integer("duration_sec").notNull(),
    /** Planned carbohydrate for the session, g/h, 0 when unknown. */
    targetCarbsPerHour: integer("target_carbs_per_hour").notNull().default(0),
    carbsG: integer("carbs_g").notNull(),
    fluidMl: integer("fluid_ml"),
    /** 1 = no complaints .. 5 = severe gut problems. */
    gutScore: integer("gut_score"),
    /** 1 = empty .. 5 = strong until the end. */
    energyScore: integer("energy_score"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("fuel_logs_user_idx").on(t.userId, t.date)],
);

/** Per scheduled session: conditions the plan cannot know (temperature, race, fasted). */
export const fuelOverrides = sqliteTable("fuel_overrides", {
  scheduledWorkoutId: text("scheduled_workout_id")
    .primaryKey()
    .references(() => scheduledWorkouts.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tempClass: text("temp_class", { enum: ["cool", "mild", "warm", "hot"] }).$type<TempClass>(),
  flags: text("flags", { mode: "json" }).$type<SessionFlags>(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

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
export type Wellness = typeof wellness.$inferSelect;
export type FuelProductRow = typeof fuelProducts.$inferSelect;
export type SweatTest = typeof sweatTests.$inferSelect;
export type FuelLog = typeof fuelLogs.$inferSelect;
