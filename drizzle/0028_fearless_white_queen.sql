CREATE TABLE `trade_crm_job_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`name` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`service_category` text DEFAULT 'other' NOT NULL,
	`priority` text DEFAULT 'standard' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`task_titles` text DEFAULT '[]' NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_job_templates_owner_idx` ON `trade_crm_job_templates` (`firebase_uid`,`record_status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_job_templates_owner_name_idx` ON `trade_crm_job_templates` (`firebase_uid`,`name`);