CREATE TABLE `compliance_evidence_integrity_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `evidence_id` text NOT NULL,
  `request_id` text NOT NULL,
  `object_key` text NOT NULL,
  `expected_sha256` text NOT NULL CHECK (
    length(`expected_sha256`) = 64
    AND lower(`expected_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `observed_sha256` text DEFAULT '' NOT NULL CHECK (
    `observed_sha256` = ''
    OR (
      length(`observed_sha256`) = 64
      AND lower(`observed_sha256`) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  `expected_size_bytes` integer NOT NULL CHECK (`expected_size_bytes` > 0),
  `observed_size_bytes` integer DEFAULT 0 NOT NULL CHECK (
    `observed_size_bytes` >= 0
  ),
  `expected_content_type` text NOT NULL,
  `observed_content_type` text DEFAULT '' NOT NULL,
  `result` text NOT NULL CHECK (`result` IN (
    'matched',
    'mismatch',
    'object_missing',
    'object_oversize',
    'storage_unavailable'
  )),
  `verification_scope` text DEFAULT 'r2_object_bytes_only' NOT NULL CHECK (
    `verification_scope` = 'r2_object_bytes_only'
  ),
  `physical_device_validation_state` text DEFAULT 'not_assessed' NOT NULL CHECK (
    `physical_device_validation_state` = 'not_assessed'
  ),
  `verified_by_uid` text NOT NULL,
  `verified_at` text NOT NULL CHECK (datetime(`verified_at`) IS NOT NULL),
  CHECK (
    (
      `result` = 'matched'
      AND `observed_sha256` = `expected_sha256`
      AND `observed_size_bytes` = `expected_size_bytes`
      AND (
        `observed_content_type` = ''
        OR lower(`observed_content_type`) = lower(`expected_content_type`)
      )
    )
    OR (
      `result` = 'mismatch'
      AND `observed_sha256` <> ''
      AND (
        `observed_sha256` <> `expected_sha256`
        OR `observed_size_bytes` <> `expected_size_bytes`
        OR (
          `observed_content_type` <> ''
          AND lower(`observed_content_type`) <> lower(`expected_content_type`)
        )
      )
    )
    OR (
      `result` IN ('object_missing', 'storage_unavailable')
      AND `observed_sha256` = ''
      AND `observed_size_bytes` = 0
      AND `observed_content_type` = ''
    )
    OR (
      `result` = 'object_oversize'
      AND `observed_sha256` = ''
      AND `observed_size_bytes` > 52428800
    )
  )
);
CREATE UNIQUE INDEX `compliance_evidence_integrity_receipts_org_request_idx`
  ON `compliance_evidence_integrity_receipts`
  (`organisation_id`, `request_id`);
CREATE INDEX `compliance_evidence_integrity_receipts_evidence_idx`
  ON `compliance_evidence_integrity_receipts`
  (`organisation_id`, `evidence_id`, `verified_at`, `id`);
CREATE INDEX `compliance_evidence_integrity_receipts_result_idx`
  ON `compliance_evidence_integrity_receipts`
  (`organisation_id`, `result`, `verified_at`, `id`);
