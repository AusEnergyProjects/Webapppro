CREATE TABLE `compliance_official_product_snapshots` (
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
    `contract` = 'creditex-official-products/v1'
  ),
  `source_manifest_json` text NOT NULL CHECK (
    json_valid(`source_manifest_json`)
    AND json_type(`source_manifest_json`) = 'object'
    AND length(`source_manifest_json`) BETWEEN 2 AND 131072
  ),
  `source_sha256` text NOT NULL CHECK (
    length(`source_sha256`) = 64
    AND `source_sha256` = lower(`source_sha256`)
    AND `source_sha256` NOT GLOB '*[^0-9a-f]*'
  ),
  `source_count` integer NOT NULL CHECK (
    `source_count` BETWEEN 1 AND 100
  ),
  `record_count` integer NOT NULL CHECK (
    `record_count` > 0 AND `record_count` <= 500000
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
      length(`activated_on`) = 10 AND date(`activated_on`) = `activated_on`
    )
  ),
  `superseded_at` text CHECK (
    `superseded_at` IS NULL OR datetime(`superseded_at`) IS NOT NULL
  ),
  `superseded_on` text CHECK (
    `superseded_on` IS NULL OR (
      length(`superseded_on`) = 10 AND date(`superseded_on`) = `superseded_on`
    )
  ),
  CHECK (
    (`status` = 'staging'
      AND `activated_at` IS NULL AND `activated_on` IS NULL
      AND `superseded_at` IS NULL AND `superseded_on` IS NULL)
    OR (`status` = 'current' AND `activated_at` IS NOT NULL
      AND `activated_on` IS NOT NULL
      AND datetime(`activated_at`) >= datetime(`created_at`)
      AND `superseded_at` IS NULL AND `superseded_on` IS NULL)
    OR (`status` = 'superseded' AND `activated_at` IS NOT NULL
      AND `activated_on` IS NOT NULL
      AND `superseded_at` IS NOT NULL AND `superseded_on` IS NOT NULL
      AND datetime(`activated_at`) >= datetime(`created_at`)
      AND datetime(`superseded_at`) >= datetime(`activated_at`)
      AND `superseded_on` >= `activated_on`)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_official_product_snapshots_current_idx`
  ON `compliance_official_product_snapshots` (`registry_code`)
  WHERE `status` = 'current';
--> statement-breakpoint
CREATE INDEX `compliance_official_product_snapshots_history_idx`
  ON `compliance_official_product_snapshots`
  (`registry_code`, `created_at`, `id`);
--> statement-breakpoint

CREATE TABLE `compliance_official_products` (
  `id` text PRIMARY KEY NOT NULL CHECK (
    trim(`id`) = `id` AND length(`id`) BETWEEN 8 AND 640
  ),
  `snapshot_id` text NOT NULL REFERENCES
    `compliance_official_product_snapshots` (`id`) ON DELETE CASCADE,
  `source_key` text NOT NULL CHECK (
    trim(`source_key`) = `source_key`
    AND `source_key` = lower(`source_key`)
    AND length(`source_key`) BETWEEN 3 AND 80
    AND `source_key` NOT GLOB '*[^a-z0-9:_-]*'
  ),
  `source_record_key` text NOT NULL CHECK (
    trim(`source_record_key`) = `source_record_key`
    AND length(`source_record_key`) BETWEEN 1 AND 500
  ),
  `product_kind` text NOT NULL CHECK (
    trim(`product_kind`) = `product_kind`
    AND `product_kind` = lower(`product_kind`)
    AND length(`product_kind`) BETWEEN 3 AND 80
    AND `product_kind` NOT GLOB '*[^a-z0-9_:-]*'
  ),
  `manufacturer` text DEFAULT '' NOT NULL CHECK (
    trim(`manufacturer`) = `manufacturer` AND length(`manufacturer`) <= 300
  ),
  `brand` text DEFAULT '' NOT NULL CHECK (
    trim(`brand`) = `brand` AND length(`brand`) <= 300
  ),
  `model` text NOT NULL CHECK (
    trim(`model`) = `model` AND length(`model`) BETWEEN 1 AND 500
  ),
  `series` text DEFAULT '' NOT NULL CHECK (
    trim(`series`) = `series` AND length(`series`) <= 300
  ),
  `registration_number` text DEFAULT '' NOT NULL CHECK (
    trim(`registration_number`) = `registration_number`
    AND length(`registration_number`) <= 200
  ),
  `certificate_number` text DEFAULT '' NOT NULL CHECK (
    trim(`certificate_number`) = `certificate_number`
    AND length(`certificate_number`) <= 200
  ),
  `approval_status` text NOT NULL CHECK (
    trim(`approval_status`) = `approval_status`
    AND `approval_status` = lower(`approval_status`)
    AND length(`approval_status`) BETWEEN 1 AND 80
    AND `approval_status` NOT GLOB '*[^a-z0-9_:-]*'
  ),
  `eligible_from` text DEFAULT '' NOT NULL CHECK (
    `eligible_from` = '' OR date(`eligible_from`) = `eligible_from`
  ),
  `eligible_to` text DEFAULT '' NOT NULL CHECK (
    (`eligible_to` = '' OR date(`eligible_to`) = `eligible_to`)
    AND (`eligible_from` = '' OR `eligible_to` = '' OR `eligible_to` >= `eligible_from`)
  ),
  `available_in_australia` integer DEFAULT 1 NOT NULL CHECK (
    `available_in_australia` IN (0, 1)
  ),
  `registry_effective_from` text NOT NULL CHECK (
    length(`registry_effective_from`) = 10
    AND date(`registry_effective_from`) = `registry_effective_from`
  ),
  `search_text` text NOT NULL CHECK (
    trim(`search_text`) = `search_text`
    AND `search_text` = lower(`search_text`)
    AND length(`search_text`) BETWEEN 1 AND 2000
  ),
  `attributes_json` text DEFAULT '{}' NOT NULL CHECK (
    json_valid(`attributes_json`)
    AND json_type(`attributes_json`) = 'object'
    AND length(`attributes_json`) BETWEEN 2 AND 65536
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_official_products_source_record_idx`
  ON `compliance_official_products`
  (`snapshot_id`, `source_key`, `source_record_key`);
--> statement-breakpoint
CREATE INDEX `compliance_official_products_selection_idx`
  ON `compliance_official_products`
  (`snapshot_id`, `product_kind`, `registry_effective_from`,
    `eligible_from`, `eligible_to`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_official_products_search_idx`
  ON `compliance_official_products`
  (`snapshot_id`, `product_kind`, `search_text`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_official_products_model_idx`
  ON `compliance_official_products`
  (`snapshot_id`, `product_kind`, `brand`, `model`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_official_products_registration_idx`
  ON `compliance_official_products`
  (`snapshot_id`, `registration_number`, `certificate_number`, `id`);
--> statement-breakpoint

CREATE TABLE `compliance_official_product_artifacts` (
  `id` text PRIMARY KEY NOT NULL CHECK (
    trim(`id`) = `id` AND length(`id`) BETWEEN 8 AND 260
  ),
  `snapshot_id` text NOT NULL REFERENCES
    `compliance_official_product_snapshots` (`id`) ON DELETE CASCADE,
  `source_key` text NOT NULL CHECK (
    trim(`source_key`) = `source_key`
    AND `source_key` = lower(`source_key`)
    AND length(`source_key`) BETWEEN 3 AND 80
    AND `source_key` NOT GLOB '*[^a-z0-9:_-]*'
  ),
  `source_url` text NOT NULL CHECK (
    trim(`source_url`) = `source_url`
    AND length(`source_url`) BETWEEN 12 AND 2000
    AND `source_url` GLOB 'https://*'
  ),
  `source_sha256` text NOT NULL CHECK (
    length(`source_sha256`) = 64
    AND `source_sha256` = lower(`source_sha256`)
    AND `source_sha256` NOT GLOB '*[^0-9a-f]*'
  ),
  `content_type` text NOT NULL CHECK (
    trim(`content_type`) = `content_type`
    AND length(`content_type`) BETWEEN 3 AND 160
  ),
  `byte_length` integer NOT NULL CHECK (
    `byte_length` BETWEEN 1 AND 100000000
  ),
  `record_count` integer NOT NULL CHECK (
    `record_count` BETWEEN 0 AND 500000
  ),
  `object_key` text NOT NULL CHECK (
    trim(`object_key`) = `object_key`
    AND length(`object_key`) BETWEEN 60 AND 2000
    AND `object_key` GLOB 'creditex/official-products/*'
  ),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_official_product_artifacts_source_idx`
  ON `compliance_official_product_artifacts` (`snapshot_id`, `source_key`);
--> statement-breakpoint
CREATE INDEX `compliance_official_product_artifacts_hash_idx`
  ON `compliance_official_product_artifacts`
  (`source_sha256`, `created_at`, `id`);
--> statement-breakpoint

CREATE TABLE `compliance_official_product_sync_runs` (
  `id` text PRIMARY KEY NOT NULL CHECK (
    trim(`id`) = `id` AND length(`id`) BETWEEN 8 AND 200
  ),
  `registry_code` text NOT NULL CHECK (
    trim(`registry_code`) = `registry_code`
    AND `registry_code` = lower(`registry_code`)
    AND length(`registry_code`) BETWEEN 3 AND 80
    AND `registry_code` NOT GLOB '*[^a-z0-9:_-]*'
  ),
  `status` text NOT NULL CHECK (`status` IN ('success', 'unchanged', 'failed')),
  `snapshot_id` text REFERENCES
    `compliance_official_product_snapshots` (`id`) ON DELETE SET NULL,
  `source_manifest_json` text CHECK (
    `source_manifest_json` IS NULL OR (
      json_valid(`source_manifest_json`)
      AND json_type(`source_manifest_json`) = 'object'
      AND length(`source_manifest_json`) BETWEEN 2 AND 131072
    )
  ),
  `source_sha256` text CHECK (
    `source_sha256` IS NULL OR (
      length(`source_sha256`) = 64
      AND `source_sha256` = lower(`source_sha256`)
      AND `source_sha256` NOT GLOB '*[^0-9a-f]*'
    )
  ),
  `record_count` integer NOT NULL CHECK (
    `record_count` BETWEEN 0 AND 500000
  ),
  `checked_at` text NOT NULL CHECK (datetime(`checked_at`) IS NOT NULL),
  `message` text DEFAULT '' NOT NULL CHECK (length(`message`) <= 2000),
  CHECK (
    (`status` IN ('success', 'unchanged')
      AND `snapshot_id` IS NOT NULL
      AND `source_manifest_json` IS NOT NULL
      AND `source_sha256` IS NOT NULL
      AND `record_count` > 0)
    OR (`status` = 'failed' AND trim(`message`) <> '')
  )
);
--> statement-breakpoint
CREATE INDEX `compliance_official_product_sync_runs_registry_idx`
  ON `compliance_official_product_sync_runs`
  (`registry_code`, `checked_at`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_official_product_sync_runs_snapshot_idx`
  ON `compliance_official_product_sync_runs`
  (`snapshot_id`, `checked_at`, `id`);
--> statement-breakpoint

CREATE TABLE `compliance_official_product_sync_leases` (
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
CREATE INDEX `compliance_official_product_sync_leases_expiry_idx`
  ON `compliance_official_product_sync_leases` (`expires_at`, `registry_code`);
--> statement-breakpoint

-- Registry triggers are installed through the D1 prepared-statement schema guard.
