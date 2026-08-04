ALTER TABLE `trade_crm_quote_versions` ADD `issued_pdf_object_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quote_versions` ADD `issued_pdf_sha256` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quote_versions` ADD `issued_pdf_size_bytes` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quick_invoices` ADD `issued_pdf_object_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quick_invoices` ADD `issued_pdf_sha256` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quick_invoices` ADD `issued_pdf_size_bytes` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quick_invoice_revisions` ADD `issued_pdf_object_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quick_invoice_revisions` ADD `issued_pdf_sha256` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_quick_invoice_revisions` ADD `issued_pdf_size_bytes` integer DEFAULT 0 NOT NULL;
