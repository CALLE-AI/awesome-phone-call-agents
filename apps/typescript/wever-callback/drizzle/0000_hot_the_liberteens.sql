CREATE TABLE `businesses` (
	`owner` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`inquiry_id` text NOT NULL,
	`provider_id` text,
	`status` text NOT NULL,
	`request` text NOT NULL,
	`result` text,
	`transcript` text DEFAULT '[]' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`inquiry_id`) REFERENCES `inquiries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_calls_inquiry` ON `calls` (`inquiry_id`);--> statement-breakpoint
CREATE INDEX `idx_calls_owner` ON `calls` (`owner`);--> statement-breakpoint
CREATE TABLE `inquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`source` text NOT NULL,
	`need` text NOT NULL,
	`timezone` text NOT NULL,
	`consent` integer DEFAULT 0 NOT NULL,
	`consent_note` text NOT NULL,
	`sample` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`appointment` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inquiries_owner_created` ON `inquiries` (`owner`,`created_at`);