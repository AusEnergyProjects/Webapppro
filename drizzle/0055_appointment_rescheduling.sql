CREATE TABLE `trade_crm_appointment_reschedule_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_uid` text NOT NULL,
	`event_type` text NOT NULL,
	`request_revision` integer NOT NULL,
	`from_starts_at` text DEFAULT '' NOT NULL,
	`from_ends_at` text DEFAULT '' NOT NULL,
	`to_starts_at` text DEFAULT '' NOT NULL,
	`to_ends_at` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_appointment_reschedule_events_request_idx` ON `trade_crm_appointment_reschedule_events` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_appointment_reschedule_events_owner_idx` ON `trade_crm_appointment_reschedule_events` (`firebase_uid`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_appointment_reschedule_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`customer_firebase_uid` text NOT NULL,
	`actor_email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`active_key` text DEFAULT '' NOT NULL,
	`preferred_windows` text DEFAULT '[]' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`access_notes` text DEFAULT '' NOT NULL,
	`requested_appointment_revision` integer NOT NULL,
	`original_starts_at` text NOT NULL,
	`original_ends_at` text DEFAULT '' NOT NULL,
	`original_assignee_member_id` text DEFAULT '' NOT NULL,
	`original_assignee_label` text DEFAULT '' NOT NULL,
	`proposed_starts_at` text DEFAULT '' NOT NULL,
	`proposed_ends_at` text DEFAULT '' NOT NULL,
	`proposed_assignee_member_id` text DEFAULT '' NOT NULL,
	`proposed_assignee_label` text DEFAULT '' NOT NULL,
	`decision_note` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`requested_at` text NOT NULL,
	`decided_by_uid` text DEFAULT '' NOT NULL,
	`decided_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_appointment_reschedule_active_idx` ON `trade_crm_appointment_reschedule_requests` (`appointment_id`,`active_key`);--> statement-breakpoint
CREATE INDEX `trade_crm_appointment_reschedule_owner_idx` ON `trade_crm_appointment_reschedule_requests` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_appointment_reschedule_customer_idx` ON `trade_crm_appointment_reschedule_requests` (`customer_firebase_uid`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_appointment_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`revision` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text DEFAULT '' NOT NULL,
	`assignee_member_id` text DEFAULT '' NOT NULL,
	`assignee_label` text DEFAULT '' NOT NULL,
	`change_source` text NOT NULL,
	`source_reference` text DEFAULT '' NOT NULL,
	`changed_by_uid` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_appointment_revisions_item_revision_idx` ON `trade_crm_appointment_revisions` (`appointment_id`,`revision`);--> statement-breakpoint
CREATE INDEX `trade_crm_appointment_revisions_owner_idx` ON `trade_crm_appointment_revisions` (`firebase_uid`,`appointment_id`,`created_at`);
