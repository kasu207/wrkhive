CREATE TABLE `calendar_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`time` text,
	`name` text NOT NULL,
	`sport` text NOT NULL,
	`duration_min` integer NOT NULL,
	`rpe` integer,
	`note` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`activity_id` text,
	`completion` text,
	`series_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_entries_user_date_idx` ON `calendar_entries` (`user_id`,`date`);--> statement-breakpoint
ALTER TABLE `users` ADD `goals` text;--> statement-breakpoint
ALTER TABLE `users` ADD `goal_note` text;