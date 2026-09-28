-- No historical invoices are exported by this migration.
ALTER TABLE trade_crm_integrations ADD COLUMN invoice_sync_mfa_verified_at TEXT NOT NULL DEFAULT '';
CREATE TABLE trade_crm_accounting_dispatches (
  invoice_id TEXT PRIMARY KEY NOT NULL REFERENCES trade_crm_accepted_invoices(id),
  firebase_uid TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('xero', 'myob', 'quickbooks')),
  external_account_id TEXT NOT NULL CHECK (trim(external_account_id) <> ''),
  account_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'needs_attention', 'synced')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (firebase_uid, work_order_id)
);
CREATE INDEX trade_crm_accounting_dispatches_due_idx ON trade_crm_accounting_dispatches(status, next_attempt_at);
