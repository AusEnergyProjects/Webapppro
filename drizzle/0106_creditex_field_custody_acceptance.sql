CREATE TABLE `compliance_field_custody_test_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `client_request_id` text NOT NULL CHECK (
    length(`client_request_id`) BETWEEN 8 AND 120
  ),
  `request_sha256` text NOT NULL CHECK (
    length(`request_sha256`) = 64
    AND lower(`request_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `artifact_sha256` text NOT NULL CHECK (
    length(`artifact_sha256`) = 64
    AND lower(`artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `platform` text NOT NULL CHECK (`platform` IN ('ios', 'android')),
  `native_build_identifier` text NOT NULL CHECK (
    trim(`native_build_identifier`) <> ''
    AND length(`native_build_identifier`) <= 180
  ),
  `native_build_sha256` text NOT NULL CHECK (
    length(`native_build_sha256`) = 64
    AND lower(`native_build_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `device_class` text DEFAULT 'physical' NOT NULL CHECK (
    `device_class` = 'physical'
  ),
  `device_model` text NOT NULL CHECK (
    trim(`device_model`) <> ''
    AND length(`device_model`) <= 180
  ),
  `device_os_version` text NOT NULL CHECK (
    trim(`device_os_version`) <> ''
    AND length(`device_os_version`) <= 120
  ),
  `device_identifier_sha256` text NOT NULL CHECK (
    length(`device_identifier_sha256`) = 64
    AND lower(`device_identifier_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `requirement_id` text NOT NULL CHECK (trim(`requirement_id`) <> ''),
  `evidence_id` text NOT NULL CHECK (trim(`evidence_id`) <> ''),
  `integrity_receipt_id` text NOT NULL CHECK (
    trim(`integrity_receipt_id`) <> ''
  ),
  `offline_scenario` text DEFAULT 'offline_capture_restore' NOT NULL CHECK (
    `offline_scenario` = 'offline_capture_restore'
  ),
  `restore_sha256` text NOT NULL CHECK (
    length(`restore_sha256`) = 64
    AND lower(`restore_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `test_result` text NOT NULL CHECK (
    `test_result` IN ('failed', 'passed')
  ),
  `tester_uid` text NOT NULL CHECK (trim(`tester_uid`) <> ''),
  `tested_at` text NOT NULL CHECK (datetime(`tested_at`) IS NOT NULL),
  `created_by_uid` text NOT NULL CHECK (trim(`created_by_uid`) <> ''),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  CHECK (`created_by_uid` = `tester_uid`),
  CHECK (datetime(`tested_at`) <= datetime(`created_at`))
);
CREATE UNIQUE INDEX `compliance_field_custody_test_artifact_request_idx`
  ON `compliance_field_custody_test_artifacts`
  (`organisation_id`, `client_request_id`);
CREATE INDEX `compliance_field_custody_test_artifact_evidence_idx`
  ON `compliance_field_custody_test_artifacts`
  (`organisation_id`, `evidence_id`, `tested_at`, `id`);
CREATE INDEX `compliance_field_custody_test_artifact_tester_idx`
  ON `compliance_field_custody_test_artifacts`
  (`organisation_id`, `tester_uid`, `tested_at`, `id`);

CREATE TABLE `compliance_field_custody_acceptance_records` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `client_request_id` text NOT NULL CHECK (
    length(`client_request_id`) BETWEEN 8 AND 120
  ),
  `request_sha256` text NOT NULL CHECK (
    length(`request_sha256`) = 64
    AND lower(`request_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `platform` text NOT NULL CHECK (`platform` IN ('ios', 'android')),
  `native_build_identifier` text NOT NULL CHECK (
    trim(`native_build_identifier`) <> ''
    AND length(`native_build_identifier`) <= 180
  ),
  `native_build_sha256` text NOT NULL CHECK (
    length(`native_build_sha256`) = 64
    AND lower(`native_build_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `device_class` text DEFAULT 'physical' NOT NULL CHECK (
    `device_class` = 'physical'
  ),
  `device_model` text NOT NULL CHECK (
    trim(`device_model`) <> ''
    AND length(`device_model`) <= 180
  ),
  `device_os_version` text NOT NULL CHECK (
    trim(`device_os_version`) <> ''
    AND length(`device_os_version`) <= 120
  ),
  `device_identifier_sha256` text NOT NULL CHECK (
    length(`device_identifier_sha256`) = 64
    AND lower(`device_identifier_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `requirement_id` text NOT NULL CHECK (trim(`requirement_id`) <> ''),
  `evidence_id` text NOT NULL CHECK (trim(`evidence_id`) <> ''),
  `integrity_receipt_id` text NOT NULL CHECK (
    trim(`integrity_receipt_id`) <> ''
  ),
  `offline_scenario` text DEFAULT 'offline_capture_restore' NOT NULL CHECK (
    `offline_scenario` = 'offline_capture_restore'
  ),
  `restore_sha256` text DEFAULT '' NOT NULL CHECK (
    `restore_sha256` = ''
    OR (
      length(`restore_sha256`) = 64
      AND lower(`restore_sha256`) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  `status` text DEFAULT 'not_run' NOT NULL CHECK (
    `status` IN ('not_run', 'blocked', 'failed', 'passed', 'rejected')
  ),
  `test_artifact_id` text DEFAULT '' NOT NULL CHECK (
    length(`test_artifact_id`) <= 180
  ),
  `test_artifact_sha256` text DEFAULT '' NOT NULL CHECK (
    `test_artifact_sha256` = ''
    OR (
      length(`test_artifact_sha256`) = 64
      AND lower(`test_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  `tester_uid` text NOT NULL CHECK (trim(`tester_uid`) <> ''),
  `independent_approver_uid` text NOT NULL CHECK (
    trim(`independent_approver_uid`) <> ''
  ),
  `tested_at` text DEFAULT '' NOT NULL CHECK (
    `tested_at` = '' OR datetime(`tested_at`) IS NOT NULL
  ),
  `approved_at` text DEFAULT '' NOT NULL CHECK (
    `approved_at` = '' OR datetime(`approved_at`) IS NOT NULL
  ),
  `created_by_uid` text NOT NULL CHECK (trim(`created_by_uid`) <> ''),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  CHECK (`tester_uid` <> `independent_approver_uid`),
  CHECK (
    (
      `status` = 'not_run'
      AND `restore_sha256` = ''
      AND `tested_at` = ''
      AND `approved_at` = ''
      AND `test_artifact_id` = ''
      AND `test_artifact_sha256` = ''
    )
    OR (
      `status` = 'blocked'
      AND length(`restore_sha256`) = 64
      AND trim(`test_artifact_id`) <> ''
      AND length(`test_artifact_sha256`) = 64
      AND datetime(`tested_at`) IS NOT NULL
      AND datetime(`tested_at`) <= datetime(`created_at`)
      AND `approved_at` = ''
    )
    OR (
      `status` = 'failed'
      AND length(`restore_sha256`) = 64
      AND trim(`test_artifact_id`) <> ''
      AND length(`test_artifact_sha256`) = 64
      AND datetime(`tested_at`) IS NOT NULL
      AND datetime(`tested_at`) <= datetime(`created_at`)
      AND `approved_at` = ''
    )
    OR (
      `status` IN ('passed', 'rejected')
      AND length(`restore_sha256`) = 64
      AND trim(`test_artifact_id`) <> ''
      AND length(`test_artifact_sha256`) = 64
      AND datetime(`tested_at`) IS NOT NULL
      AND datetime(`approved_at`) IS NOT NULL
      AND datetime(`approved_at`) >= datetime(`tested_at`)
      AND datetime(`approved_at`) <= datetime(`created_at`)
      AND `created_by_uid` = `independent_approver_uid`
    )
  )
);
CREATE UNIQUE INDEX `compliance_field_custody_acceptance_request_idx`
  ON `compliance_field_custody_acceptance_records`
  (`organisation_id`, `client_request_id`);
CREATE INDEX `compliance_field_custody_acceptance_evidence_idx`
  ON `compliance_field_custody_acceptance_records`
  (`organisation_id`, `evidence_id`, `created_at`, `id`);
CREATE INDEX `compliance_field_custody_acceptance_status_idx`
  ON `compliance_field_custody_acceptance_records`
  (`organisation_id`, `status`, `platform`, `created_at`, `id`);
