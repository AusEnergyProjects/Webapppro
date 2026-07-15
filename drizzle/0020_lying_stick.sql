CREATE TABLE `trade_crm_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`external_account_id` text DEFAULT '' NOT NULL,
	`external_account_label` text DEFAULT '' NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`token_expires_at` text DEFAULT '' NOT NULL,
	`last_sync_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_integrations_owner_provider_idx` ON `trade_crm_integrations` (`firebase_uid`,`provider`);--> statement-breakpoint
CREATE INDEX `trade_crm_integrations_owner_status_idx` ON `trade_crm_integrations` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`provider` text NOT NULL,
	`state_hash` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_oauth_states_hash_idx` ON `trade_crm_oauth_states` (`state_hash`);--> statement-breakpoint
CREATE INDEX `trade_crm_oauth_states_owner_expiry_idx` ON `trade_crm_oauth_states` (`firebase_uid`,`expires_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`checkout_url` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_payment_links_idempotency_idx` ON `trade_crm_payment_links` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `trade_crm_payment_links_owner_idx` ON `trade_crm_payment_links` (`firebase_uid`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_payment_links_work_order_idx` ON `trade_crm_payment_links` (`work_order_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_property_views` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`place_id` text NOT NULL,
	`verified_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_property_views_work_order_idx` ON `trade_crm_property_views` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `trade_crm_property_views_owner_idx` ON `trade_crm_property_views` (`firebase_uid`,`updated_at`);