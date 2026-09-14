CREATE TABLE `case_workflow` (
	`evidence_gap_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`assigned_role` text NOT NULL,
	`next_action` text NOT NULL,
	`updated_at` text NOT NULL
);
