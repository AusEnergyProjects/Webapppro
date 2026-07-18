CREATE TABLE `appointment_notification_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_key` text NOT NULL,
	`appointment_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`project_id` text NOT NULL,
	`installer_uid` text NOT NULL,
	`customer_uid` text NOT NULL,
	`event_type` text NOT NULL,
	`appointment_revision` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`summary` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_notification_events_key_idx` ON `appointment_notification_events` (`event_key`);--> statement-breakpoint
CREATE INDEX `appointment_notification_events_appointment_idx` ON `appointment_notification_events` (`appointment_id`,`appointment_revision`);--> statement-breakpoint
CREATE INDEX `appointment_notification_events_project_idx` ON `appointment_notification_events` (`customer_uid`,`project_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `appointment_notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`audience` text NOT NULL,
	`recipient_uid` text NOT NULL,
	`channel` text NOT NULL,
	`provider` text NOT NULL,
	`content_revision` integer NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`eligibility_reason` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`queued_at` text NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`delivered_at` text DEFAULT '' NOT NULL,
	`failed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_notification_deliveries_idempotency_idx` ON `appointment_notification_deliveries` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_notification_deliveries_provider_message_idx` ON `appointment_notification_deliveries` (`provider`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `appointment_notification_deliveries_event_idx` ON `appointment_notification_deliveries` (`event_id`,`audience`,`channel`);--> statement-breakpoint
CREATE INDEX `appointment_notification_deliveries_status_idx` ON `appointment_notification_deliveries` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `appointment_notification_deliveries_recipient_idx` ON `appointment_notification_deliveries` (`recipient_uid`,`channel`,`created_at`);--> statement-breakpoint
CREATE TABLE `appointment_notification_delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text NOT NULL,
	`provider_event_key` text NOT NULL,
	`event_type` text NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_notification_delivery_events_provider_idx` ON `appointment_notification_delivery_events` (`provider_event_key`);--> statement-breakpoint
CREATE INDEX `appointment_notification_delivery_events_delivery_idx` ON `appointment_notification_delivery_events` (`delivery_id`,`occurred_at`);
