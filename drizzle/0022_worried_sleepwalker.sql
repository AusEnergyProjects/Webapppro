CREATE TABLE `trade_crm_accounting_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`provider` text NOT NULL,
	`document_type` text DEFAULT 'invoice' NOT NULL,
	`external_contact_id` text DEFAULT '' NOT NULL,
	`external_document_id` text DEFAULT '' NOT NULL,
	`external_number` text DEFAULT '' NOT NULL,
	`external_url` text DEFAULT '' NOT NULL,
	`account_reference` text DEFAULT '' NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`paid_amount_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`status` text DEFAULT 'exporting' NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`due_at` text DEFAULT '' NOT NULL,
	`last_synced_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_accounting_documents_job_type_idx` ON `trade_crm_accounting_documents` (`firebase_uid`,`work_order_id`,`document_type`);--> statement-breakpoint
CREATE INDEX `trade_crm_accounting_documents_provider_external_idx` ON `trade_crm_accounting_documents` (`provider`,`external_document_id`);--> statement-breakpoint
CREATE INDEX `trade_crm_accounting_documents_owner_idx` ON `trade_crm_accounting_documents` (`firebase_uid`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_accounting_documents_status_idx` ON `trade_crm_accounting_documents` (`status`,`last_synced_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_accounting_events` (
	`id` text PRIMARY KEY NOT NULL,
	`accounting_document_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`provider` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`paid_amount_cents` integer DEFAULT 0 NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_accounting_events_document_idx` ON `trade_crm_accounting_events` (`accounting_document_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_accounting_events_owner_idx` ON `trade_crm_accounting_events` (`firebase_uid`,`occurred_at`);
