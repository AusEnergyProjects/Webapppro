CREATE TABLE `trade_crm_accepted_invoice_deliveries` (
  `invoice_id` text PRIMARY KEY NOT NULL,
  `firebase_uid` text NOT NULL,
  `quote_link_id` text NOT NULL,
  `recipient_email` text NOT NULL,
  `idempotency_key` text NOT NULL UNIQUE,
  `status` text NOT NULL DEFAULT 'queued',
  `attempts` integer NOT NULL DEFAULT 0,
  `next_attempt_at` text NOT NULL DEFAULT '',
  `lease_token` text NOT NULL DEFAULT '',
  `lease_expires_at` text NOT NULL DEFAULT '',
  `pdf_object_key` text NOT NULL DEFAULT '',
  `pdf_sha256` text NOT NULL DEFAULT '',
  `pdf_size_bytes` integer NOT NULL DEFAULT 0,
  `provider` text NOT NULL DEFAULT '',
  `provider_message_id` text NOT NULL DEFAULT '',
  `error_code` text NOT NULL DEFAULT '',
  `submitted_at` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (`status` IN ('queued', 'sending', 'provider_accepted', 'failed', 'reconciliation_required')),
  CHECK (`attempts` >= 0 AND `attempts` <= 5),
  CHECK (`pdf_size_bytes` >= 0),
  CHECK (`status` <> 'sending' OR (`lease_token` <> '' AND `lease_expires_at` <> '')),
  CHECK (`status` <> 'provider_accepted' OR `provider_message_id` <> '')
);--> statement-breakpoint
CREATE INDEX `trade_crm_accepted_invoice_deliveries_due_idx`
  ON `trade_crm_accepted_invoice_deliveries` (`status`, `next_attempt_at`, `lease_expires_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_accepted_invoice_deliveries_owner_idx`
  ON `trade_crm_accepted_invoice_deliveries` (`firebase_uid`, `invoice_id`);
