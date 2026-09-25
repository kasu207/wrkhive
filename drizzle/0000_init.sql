CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`sport` text NOT NULL,
	`name` text NOT NULL,
	`start_time` integer NOT NULL,
	`date` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`moving_sec` integer,
	`distance_m` real,
	`elevation_gain_m` real,
	`avg_hr` integer,
	`max_hr` integer,
	`avg_power` integer,
	`norm_power` integer,
	`avg_cadence` integer,
	`avg_speed` real,
	`calories` integer,
	`tss` real,
	`tss_method` text,
	`hr_zone_sec` text,
	`vo2max_est` real,
	`device_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `device_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activities_provider_external_idx` ON `activities` (`user_id`,`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `activities_user_date_idx` ON `activities` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `coach_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`payload` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coach_user_idx` ON `coach_messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workout_id` text NOT NULL,
	`connection_id` text,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_date` text,
	`external_ids` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `device_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deliveries_workout_idx` ON `deliveries` (`workout_id`);--> statement-breakpoint
CREATE TABLE `device_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`mode` text NOT NULL,
	`external_user_id` text,
	`display_name` text,
	`access_token` text,
	`refresh_token` text,
	`token_expires_at` integer,
	`scopes` text,
	`auto_sync` integer DEFAULT true NOT NULL,
	`last_sync_at` integer,
	`status` text DEFAULT 'connected' NOT NULL,
	`status_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_user_provider_idx` ON `device_connections` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `connections_external_idx` ON `device_connections` (`provider`,`external_user_id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`code_verifier` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scheduled_workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workout_id` text NOT NULL,
	`plan_id` text,
	`date` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`activity_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `training_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scheduled_user_date_idx` ON `scheduled_workouts` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `training_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`sport` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`weeks` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plans_user_idx` ON `training_plans` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`ftp` integer DEFAULT 230 NOT NULL,
	`lthr` integer DEFAULT 165 NOT NULL,
	`max_hr` integer DEFAULT 188 NOT NULL,
	`rest_hr` integer DEFAULT 52 NOT NULL,
	`threshold_pace` integer DEFAULT 285 NOT NULL,
	`weight_kg` real,
	`time_zone` text DEFAULT 'Europe/Berlin' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sport` text NOT NULL,
	`structure` text NOT NULL,
	`duration_sec` integer DEFAULT 0 NOT NULL,
	`distance_m` integer DEFAULT 0 NOT NULL,
	`tss` integer DEFAULT 0 NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workouts_user_idx` ON `workouts` (`user_id`,`updated_at`);