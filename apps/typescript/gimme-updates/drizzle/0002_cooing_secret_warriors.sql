PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`sender` text NOT NULL,
	`subject` text NOT NULL,
	`summary` text,
	`category` text,
	`urgency` text,
	`due_date` integer,
	`decision` text,
	`decision_detail` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_emails`("id", "user_id", "gmail_message_id", "sender", "subject", "summary", "category", "urgency", "due_date", "decision", "decision_detail", "status", "created_at") SELECT "id", "user_id", "gmail_message_id", "sender", "subject", "summary", "category", "urgency", "due_date", "decision", "decision_detail", "status", "created_at" FROM `emails`;--> statement-breakpoint
DROP TABLE `emails`;--> statement-breakpoint
ALTER TABLE `__new_emails` RENAME TO `emails`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`phone_number` text NOT NULL,
	`call_time` text NOT NULL,
	`google_access_token` text,
	`google_refresh_token` text,
	`google_token_expiry` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "name", "phone_number", "call_time", "google_access_token", "google_refresh_token", "google_token_expiry", "created_at") SELECT "id", "email", "name", "phone_number", "call_time", "google_access_token", "google_refresh_token", "google_token_expiry", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);