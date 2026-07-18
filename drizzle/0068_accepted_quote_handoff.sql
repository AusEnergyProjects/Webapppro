CREATE TABLE `trade_crm_commercial_handovers` (
	`id` text PRIMARY KEY NOT NULL,
	`acceptance_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`quote_version_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`commercial_reference` text NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`scope_snapshot_json` text DEFAULT '[]' NOT NULL,
	`terms_snapshot` text DEFAULT '' NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`deposit_kind` text DEFAULT 'percentage' NOT NULL,
	`deposit_basis_points` integer DEFAULT 1000 NOT NULL,
	`deposit_fixed_cents` integer DEFAULT 0 NOT NULL,
	`deposit_amount_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'accepted' NOT NULL,
	`accepted_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_commercial_handovers_acceptance_idx` ON `trade_crm_commercial_handovers` (`acceptance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_commercial_handovers_reference_idx` ON `trade_crm_commercial_handovers` (`firebase_uid`,`commercial_reference`);--> statement-breakpoint
CREATE INDEX `trade_crm_commercial_handovers_work_idx` ON `trade_crm_commercial_handovers` (`firebase_uid`,`work_order_id`,`accepted_at`);--> statement-breakpoint
ALTER TABLE `trade_crm_accounting_documents` ADD `commercial_handoff_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_accounting_documents` ADD `commercial_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_accounting_documents` ADD `scope_snapshot_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_accounting_documents` ADD `subtotal_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_accounting_documents` ADD `tax_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `commercial_handoff_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `commercial_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_payment_links` ADD `purpose` text DEFAULT 'payment' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_payment_links_commercial_provider_idx` ON `trade_crm_payment_links` (`firebase_uid`,`commercial_reference`,`purpose`);
