ALTER TABLE `trade_crm_quick_invoices` ADD `discount_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quick_invoices` ADD `document_snapshot_json` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quick_invoice_revisions` ADD `discount_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quick_invoice_revisions` ADD `document_snapshot_json` text DEFAULT '' NOT NULL;
