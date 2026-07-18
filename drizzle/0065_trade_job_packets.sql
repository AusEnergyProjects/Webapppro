CREATE TABLE `trade_job_packets` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`packet_code` text NOT NULL,
	`name` text NOT NULL,
	`service_category` text DEFAULT 'other' NOT NULL,
	`job_template_id` text DEFAULT '' NOT NULL,
	`suggested_crew_size` integer DEFAULT 1 NOT NULL,
	`record_status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_uid` text NOT NULL,
	`updated_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_job_packets_owner_code_idx` ON `trade_job_packets` (`firebase_uid`,`packet_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_job_packets_owner_name_idx` ON `trade_job_packets` (`firebase_uid`,`name`);--> statement-breakpoint
CREATE INDEX `trade_job_packets_owner_status_idx` ON `trade_job_packets` (`firebase_uid`,`record_status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_job_packet_items` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`position` integer NOT NULL,
	`price_book_item_id` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_job_packet_items_position_idx` ON `trade_job_packet_items` (`packet_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_job_packet_items_price_idx` ON `trade_job_packet_items` (`packet_id`,`price_book_item_id`);--> statement-breakpoint
CREATE INDEX `trade_job_packet_items_owner_idx` ON `trade_job_packet_items` (`firebase_uid`,`packet_id`);--> statement-breakpoint
CREATE TABLE `trade_job_packet_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`position` integer NOT NULL,
	`template_key` text NOT NULL,
	`template_version` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_job_packet_forms_position_idx` ON `trade_job_packet_forms` (`packet_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_job_packet_forms_template_idx` ON `trade_job_packet_forms` (`packet_id`,`template_key`,`template_version`);--> statement-breakpoint
CREATE INDEX `trade_job_packet_forms_owner_idx` ON `trade_job_packet_forms` (`firebase_uid`,`packet_id`);--> statement-breakpoint
ALTER TABLE `trade_crm_quote_items` ADD `job_packet_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_items` ADD `job_packet_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_items` ADD `job_packet_line_id` text DEFAULT '' NOT NULL;
