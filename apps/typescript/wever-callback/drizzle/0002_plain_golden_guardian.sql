CREATE TABLE `calle_connections` (
	`owner` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`verified_at` text NOT NULL
);
