CREATE TABLE `compliance_product_registry_snapshots` (
  `id` text PRIMARY KEY NOT NULL CHECK (
    trim(`id`) = `id` AND length(`id`) BETWEEN 8 AND 160
  ),
  `registry_code` text NOT NULL CHECK (
    trim(`registry_code`) = `registry_code`
    AND `registry_code` = lower(`registry_code`)
    AND length(`registry_code`) BETWEEN 3 AND 80
    AND `registry_code` NOT GLOB '*[^a-z0-9:_-]*'
  ),
  `contract` text NOT NULL CHECK (
    `contract` = 'creditex-sres-official-registry/v1'
  ),
  `source_manifest_json` text NOT NULL CHECK (
    json_valid(`source_manifest_json`)
    AND json_type(`source_manifest_json`) = 'object'
    AND length(`source_manifest_json`) BETWEEN 2 AND 32768
  ),
  `source_sha256` text NOT NULL CHECK (
    length(`source_sha256`) = 64
    AND `source_sha256` = lower(`source_sha256`)
    AND `source_sha256` NOT GLOB '*[^0-9a-f]*'
  ),
  `record_count` integer NOT NULL CHECK (
    `record_count` > 0 AND `record_count` <= 50000
  ),
  `status` text DEFAULT 'staging' NOT NULL CHECK (
    `status` IN ('staging', 'current', 'superseded')
  ),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `activated_at` text CHECK (
    `activated_at` IS NULL OR datetime(`activated_at`) IS NOT NULL
  ),
  `activated_on` text CHECK (
    `activated_on` IS NULL OR (
      length(`activated_on`) = 10
      AND date(`activated_on`) = `activated_on`
    )
  ),
  `superseded_at` text CHECK (
    `superseded_at` IS NULL OR datetime(`superseded_at`) IS NOT NULL
  ),
  `superseded_on` text CHECK (
    `superseded_on` IS NULL OR (
      length(`superseded_on`) = 10
      AND date(`superseded_on`) = `superseded_on`
    )
  ),
  CHECK (
    (
      `status` = 'staging'
      AND `activated_at` IS NULL
      AND `activated_on` IS NULL
      AND `superseded_at` IS NULL
      AND `superseded_on` IS NULL
    )
    OR (
      `status` = 'current'
      AND `activated_at` IS NOT NULL
      AND `activated_on` IS NOT NULL
      AND datetime(`activated_at`) >= datetime(`created_at`)
      AND `superseded_at` IS NULL
      AND `superseded_on` IS NULL
    )
    OR (
      `status` = 'superseded'
      AND `activated_at` IS NOT NULL
      AND `activated_on` IS NOT NULL
      AND `superseded_at` IS NOT NULL
      AND `superseded_on` IS NOT NULL
      AND datetime(`activated_at`) >= datetime(`created_at`)
      AND datetime(`superseded_at`) >= datetime(`activated_at`)
      AND `superseded_on` >= `activated_on`
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_product_registry_snapshots_current_idx`
  ON `compliance_product_registry_snapshots` (`registry_code`)
  WHERE `status` = 'current';
--> statement-breakpoint
CREATE INDEX `compliance_product_registry_snapshots_registry_history_idx`
  ON `compliance_product_registry_snapshots`
  (`registry_code`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_product_registry_snapshots_status_idx`
  ON `compliance_product_registry_snapshots`
  (`status`, `created_at`, `id`);
--> statement-breakpoint

CREATE TABLE `compliance_product_registry_products` (
  `id` text PRIMARY KEY NOT NULL CHECK (
    trim(`id`) = `id` AND length(`id`) BETWEEN 8 AND 200
  ),
  `snapshot_id` text NOT NULL REFERENCES
    `compliance_product_registry_snapshots` (`id`) ON DELETE CASCADE,
  `source_record_key` text NOT NULL CHECK (
    trim(`source_record_key`) = `source_record_key`
    AND length(`source_record_key`) BETWEEN 3 AND 240
  ),
  `source_item` text NOT NULL CHECK (
    length(`source_item`) BETWEEN 1 AND 32
    AND `source_item` GLOB '[0-9]*'
    AND `source_item` NOT GLOB '*[^0-9]*'
  ),
  `technology` text NOT NULL CHECK (
    `technology` IN ('air_source_heat_pump', 'solar_water_heater')
  ),
  `category` text NOT NULL CHECK (
    `category` IN (
      'capacity_at_most_425l',
      'capacity_less_than_700l',
      'capacity_at_least_700l'
    )
  ),
  `brand` text NOT NULL CHECK (
    trim(`brand`) = `brand` AND length(`brand`) BETWEEN 1 AND 200
  ),
  `model` text NOT NULL CHECK (
    trim(`model`) = `model` AND length(`model`) BETWEEN 1 AND 200
  ),
  `search_text` text NOT NULL CHECK (
    trim(`search_text`) = `search_text`
    AND `search_text` = lower(`search_text`)
    AND length(`search_text`) BETWEEN 1 AND 600
  ),
  `eligible_from` text NOT NULL CHECK (
    date(`eligible_from`) = `eligible_from`
  ),
  `eligible_to` text NOT NULL CHECK (
    date(`eligible_to`) = `eligible_to`
    AND `eligible_to` >= `eligible_from`
  ),
  `zone_1_stcs` integer CHECK (
    `zone_1_stcs` IS NULL OR `zone_1_stcs` BETWEEN 0 AND 1000000
  ),
  `zone_2_stcs` integer CHECK (
    `zone_2_stcs` IS NULL OR `zone_2_stcs` BETWEEN 0 AND 1000000
  ),
  `zone_3_stcs` integer CHECK (
    `zone_3_stcs` IS NULL OR `zone_3_stcs` BETWEEN 0 AND 1000000
  ),
  `zone_4_stcs` integer CHECK (
    `zone_4_stcs` IS NULL OR `zone_4_stcs` BETWEEN 0 AND 1000000
  ),
  `zone_5_stcs` integer CHECK (
    `zone_5_stcs` IS NULL OR `zone_5_stcs` BETWEEN 0 AND 1000000
  ),
  CHECK (
    (
      `technology` = 'air_source_heat_pump'
      AND `category` = 'capacity_at_most_425l'
      AND `source_record_key` = 'cer-ashp:' || `source_item`
    )
    OR (
      `technology` = 'solar_water_heater'
      AND `category` = 'capacity_less_than_700l'
      AND `source_record_key` = 'cer-swh-lt-700l:' || `source_item`
      AND `zone_5_stcs` IS NULL
    )
    OR (
      `technology` = 'solar_water_heater'
      AND `category` = 'capacity_at_least_700l'
      AND `source_record_key` = 'cer-swh-ge-700l:' || `source_item`
      AND `zone_5_stcs` IS NULL
    )
  ),
  CHECK (
    coalesce(`zone_1_stcs`, 0) + coalesce(`zone_2_stcs`, 0)
      + coalesce(`zone_3_stcs`, 0) + coalesce(`zone_4_stcs`, 0)
      + coalesce(`zone_5_stcs`, 0) > 0
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_product_registry_products_snapshot_source_idx`
  ON `compliance_product_registry_products`
  (`snapshot_id`, `source_record_key`);
--> statement-breakpoint
CREATE INDEX `compliance_product_registry_products_selection_idx`
  ON `compliance_product_registry_products`
  (`snapshot_id`, `technology`, `category`, `eligible_from`, `eligible_to`);
--> statement-breakpoint
CREATE INDEX `compliance_product_registry_products_search_idx`
  ON `compliance_product_registry_products`
  (`snapshot_id`, `technology`, `search_text`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_product_registry_products_model_idx`
  ON `compliance_product_registry_products`
  (`snapshot_id`, `technology`, `brand`, `model`, `id`);
--> statement-breakpoint

CREATE TABLE `compliance_product_registry_source_artifacts` (
  `id` text PRIMARY KEY NOT NULL CHECK (
    trim(`id`) = `id` AND length(`id`) BETWEEN 8 AND 200
  ),
  `snapshot_id` text NOT NULL REFERENCES
    `compliance_product_registry_snapshots` (`id`) ON DELETE CASCADE,
  `source_key` text NOT NULL CHECK (
    `source_key` IN (
      'cer-ashp',
      'cer-swh-lt-700l',
      'cer-swh-ge-700l',
      'cer-swh-ashp-postcode-zones',
      'cer-pv-postcode-zones'
    )
  ),
  `source_url` text NOT NULL CHECK (
    trim(`source_url`) = `source_url`
    AND length(`source_url`) BETWEEN 20 AND 1000
    AND `source_url` GLOB 'https://cer.gov.au/*'
  ),
  `source_sha256` text NOT NULL CHECK (
    length(`source_sha256`) = 64
    AND `source_sha256` = lower(`source_sha256`)
    AND `source_sha256` NOT GLOB '*[^0-9a-f]*'
  ),
  `content_type` text NOT NULL CHECK (
    trim(`content_type`) = `content_type`
    AND length(`content_type`) BETWEEN 3 AND 120
  ),
  `byte_length` integer NOT NULL CHECK (
    `byte_length` BETWEEN 1 AND 1900000
  ),
  `record_count` integer NOT NULL CHECK (
    `record_count` BETWEEN 0 AND 12000
  ),
  `object_key` text NOT NULL CHECK (
    trim(`object_key`) = `object_key`
    AND length(`object_key`) BETWEEN 80 AND 1000
    AND `object_key` GLOB 'creditex/official-sources/cer_sres_swh/*'
  ),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_product_registry_source_artifacts_source_idx`
  ON `compliance_product_registry_source_artifacts`
  (`snapshot_id`, `source_key`);
--> statement-breakpoint
CREATE INDEX `compliance_product_registry_source_artifacts_hash_idx`
  ON `compliance_product_registry_source_artifacts`
  (`source_sha256`, `created_at`, `id`);
--> statement-breakpoint

CREATE TABLE `compliance_product_registry_sync_runs` (
  `id` text PRIMARY KEY NOT NULL CHECK (
    trim(`id`) = `id` AND length(`id`) BETWEEN 8 AND 200
  ),
  `registry_code` text NOT NULL CHECK (
    trim(`registry_code`) = `registry_code`
    AND `registry_code` = lower(`registry_code`)
    AND length(`registry_code`) BETWEEN 3 AND 80
    AND `registry_code` NOT GLOB '*[^a-z0-9:_-]*'
  ),
  `status` text NOT NULL CHECK (
    `status` IN ('success', 'unchanged', 'failed')
  ),
  `snapshot_id` text REFERENCES
    `compliance_product_registry_snapshots` (`id`) ON DELETE SET NULL,
  `source_manifest_json` text CHECK (
    `source_manifest_json` IS NULL
    OR (
      json_valid(`source_manifest_json`)
      AND json_type(`source_manifest_json`) = 'object'
      AND length(`source_manifest_json`) BETWEEN 2 AND 32768
    )
  ),
  `source_sha256` text CHECK (
    `source_sha256` IS NULL
    OR (
      length(`source_sha256`) = 64
      AND `source_sha256` = lower(`source_sha256`)
      AND `source_sha256` NOT GLOB '*[^0-9a-f]*'
    )
  ),
  `record_count` integer NOT NULL CHECK (
    `record_count` BETWEEN 0 AND 50000
  ),
  `checked_at` text NOT NULL CHECK (datetime(`checked_at`) IS NOT NULL),
  `message` text DEFAULT '' NOT NULL CHECK (
    length(`message`) <= 2000
  ),
  CHECK (
    (
      `status` IN ('success', 'unchanged')
      AND `snapshot_id` IS NOT NULL
      AND `source_manifest_json` IS NOT NULL
      AND `source_sha256` IS NOT NULL
      AND `record_count` > 0
    )
    OR (
      `status` = 'failed'
      AND trim(`message`) <> ''
    )
  )
);
--> statement-breakpoint
CREATE INDEX `compliance_product_registry_sync_runs_registry_time_idx`
  ON `compliance_product_registry_sync_runs`
  (`registry_code`, `checked_at`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_product_registry_sync_runs_health_idx`
  ON `compliance_product_registry_sync_runs`
  (`status`, `checked_at`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_product_registry_sync_runs_snapshot_idx`
  ON `compliance_product_registry_sync_runs`
  (`snapshot_id`, `checked_at`, `id`);
--> statement-breakpoint

CREATE TABLE `compliance_product_registry_sync_leases` (
  `registry_code` text PRIMARY KEY NOT NULL CHECK (
    trim(`registry_code`) = `registry_code`
    AND `registry_code` = lower(`registry_code`)
    AND length(`registry_code`) BETWEEN 3 AND 80
    AND `registry_code` NOT GLOB '*[^a-z0-9:_-]*'
  ),
  `lease_id` text NOT NULL CHECK (
    trim(`lease_id`) = `lease_id` AND length(`lease_id`) BETWEEN 8 AND 160
  ),
  `started_at` text NOT NULL CHECK (datetime(`started_at`) IS NOT NULL),
  `expires_at` text NOT NULL CHECK (
    datetime(`expires_at`) IS NOT NULL
    AND datetime(`expires_at`) > datetime(`started_at`)
  )
);
--> statement-breakpoint
CREATE INDEX `compliance_product_registry_sync_leases_expiry_idx`
  ON `compliance_product_registry_sync_leases` (`expires_at`, `registry_code`);
--> statement-breakpoint

-- Registry triggers are installed through the D1 prepared-statement schema guard.
