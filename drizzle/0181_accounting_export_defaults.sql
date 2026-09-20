-- Keep the last confirmed sales account/item with its connected accounting business.
ALTER TABLE trade_crm_integrations ADD COLUMN default_account_reference TEXT NOT NULL DEFAULT '';
