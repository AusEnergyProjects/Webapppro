-- Sites-safe migration: complex trigger guards are installed through
-- src/lib/creditex-schema-guards.ts using one prepared statement per guard.
PRAGMA legacy_alter_table = ON;

ALTER TABLE `compliance_official_source_artifacts`
  RENAME TO `compliance_official_source_artifacts_previous`;

CREATE TABLE `compliance_official_source_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `client_request_id` text NOT NULL,
  `source_url` text NOT NULL CHECK (`source_url` LIKE 'https://%'),
  `source_final_url` text DEFAULT '' NOT NULL CHECK (
    `source_final_url` = '' OR `source_final_url` LIKE 'https://%'
  ),
  `source_host` text NOT NULL CHECK (
    `source_host` = lower(`source_host`)
    AND (
      `source_host` = 'gov.au'
      OR `source_host` LIKE '%.gov.au'
      OR `source_host` = 'www.qca.org.au'
    )
  ),
  `source_title` text NOT NULL CHECK (trim(`source_title`) <> ''),
  `source_version` text DEFAULT '' NOT NULL,
  `original_file_name` text NOT NULL CHECK (trim(`original_file_name`) <> ''),
  `content_type` text NOT NULL CHECK (`content_type` IN (
    'application/pdf',
    'application/json',
    'application/xml',
    'text/xml',
    'text/html',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  `size_bytes` integer NOT NULL CHECK (`size_bytes` > 0 AND `size_bytes` <= 15728640),
  `sha256` text NOT NULL CHECK (
    length(`sha256`) = 64
    AND lower(`sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `object_key` text NOT NULL CHECK (trim(`object_key`) <> ''),
  `retrieval_method` text DEFAULT 'manual_upload' NOT NULL CHECK (
    `retrieval_method` IN ('manual_upload', 'server_fetch')
  ),
  `asserted_retrieved_at` text NOT NULL CHECK (
    datetime(`asserted_retrieved_at`) IS NOT NULL
  ),
  `source_etag` text DEFAULT '' NOT NULL,
  `source_last_modified` text DEFAULT '' NOT NULL,
  `custody_state` text DEFAULT 'pending_review' NOT NULL CHECK (
    `custody_state` IN ('draft', 'pending_review')
  ),
  `rule_activation_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `rule_activation_enabled` = 0
  ),
  `captured_by_uid` text NOT NULL,
  `captured_at` text NOT NULL
);

INSERT INTO `compliance_official_source_artifacts` (
  `id`, `organisation_id`, `client_request_id`, `source_url`,
  `source_final_url`, `source_host`, `source_title`, `source_version`,
  `original_file_name`, `content_type`, `size_bytes`, `sha256`, `object_key`,
  `retrieval_method`, `asserted_retrieved_at`, `source_etag`,
  `source_last_modified`, `custody_state`, `rule_activation_enabled`,
  `captured_by_uid`, `captured_at`
)
SELECT
  `id`, `organisation_id`, `client_request_id`, `source_url`,
  `source_url`, `source_host`, `source_title`, `source_version`,
  `original_file_name`, `content_type`, `size_bytes`, `sha256`, `object_key`,
  `retrieval_method`, `asserted_retrieved_at`, `source_etag`,
  `source_last_modified`, `custody_state`, `rule_activation_enabled`,
  `captured_by_uid`, `captured_at`
FROM `compliance_official_source_artifacts_previous`;

DROP TABLE `compliance_official_source_artifacts_previous`;

PRAGMA legacy_alter_table = OFF;

CREATE UNIQUE INDEX `compliance_official_source_artifacts_org_request_idx`
  ON `compliance_official_source_artifacts`
  (`organisation_id`, `client_request_id`);

CREATE UNIQUE INDEX `compliance_official_source_artifacts_org_object_idx`
  ON `compliance_official_source_artifacts`
  (`organisation_id`, `object_key`);

CREATE INDEX `compliance_official_source_artifacts_org_state_idx`
  ON `compliance_official_source_artifacts`
  (`organisation_id`, `custody_state`, `captured_at`, `id`);

CREATE INDEX `compliance_official_source_artifacts_org_hash_idx`
  ON `compliance_official_source_artifacts`
  (`organisation_id`, `sha256`, `captured_at`);
