CREATE TABLE `trade_crm_quick_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`crm_customer_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`line_items_json` text DEFAULT '[]' NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`delivery_status` text DEFAULT 'queued' NOT NULL,
	`delivery_provider` text DEFAULT 'resend' NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`consent_confirmed_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quick_invoices_owner_job_idx` ON `trade_crm_quick_invoices` (`firebase_uid`,`work_order_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quick_invoices_number_idx` ON `trade_crm_quick_invoices` (`invoice_number`);
--> statement-breakpoint
CREATE INDEX `trade_crm_quick_invoices_owner_status_idx` ON `trade_crm_quick_invoices` (`firebase_uid`,`status`,`updated_at`);
