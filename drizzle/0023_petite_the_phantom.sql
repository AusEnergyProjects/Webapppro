CREATE TABLE `trade_crm_counters` (
	`firebase_uid` text NOT NULL,
	`counter_key` text NOT NULL,
	`last_value` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_counters_owner_key_idx` ON `trade_crm_counters` (`firebase_uid`,`counter_key`);--> statement-breakpoint
CREATE TABLE `trade_crm_job_media` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`category` text DEFAULT 'progress' NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_job_media_owner_idx` ON `trade_crm_job_media` (`firebase_uid`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_job_media_work_order_idx` ON `trade_crm_job_media` (`work_order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_signoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`signer_role` text NOT NULL,
	`signer_name` text NOT NULL,
	`confirmation_text` text NOT NULL,
	`method` text DEFAULT 'typed' NOT NULL,
	`signed_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_signoffs_owner_idx` ON `trade_crm_signoffs` (`firebase_uid`,`signed_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_signoffs_work_order_idx` ON `trade_crm_signoffs` (`work_order_id`,`signed_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`staff_label` text DEFAULT '' NOT NULL,
	`work_date` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_time_entries_owner_date_idx` ON `trade_crm_time_entries` (`firebase_uid`,`work_date`);--> statement-breakpoint
CREATE INDEX `trade_crm_time_entries_work_order_idx` ON `trade_crm_time_entries` (`work_order_id`,`work_date`);