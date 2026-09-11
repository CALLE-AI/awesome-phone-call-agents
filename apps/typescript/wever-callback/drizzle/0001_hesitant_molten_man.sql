CREATE TABLE `phone_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`expires_at` text NOT NULL
);
