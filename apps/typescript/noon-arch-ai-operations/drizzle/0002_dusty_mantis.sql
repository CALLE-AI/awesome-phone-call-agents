ALTER TABLE `call_records` ADD `confirmation_id` text;--> statement-breakpoint
ALTER TABLE `call_records` ADD `initiated_by` text DEFAULT 'manual_confirmation' NOT NULL;--> statement-breakpoint
ALTER TABLE `call_records` ADD `automatic_follow_up` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `call_records_confirmation_id_unique` ON `call_records` (`confirmation_id`);