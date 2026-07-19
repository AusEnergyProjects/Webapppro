ALTER TABLE `trade_crm_quick_invoices` ADD `revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE `trade_crm_quick_invoice_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`revision` integer NOT NULL,
	`line_items_json` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`due_at` text NOT NULL,
	`change_reason` text DEFAULT '' NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quick_invoice_revisions_invoice_revision_idx` ON `trade_crm_quick_invoice_revisions` (`invoice_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `trade_crm_quick_invoice_revisions_owner_idx` ON `trade_crm_quick_invoice_revisions` (`firebase_uid`,`created_at`);
--> statement-breakpoint
INSERT INTO `trade_crm_quick_invoice_revisions`
  (`id`,`invoice_id`,`firebase_uid`,`revision`,`line_items_json`,`subtotal_cents`,`tax_cents`,`total_cents`,`due_at`,`change_reason`,`created_by_uid`,`created_at`)
SELECT 'initial-' || id, id, firebase_uid, 1, line_items_json, subtotal_cents, tax_cents, total_cents, due_at,
  'Initial invoice snapshot', created_by_uid, created_at FROM `trade_crm_quick_invoices`;
--> statement-breakpoint
CREATE TABLE `trade_crm_quick_invoice_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`credit_number` text NOT NULL,
	`description` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`reason` text NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quick_invoice_credits_number_idx` ON `trade_crm_quick_invoice_credits` (`credit_number`);
--> statement-breakpoint
CREATE INDEX `trade_crm_quick_invoice_credits_invoice_idx` ON `trade_crm_quick_invoice_credits` (`invoice_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `trade_crm_quick_invoice_credits_owner_idx` ON `trade_crm_quick_invoice_credits` (`firebase_uid`,`created_at`);
--> statement-breakpoint
CREATE TABLE `trade_crm_invoice_payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`payment_link_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_payment_id` text DEFAULT '' NOT NULL,
	`amount_cents` integer NOT NULL,
	`allocated_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_invoice_payment_allocations_link_idx` ON `trade_crm_invoice_payment_allocations` (`payment_link_id`);
--> statement-breakpoint
CREATE INDEX `trade_crm_invoice_payment_allocations_invoice_idx` ON `trade_crm_invoice_payment_allocations` (`invoice_id`,`allocated_at`);
--> statement-breakpoint
CREATE INDEX `trade_crm_invoice_payment_allocations_owner_idx` ON `trade_crm_invoice_payment_allocations` (`firebase_uid`,`allocated_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `trade_crm_invoice_payment_allocations`
  (`id`,`invoice_id`,`work_order_id`,`firebase_uid`,`payment_link_id`,`provider`,`provider_payment_id`,`amount_cents`,`allocated_at`,`created_at`)
SELECT 'allocation-' || link.id, invoice.id, link.work_order_id, link.firebase_uid, link.id, link.provider,
  link.provider_payment_id, link.paid_amount_cents, link.paid_at, link.paid_at
FROM `trade_crm_payment_links` link
JOIN `trade_crm_quick_invoices` invoice ON invoice.firebase_uid = link.firebase_uid
  AND invoice.work_order_id = link.work_order_id AND invoice.invoice_number = link.commercial_reference
WHERE link.purpose = 'invoice' AND link.status = 'paid' AND link.paid_amount_cents > 0;
