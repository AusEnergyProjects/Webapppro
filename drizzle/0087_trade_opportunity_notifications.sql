CREATE TABLE `trade_opportunity_notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`eligibility_reason` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'resend' NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`recipient_email_hash` text DEFAULT '' NOT NULL,
	`idempotency_key` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`enqueued_at` text NOT NULL,
	`last_attempt_at` text DEFAULT '' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`delivered_at` text DEFAULT '' NOT NULL,
	`failed_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_opportunity_notification_deliveries_match_idx`
ON `trade_opportunity_notification_deliveries` (`match_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_opportunity_notification_deliveries_idempotency_idx`
ON `trade_opportunity_notification_deliveries` (`idempotency_key`)
WHERE `idempotency_key` <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `trade_opportunity_notification_deliveries_provider_message_idx`
ON `trade_opportunity_notification_deliveries` (`provider`,`provider_message_id`)
WHERE `provider_message_id` <> '';--> statement-breakpoint
CREATE INDEX `trade_opportunity_notification_deliveries_status_idx`
ON `trade_opportunity_notification_deliveries` (`status`,`next_attempt_at`,`enqueued_at`);--> statement-breakpoint
CREATE INDEX `trade_opportunity_notification_deliveries_recipient_idx`
ON `trade_opportunity_notification_deliveries` (`recipient_email_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_opportunity_notification_delivery_events` (
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
CREATE UNIQUE INDEX `trade_opportunity_notification_delivery_events_provider_idx`
ON `trade_opportunity_notification_delivery_events` (`provider_event_key`);--> statement-breakpoint
CREATE INDEX `trade_opportunity_notification_delivery_events_delivery_idx`
ON `trade_opportunity_notification_delivery_events` (`delivery_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `trade_opportunity_email_suppressions` (
	`email_hash` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`provider` text DEFAULT 'resend' NOT NULL,
	`provider_status` text NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`suppressed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_opportunity_email_suppressions_time_idx`
ON `trade_opportunity_email_suppressions` (`suppressed_at`);--> statement-breakpoint
CREATE TRIGGER `trade_opportunity_matches_notification_enqueue`
AFTER INSERT ON `trade_opportunity_matches`
WHEN NEW.`status` IN ('offered', 'viewed')
BEGIN
  INSERT OR IGNORE INTO `trade_opportunity_notification_deliveries`
    (`id`, `match_id`, `status`, `eligibility_reason`, `attempts`, `next_attempt_at`,
     `provider`, `provider_message_id`, `provider_status`, `recipient_email_hash`,
     `idempotency_key`, `subject`, `body`, `enqueued_at`, `last_attempt_at`, `sent_at`,
     `delivered_at`, `failed_at`, `last_error`, `created_at`, `updated_at`)
  VALUES
    (lower(hex(randomblob(16))), NEW.`id`, 'pending', '', 0, '', 'resend', '', '', '',
     '', '', '', NEW.`matched_at`, '', '', '', '', '', NEW.`matched_at`, NEW.`matched_at`);
END;
