CREATE TABLE `compliance_official_source_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `client_request_id` text NOT NULL,
  `source_url` text NOT NULL CHECK (`source_url` LIKE 'https://%'),
  `source_host` text NOT NULL CHECK (
    `source_host` = lower(`source_host`)
    AND (`source_host` = 'gov.au' OR `source_host` LIKE '%.gov.au')
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
    `retrieval_method` = 'manual_upload'
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

CREATE TABLE `compliance_official_source_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `artifact_id` text NOT NULL,
  `target_type` text NOT NULL CHECK (
    `target_type` IN ('program', 'activity', 'evidence_policy', 'calculator')
  ),
  `target_id` text NOT NULL CHECK (trim(`target_id`) <> ''),
  `citation_location` text NOT NULL CHECK (trim(`citation_location`) <> ''),
  `binding_state` text DEFAULT 'pending_review' NOT NULL CHECK (
    `binding_state` IN ('draft', 'pending_review')
  ),
  `rule_activation_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `rule_activation_enabled` = 0
  ),
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `compliance_official_source_bindings_identity_idx`
  ON `compliance_official_source_bindings` (
    `organisation_id`,
    `artifact_id`,
    `target_type`,
    `target_id`,
    `citation_location`
  );
CREATE INDEX `compliance_official_source_bindings_target_idx`
  ON `compliance_official_source_bindings`
  (`organisation_id`, `target_type`, `target_id`, `created_at`);
CREATE INDEX `compliance_official_source_bindings_artifact_idx`
  ON `compliance_official_source_bindings`
  (`artifact_id`, `created_at`);
