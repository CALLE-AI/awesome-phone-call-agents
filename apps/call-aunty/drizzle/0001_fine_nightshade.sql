CREATE TABLE `follow_up_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`dedupeKey` varchar(128) NOT NULL,
	`womanId` varchar(128) NOT NULL,
	`contactMethod` enum('visit','phone','sms') NOT NULL,
	`outcome` enum('reached','no_answer','needs_clinician') NOT NULL,
	`note` text NOT NULL,
	`nextAction` enum('call_again','clinic_visit','urgent_review','none') NOT NULL,
	`status` enum('completed') NOT NULL,
	`clientUpdatedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `follow_up_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `follow_up_records_user_dedupe_idx` UNIQUE(`userId`,`dedupeKey`)
);
