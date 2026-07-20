ALTER TABLE `trade_crm_payment_links` ADD `attempt_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `superseded_by_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `superseded_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
DROP INDEX `trade_crm_payment_links_commercial_provider_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_payment_links_commercial_attempt_idx` ON `trade_crm_payment_links` (`firebase_uid`,`commercial_reference`,`purpose`,`attempt_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_payment_links_collectible_idx` ON `trade_crm_payment_links` (`firebase_uid`,`commercial_reference`,`purpose`) WHERE `status` IN ('creating','open','processing','paid');--> statement-breakpoint
CREATE INDEX `trade_crm_payment_links_commercial_status_idx` ON `trade_crm_payment_links` (`firebase_uid`,`commercial_reference`,`purpose`,`status`);--> statement-breakpoint
