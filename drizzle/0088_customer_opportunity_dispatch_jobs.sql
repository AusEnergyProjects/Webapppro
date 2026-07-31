CREATE TABLE `customer_opportunity_dispatch_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`admin_notification_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text DEFAULT '' NOT NULL,
	`claimed_at` text DEFAULT '' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`failed_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_opportunity_dispatch_jobs_opportunity_idx`
ON `customer_opportunity_dispatch_jobs` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `customer_opportunity_dispatch_jobs_status_idx`
ON `customer_opportunity_dispatch_jobs` (`status`,`next_attempt_at`,`created_at`);
