CREATE TABLE `call_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`interview_id` text NOT NULL,
	`authorization_version` integer NOT NULL,
	`provider_mode` text NOT NULL,
	`provider_call_id` text,
	`status` text NOT NULL,
	`request_payload` text NOT NULL,
	`response_payload` text,
	`preview_confirmed_at` text,
	`launched_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `call_runs_interview_authorization_unique` ON `call_runs` (`interview_id`,`authorization_version`);
