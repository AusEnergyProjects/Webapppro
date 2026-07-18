CREATE TABLE `trade_crm_quote_links` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`quote_version_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`encrypted_token` text DEFAULT '' NOT NULL,
	`token_issue` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quote_links_version_idx` ON `trade_crm_quote_links` (`quote_version_id`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_links_owner_idx` ON `trade_crm_quote_links` (`firebase_uid`,`work_order_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_links_expiry_idx` ON `trade_crm_quote_links` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_quote_events` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_link_id` text DEFAULT '' NOT NULL,
	`quote_id` text NOT NULL,
	`quote_version_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text DEFAULT 'system' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`evidence_key` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quote_events_evidence_idx` ON `trade_crm_quote_events` (`evidence_key`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_events_version_idx` ON `trade_crm_quote_events` (`quote_version_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_events_owner_idx` ON `trade_crm_quote_events` (`firebase_uid`,`work_order_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_quote_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_link_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`quote_version_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`question` text NOT NULL,
	`answer` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`asked_at` text NOT NULL,
	`answered_at` text DEFAULT '' NOT NULL,
	`answered_by_uid` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_quote_questions_version_idx` ON `trade_crm_quote_questions` (`quote_version_id`,`asked_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_questions_owner_idx` ON `trade_crm_quote_questions` (`firebase_uid`,`status`,`asked_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_quote_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_link_id` text NOT NULL,
	`quote_version_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`channel` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`recipient_preview` text DEFAULT '' NOT NULL,
	`consent_basis` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`delivered_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quote_deliveries_idempotency_idx` ON `trade_crm_quote_deliveries` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_deliveries_version_idx` ON `trade_crm_quote_deliveries` (`quote_version_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `signer_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `actor_type` text DEFAULT 'verified_account' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `quote_link_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `token_issue` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `commercial_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `currency` text DEFAULT 'AUD' NOT NULL;
