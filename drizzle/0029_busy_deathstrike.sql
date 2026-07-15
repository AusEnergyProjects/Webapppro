CREATE TABLE `trade_job_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`template_key` text NOT NULL,
	`template_version` integer NOT NULL,
	`template_name` text NOT NULL,
	`jurisdiction` text DEFAULT 'AU' NOT NULL,
	`template_snapshot` text NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`completed_by_uid` text DEFAULT '' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_job_forms_work_template_idx` ON `trade_job_forms` (`work_order_id`,`template_key`,`template_version`);--> statement-breakpoint
CREATE INDEX `trade_job_forms_owner_status_idx` ON `trade_job_forms` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_job_forms_work_idx` ON `trade_job_forms` (`work_order_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_service_job_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`service_plan_id` text NOT NULL,
	`source_work_order_id` text NOT NULL,
	`generated_work_order_id` text DEFAULT '' NOT NULL,
	`firebase_uid` text NOT NULL,
	`due_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_service_job_generations_plan_due_idx` ON `trade_service_job_generations` (`service_plan_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `trade_service_job_generations_owner_idx` ON `trade_service_job_generations` (`firebase_uid`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_service_job_generations_work_idx` ON `trade_service_job_generations` (`generated_work_order_id`);--> statement-breakpoint
ALTER TABLE `trade_asset_service_plans` ADD `job_template_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_asset_service_plans` ADD `auto_create_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_asset_service_plans` ADD `job_lead_days` integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_asset_service_plans` ADD `last_generated_due_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_asset_service_plans` ADD `last_generated_work_order_id` text DEFAULT '' NOT NULL;