CREATE TABLE `compliance_operational_lookup_imports` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `client_request_id` text NOT NULL CHECK (
    length(`client_request_id`) BETWEEN 8 AND 120
  ),
  `lookup_kind` text NOT NULL CHECK (
    `lookup_kind` IN (
      'participant',
      'product',
      'licence',
      'recall',
      'suspension'
    )
  ),
  `source_artifact_id` text NOT NULL,
  `source_artifact_sha256` text NOT NULL CHECK (
    length(`source_artifact_sha256`) = 64
    AND lower(`source_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `source_artifact_custody_state` text NOT NULL CHECK (
    `source_artifact_custody_state` IN ('draft', 'pending_review')
  ),
  `source_timestamp` text NOT NULL CHECK (
    datetime(`source_timestamp`) IS NOT NULL
  ),
  `request_sha256` text NOT NULL CHECK (
    length(`request_sha256`) = 64
    AND lower(`request_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `records_sha256` text NOT NULL CHECK (
    length(`records_sha256`) = 64
    AND lower(`records_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `record_count` integer NOT NULL CHECK (
    `record_count` > 0 AND `record_count` <= 1000
  ),
  `status` text DEFAULT 'staged_pending' NOT NULL CHECK (
    `status` = 'staged_pending'
  ),
  `live_verification_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `live_verification_enabled` = 0
  ),
  `eligibility_activation_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `eligibility_activation_enabled` = 0
  ),
  `local_assertion_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `local_assertion_enabled` = 0
  ),
  `created_by_uid` text NOT NULL CHECK (trim(`created_by_uid`) <> ''),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
CREATE UNIQUE INDEX `compliance_operational_lookup_imports_org_request_idx`
  ON `compliance_operational_lookup_imports`
  (`organisation_id`, `client_request_id`);
CREATE INDEX `compliance_operational_lookup_imports_org_kind_idx`
  ON `compliance_operational_lookup_imports`
  (`organisation_id`, `lookup_kind`, `source_timestamp`, `created_at`, `id`);
CREATE INDEX `compliance_operational_lookup_imports_source_idx`
  ON `compliance_operational_lookup_imports`
  (`organisation_id`, `source_artifact_id`, `created_at`, `id`);

CREATE TABLE `compliance_operational_lookup_records` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `import_id` text NOT NULL,
  `row_number` integer NOT NULL CHECK (
    `row_number` > 0 AND `row_number` <= 1000
  ),
  `source_record_key` text NOT NULL CHECK (
    trim(`source_record_key`) <> ''
    AND length(`source_record_key`) <= 240
  ),
  `source_effective_from` text NOT NULL CHECK (
    date(`source_effective_from`) = `source_effective_from`
  ),
  `source_effective_to` text DEFAULT '' NOT NULL CHECK (
    `source_effective_to` = ''
    OR (
      date(`source_effective_to`) = `source_effective_to`
      AND `source_effective_to` >= `source_effective_from`
    )
  ),
  `source_status` text NOT NULL CHECK (
    trim(`source_status`) <> '' AND length(`source_status`) <= 240
  ),
  `record_json` text NOT NULL CHECK (
    json_valid(`record_json`)
    AND json_type(`record_json`) = 'object'
    AND length(`record_json`) <= 65536
  ),
  `record_sha256` text NOT NULL CHECK (
    length(`record_sha256`) = 64
    AND lower(`record_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `status` text DEFAULT 'staged_pending' NOT NULL CHECK (
    `status` = 'staged_pending'
  ),
  `live_verification_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `live_verification_enabled` = 0
  ),
  `eligibility_activation_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `eligibility_activation_enabled` = 0
  ),
  `local_assertion_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `local_assertion_enabled` = 0
  ),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
CREATE UNIQUE INDEX `compliance_operational_lookup_records_import_row_idx`
  ON `compliance_operational_lookup_records`
  (`import_id`, `row_number`);
CREATE UNIQUE INDEX `compliance_operational_lookup_records_source_identity_idx`
  ON `compliance_operational_lookup_records`
  (
    `import_id`,
    `source_record_key`,
    `source_effective_from`,
    `source_effective_to`
  );
CREATE INDEX `compliance_operational_lookup_records_org_import_idx`
  ON `compliance_operational_lookup_records`
  (`organisation_id`, `import_id`, `row_number`);
