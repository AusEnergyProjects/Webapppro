ALTER TABLE `trade_crm_quote_acceptances` ADD `decision_request_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `decision_payload_sha256` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `result_invoice_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `invoice_creation_status` text DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `invoice_creation_error_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quote_acceptances_decision_request_idx` ON `trade_crm_quote_acceptances` (`quote_link_id`,`token_issue`,`decision_request_id`) WHERE `decision_request_id` <> '';--> statement-breakpoint
CREATE TABLE `trade_crm_accepted_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`acceptance_id` text NOT NULL,
	`commercial_handoff_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`quote_version_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`document_label` text DEFAULT 'Invoice' NOT NULL,
	`source_snapshot_sha256` text NOT NULL,
	`document_snapshot_json` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`issue_blocker_code` text DEFAULT '' NOT NULL,
	`payment_snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `trade_crm_accepted_invoices_identity_check` CHECK (trim(`id`) <> '' AND trim(`acceptance_id`) <> '' AND trim(`commercial_handoff_id`) <> '' AND trim(`quote_id`) <> '' AND trim(`quote_version_id`) <> '' AND trim(`work_order_id`) <> '' AND trim(`firebase_uid`) <> '' AND trim(`crm_customer_id`) <> '' AND trim(`invoice_number`) <> ''),
	CONSTRAINT `trade_crm_accepted_invoices_currency_check` CHECK (`currency` = 'AUD'),
	CONSTRAINT `trade_crm_accepted_invoices_label_check` CHECK (`document_label` IN ('Invoice', 'Tax Invoice')),
	CONSTRAINT `trade_crm_accepted_invoices_hash_check` CHECK (length(`source_snapshot_sha256`) = 64 AND `source_snapshot_sha256` = lower(`source_snapshot_sha256`) AND `source_snapshot_sha256` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `trade_crm_accepted_invoices_document_check` CHECK (json_valid(`document_snapshot_json`) AND json_type(`document_snapshot_json`) = 'object' AND json_extract(`document_snapshot_json`, '$.schemaVersion') = 'trade-accepted-invoice-v1' AND json_extract(`document_snapshot_json`, '$.invoice.id') = `id` AND json_extract(`document_snapshot_json`, '$.invoice.number') = `invoice_number` AND json_extract(`document_snapshot_json`, '$.invoice.documentLabel') = `document_label` AND json_extract(`document_snapshot_json`, '$.invoice.currency') = `currency` AND json_extract(`document_snapshot_json`, '$.invoice.dueAt') = `due_at` AND json_extract(`document_snapshot_json`, '$.source.snapshotSha256') = `source_snapshot_sha256` AND json_extract(`document_snapshot_json`, '$.totals.subtotalCents') = `subtotal_cents` AND json_extract(`document_snapshot_json`, '$.totals.taxCents') = `tax_cents` AND json_extract(`document_snapshot_json`, '$.totals.totalCents') = `total_cents`),
	CONSTRAINT `trade_crm_accepted_invoices_payment_check` CHECK (json_valid(`payment_snapshot_json`) AND json_type(`payment_snapshot_json`) = 'object' AND json(`payment_snapshot_json`) = json(json_extract(`document_snapshot_json`, '$.payment')) AND ((json_extract(`payment_snapshot_json`, '$.available') = 0 AND json_extract(`payment_snapshot_json`, '$.method') = 'unavailable') OR (`status` = 'issued' AND json_extract(`payment_snapshot_json`, '$.available') = 1 AND json_extract(`payment_snapshot_json`, '$.method') = 'bank_transfer' AND trim(coalesce(json_extract(`payment_snapshot_json`, '$.accountName'), '')) <> '' AND trim(coalesce(json_extract(`payment_snapshot_json`, '$.bsb'), '')) <> '' AND trim(coalesce(json_extract(`payment_snapshot_json`, '$.accountNumber'), '')) <> ''))),
	CONSTRAINT `trade_crm_accepted_invoices_totals_check` CHECK (`subtotal_cents` BETWEEN -100000000 AND 100000000 AND `tax_cents` BETWEEN -100000000 AND 100000000 AND `total_cents` BETWEEN 1 AND 100000000 AND `subtotal_cents` + `tax_cents` = `total_cents`),
	CONSTRAINT `trade_crm_accepted_invoices_status_check` CHECK ((`status` = 'issued' AND `issue_blocker_code` = '') OR (`status` = 'attention_required' AND trim(`issue_blocker_code`) <> '')),
	CONSTRAINT `trade_crm_accepted_invoices_due_check` CHECK (length(`due_at`) = 10 AND date(`due_at`) = `due_at`),
	CONSTRAINT `trade_crm_accepted_invoices_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_accepted_invoices_acceptance_idx` ON `trade_crm_accepted_invoices` (`acceptance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_accepted_invoices_handoff_idx` ON `trade_crm_accepted_invoices` (`commercial_handoff_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_accepted_invoices_quote_version_idx` ON `trade_crm_accepted_invoices` (`quote_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_accepted_invoices_owner_number_idx` ON `trade_crm_accepted_invoices` (`firebase_uid`,`invoice_number`);--> statement-breakpoint
CREATE INDEX `trade_crm_accepted_invoices_owner_job_idx` ON `trade_crm_accepted_invoices` (`firebase_uid`,`work_order_id`,`updated_at`);
