CREATE TABLE `wellness` (
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`resting_hr` integer,
	`hrv` real,
	`hrv_sdnn` real,
	`sleep_sec` integer,
	`weight_kg` real,
	`legs` integer,
	`sleep_feel` integer,
	`motivation` integer,
	`source` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `activities` ADD `decoupling_pct` real;--> statement-breakpoint
ALTER TABLE `activities` ADD `bests` text;--> statement-breakpoint
ALTER TABLE `users` ADD `dashboard` text;