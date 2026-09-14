CREATE TABLE `intake_links` (
	`owner` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`introduction` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_intake_token` ON `intake_links` (`token`);