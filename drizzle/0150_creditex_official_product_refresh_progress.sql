-- Durable replay progress is constrained here. Cross-table progress guards are
-- installed through src/lib/creditex-product-registry-schema-guards.ts because
-- Sites migrations split SQL on semicolons and cannot carry trigger bodies.

-- Older cancelled Workers could leave more than one staging snapshot. Keep the
-- latest exact snapshot for each registry before enforcing one resumable owner.
DELETE FROM `compliance_official_product_snapshots`
WHERE `status` = 'staging'
  AND `id` IN (
    SELECT stale.`id`
    FROM `compliance_official_product_snapshots` stale
    JOIN `compliance_official_product_snapshots` newer
      ON newer.`registry_code` = stale.`registry_code`
      AND newer.`status` = 'staging'
      AND (
        newer.`created_at` > stale.`created_at`
        OR (
          newer.`created_at` = stale.`created_at`
          AND newer.`id` > stale.`id`
        )
      )
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_official_product_snapshots_staging_idx`
  ON `compliance_official_product_snapshots` (`registry_code`)
  WHERE `status` = 'staging';
--> statement-breakpoint

CREATE TABLE `compliance_official_product_refresh_progress` (
  `registry_code` text PRIMARY KEY NOT NULL CHECK (
    trim(`registry_code`) = `registry_code`
    AND `registry_code` = lower(`registry_code`)
    AND length(`registry_code`) BETWEEN 3 AND 80
    AND `registry_code` NOT GLOB '*[^a-z0-9:_-]*'
  ),
  `snapshot_id` text NOT NULL UNIQUE REFERENCES
    `compliance_official_product_snapshots` (`id`) ON DELETE CASCADE,
  `replay_contract` text NOT NULL CHECK (
    `replay_contract` = 'creditex-official-product-refresh-replay/v1'
  ),
  `source_index` integer NOT NULL CHECK (`source_index` BETWEEN 0 AND 99),
  `source_key` text NOT NULL CHECK (
    trim(`source_key`) = `source_key`
    AND `source_key` = lower(`source_key`)
    AND length(`source_key`) BETWEEN 3 AND 80
    AND `source_key` NOT GLOB '*[^a-z0-9:_-]*'
  ),
  `phase` text NOT NULL CHECK (
    `phase` IN ('supplements', 'products', 'activate', 'cleanup')
  ),
  `supplement_batch_count` integer DEFAULT 0 NOT NULL CHECK (
    `supplement_batch_count` BETWEEN 0 AND 500000
  ),
  `supplement_value_count` integer DEFAULT 0 NOT NULL CHECK (
    `supplement_value_count` BETWEEN 0 AND 500000
    AND `supplement_batch_count` <= `supplement_value_count`
  ),
  `product_batch_count` integer DEFAULT 0 NOT NULL CHECK (
    `product_batch_count` BETWEEN 0 AND 500000
  ),
  `product_record_count` integer DEFAULT 0 NOT NULL CHECK (
    `product_record_count` BETWEEN 0 AND 500000
    AND `product_batch_count` <= `product_record_count`
  ),
  `last_product_record_key` text DEFAULT '' NOT NULL CHECK (
    trim(`last_product_record_key`) = `last_product_record_key`
    AND length(`last_product_record_key`) <= 500
    AND (
      (`product_record_count` = 0 AND `last_product_record_key` = '')
      OR (`product_record_count` > 0 AND `last_product_record_key` <> '')
    )
  ),
  `revision` integer DEFAULT 1 NOT NULL CHECK (
    `revision` BETWEEN 1 AND 2147483647
  ),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (
    datetime(`updated_at`) IS NOT NULL
    AND datetime(`updated_at`) >= datetime(`created_at`)
  )
) WITHOUT ROWID;
