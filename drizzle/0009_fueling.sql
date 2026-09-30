CREATE TABLE `fuel_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`activity_id` text,
	`date` text NOT NULL,
	`sport` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`target_carbs_per_hour` integer DEFAULT 0 NOT NULL,
	`carbs_g` integer NOT NULL,
	`fluid_ml` integer,
	`gut_score` integer,
	`energy_score` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `fuel_logs_user_idx` ON `fuel_logs` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `fuel_overrides` (
	`scheduled_workout_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`temp_class` text,
	`flags` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scheduled_workout_id`) REFERENCES `scheduled_workouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fuel_products` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`carbs_g` real NOT NULL,
	`sodium_mg` integer DEFAULT 0 NOT NULL,
	`caffeine_mg` integer DEFAULT 0 NOT NULL,
	`multi_source` integer DEFAULT false NOT NULL,
	`fluid_ml` integer,
	`serving_label` text DEFAULT '1 Portion' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fuel_products_user_idx` ON `fuel_products` (`user_id`);--> statement-breakpoint
CREATE TABLE `sweat_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`activity_id` text,
	`date` text NOT NULL,
	`sport` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`temp_c` real NOT NULL,
	`temp_class` text NOT NULL,
	`pre_kg` real NOT NULL,
	`post_kg` real NOT NULL,
	`fluid_ml` integer DEFAULT 0 NOT NULL,
	`urine_ml` integer DEFAULT 0 NOT NULL,
	`rate_lh` real NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sweat_tests_user_idx` ON `sweat_tests` (`user_id`,`date`);--> statement-breakpoint
ALTER TABLE `users` ADD `fuel_max_carb` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `fuel_sweat_sodium` text DEFAULT 'average' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `fuel_caffeine` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `fuel_prefer_natural` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `fuel_pantry` text;