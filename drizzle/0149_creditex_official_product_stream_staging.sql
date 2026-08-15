CREATE TABLE `compliance_official_product_stream_values` (
  `snapshot_id` text NOT NULL REFERENCES `compliance_official_product_snapshots`(`id`) ON DELETE CASCADE,
  `source_key` text NOT NULL CHECK (trim(`source_key`) <> ''),
  `source_record_key` text NOT NULL CHECK (trim(`source_record_key`) <> ''),
  `value_json` text NOT NULL CHECK (json_valid(`value_json`) AND length(`value_json`) <= 65536),
  `created_at` text NOT NULL,
  PRIMARY KEY (`snapshot_id`, `source_key`, `source_record_key`)
) WITHOUT ROWID;

CREATE INDEX `idx_official_product_stream_values_snapshot`
  ON `compliance_official_product_stream_values` (`snapshot_id`, `source_key`);
