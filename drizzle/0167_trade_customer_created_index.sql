CREATE INDEX IF NOT EXISTS `trade_crm_customers_owner_created_idx`
  ON `trade_crm_customers` (`firebase_uid`, `record_status`, `created_at`, `id`);
