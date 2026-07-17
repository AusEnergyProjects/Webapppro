CREATE TABLE `trade_service_follow_up_events` (
	`id` text PRIMARY KEY NOT NULL,
	`follow_up_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`actor_uid` text NOT NULL,
	`event_type` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_service_follow_up_events_record_idx` ON `trade_service_follow_up_events` (`follow_up_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_service_follow_up_events_owner_idx` ON `trade_service_follow_up_events` (`firebase_uid`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_service_follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`service_plan_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`service_site_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'preparing' NOT NULL,
	`assignee_member_id` text DEFAULT '' NOT NULL,
	`suppression_reason` text DEFAULT '' NOT NULL,
	`internal_notes` text DEFAULT '' NOT NULL,
	`reminder_subject` text DEFAULT '' NOT NULL,
	`reminder_body` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_service_follow_ups_plan_due_idx` ON `trade_service_follow_ups` (`firebase_uid`,`service_plan_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `trade_service_follow_ups_owner_status_due_idx` ON `trade_service_follow_ups` (`firebase_uid`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `trade_service_follow_ups_owner_assignee_due_idx` ON `trade_service_follow_ups` (`firebase_uid`,`assignee_member_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `trade_service_follow_ups_owner_customer_site_idx` ON `trade_service_follow_ups` (`firebase_uid`,`crm_customer_id`,`service_site_id`);
