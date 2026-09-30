ALTER TABLE `call_records` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `call_records` ADD `result_json` text;--> statement-breakpoint
ALTER TABLE `call_records` ADD `evidence_json` text;--> statement-breakpoint
ALTER TABLE `call_records` ADD `transcript_json` text;--> statement-breakpoint
ALTER TABLE `call_records` ADD `confidence_percent` integer;--> statement-breakpoint
ALTER TABLE `call_records` ADD `completed_at` text;