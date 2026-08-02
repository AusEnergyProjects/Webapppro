DROP TRIGGER IF EXISTS `compliance_parallel_reconciliation_runs_parent_guard`;
DROP TRIGGER IF EXISTS `compliance_parallel_reconciliation_runs_reference_guard`;
DROP TRIGGER IF EXISTS `compliance_parallel_reconciliation_runs_immutable`;
DROP TRIGGER IF EXISTS `compliance_parallel_reconciliation_runs_no_delete`;
DROP TRIGGER IF EXISTS `compliance_parallel_reconciliation_runs_audit`;
DROP TRIGGER IF EXISTS `compliance_parallel_reconciliation_rows_parent_guard`;
DROP TRIGGER IF EXISTS `compliance_parallel_reconciliation_rows_immutable`;
DROP TRIGGER IF EXISTS `compliance_parallel_reconciliation_rows_no_delete`;

ALTER TABLE `compliance_parallel_reconciliation_runs`
  RENAME TO `compliance_parallel_reconciliation_runs_legacy_0108`;

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
  `calculator_engine_receipt_id` text DEFAULT '' NOT NULL,
  `calculator_engine_contract_hash` text DEFAULT '' NOT NULL CHECK (
    `calculator_engine_contract_hash` = ''
    OR (
      length(`calculator_engine_contract_hash`) = 71
      AND `calculator_engine_contract_hash` GLOB 'sha256:*'
      AND lower(substr(`calculator_engine_contract_hash`, 8))
        NOT GLOB '*[^0-9a-f]*'
    )
  ),
  `calculator_suite_receipt_hash` text DEFAULT '' NOT NULL CHECK (
    `calculator_suite_receipt_hash` = ''
    OR (
      length(`calculator_suite_receipt_hash`) = 71
      AND `calculator_suite_receipt_hash` GLOB 'sha256:*'
      AND lower(substr(`calculator_suite_receipt_hash`, 8))
        NOT GLOB '*[^0-9a-f]*'
    )
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
      `comparison_scope` IN (
        'verified_output_hash_vs_manual_reference_non_evidentiary',
        'verified_output_hash_vs_dataforce_staged_row_non_evidentiary'
      )
    ),
  `reference_origin` text DEFAULT 'caller_supplied' NOT NULL CHECK (
    `reference_origin` IN ('caller_supplied', 'dataforce_staged_row')
  ),
  `reference_scope` text DEFAULT 'manual_reference_non_evidentiary' NOT NULL CHECK (
    `reference_scope` IN (
      'manual_reference_non_evidentiary',
      'dataforce_certificate_quantity_non_evidentiary'
    )
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
  CHECK (`row_count` = `matched_count` + `mismatched_count`),
  CHECK (
    (
      `comparison_scope` =
        'verified_output_hash_vs_manual_reference_non_evidentiary'
      AND `reference_origin` = 'caller_supplied'
      AND `reference_scope` = 'manual_reference_non_evidentiary'
    )
    OR (
      `comparison_scope` =
        'verified_output_hash_vs_dataforce_staged_row_non_evidentiary'
      AND `reference_origin` = 'dataforce_staged_row'
      AND `reference_scope` =
        'dataforce_certificate_quantity_non_evidentiary'
      AND trim(`calculator_engine_receipt_id`) <> ''
      AND trim(`calculator_engine_contract_hash`) <> ''
      AND trim(`calculator_suite_receipt_hash`) <> ''
    )
  )
);

INSERT INTO `compliance_parallel_reconciliation_runs` (
  `id`,
  `organisation_id`,
  `client_request_id`,
  `request_sha256`,
  `activity_version_id`,
  `activity_version_number`,
  `activity_publication_snapshot_sha256`,
  `calculator_version_id`,
  `calculator_version_number`,
  `calculator_official_source_sha256`,
  `golden_vector_status`,
  `golden_vector_count`,
  `golden_vector_suite_sha256`,
  `calculator_engine_receipt_id`,
  `calculator_engine_contract_hash`,
  `calculator_suite_receipt_hash`,
  `mapping_artifact_id`,
  `mapping_version`,
  `mapping_artifact_sha256`,
  `comparison_scope`,
  `reference_origin`,
  `reference_scope`,
  `status`,
  `row_count`,
  `matched_count`,
  `mismatched_count`,
  `external_submission_enabled`,
  `certificate_creation_enabled`,
  `run_by_uid`,
  `run_at`
)
SELECT
  `id`,
  `organisation_id`,
  `client_request_id`,
  `request_sha256`,
  `activity_version_id`,
  `activity_version_number`,
  `activity_publication_snapshot_sha256`,
  `calculator_version_id`,
  `calculator_version_number`,
  `calculator_official_source_sha256`,
  `golden_vector_status`,
  `golden_vector_count`,
  `golden_vector_suite_sha256`,
  '',
  '',
  '',
  `mapping_artifact_id`,
  `mapping_version`,
  `mapping_artifact_sha256`,
  `comparison_scope`,
  'caller_supplied',
  'manual_reference_non_evidentiary',
  `status`,
  `row_count`,
  `matched_count`,
  `mismatched_count`,
  `external_submission_enabled`,
  `certificate_creation_enabled`,
  `run_by_uid`,
  `run_at`
FROM `compliance_parallel_reconciliation_runs_legacy_0108`;

DROP TABLE `compliance_parallel_reconciliation_runs_legacy_0108`;

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

CREATE TABLE `compliance_calculator_engine_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `calculator_version_id` text NOT NULL,
  `calculator_version_number` integer NOT NULL CHECK (
    `calculator_version_number` > 0
  ),
  `engine_contract_id` text NOT NULL CHECK (
    `engine_contract_id` =
      'creditex-fixed-decimal-engine-contract/base10-strings-v2'
  ),
  `engine_contract_hash` text NOT NULL CHECK (
    length(`engine_contract_hash`) = 71
    AND `engine_contract_hash` GLOB 'sha256:*'
    AND lower(substr(`engine_contract_hash`, 8))
      NOT GLOB '*[^0-9a-f]*'
  ),
  `golden_vector_suite_sha256` text NOT NULL CHECK (
    length(`golden_vector_suite_sha256`) = 64
    AND lower(`golden_vector_suite_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `engine_suite_hash` text NOT NULL CHECK (
    length(`engine_suite_hash`) = 71
    AND `engine_suite_hash` GLOB 'sha256:*'
    AND lower(substr(`engine_suite_hash`, 8))
      NOT GLOB '*[^0-9a-f]*'
  ),
  `suite_receipt_schema` text NOT NULL CHECK (
    `suite_receipt_schema` =
      'creditex-calculator-suite-receipt/v2'
  ),
  `suite_receipt_hash` text NOT NULL CHECK (
    length(`suite_receipt_hash`) = 71
    AND `suite_receipt_hash` GLOB 'sha256:*'
    AND lower(substr(`suite_receipt_hash`, 8))
      NOT GLOB '*[^0-9a-f]*'
  ),
  `vector_count` integer NOT NULL CHECK (
    `vector_count` > 0 AND `vector_count` <= 500
  ),
  `result` text NOT NULL CHECK (`result` = 'passed'),
  `executed_by_uid` text NOT NULL CHECK (trim(`executed_by_uid`) <> ''),
  `executed_at` text NOT NULL CHECK (datetime(`executed_at`) IS NOT NULL),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
CREATE UNIQUE INDEX `compliance_calculator_engine_receipts_exact_idx`
  ON `compliance_calculator_engine_receipts` (
    `organisation_id`,
    `calculator_version_id`,
    `engine_contract_hash`,
    `golden_vector_suite_sha256`,
    `engine_suite_hash`,
    `suite_receipt_hash`
  );
CREATE INDEX `compliance_calculator_engine_receipts_calculator_idx`
  ON `compliance_calculator_engine_receipts` (
    `organisation_id`,
    `calculator_version_id`,
    `executed_at`,
    `id`
  );

CREATE TABLE `compliance_parallel_reference_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `run_id` text NOT NULL,
  `parallel_row_id` text NOT NULL,
  `mapping_artifact_id` text NOT NULL,
  `mapping_version` text NOT NULL CHECK (trim(`mapping_version`) <> ''),
  `mapping_artifact_sha256` text NOT NULL CHECK (
    length(`mapping_artifact_sha256`) = 64
    AND lower(`mapping_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `transformation_contract` text DEFAULT
    'dataforce-jobs-v1:certificate-quantity-v1'
    NOT NULL CHECK (
      `transformation_contract` =
        'dataforce-jobs-v1:certificate-quantity-v1'
    ),
  `legacy_batch_id` text NOT NULL,
  `legacy_batch_content_sha256` text NOT NULL CHECK (
    length(`legacy_batch_content_sha256`) = 64
    AND lower(`legacy_batch_content_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `legacy_import_row_id` text NOT NULL,
  `legacy_row_number` integer NOT NULL CHECK (`legacy_row_number` > 1),
  `legacy_row_sha256` text NOT NULL CHECK (
    length(`legacy_row_sha256`) = 64
    AND lower(`legacy_row_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `dataforce_app_id` text DEFAULT '' NOT NULL,
  `dataforce_job_id` text NOT NULL CHECK (trim(`dataforce_job_id`) <> ''),
  `tlink_case_id` text NOT NULL CHECK (trim(`tlink_case_id`) <> ''),
  `tlink_work_order_id` text NOT NULL CHECK (
    trim(`tlink_work_order_id`) <> ''
  ),
  `tlink_work_number` text NOT NULL CHECK (
    trim(`tlink_work_number`) <> ''
  ),
  `identity_match_basis` text NOT NULL CHECK (
    `identity_match_basis` IN ('job_id', 'app_id_and_job_id')
  ),
  `reference_snapshot` text NOT NULL CHECK (
    json_valid(`reference_snapshot`)
    AND json_type(`reference_snapshot`, '$.certificateQuantity')
      IN ('integer', 'real')
  ),
  `reference_sha256` text NOT NULL CHECK (
    length(`reference_sha256`) = 64
    AND lower(`reference_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `evidence_use` text DEFAULT 'non_evidentiary' NOT NULL CHECK (
    `evidence_use` = 'non_evidentiary'
  ),
  `external_submission_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `external_submission_enabled` = 0
  ),
  `certificate_creation_enabled` integer DEFAULT 0 NOT NULL CHECK (
    `certificate_creation_enabled` = 0
  ),
  `created_by_uid` text NOT NULL CHECK (trim(`created_by_uid`) <> ''),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
CREATE UNIQUE INDEX `compliance_parallel_reference_bindings_run_row_idx`
  ON `compliance_parallel_reference_bindings`
  (`run_id`, `parallel_row_id`);
CREATE UNIQUE INDEX `compliance_parallel_reference_bindings_run_legacy_idx`
  ON `compliance_parallel_reference_bindings`
  (`run_id`, `legacy_import_row_id`);
CREATE INDEX `compliance_parallel_reference_bindings_org_source_idx`
  ON `compliance_parallel_reference_bindings`
  (`organisation_id`, `legacy_batch_id`, `legacy_import_row_id`);
