CREATE TRIGGER `compliance_submission_batches_original_no_update`
BEFORE UPDATE ON `compliance_submission_batches`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`program_id` <> OLD.`program_id`
  OR NEW.`batch_number` <> OLD.`batch_number`
  OR NEW.`format` <> OLD.`format`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_BATCH_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_items_original_no_update`
BEFORE UPDATE ON `compliance_submission_batch_items`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`batch_id` <> OLD.`batch_id`
  OR NEW.`case_id` <> OLD.`case_id`
  OR NEW.`case_revision` <> OLD.`case_revision`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_ITEM_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_items_no_delete`
BEFORE DELETE ON `compliance_submission_batch_items`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_ITEM_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_no_delete`
BEFORE DELETE ON `compliance_certificate_lots`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_original_no_update`
BEFORE UPDATE ON `compliance_certificate_lots`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`program_id` <> OLD.`program_id`
  OR NEW.`batch_id` <> OLD.`batch_id`
  OR NEW.`certificate_type` <> OLD.`certificate_type`
  OR NEW.`quantity` <> OLD.`quantity`
  OR NEW.`vintage_from` <> OLD.`vintage_from`
  OR NEW.`vintage_to` <> OLD.`vintage_to`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_registry_reference_guard`
BEFORE UPDATE OF `registry_lot_reference` ON `compliance_certificate_lots`
WHEN (
  NEW.`registry_lot_reference` <> OLD.`registry_lot_reference`
  AND (
    OLD.`registry_lot_reference` <> ''
    OR trim(NEW.`registry_lot_reference`) = ''
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_REFERENCE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_transition_guard`
BEFORE UPDATE OF `status` ON `compliance_certificate_lots`
WHEN NOT (
  OLD.`status` = NEW.`status`
  OR (
    OLD.`status` = 'pending'
    AND NEW.`status` IN ('created', 'available', 'cancelled')
  )
  OR (
    OLD.`status` = 'created'
    AND NEW.`status` IN ('available', 'cancelled')
  )
  OR (
    OLD.`status` = 'available'
    AND NEW.`status` IN ('reserved', 'traded', 'retired', 'cancelled')
  )
  OR (
    OLD.`status` = 'reserved'
    AND NEW.`status` IN ('available', 'traded', 'cancelled')
  )
  OR (
    OLD.`status` = 'traded'
    AND NEW.`status` = 'retired'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_active_trade_guard`
BEFORE UPDATE OF `status` ON `compliance_certificate_lots`
WHEN NEW.`status` IN ('retired', 'cancelled') AND EXISTS (
  SELECT 1
  FROM `compliance_trades` trade
  WHERE trade.`certificate_lot_id` = OLD.`id`
    AND trade.`organisation_id` = OLD.`organisation_id`
    AND trade.`status` IN ('pending', 'confirmed', 'settled')
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_HAS_ACTIVE_TRADES');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_original_no_update`
BEFORE UPDATE ON `compliance_trades`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`certificate_lot_id` <> OLD.`certificate_lot_id`
  OR NEW.`counterparty_reference` <> OLD.`counterparty_reference`
  OR NEW.`quantity` <> OLD.`quantity`
  OR NEW.`unit_price_cents` <> OLD.`unit_price_cents`
  OR NEW.`trade_date` <> OLD.`trade_date`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_no_delete`
BEFORE DELETE ON `compliance_trades`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_external_reference_guard`
BEFORE UPDATE OF `external_reference` ON `compliance_trades`
WHEN (
  NEW.`external_reference` <> OLD.`external_reference`
  AND (
    OLD.`external_reference` <> ''
    OR trim(NEW.`external_reference`) = ''
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_REFERENCE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_transition_guard`
BEFORE UPDATE OF `status` ON `compliance_trades`
WHEN NOT (
  OLD.`status` = NEW.`status`
  OR (
    OLD.`status` = 'pending'
    AND NEW.`status` IN ('confirmed', 'cancelled')
  )
  OR (
    OLD.`status` = 'confirmed'
    AND NEW.`status` IN ('settled', 'cancelled')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_settlement_state_guard`
BEFORE UPDATE OF `status` ON `compliance_trades`
WHEN (
  NEW.`status` = 'settled'
  AND NOT EXISTS (
    SELECT 1
    FROM `compliance_settlements` settlement
    WHERE settlement.`trade_id` = OLD.`id`
      AND settlement.`organisation_id` = OLD.`organisation_id`
      AND settlement.`status` = 'settled'
  )
)
OR (
  NEW.`status` = 'cancelled'
  AND EXISTS (
    SELECT 1
    FROM `compliance_settlements` settlement
    WHERE settlement.`trade_id` = OLD.`id`
      AND settlement.`organisation_id` = OLD.`organisation_id`
      AND settlement.`status` <> 'cancelled'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_SETTLEMENT_STATE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_original_no_update`
BEFORE UPDATE ON `compliance_settlements`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`trade_id` <> OLD.`trade_id`
  OR NEW.`gross_cents` <> OLD.`gross_cents`
  OR NEW.`fee_cents` <> OLD.`fee_cents`
  OR NEW.`net_cents` <> OLD.`net_cents`
  OR NEW.`due_date` <> OLD.`due_date`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_no_delete`
BEFORE DELETE ON `compliance_settlements`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_external_reference_guard`
BEFORE UPDATE OF `external_reference` ON `compliance_settlements`
WHEN (
  NEW.`external_reference` <> OLD.`external_reference`
  AND (
    OLD.`external_reference` <> ''
    OR trim(NEW.`external_reference`) = ''
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_REFERENCE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_insert_state_guard`
BEFORE INSERT ON `compliance_settlements`
WHEN (
  (NEW.`status` = 'settled' AND trim(NEW.`settled_at`) = '')
  OR (NEW.`status` <> 'settled' AND NEW.`settled_at` <> '')
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_STATE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_transition_guard`
BEFORE UPDATE OF `status`, `settled_at` ON `compliance_settlements`
WHEN (
  NOT (
    OLD.`status` = NEW.`status`
    OR (
      OLD.`status` = 'pending'
      AND NEW.`status` IN ('processing', 'settled', 'failed', 'cancelled')
    )
    OR (
      OLD.`status` = 'processing'
      AND NEW.`status` IN ('settled', 'failed', 'cancelled')
    )
    OR (
      OLD.`status` = 'failed'
      AND NEW.`status` IN ('processing', 'cancelled')
    )
  )
  OR (NEW.`status` = 'settled' AND trim(NEW.`settled_at`) = '')
  OR (NEW.`status` <> 'settled' AND NEW.`settled_at` <> '')
  OR (
    NEW.`status` = 'settled'
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_trades` trade
      WHERE trade.`id` = NEW.`trade_id`
        AND trade.`organisation_id` = NEW.`organisation_id`
        AND trade.`status` = 'confirmed'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_TRANSITION_INVALID');
END;
--> statement-breakpoint
ALTER TABLE `trade_mobile_upload_sessions`
ADD `evidence_envelope` text DEFAULT '{}' NOT NULL
CHECK (json_valid(`evidence_envelope`));
--> statement-breakpoint
ALTER TABLE `trade_mobile_upload_sessions`
ADD `original_sha256` text DEFAULT '' NOT NULL CHECK (
  `original_sha256` = ''
  OR (
    length(`original_sha256`) = 64
    AND lower(`original_sha256`) NOT GLOB '*[^0-9a-f]*'
  )
);
--> statement-breakpoint
ALTER TABLE `trade_crm_job_media`
ADD `evidence_envelope` text DEFAULT '{}' NOT NULL
CHECK (json_valid(`evidence_envelope`));
--> statement-breakpoint
ALTER TABLE `trade_crm_job_media`
ADD `original_sha256` text DEFAULT '' NOT NULL CHECK (
  `original_sha256` = ''
  OR (
    length(`original_sha256`) = 64
    AND lower(`original_sha256`) NOT GLOB '*[^0-9a-f]*'
  )
);
--> statement-breakpoint
INSERT OR IGNORE INTO `compliance_organisations` (
  `id`, `organisation_code`, `legal_name`, `trading_name`, `abn`, `status`,
  `created_by_uid`, `created_at`, `updated_at`
) VALUES (
  'org_creditex_au',
  'CREDITEX-AU',
  'Creditex Pty Ltd',
  'Creditex',
  '76105513040',
  'active',
  'platform:creditex-partnership',
  '2026-08-01T00:00:00.000Z',
  '2026-08-01T00:00:00.000Z'
);
--> statement-breakpoint
INSERT OR IGNORE INTO `compliance_invitations` (
  `id`, `organisation_id`, `email`, `display_name`, `role`, `status`,
  `invited_by_uid`, `expires_at`, `claimed_by_uid`, `claimed_at`,
  `created_at`, `updated_at`
) VALUES (
  'invite_creditex_aea_info',
  'org_creditex_au',
  'info@ausenergyassessments.com',
  'AEA Creditex administrator',
  'admin',
  'pending',
  'platform:creditex-partnership',
  '2026-08-31T00:00:00.000Z',
  '',
  '',
  '2026-08-01T00:00:00.000Z',
  '2026-08-01T00:00:00.000Z'
);
