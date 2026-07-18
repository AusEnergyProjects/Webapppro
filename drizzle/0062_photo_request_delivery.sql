ALTER TABLE `trade_crm_photo_requests` ADD `encrypted_token` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_photo_requests` ADD `token_issue` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `trade_crm_photo_request_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_request_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`customer_uid` text DEFAULT '' NOT NULL,
	`channel` text NOT NULL,
	`provider` text NOT NULL,
	`request_revision` integer NOT NULL,
	`token_issue` integer NOT NULL,
	`intent` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`consent_basis` text NOT NULL,
	`consent_confirmed_at` text NOT NULL,
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
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_photo_request_deliveries_idempotency_idx` ON `trade_crm_photo_request_deliveries` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_photo_request_deliveries_provider_message_idx` ON `trade_crm_photo_request_deliveries` (`provider`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_request_deliveries_request_idx` ON `trade_crm_photo_request_deliveries` (`photo_request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_request_deliveries_owner_status_idx` ON `trade_crm_photo_request_deliveries` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_request_deliveries_customer_channel_idx` ON `trade_crm_photo_request_deliveries` (`firebase_uid`,`crm_customer_id`,`channel`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_photo_request_delivery_events` (
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
CREATE UNIQUE INDEX `trade_crm_photo_request_delivery_events_provider_idx` ON `trade_crm_photo_request_delivery_events` (`provider_event_key`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_request_delivery_events_delivery_idx` ON `trade_crm_photo_request_delivery_events` (`delivery_id`,`occurred_at`);
