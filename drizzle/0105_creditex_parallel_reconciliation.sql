CREATE TABLE `compliance_legacy_mapping_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `legacy_system_key` text NOT NULL CHECK (
    trim(`legacy_system_key`) <> ''
    AND length(`legacy_system_key`) <= 120
  ),
  `mapping_version` text NOT NULL CHECK (
    trim(`mapping_version`) <> ''
    AND length(`mapping_version`) <= 120
  ),
  `artifact_format` text NOT NULL CHECK (
    `artifact_format` IN ('json', 'csv')
  ),
  `object_key` text NOT NULL CHECK (trim(`object_key`) <> ''),
  `artifact_sha256` text NOT NULL CHECK (
    length(`artifact_sha256`) = 64
    AND lower(`artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `authorization_state` text DEFAULT 'draft' NOT NULL CHECK (
    `authorization_state` IN ('draft', 'approved', 'withdrawn')
  ),
  `authorization_basis` text DEFAULT '' NOT NULL,
  `requested_by_uid` text NOT NULL CHECK (trim(`requested_by_uid`) <> ''),
  `primary_authorizer_uid` text DEFAULT '' NOT NULL,
  `secondary_authorizer_uid` text DEFAULT '' NOT NULL,
  `authorized_at` text DEFAULT '' NOT NULL,
  `withdrawn_by_uid` text DEFAULT '' NOT NULL,
  `withdrawn_at` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  CHECK (
    (
      `authorization_state` = 'draft'
      AND `authorization_basis` = ''
      AND `primary_authorizer_uid` = ''
      AND `secondary_authorizer_uid` = ''
      AND `authorized_at` = ''
      AND `withdrawn_by_uid` = ''
      AND `withdrawn_at` = ''
    )
    OR (
      `authorization_state` = 'approved'
      AND trim(`authorization_basis`) <> ''
      AND trim(`primary_authorizer_uid`) <> ''
      AND trim(`secondary_authorizer_uid`) <> ''
      AND `requested_by_uid` <> `primary_authorizer_uid`
      AND `requested_by_uid` <> `secondary_authorizer_uid`
      AND `primary_authorizer_uid` <> `secondary_authorizer_uid`
      AND datetime(`authorized_at`) IS NOT NULL
      AND `withdrawn_by_uid` = ''
      AND `withdrawn_at` = ''
    )
    OR (
      `authorization_state` = 'withdrawn'
      AND trim(`authorization_basis`) <> ''
      AND trim(`primary_authorizer_uid`) <> ''
      AND trim(`secondary_authorizer_uid`) <> ''
      AND `requested_by_uid` <> `primary_authorizer_uid`
      AND `requested_by_uid` <> `secondary_authorizer_uid`
      AND `primary_authorizer_uid` <> `secondary_authorizer_uid`
      AND datetime(`authorized_at`) IS NOT NULL
      AND trim(`withdrawn_by_uid`) <> ''
      AND datetime(`withdrawn_at`) IS NOT NULL
    )
  )
);
CREATE UNIQUE INDEX `compliance_legacy_mapping_artifacts_version_idx`
  ON `compliance_legacy_mapping_artifacts`
  (`organisation_id`, `legacy_system_key`, `mapping_version`);
CREATE INDEX `compliance_legacy_mapping_artifacts_state_idx`
  ON `compliance_legacy_mapping_artifacts`
  (`organisation_id`, `authorization_state`, `created_at`, `id`);

CREATE TABLE `compliance_parallel_reconciliation_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `client_request_id` text NOT NULL CHECK (
    length(`client_request_id`) BETWEEN 8 AND 120
  ),
  `request_sha256` text NOT NULL CHECK (
    length(`request_sha256`) = 64
    AND lower(`request_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `activity_version_id` text NOT NULL,
  `activity_version_number` integer NOT NULL CHECK (
    `activity_version_number` > 0
  ),
  `activity_publication_snapshot_sha256` text NOT NULL CHECK (
    length(`activity_publication_snapshot_sha256`) = 64
    AND lower(`activity_publication_snapshot_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `calculator_version_id` text NOT NULL,
  `calculator_version_number` integer NOT NULL CHECK (
    `calculator_version_number` > 0
  ),
  `calculator_official_source_sha256` text NOT NULL CHECK (
    length(`calculator_official_source_sha256`) = 64
    AND lower(`calculator_official_source_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `golden_vector_status` text NOT NULL CHECK (
    `golden_vector_status` = 'passed'
  ),
  `golden_vector_count` integer NOT NULL CHECK (
    `golden_vector_count` > 0
  ),
  `golden_vector_suite_sha256` text NOT NULL CHECK (
    length(`golden_vector_suite_sha256`) = 64
    AND lower(`golden_vector_suite_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `mapping_artifact_id` text NOT NULL,
  `mapping_version` text NOT NULL CHECK (trim(`mapping_version`) <> ''),
  `mapping_artifact_sha256` text NOT NULL CHECK (
    length(`mapping_artifact_sha256`) = 64
    AND lower(`mapping_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `comparison_scope` text DEFAULT
    'verified_output_hash_vs_manual_reference_non_evidentiary'
    NOT NULL CHECK (
      `comparison_scope` =
        'verified_output_hash_vs_manual_reference_non_evidentiary'
    ),
  `status` text DEFAULT 'dry_run_completed' NOT NULL CHECK (
    `status` = 'dry_run_completed'
  ),
  `row_count` integer NOT NULL CHECK (
    `row_count` > 0 AND `row_count` <= 250
  ),
  `matched_count` integer NOT NULL CHECK (`matched_count` >= 0),
  `mismatched_count` integer NOT NULL CHECK (`mismatched_count` >= 0),
  `external_submission_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `external_submission_enabled` = 0
  ),
  `certificate_creation_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `certificate_creation_enabled` = 0
  ),
  `run_by_uid` text NOT NULL CHECK (trim(`run_by_uid`) <> ''),
  `run_at` text NOT NULL CHECK (datetime(`run_at`) IS NOT NULL),
  CHECK (`row_count` = `matched_count` + `mismatched_count`)
);
CREATE UNIQUE INDEX `compliance_parallel_reconciliation_runs_org_request_idx`
  ON `compliance_parallel_reconciliation_runs`
  (`organisation_id`, `client_request_id`);
CREATE INDEX `compliance_parallel_reconciliation_runs_org_time_idx`
  ON `compliance_parallel_reconciliation_runs`
  (`organisation_id`, `run_at`, `id`);
CREATE INDEX `compliance_parallel_reconciliation_runs_governed_inputs_idx`
  ON `compliance_parallel_reconciliation_runs`
  (
    `organisation_id`,
    `activity_version_id`,
    `calculator_version_id`,
    `mapping_artifact_id`,
    `run_at`
  );

CREATE TABLE `compliance_parallel_reconciliation_rows` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `run_id` text NOT NULL,
  `row_number` integer NOT NULL CHECK (
    `row_number` > 0 AND `row_number` <= 250
  ),
  `case_id` text NOT NULL,
  `case_revision` integer NOT NULL CHECK (`case_revision` > 0),
  `case_snapshot_sha256` text NOT NULL CHECK (
    length(`case_snapshot_sha256`) = 64
    AND lower(`case_snapshot_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `calculation_run_id` text NOT NULL,
  `input_sha256` text NOT NULL CHECK (
    length(`input_sha256`) = 64
    AND lower(`input_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `output_sha256` text NOT NULL CHECK (
    length(`output_sha256`) = 64
    AND lower(`output_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `reference_sha256` text NOT NULL CHECK (
    length(`reference_sha256`) = 64
    AND lower(`reference_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `result` text NOT NULL CHECK (
    (`result` = 'matched' AND `output_sha256` = `reference_sha256`)
    OR
    (`result` = 'mismatched' AND `output_sha256` <> `reference_sha256`)
  ),
  `external_submission_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `external_submission_enabled` = 0
  ),
  `certificate_creation_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `certificate_creation_enabled` = 0
  ),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
CREATE UNIQUE INDEX `compliance_parallel_reconciliation_rows_run_row_idx`
  ON `compliance_parallel_reconciliation_rows`
  (`run_id`, `row_number`);
CREATE UNIQUE INDEX `compliance_parallel_reconciliation_rows_run_case_idx`
  ON `compliance_parallel_reconciliation_rows`
  (`run_id`, `case_id`);
CREATE INDEX `compliance_parallel_reconciliation_rows_org_result_idx`
  ON `compliance_parallel_reconciliation_rows`
  (`organisation_id`, `run_id`, `result`, `row_number`);
