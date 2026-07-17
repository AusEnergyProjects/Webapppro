CREATE TABLE `customer_service_reminder_contacts` (
	`customer_uid` text PRIMARY KEY NOT NULL,
	`mobile_e164` text DEFAULT '' NOT NULL,
	`mobile_verified_at` text DEFAULT '' NOT NULL,
	`pending_mobile_e164` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_service_reminder_contacts_mobile_idx` ON `customer_service_reminder_contacts` (`mobile_e164`);--> statement-breakpoint
CREATE TABLE `customer_service_reminder_opt_outs` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_uid` text NOT NULL,
	`channel` text NOT NULL,
	`source` text NOT NULL,
	`provider_reference` text DEFAULT '' NOT NULL,
	`opted_out_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_service_reminder_opt_outs_customer_channel_idx` ON `customer_service_reminder_opt_outs` (`customer_uid`,`channel`);--> statement-breakpoint
CREATE INDEX `customer_service_reminder_opt_outs_channel_idx` ON `customer_service_reminder_opt_outs` (`channel`,`opted_out_at`);--> statement-breakpoint
CREATE TABLE `service_reminder_channel_settings` (
	`channel` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`sender_label` text DEFAULT 'Australian Energy Assessments' NOT NULL,
	`daily_limit` integer DEFAULT 100 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_by_uid` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `service_reminder_channel_settings_enabled_idx` ON `service_reminder_channel_settings` (`enabled`,`channel`);--> statement-breakpoint
CREATE TABLE `service_reminder_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`follow_up_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`customer_uid` text NOT NULL,
	`asset_id` text NOT NULL,
	`channel` text NOT NULL,
	`provider` text NOT NULL,
	`content_revision` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`queued_at` text NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`delivered_at` text DEFAULT '' NOT NULL,
	`failed_at` text DEFAULT '' NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_reminder_deliveries_idempotency_idx` ON `service_reminder_deliveries` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_reminder_deliveries_provider_message_idx` ON `service_reminder_deliveries` (`provider`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `service_reminder_deliveries_follow_up_idx` ON `service_reminder_deliveries` (`follow_up_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `service_reminder_deliveries_owner_status_idx` ON `service_reminder_deliveries` (`firebase_uid`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `service_reminder_deliveries_customer_channel_idx` ON `service_reminder_deliveries` (`customer_uid`,`channel`,`created_at`);--> statement-breakpoint
CREATE TABLE `service_reminder_delivery_events` (
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
CREATE UNIQUE INDEX `service_reminder_delivery_events_provider_idx` ON `service_reminder_delivery_events` (`provider_event_key`);--> statement-breakpoint
CREATE INDEX `service_reminder_delivery_events_delivery_idx` ON `service_reminder_delivery_events` (`delivery_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `customer_asset_lifecycle_preferences` ADD `email_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_asset_lifecycle_preferences` ADD `sms_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO `service_reminder_channel_settings`
  (`channel`, `provider`, `enabled`, `sender_label`, `daily_limit`, `revision`, `updated_by_uid`, `created_at`, `updated_at`)
VALUES
  ('email', 'resend', 0, 'Australian Energy Assessments', 100, 0, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sms', 'twilio', 0, 'Australian Energy Assessments', 50, 0, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
