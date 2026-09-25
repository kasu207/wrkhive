ALTER TABLE `activities` ADD `source_app` text;--> statement-breakpoint
ALTER TABLE `scheduled_workouts` ADD `original_workout_id` text REFERENCES workouts(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `scheduled_workouts` ADD `adapt_note` text;--> statement-breakpoint
ALTER TABLE `users` ADD `apps` text;--> statement-breakpoint
ALTER TABLE `users` ADD `auto_adapt` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `onboarded_at` integer;--> statement-breakpoint
-- Existing accounts are already set up: skip the onboarding for them.
UPDATE `users` SET `onboarded_at` = `created_at` WHERE `onboarded_at` IS NULL;--> statement-breakpoint
-- Attribute existing activities to their source where it is known.
UPDATE `activities` SET `source_app` = 'demo' WHERE `source_app` IS NULL AND `device_name` = 'Demo-Gerät';--> statement-breakpoint
UPDATE `activities` SET `source_app` = CASE `provider` WHEN 'garmin' THEN 'garmin' WHEN 'wahoo' THEN 'wahoo' WHEN 'manual' THEN 'file' END WHERE `source_app` IS NULL AND `provider` IN ('garmin', 'wahoo', 'manual');
