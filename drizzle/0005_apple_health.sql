ALTER TABLE `users` ADD `apple_health_key_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `apple_health_last_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `users_apple_health_key_idx` ON `users` (`apple_health_key_hash`);