CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `consent_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`respondent_id` text NOT NULL,
	`version` integer NOT NULL,
	`automated_call_allowed` integer NOT NULL,
	`transcription_allowed` integer NOT NULL,
	`selected_channel` text NOT NULL,
	`created_at` text NOT NULL,
	`withdrawn_at` text
);
--> statement-breakpoint
CREATE TABLE `evidence_gap_dispositions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`evidence_gap_id` text NOT NULL,
	`disposition` text NOT NULL,
	`rationale` text NOT NULL,
	`reviewer_role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dispositions_gap_id` ON `evidence_gap_dispositions` (`evidence_gap_id`);
--> statement-breakpoint
CREATE TABLE `review_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` text NOT NULL,
	`action` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`payload` text NOT NULL,
	`reviewer_role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_review_actions_statement_id` ON `review_actions` (`statement_id`);
--> statement-breakpoint
CREATE TABLE `follow_up_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`evidence_gap_id` text NOT NULL,
	`channel` text NOT NULL,
	`summary` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_follow_up_tasks_gap_id` ON `follow_up_tasks` (`evidence_gap_id`);
