CREATE TABLE `ingested_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`evidence_gap_id` text NOT NULL,
	`origin` text NOT NULL,
	`fact` text NOT NULL,
	`source` text NOT NULL,
	`certainty` text NOT NULL,
	`evidence` text NOT NULL,
	`limitations` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ingested_statements_gap_id` ON `ingested_statements` (`evidence_gap_id`);
