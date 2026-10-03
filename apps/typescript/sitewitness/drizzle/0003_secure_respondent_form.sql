ALTER TABLE `follow_up_tasks` ADD `response_token` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `follow_up_tasks_response_token_unique` ON `follow_up_tasks` (`response_token`);
--> statement-breakpoint
CREATE TABLE `secure_form_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`respondent_name` text NOT NULL,
	`respondent_role` text NOT NULL,
	`knowledge_start` text NOT NULL,
	`knowledge_end` text NOT NULL,
	`answers` text NOT NULL,
	`limitations` text NOT NULL,
	`acknowledged` integer NOT NULL,
	`submitted_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secure_form_responses_task_id_unique` ON `secure_form_responses` (`task_id`);
