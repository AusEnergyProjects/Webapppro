ALTER TABLE `trade_crm_service_sites`
  ADD COLUMN `address_entry_mode` text DEFAULT 'manual_pending_review' NOT NULL
  CHECK (`address_entry_mode` IN ('manual_pending_review', 'provider_selected'));
--> statement-breakpoint
ALTER TABLE `trade_crm_service_sites`
  ADD COLUMN `address_provider` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_service_sites`
  ADD COLUMN `address_provider_reference` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_service_sites`
  ADD COLUMN `address_formatted` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_service_sites`
  ADD COLUMN `address_verified_at` text DEFAULT '' NOT NULL
  CHECK (
    (
      `address_entry_mode` = 'manual_pending_review'
      AND `address_provider` = ''
      AND `address_provider_reference` = ''
      AND `address_formatted` = ''
      AND `address_verified_at` = ''
    )
    OR
    (
      `address_entry_mode` = 'provider_selected'
      AND trim(`address_provider`) <> ''
      AND trim(`address_provider_reference`) <> ''
      AND trim(`address_formatted`) <> ''
      AND datetime(`address_verified_at`) IS NOT NULL
    )
  );
--> statement-breakpoint
CREATE INDEX `trade_crm_service_sites_address_verification_idx`
  ON `trade_crm_service_sites` (`firebase_uid`, `address_entry_mode`, `address_verified_at`);
