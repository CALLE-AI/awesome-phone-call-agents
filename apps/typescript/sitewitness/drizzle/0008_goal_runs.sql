ALTER TABLE `call_runs` ADD `goal_id` text;
--> statement-breakpoint
ALTER TABLE `call_runs` ADD `goal_run_id` text;
--> statement-breakpoint
ALTER TABLE `call_runs` ADD `telephone_run_id` text;
--> statement-breakpoint
ALTER TABLE `call_runs` ADD `run_spec_id` text;
--> statement-breakpoint
ALTER TABLE `call_runs` ADD `run_spec_version` integer;
--> statement-breakpoint
ALTER TABLE `call_runs` ADD `variables_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `call_runs` ADD `goal_result` text;
--> statement-breakpoint
ALTER TABLE `call_runs` ADD `goal_error` text;
--> statement-breakpoint
CREATE INDEX `idx_call_runs_goal_run_id` ON `call_runs` (`goal_run_id`);
