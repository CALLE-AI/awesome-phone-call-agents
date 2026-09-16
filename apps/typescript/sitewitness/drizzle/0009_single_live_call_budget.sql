ALTER TABLE `call_runs` ADD `live_call_budget_reserved_at` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_call_runs_single_live_budget` ON `call_runs` ((1)) WHERE `provider_mode` = 'calle_goal' AND `live_call_budget_reserved_at` IS NOT NULL;
