DROP INDEX IF EXISTS `idx_call_runs_single_live_budget`;
--> statement-breakpoint
CREATE INDEX `idx_call_runs_live_budget` ON `call_runs` (`provider_mode`, `live_call_budget_reserved_at`);
