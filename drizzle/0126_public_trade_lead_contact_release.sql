CREATE INDEX `trade_opportunity_matches_firebase_matched_idx`
  ON `trade_opportunity_matches` (`firebase_uid`, `matched_at`);
--> statement-breakpoint
CREATE INDEX `trade_opportunity_matches_firebase_status_opportunity_idx`
  ON `trade_opportunity_matches` (`firebase_uid`, `status`, `opportunity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_opportunities_source_reference_idx`
  ON `trade_opportunities` (`source_reference`)
  WHERE `source_reference` <> '';
--> statement-breakpoint
CREATE TABLE `public_trade_lead_contact_releases` (
  `id` text PRIMARY KEY NOT NULL,
  `opportunity_id` text NOT NULL,
  `source_reference` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'withdrawn')),
  `notice_version` text NOT NULL,
  `consent_purpose` text NOT NULL,
  `disclosed_fields` text DEFAULT '[]' NOT NULL CHECK (
    json_valid(`disclosed_fields`) AND json_type(`disclosed_fields`) = 'array'
  ),
  `customer_name` text NOT NULL,
  `customer_email` text DEFAULT '' NOT NULL,
  `customer_phone` text DEFAULT '' NOT NULL,
  `postcode` text NOT NULL CHECK (
    length(`postcode`) = 4 AND `postcode` NOT GLOB '*[^0-9]*'
  ),
  `customer_message` text DEFAULT '' NOT NULL,
  `granted_at` text NOT NULL CHECK (datetime(`granted_at`) IS NOT NULL),
  `withdrawn_at` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_trade_lead_contact_releases_opportunity_idx`
  ON `public_trade_lead_contact_releases` (`opportunity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_trade_lead_contact_releases_source_idx`
  ON `public_trade_lead_contact_releases` (`source_reference`);
--> statement-breakpoint
CREATE INDEX `public_trade_lead_contact_releases_status_idx`
  ON `public_trade_lead_contact_releases` (`status`, `updated_at`);
