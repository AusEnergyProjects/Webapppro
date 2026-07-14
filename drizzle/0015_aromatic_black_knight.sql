CREATE TABLE `trade_work_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`event_type` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_work_order_events_owner_idx` ON `trade_work_order_events` (`firebase_uid`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_work_order_events_order_idx` ON `trade_work_order_events` (`work_order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_work_order_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`title` text NOT NULL,
	`due_at` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_work_order_tasks_owner_idx` ON `trade_work_order_tasks` (`firebase_uid`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `trade_work_order_tasks_order_idx` ON `trade_work_order_tasks` (`work_order_id`,`sort_order`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_work_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`partner_type` text NOT NULL,
	`work_type` text DEFAULT 'job' NOT NULL,
	`source_type` text DEFAULT 'internal' NOT NULL,
	`source_reference` text DEFAULT '' NOT NULL,
	`work_number` text NOT NULL,
	`title` text NOT NULL,
	`service_category` text DEFAULT 'other' NOT NULL,
	`site_area` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'backlog' NOT NULL,
	`priority` text DEFAULT 'standard' NOT NULL,
	`scheduled_start` text DEFAULT '' NOT NULL,
	`scheduled_end` text DEFAULT '' NOT NULL,
	`assignee_label` text DEFAULT '' NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_work_orders_owner_number_idx` ON `trade_work_orders` (`firebase_uid`,`work_number`);--> statement-breakpoint
CREATE INDEX `trade_work_orders_owner_stage_idx` ON `trade_work_orders` (`firebase_uid`,`record_status`,`stage`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_work_orders_source_idx` ON `trade_work_orders` (`firebase_uid`,`source_type`,`source_reference`);