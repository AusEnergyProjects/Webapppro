CREATE TABLE `compliance_legacy_import_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `source_system` text DEFAULT 'dataforce' NOT NULL CHECK (`source_system` = 'dataforce'),
  `contract_version` text DEFAULT 'dataforce-jobs-v1' NOT NULL CHECK (`contract_version` = 'dataforce-jobs-v1'),
  `file_name` text NOT NULL,
  `content_sha256` text NOT NULL CHECK (length(`content_sha256`) = 64 AND lower(`content_sha256`) NOT GLOB '*[^0-9a-f]*'),
  `file_size_bytes` integer NOT NULL CHECK (`file_size_bytes` > 0 AND `file_size_bytes` <= 5242880),
  `row_count` integer NOT NULL CHECK (`row_count` > 0 AND `row_count` <= 2500),
  `status` text DEFAULT 'staged_unmapped' NOT NULL CHECK (`status` = 'staged_unmapped'),
  `regulated_job_creation_enabled` integer DEFAULT 0 NOT NULL CHECK (`regulated_job_creation_enabled` = 0),
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `compliance_legacy_import_batches_org_hash_idx`
  ON `compliance_legacy_import_batches` (`organisation_id`, `content_sha256`);
CREATE INDEX `compliance_legacy_import_batches_org_time_idx`
  ON `compliance_legacy_import_batches` (`organisation_id`, `created_at`, `id`);

CREATE TABLE `compliance_legacy_import_rows` (
  `id` text PRIMARY KEY NOT NULL,
  `batch_id` text NOT NULL,
  `organisation_id` text NOT NULL,
  `row_number` integer NOT NULL CHECK (`row_number` > 1),
  `app_id` text DEFAULT '' NOT NULL,
  `job_id` text NOT NULL CHECK (trim(`job_id`) <> ''),
  `row_sha256` text NOT NULL CHECK (length(`row_sha256`) = 64 AND lower(`row_sha256`) NOT GLOB '*[^0-9a-f]*'),
  `data_json` text NOT NULL CHECK (json_valid(`data_json`)),
  `mapping_status` text DEFAULT 'staged_unmapped' NOT NULL CHECK (`mapping_status` = 'staged_unmapped'),
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `compliance_legacy_import_rows_batch_row_idx`
  ON `compliance_legacy_import_rows` (`batch_id`, `row_number`);
CREATE INDEX `compliance_legacy_import_rows_org_job_idx`
  ON `compliance_legacy_import_rows` (`organisation_id`, `job_id`, `created_at`);
