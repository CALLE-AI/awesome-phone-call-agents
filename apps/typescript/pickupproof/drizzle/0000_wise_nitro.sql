CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`body` text NOT NULL
);
