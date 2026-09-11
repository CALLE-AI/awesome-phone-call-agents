CREATE TABLE `call_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`plan_fingerprint` text NOT NULL,
	`approved_at` text NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`request_id`) REFERENCES `sourcing_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_call_approvals_plan_fingerprint` ON `call_approvals` (`plan_fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_call_approvals_request_id` ON `call_approvals` (`request_id`);--> statement-breakpoint
CREATE TABLE `call_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`provider_call_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`task_completed` integer,
	`confidence_score` real,
	`confidence_label` text,
	`summary` text,
	`evidence_json` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `sourcing_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_call_runs_provider_call_id` ON `call_runs` (`provider_call_id`);--> statement-breakpoint
CREATE INDEX `idx_call_runs_request_created` ON `call_runs` (`request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `request_suppliers` (
	`request_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`name` text NOT NULL,
	`phone_e164` text NOT NULL,
	`phone_masked` text NOT NULL,
	`area` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`request_id`, `supplier_id`),
	FOREIGN KEY (`request_id`) REFERENCES `sourcing_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_request_suppliers_request_id` ON `request_suppliers` (`request_id`);--> statement-breakpoint
CREATE TABLE `sourcing_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`execution_mode` text NOT NULL,
	`vehicle` text NOT NULL,
	`part` text NOT NULL,
	`fitment_reference` text NOT NULL,
	`budget_amount` real NOT NULL,
	`currency` text NOT NULL,
	`delivery_location` text NOT NULL,
	`needed_by` text NOT NULL,
	`country_code` text NOT NULL,
	`locale` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sourcing_requests_created_at` ON `sourcing_requests` (`created_at`);--> statement-breakpoint
CREATE TABLE `supplier_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`call_run_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`supplier_name` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`summary` text,
	`evidence_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `sourcing_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`call_run_id`) REFERENCES `call_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_supplier_quotes_run_supplier` ON `supplier_quotes` (`call_run_id`,`supplier_id`);--> statement-breakpoint
CREATE INDEX `idx_supplier_quotes_request_id` ON `supplier_quotes` (`request_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_call_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_events_provider_call_id` ON `webhook_events` (`provider_call_id`);--> statement-breakpoint
PRAGMA optimize;
