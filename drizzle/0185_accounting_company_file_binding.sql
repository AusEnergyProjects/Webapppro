-- No historical association can be proven from the current connection alone.
-- Existing rows remain unbound and cannot be sent to an accounting company file.
ALTER TABLE trade_crm_accounting_documents ADD COLUMN external_account_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TRIGGER trade_crm_accounting_documents_company_insert_guard
BEFORE INSERT ON trade_crm_accounting_documents
WHEN trim(NEW.external_account_id) = '' OR NOT EXISTS (
  SELECT 1 FROM trade_crm_integrations connection
  WHERE connection.firebase_uid = NEW.firebase_uid
    AND connection.provider = NEW.provider
    AND connection.external_account_id = NEW.external_account_id
    AND connection.status = 'connected'
)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNTING_COMPANY_FILE_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER trade_crm_accounting_documents_company_immutable_guard
BEFORE UPDATE OF firebase_uid, provider, external_account_id ON trade_crm_accounting_documents
WHEN NEW.firebase_uid IS NOT OLD.firebase_uid
  OR NEW.provider IS NOT OLD.provider
  OR NEW.external_account_id IS NOT OLD.external_account_id
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNTING_COMPANY_FILE_IMMUTABLE');
END;
