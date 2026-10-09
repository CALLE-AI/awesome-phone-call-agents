ALTER TABLE `follow_up_tasks` ADD `updated_at` text;
--> statement-breakpoint
ALTER TABLE `follow_up_tasks` ADD `attempt_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `follow_up_tasks` ADD `cancel_reason` text;
--> statement-breakpoint
ALTER TABLE `follow_up_tasks` ADD `sent_at` text;
--> statement-breakpoint
ALTER TABLE `follow_up_tasks` ADD `viewed_at` text;
--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor` text DEFAULT 'System' NOT NULL;
