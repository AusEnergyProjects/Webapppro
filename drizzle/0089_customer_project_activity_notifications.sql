ALTER TABLE `customer_project_quotes` ADD `submission_request_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `customer_project_quotes` ADD `submission_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `customer_project_activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_key` text NOT NULL,
	`project_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`opportunity_match_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`installer_uid` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_uid` text NOT NULL,
	`summary` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_activity_events_key_idx`
ON `customer_project_activity_events` (`event_key`);
--> statement-breakpoint
CREATE INDEX `customer_project_activity_events_customer_idx`
ON `customer_project_activity_events` (`customer_uid`,`occurred_at`,`id`);
--> statement-breakpoint
CREATE INDEX `customer_project_activity_events_installer_idx`
ON `customer_project_activity_events` (`installer_uid`,`occurred_at`,`id`);
--> statement-breakpoint
CREATE TABLE `customer_project_activity_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`audience` text NOT NULL,
	`recipient_uid` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`provider` text DEFAULT 'resend' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`eligibility_reason` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text DEFAULT '' NOT NULL,
	`recipient_email_hash` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`html` text DEFAULT '' NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`queued_at` text NOT NULL,
	`last_attempt_at` text DEFAULT '' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`delivered_at` text DEFAULT '' NOT NULL,
	`failed_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_activity_deliveries_event_idx`
ON `customer_project_activity_deliveries` (`event_id`,`audience`,`channel`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_activity_deliveries_idempotency_idx`
ON `customer_project_activity_deliveries` (`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_activity_deliveries_provider_message_idx`
ON `customer_project_activity_deliveries` (`provider`,`provider_message_id`)
WHERE `provider_message_id` <> '';
--> statement-breakpoint
CREATE INDEX `customer_project_activity_deliveries_status_idx`
ON `customer_project_activity_deliveries` (`status`,`next_attempt_at`,`queued_at`);
--> statement-breakpoint
CREATE INDEX `customer_project_activity_deliveries_recipient_idx`
ON `customer_project_activity_deliveries` (`recipient_uid`,`audience`,`created_at`);
--> statement-breakpoint
CREATE TABLE `customer_project_activity_delivery_events` (
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
CREATE UNIQUE INDEX `customer_project_activity_delivery_events_provider_idx`
ON `customer_project_activity_delivery_events` (`provider_event_key`);
--> statement-breakpoint
CREATE INDEX `customer_project_activity_delivery_events_delivery_idx`
ON `customer_project_activity_delivery_events` (`delivery_id`,`occurred_at`);
