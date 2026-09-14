PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`name` text NOT NULL,
	`phone_number` text NOT NULL,
	`call_time` text,
	`google_access_token` text,
	`google_refresh_token` text,
	`google_token_expiry` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "name", "phone_number", "call_time", "google_access_token", "google_refresh_token", "google_token_expiry", "created_at") SELECT "id", "email", "name", "phone_number", "call_time", "google_access_token", "google_refresh_token", "google_token_expiry", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);