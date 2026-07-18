CREATE TABLE `trade_crm_photo_request_events` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_request_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_uid` text DEFAULT '' NOT NULL,
	`event_type` text NOT NULL,
	`request_revision` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_photo_request_events_request_idx` ON `trade_crm_photo_request_events` (`photo_request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_request_events_job_idx` ON `trade_crm_photo_request_events` (`firebase_uid`,`work_order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_photo_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`requirements` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`expires_at` text NOT NULL,
	`last_shared_at` text DEFAULT '' NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_photo_requests_work_order_idx` ON `trade_crm_photo_requests` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_requests_owner_idx` ON `trade_crm_photo_requests` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_requests_expiry_idx` ON `trade_crm_photo_requests` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `trade_crm_job_media` ADD `source` text DEFAULT 'installer' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_job_media` ADD `photo_request_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_job_media` ADD `photo_requirement_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_job_media` ADD `request_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_job_media` ADD `checklist_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_job_media` ADD `customer_acknowledged_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `trade_crm_job_media_photo_request_idx` ON `trade_crm_job_media` (`photo_request_id`,`created_at`);
