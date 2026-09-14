CREATE TABLE `human_interview_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`interviewer` text NOT NULL,
	`method` text NOT NULL,
	`interview_date` text NOT NULL,
	`respondent_name` text NOT NULL,
	`respondent_role` text NOT NULL,
	`knowledge_start` text NOT NULL,
	`knowledge_end` text NOT NULL,
	`answers` text NOT NULL,
	`limitations` text NOT NULL,
	`declined_notes` text NOT NULL,
	`confirmed` integer NOT NULL,
	`submitted_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `human_interview_records_task_id_unique` ON `human_interview_records` (`task_id`);
