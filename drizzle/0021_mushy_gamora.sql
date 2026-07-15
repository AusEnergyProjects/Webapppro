CREATE TABLE `trade_crm_payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payment_link_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`status` text NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`provider_payment_id` text DEFAULT '' NOT NULL,
	`occurred_at` text DEFAULT '' NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_payment_events_provider_event_idx` ON `trade_crm_payment_events` (`provider`,`event_id`);--> statement-breakpoint
CREATE INDEX `trade_crm_payment_events_link_idx` ON `trade_crm_payment_events` (`payment_link_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_payment_events_owner_idx` ON `trade_crm_payment_events` (`firebase_uid`,`received_at`);--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `provider_order_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `provider_payment_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `paid_amount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `paid_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `failure_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `last_event_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `last_event_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `trade_crm_payment_links_provider_order_idx` ON `trade_crm_payment_links` (`provider`,`provider_order_id`);