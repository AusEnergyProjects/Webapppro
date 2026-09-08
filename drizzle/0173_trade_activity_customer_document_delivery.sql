CREATE TABLE `trade_activity_customer_document_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL REFERENCES `trade_work_orders`(`id`) ON DELETE RESTRICT,
	`appointment_id` text NOT NULL REFERENCES `trade_crm_appointments`(`id`) ON DELETE RESTRICT,
	`firebase_uid` text NOT NULL,
	`recipient_email_sha256` text NOT NULL CHECK (length(`recipient_email_sha256`) = 64 AND `recipient_email_sha256` = lower(`recipient_email_sha256`) AND `recipient_email_sha256` NOT GLOB '*[^0-9a-f]*'),
	`activity_bindings` text NOT NULL CHECK (json_valid(`activity_bindings`) AND json_type(`activity_bindings`) = 'array' AND json_array_length(`activity_bindings`) > 0),
	`document_ids` text NOT NULL CHECK (json_valid(`document_ids`) AND json_type(`document_ids`) = 'array' AND json_array_length(`document_ids`) > 0),
	`document_sha256_set` text NOT NULL CHECK (json_valid(`document_sha256_set`) AND json_type(`document_sha256_set`) = 'array' AND json_array_length(`document_sha256_set`) = json_array_length(`document_ids`)),
	`pack_sha256` text NOT NULL CHECK (length(`pack_sha256`) = 64 AND `pack_sha256` = lower(`pack_sha256`) AND `pack_sha256` NOT GLOB '*[^0-9a-f]*'),
	`delivery_generation` integer NOT NULL CHECK (`delivery_generation` > 0),
	`retry_of_delivery_id` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'resend' NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL CHECK (`status` IN ('queued','sending','provider_accepted','sent','delivered','failed','bounced','complained','suppressed')),
	`accepted_at` text DEFAULT '' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`delivered_at` text DEFAULT '' NOT NULL,
	`failed_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CHECK (`provider` = 'resend'),
	CHECK ((`provider_message_id` = '' AND `status` IN ('queued','sending','failed','suppressed')) OR (`provider_message_id` <> '' AND `status` IN ('provider_accepted','sent','delivered','failed','bounced','complained','suppressed'))),
	CHECK ((`status` IN ('provider_accepted','sent','delivered') AND `accepted_at` <> '' AND datetime(`accepted_at`) IS NOT NULL) OR (`status` NOT IN ('provider_accepted','sent','delivered'))),
	CHECK ((`status` IN ('failed','bounced','complained','suppressed') AND `failed_at` <> '' AND datetime(`failed_at`) IS NOT NULL) OR (`status` NOT IN ('failed','bounced','complained','suppressed'))),
	CHECK ((`accepted_at` = '' OR datetime(`accepted_at`) IS NOT NULL) AND (`sent_at` = '' OR datetime(`sent_at`) IS NOT NULL) AND (`delivered_at` = '' OR datetime(`delivered_at`) IS NOT NULL) AND (`failed_at` = '' OR datetime(`failed_at`) IS NOT NULL) AND datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_activity_customer_document_delivery_generation_idx`
ON `trade_activity_customer_document_deliveries` (`work_order_id`, `appointment_id`, `firebase_uid`, `recipient_email_sha256`, `pack_sha256`, `delivery_generation`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_activity_customer_document_delivery_idempotency_idx`
ON `trade_activity_customer_document_deliveries` (`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_activity_customer_document_delivery_provider_idx`
ON `trade_activity_customer_document_deliveries` (`provider`, `provider_message_id`)
WHERE `provider_message_id` <> '';
--> statement-breakpoint
CREATE INDEX `trade_activity_customer_document_delivery_job_idx`
ON `trade_activity_customer_document_deliveries` (`firebase_uid`, `work_order_id`, `appointment_id`, `delivery_generation` DESC);
--> statement-breakpoint
CREATE INDEX `trade_activity_customer_document_delivery_status_idx`
ON `trade_activity_customer_document_deliveries` (`status`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `trade_activity_customer_document_delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text NOT NULL REFERENCES `trade_activity_customer_document_deliveries`(`id`) ON DELETE RESTRICT,
	`provider_event_key` text NOT NULL,
	`event_type` text NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	CHECK (trim(`provider_event_key`) <> '' AND trim(`event_type`) <> ''),
	CHECK (datetime(`occurred_at`) IS NOT NULL AND datetime(`created_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_activity_customer_document_delivery_events_provider_idx`
ON `trade_activity_customer_document_delivery_events` (`provider_event_key`);
--> statement-breakpoint
CREATE INDEX `trade_activity_customer_document_delivery_events_delivery_idx`
ON `trade_activity_customer_document_delivery_events` (`delivery_id`, `occurred_at`);
