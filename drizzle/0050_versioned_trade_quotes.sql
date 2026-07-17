CREATE TABLE `trade_crm_quote_acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`quote_version_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`customer_firebase_uid` text NOT NULL,
	`actor_email` text NOT NULL,
	`actor_email_verified` integer DEFAULT false NOT NULL,
	`actor_auth_time` integer DEFAULT 0 NOT NULL,
	`actor_sign_in_provider` text DEFAULT '' NOT NULL,
	`decision` text NOT NULL,
	`consent_statement` text NOT NULL,
	`decided_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quote_acceptances_version_idx` ON `trade_crm_quote_acceptances` (`quote_version_id`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_acceptances_owner_idx` ON `trade_crm_quote_acceptances` (`firebase_uid`,`work_order_id`,`decided_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_acceptances_customer_idx` ON `trade_crm_quote_acceptances` (`customer_firebase_uid`,`decided_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_quote_items` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_version_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`position` integer NOT NULL,
	`line_type` text NOT NULL,
	`description` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`tax_code` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quote_items_version_position_idx` ON `trade_crm_quote_items` (`quote_version_id`,`position`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_items_owner_idx` ON `trade_crm_quote_items` (`firebase_uid`,`quote_version_id`);--> statement-breakpoint
CREATE TABLE `trade_crm_quote_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`version_number` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`acceptance_email` text DEFAULT '' NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`terms` text DEFAULT '' NOT NULL,
	`valid_until` text DEFAULT '' NOT NULL,
	`consent_statement` text DEFAULT '' NOT NULL,
	`issued_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quote_versions_quote_version_idx` ON `trade_crm_quote_versions` (`quote_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_versions_owner_idx` ON `trade_crm_quote_versions` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_versions_acceptance_email_idx` ON `trade_crm_quote_versions` (`acceptance_email`,`status`,`issued_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`service_site_id` text NOT NULL,
	`quote_number` text NOT NULL,
	`current_version_number` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quotes_owner_work_idx` ON `trade_crm_quotes` (`firebase_uid`,`work_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quotes_owner_number_idx` ON `trade_crm_quotes` (`firebase_uid`,`quote_number`);--> statement-breakpoint
CREATE INDEX `trade_crm_quotes_customer_idx` ON `trade_crm_quotes` (`firebase_uid`,`crm_customer_id`,`updated_at`);
