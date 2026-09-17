CREATE TABLE `call_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`calle_call_id` text,
	`contact_id` integer,
	`recipient_name` text NOT NULL,
	`phone_last_four` text NOT NULL,
	`workflow` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`company` text NOT NULL,
	`phone` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_phone_unique` ON `contacts` (`phone`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` integer PRIMARY KEY NOT NULL,
	`project_name` text NOT NULL,
	`follow_up_items` text NOT NULL,
	`updated_at` text NOT NULL
);
