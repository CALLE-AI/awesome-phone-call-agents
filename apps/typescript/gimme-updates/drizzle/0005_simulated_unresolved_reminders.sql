ALTER TABLE `reminders` ADD `is_simulated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reminders` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE `reminders` SET `status` = 'fired' WHERE `fired` = 1;
