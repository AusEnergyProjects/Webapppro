-- Durable source acquisition lives before the immutable artifact and replay
-- contracts. Exact upstream response bytes are retained in R2; these D1 rows
-- are only the fenced cursor and custody receipts needed to resume safely.

CREATE TABLE `compliance_official_product_source_acquisitions` (
  `registry_code` text PRIMARY KEY NOT NULL CHECK (
    trim(`registry_code`) = `registry_code`
    AND `registry_code` = lower(`registry_code`)
    AND length(`registry_code`) BETWEEN 3 AND 80
    AND `registry_code` NOT GLOB '*[^a-z0-9:_-]*'
  ),
  `acquisition_id` text NOT NULL UNIQUE CHECK (
    length(`acquisition_id`) BETWEEN 16 AND 80
  ),
  `contract` text NOT NULL CHECK (
    `contract` = 'creditex-official-product-source-acquisition/v1'
  ),
  `definition_sha256` text NOT NULL CHECK (
    length(`definition_sha256`) = 64
    AND `definition_sha256` NOT GLOB '*[^0-9a-f]*'
  ),
  `source_key` text NOT NULL CHECK (
    trim(`source_key`) = `source_key`
    AND `source_key` = lower(`source_key`)
    AND length(`source_key`) BETWEEN 3 AND 80
    AND `source_key` NOT GLOB '*[^a-z0-9:_-]*'
  ),
  `source_refreshed_at` text NOT NULL CHECK (
    datetime(`source_refreshed_at`) IS NOT NULL
  ),
  `total_record_count` integer NOT NULL CHECK (
    `total_record_count` BETWEEN 1 AND 500000
  ),
  `status_control_json` text NOT NULL CHECK (
    json_valid(`status_control_json`)
  ),
  `category_control_json` text NOT NULL CHECK (
    json_valid(`category_control_json`)
  ),
  `supplemental_control_json` text NOT NULL CHECK (
    json_valid(`supplemental_control_json`)
  ),
  `phase` text DEFAULT 'pages' NOT NULL CHECK (
    `phase` IN ('pages', 'assemble', 'ready', 'cleanup')
  ),
  `cleanup_disposition` text DEFAULT 'restart' NOT NULL CHECK (
    `cleanup_disposition` IN ('restart', 'finish')
  ),
  `response_count` integer DEFAULT 0 NOT NULL CHECK (
    `response_count` BETWEEN 0 AND 2500
  ),
  `response_byte_length` integer DEFAULT 0 NOT NULL CHECK (
    `response_byte_length` BETWEEN 0 AND 32000000
  ),
  `assembly_record_count` integer DEFAULT 0 NOT NULL CHECK (
    `assembly_record_count` BETWEEN 0 AND 2500
  ),
  `assembly_chunk_count` integer DEFAULT 0 NOT NULL CHECK (
    `assembly_chunk_count` BETWEEN 0 AND 2500
  ),
  `assembly_byte_length` integer DEFAULT 0 NOT NULL CHECK (
    `assembly_byte_length` BETWEEN 0 AND 32000000
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
--> statement-breakpoint

CREATE TABLE `compliance_official_product_source_acquisition_streams` (
  `acquisition_id` text NOT NULL REFERENCES
    `compliance_official_product_source_acquisitions` (`acquisition_id`)
    ON DELETE CASCADE,
  `stream_index` integer NOT NULL CHECK (`stream_index` BETWEEN 0 AND 10),
  `stream_key` text NOT NULL CHECK (
    trim(`stream_key`) = `stream_key`
    AND length(`stream_key`) BETWEEN 3 AND 100
  ),
  `expected_record_count` integer NOT NULL CHECK (
    `expected_record_count` BETWEEN 0 AND 500000
  ),
  `page_count` integer DEFAULT 0 NOT NULL CHECK (
    `page_count` BETWEEN 0 AND 200
  ),
  `record_count` integer DEFAULT 0 NOT NULL CHECK (
    `record_count` BETWEEN 0 AND `expected_record_count`
  ),
  `last_record_id` text DEFAULT '' NOT NULL CHECK (
    trim(`last_record_id`) = `last_record_id`
    AND length(`last_record_id`) <= 18
    AND (
      (`record_count` = 0 AND `last_record_id` = '')
      OR (`record_count` > 0 AND length(`last_record_id`) BETWEEN 15 AND 18)
    )
  ),
  `terminal` integer DEFAULT 0 NOT NULL CHECK (`terminal` IN (0, 1)),
  `revision` integer DEFAULT 1 NOT NULL CHECK (
    `revision` BETWEEN 1 AND 2147483647
  ),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL),
  PRIMARY KEY (`acquisition_id`, `stream_index`),
  UNIQUE (`acquisition_id`, `stream_key`),
  CHECK (`terminal` = 0 OR `record_count` = `expected_record_count`),
  CHECK (`terminal` = 0 OR `expected_record_count` = 0 OR `page_count` > 0)
) WITHOUT ROWID;
--> statement-breakpoint

CREATE TABLE `compliance_official_product_source_acquisition_fragments` (
  `acquisition_id` text NOT NULL REFERENCES
    `compliance_official_product_source_acquisitions` (`acquisition_id`)
    ON DELETE CASCADE,
  `kind` text NOT NULL CHECK (
    `kind` IN ('control', 'model', 'schema', 'page', 'assembly')
  ),
  `stream_index` integer NOT NULL CHECK (`stream_index` BETWEEN -1 AND 10),
  `fragment_index` integer NOT NULL CHECK (`fragment_index` BETWEEN 0 AND 2500),
  `request_sha256` text NOT NULL CHECK (
    length(`request_sha256`) = 64
    AND `request_sha256` NOT GLOB '*[^0-9a-f]*'
  ),
  `cursor_before` text DEFAULT '' NOT NULL CHECK (
    length(`cursor_before`) <= 18
  ),
  `cursor_after` text DEFAULT '' NOT NULL CHECK (
    length(`cursor_after`) <= 18
  ),
  `row_count` integer DEFAULT 0 NOT NULL CHECK (
    `row_count` BETWEEN 0 AND 5000
  ),
  `terminal` integer DEFAULT 0 NOT NULL CHECK (`terminal` IN (0, 1)),
  `object_key` text NOT NULL UNIQUE CHECK (
    length(`object_key`) BETWEEN 40 AND 1000
  ),
  `response_sha256` text NOT NULL CHECK (
    length(`response_sha256`) = 64
    AND `response_sha256` NOT GLOB '*[^0-9a-f]*'
  ),
  `content_type` text NOT NULL CHECK (`content_type` = 'application/json'),
  `byte_length` integer NOT NULL CHECK (`byte_length` BETWEEN 1 AND 32000000),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  PRIMARY KEY (`acquisition_id`, `kind`, `stream_index`, `fragment_index`),
  CHECK (
    (`kind` = 'page' AND `stream_index` BETWEEN 0 AND 10)
    OR (`kind` <> 'page' AND `stream_index` = -1)
  )
) WITHOUT ROWID;
--> statement-breakpoint

CREATE INDEX `compliance_official_product_source_acquisition_fragments_stream_idx`
  ON `compliance_official_product_source_acquisition_fragments`
    (`acquisition_id`, `stream_index`, `fragment_index`);
