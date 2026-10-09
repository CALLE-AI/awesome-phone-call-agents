CREATE TABLE `app_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_bindings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`connection_id` integer NOT NULL,
	`service_key` text NOT NULL,
	`source_id` text NOT NULL,
	`source_name` text NOT NULL,
	`mapping_json` text DEFAULT '{}' NOT NULL,
	`filters_json` text DEFAULT '{}' NOT NULL,
	`sync_mode` text DEFAULT 'manual' NOT NULL,
	`writeback_enabled` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_bindings_owner_service_unique` ON `integration_bindings` (`owner_id`,`service_key`);--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`auth_mode` text NOT NULL,
	`credential_ciphertext` text NOT NULL,
	`credential_iv` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`last_tested_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_owner_provider_unique` ON `integration_connections` (`owner_id`,`provider`);--> statement-breakpoint
ALTER TABLE `call_records` ADD `source_context_json` text;--> statement-breakpoint
ALTER TABLE `call_records` ADD `writeback_status` text;--> statement-breakpoint
ALTER TABLE `call_records` ADD `writeback_at` text;