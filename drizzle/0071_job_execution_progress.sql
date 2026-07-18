CREATE TABLE `trade_crm_quote_execution_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_version_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`source_kind` text DEFAULT 'manual_quote' NOT NULL,
	`packets_json` text DEFAULT '[]' NOT NULL,
	`expected_duration_minutes` integer DEFAULT 0 NOT NULL,
	`suggested_crew_size` integer DEFAULT 1 NOT NULL,
	`required_capabilities_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quote_execution_snapshots_version_idx` ON `trade_crm_quote_execution_snapshots` (`quote_version_id`);
--> statement-breakpoint
CREATE INDEX `trade_crm_quote_execution_snapshots_owner_idx` ON `trade_crm_quote_execution_snapshots` (`firebase_uid`,`created_at`);
--> statement-breakpoint
ALTER TABLE `trade_crm_job_plans` ADD `completed_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_job_plan_phases` ADD `status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_job_plan_phases` ADD `completed_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_job_plan_phases` ADD `updated_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `trade_crm_job_actuals` (
	`id` text PRIMARY KEY NOT NULL,
	`job_plan_id` text NOT NULL,
	`job_plan_phase_id` text NOT NULL,
	`job_plan_requirement_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`actual_type` text NOT NULL,
	`quantity_milli` integer DEFAULT 0 NOT NULL,
	`duration_minutes` integer DEFAULT 0 NOT NULL,
	`total_cost_cents` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`recorded_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_job_actuals_requirement_idx` ON `trade_crm_job_actuals` (`job_plan_requirement_id`);
--> statement-breakpoint
CREATE INDEX `trade_crm_job_actuals_work_idx` ON `trade_crm_job_actuals` (`firebase_uid`,`work_order_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `trade_crm_job_actuals_plan_idx` ON `trade_crm_job_actuals` (`job_plan_id`,`actual_type`);
