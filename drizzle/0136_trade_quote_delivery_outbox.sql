ALTER TABLE `trade_crm_quote_deliveries` ADD `recipient_email_sha256` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `provider_idempotency_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `public_origin` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `queued_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `next_attempt_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `last_attempt_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `lease_expires_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `failure_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `retry_of_delivery_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `delivery_generation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `trade_crm_quote_deliveries_outbox_idx` ON `trade_crm_quote_deliveries` (`status`,`next_attempt_at`,`created_at`);
CREATE UNIQUE INDEX `trade_crm_quote_deliveries_retry_generation_idx` ON `trade_crm_quote_deliveries` (`retry_of_delivery_id`,`delivery_generation`) WHERE `retry_of_delivery_id` <> '';
UPDATE `trade_crm_quote_deliveries`
SET `status` = 'failed',
  `failure_code` = 'QUOTE_DELIVERY_LEGACY_RETRY_REQUIRED',
  `next_attempt_at` = '',
  `lease_expires_at` = '',
  `last_error` = 'Delivery needs an authorised manual retry.',
  `updated_at` = CASE WHEN `updated_at` = '' THEN `created_at` ELSE `updated_at` END
WHERE `status` IN ('queued', 'sending', 'failed', 'waiting_for_channel')
  AND `recipient_email_sha256` = '';
UPDATE `trade_crm_quote_deliveries`
SET `status` = 'opted_out',
  `failure_code` = 'QUOTE_DELIVERY_PROVIDER_TERMINAL',
  `next_attempt_at` = '',
  `lease_expires_at` = '',
  `last_error` = 'Customer email delivery is disabled after a provider complaint.',
  `updated_at` = CASE WHEN `updated_at` = '' THEN `created_at` ELSE `updated_at` END
WHERE `status` = 'complained';
