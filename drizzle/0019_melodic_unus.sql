CREATE TABLE `trade_crm_appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`appointment_type` text DEFAULT 'site_visit' NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text DEFAULT '' NOT NULL,
	`assignee_label` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_appointments_owner_start_idx` ON `trade_crm_appointments` (`firebase_uid`,`status`,`starts_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_appointments_work_order_idx` ON `trade_crm_appointments` (`work_order_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`customer_number` text NOT NULL,
	`customer_type` text DEFAULT 'residential' NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`business_name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address_line_1` text DEFAULT '' NOT NULL,
	`address_line_2` text DEFAULT '' NOT NULL,
	`suburb` text DEFAULT '' NOT NULL,
	`address_state` text DEFAULT '' NOT NULL,
	`postcode` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`private_notes` text DEFAULT '' NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_customers_owner_number_idx` ON `trade_crm_customers` (`firebase_uid`,`customer_number`);--> statement-breakpoint
CREATE INDEX `trade_crm_customers_owner_status_idx` ON `trade_crm_customers` (`firebase_uid`,`record_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_customers_owner_name_idx` ON `trade_crm_customers` (`firebase_uid`,`last_name`,`business_name`);--> statement-breakpoint
CREATE TABLE `trade_crm_job_details` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text DEFAULT '' NOT NULL,
	`customer_source` text DEFAULT 'internal' NOT NULL,
	`pipeline_stage` text DEFAULT 'enquiry' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`customer_reference` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`estimated_value_cents` integer DEFAULT 0 NOT NULL,
	`quoted_value_cents` integer DEFAULT 0 NOT NULL,
	`invoiced_value_cents` integer DEFAULT 0 NOT NULL,
	`paid_value_cents` integer DEFAULT 0 NOT NULL,
	`quote_status` text DEFAULT 'not_started' NOT NULL,
	`invoice_status` text DEFAULT 'not_started' NOT NULL,
	`payment_due_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_job_details_work_order_idx` ON `trade_crm_job_details` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `trade_crm_job_details_owner_pipeline_idx` ON `trade_crm_job_details` (`firebase_uid`,`pipeline_stage`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_job_details_customer_idx` ON `trade_crm_job_details` (`crm_customer_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_job_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`note_type` text DEFAULT 'internal' NOT NULL,
	`body` text NOT NULL,
	`issue_status` text DEFAULT 'not_applicable' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_job_notes_owner_idx` ON `trade_crm_job_notes` (`firebase_uid`,`note_type`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_job_notes_work_order_idx` ON `trade_crm_job_notes` (`work_order_id`,`created_at`);