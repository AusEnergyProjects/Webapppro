CREATE TABLE `trade_job_notification_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`notification_key` text NOT NULL,
	`read_by_uid` text NOT NULL,
	`read_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_job_notification_reads_actor_key_idx` ON `trade_job_notification_reads` (`firebase_uid`,`read_by_uid`,`notification_key`);
--> statement-breakpoint
CREATE INDEX `trade_job_notification_reads_actor_time_idx` ON `trade_job_notification_reads` (`firebase_uid`,`read_by_uid`,`read_at`);
