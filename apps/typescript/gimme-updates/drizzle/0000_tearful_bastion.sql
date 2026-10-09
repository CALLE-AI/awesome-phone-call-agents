CREATE TABLE `call_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`call_type` text NOT NULL,
	`calle_call_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`structured_result` text,
	`transcript` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`sender` text NOT NULL,
	`subject` text NOT NULL,
	`summary` text NOT NULL,
	`category` text NOT NULL,
	`urgency` text NOT NULL,
	`due_date` integer,
	`decision` text,
	`decision_detail` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email_id` text NOT NULL,
	`remind_at` integer NOT NULL,
	`fired` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone_number` text NOT NULL,
	`call_time` text NOT NULL,
	`google_access_token` text NOT NULL,
	`google_refresh_token` text NOT NULL,
	`google_token_expiry` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
