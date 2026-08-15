-- Sites-safe migration: complex trigger guards are installed through
-- src/lib/creditex-work-pack-schema-guards.ts using one prepared statement per guard.
-- 0146: exact, independently reviewed SRES certificate-activation evidence.
-- Provider acceptance remains a post-submission output-action receipt and is
-- deliberately not represented by these preparation-time records.
CREATE TABLE `compliance_sres_activation_records` (
  `id` text PRIMARY KEY NOT NULL,
  `client_request_id` text NOT NULL,
  `organisation_id` text NOT NULL,
  `program_code` text NOT NULL,
  `activity_template_id` text NOT NULL,
  `case_id` text DEFAULT '' NOT NULL,
  `evidence_kind` text NOT NULL,
  `subject_key` text NOT NULL,
  `result_code` text NOT NULL,
  `source_artifact_id` text NOT NULL,
  `source_artifact_sha256` text NOT NULL,
  `source_record_key` text NOT NULL,
  `response_contract` text NOT NULL,
  `response_snapshot` text NOT NULL,
  `response_sha256` text NOT NULL,
  `effective_from` text NOT NULL,
  `effective_to` text DEFAULT '' NOT NULL,
  `observed_at` text NOT NULL,
  `valid_until` text DEFAULT '' NOT NULL,
  `supersedes_record_id` text DEFAULT '' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_actor_kind` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_sres_activation_record_identity_check` CHECK (
    trim(`id`) <> ''
    AND length(trim(`client_request_id`)) BETWEEN 8 AND 240
    AND trim(`organisation_id`) <> ''
    AND `program_code` = 'SRES'
    AND trim(`activity_template_id`) <> ''
    AND trim(`subject_key`) <> ''
    AND length(`subject_key`) <= 240
    AND trim(`source_artifact_id`) <> ''
    AND length(`source_artifact_sha256`) = 64
    AND lower(`source_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `source_artifact_sha256` = lower(`source_artifact_sha256`)
    AND trim(`source_record_key`) <> ''
    AND length(`source_record_key`) <= 500
    AND trim(`response_contract`) <> ''
    AND json_valid(`response_snapshot`)
    AND json_type(`response_snapshot`) = 'object'
    AND length(`response_snapshot`) <= 262144
    AND length(`response_sha256`) = 71
    AND substr(`response_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`response_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `response_sha256` = lower(`response_sha256`)
    AND date(`effective_from`) = `effective_from`
    AND (
      `effective_to` = '' OR (
        date(`effective_to`) = `effective_to`
        AND `effective_to` >= `effective_from`
      )
    )
    AND datetime(`observed_at`) IS NOT NULL
    AND (
      `valid_until` = '' OR (
        datetime(`valid_until`) IS NOT NULL
        AND datetime(`valid_until`) >= datetime(`observed_at`)
      )
    )
    AND trim(`created_by_uid`) <> ''
    AND `created_actor_kind` IN ('compliance', 'admin')
    AND datetime(`created_at`) IS NOT NULL
    AND datetime(`created_at`) >= datetime(`observed_at`)
  ),
  CONSTRAINT `compliance_sres_activation_record_kind_check` CHECK (
    (`evidence_kind` = 'rec_registry_submission_contract'
      AND `response_contract` =
        'creditex-sres-rec-registry-submission-contract/v1'
      AND `result_code` IN (
        'manual_submission_contract_current',
        'adapter_submission_contract_current', 'superseded'
      ))
    OR (`evidence_kind` = 'declaration_snapshot'
      AND `response_contract` = 'creditex-sres-declaration-snapshot/v1'
      AND `result_code` IN ('current', 'superseded'))
    OR (`evidence_kind` = 'component_recall_status'
      AND `response_contract` = 'creditex-sres-component-recall-status/v1'
      AND `result_code` IN ('listed_not_removed', 'recalled_or_removed'))
    OR (`evidence_kind` = 'calculator_vector_suite'
      AND `response_contract` = 'creditex-sres-calculator-vector-suite/v1'
      AND `result_code` IN ('passed', 'failed'))
    OR (`evidence_kind` = 'registered_agent_assignment'
      AND `response_contract` =
        'creditex-sres-registered-agent-assignment/v1'
      AND `result_code` IN (
        'verified_assigned', 'suspended_or_unverified'
      ))
    OR (`evidence_kind` = 'component_eligibility'
      AND `response_contract` = 'creditex-sres-component-eligibility/v1'
      AND `result_code` IN ('eligible', 'ineligible'))
    OR (`evidence_kind` IN (
        'installer_accreditation', 'designer_accreditation'
      )
      AND `response_contract` = 'creditex-sres-accreditation-status/v1'
      AND `result_code` IN ('active', 'inactive'))
  ),
  CONSTRAINT `compliance_sres_activation_record_response_check` CHECK (
    json_extract(`response_snapshot`, '$.contract') = `response_contract`
    AND json_extract(`response_snapshot`, '$.programCode') = `program_code`
    AND json_extract(`response_snapshot`, '$.activityTemplateId') =
      `activity_template_id`
    AND json_extract(`response_snapshot`, '$.caseId') = `case_id`
    AND json_extract(`response_snapshot`, '$.evidenceKind') = `evidence_kind`
    AND json_extract(`response_snapshot`, '$.subjectKey') = `subject_key`
    AND json_extract(`response_snapshot`, '$.resultCode') = `result_code`
    AND json_extract(`response_snapshot`, '$.sourceArtifactId') =
      `source_artifact_id`
    AND json_extract(`response_snapshot`, '$.sourceArtifactSha256') =
      `source_artifact_sha256`
    AND json_extract(`response_snapshot`, '$.sourceRecordKey') =
      `source_record_key`
    AND json_extract(`response_snapshot`, '$.effectiveFrom') = `effective_from`
    AND json_extract(`response_snapshot`, '$.effectiveTo') = `effective_to`
    AND json_extract(`response_snapshot`, '$.observedAt') = `observed_at`
    AND json_extract(`response_snapshot`, '$.validUntil') = `valid_until`
    AND COALESCE(
      json_extract(`response_snapshot`, '$.supersedesRecordId'), ''
    ) = `supersedes_record_id`
  )
);

CREATE UNIQUE INDEX `compliance_sres_activation_request_idx`
  ON `compliance_sres_activation_records`
    (`organisation_id`, `client_request_id`);

CREATE UNIQUE INDEX `compliance_sres_activation_successor_idx`
  ON `compliance_sres_activation_records` (`supersedes_record_id`)
  WHERE `supersedes_record_id` <> '';

CREATE INDEX `compliance_sres_activation_scope_idx`
  ON `compliance_sres_activation_records`
    (`organisation_id`, `program_code`, `activity_template_id`, `case_id`,
      `evidence_kind`, `effective_from`, `effective_to`, `created_at`, `id`);

CREATE TABLE `compliance_sres_activation_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `activation_record_id` text NOT NULL,
  `response_sha256` text NOT NULL,
  `source_artifact_id` text NOT NULL,
  `source_artifact_sha256` text NOT NULL,
  `decision` text NOT NULL CHECK (`decision` IN ('approved', 'rejected')),
  `reviewed_by_uid` text NOT NULL,
  `reviewed_actor_kind` text NOT NULL,
  `review_note` text NOT NULL,
  `reviewed_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_sres_activation_review_check` CHECK (
    trim(`id`) <> ''
    AND trim(`organisation_id`) <> ''
    AND trim(`activation_record_id`) <> ''
    AND length(`response_sha256`) = 71
    AND substr(`response_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`response_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND length(`source_artifact_sha256`) = 64
    AND lower(`source_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND trim(`reviewed_by_uid`) <> ''
    AND `reviewed_actor_kind` IN ('compliance', 'admin')
    AND length(trim(`review_note`)) BETWEEN 10 AND 2000
    AND datetime(`reviewed_at`) IS NOT NULL
    AND `created_at` = `reviewed_at`
  )
);

CREATE UNIQUE INDEX `compliance_sres_activation_review_record_idx`
  ON `compliance_sres_activation_reviews`
    (`organisation_id`, `activation_record_id`);

CREATE TABLE `compliance_sres_activation_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `client_request_id` text NOT NULL,
  `organisation_id` text NOT NULL,
  `program_code` text NOT NULL,
  `activity_template_id` text NOT NULL,
  `case_id` text NOT NULL,
  `activity_date` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `snapshot_sha256` text NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_actor_kind` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_sres_activation_snapshot_check` CHECK (
    trim(`id`) <> ''
    AND length(trim(`client_request_id`)) BETWEEN 8 AND 240
    AND trim(`organisation_id`) <> ''
    AND `program_code` = 'SRES'
    AND trim(`activity_template_id`) <> ''
    AND trim(`case_id`) <> ''
    AND date(`activity_date`) = `activity_date`
    AND json_valid(`snapshot_json`)
    AND json_type(`snapshot_json`) = 'object'
    AND length(`snapshot_json`) <= 262144
    AND length(`snapshot_sha256`) = 71
    AND substr(`snapshot_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`snapshot_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `snapshot_sha256` = lower(`snapshot_sha256`)
    AND trim(`created_by_uid`) <> ''
    AND `created_actor_kind` IN ('compliance', 'admin')
    AND datetime(`created_at`) IS NOT NULL
    AND json_extract(`snapshot_json`, '$.contract') =
      'creditex-sres-certificate-activation-evidence/v1'
    AND json_extract(`snapshot_json`, '$.snapshotId') = `id`
    AND json_extract(`snapshot_json`, '$.programCode') = `program_code`
    AND json_extract(`snapshot_json`, '$.activityTemplateId') =
      `activity_template_id`
    AND json_extract(`snapshot_json`, '$.caseId') = `case_id`
    AND json_extract(`snapshot_json`, '$.activityDate') = `activity_date`
    AND json_type(`snapshot_json`, '$.records') = 'array'
    AND json_array_length(json_extract(`snapshot_json`, '$.records')) = 8
  )
);

CREATE UNIQUE INDEX `compliance_sres_activation_snapshot_request_idx`
  ON `compliance_sres_activation_snapshots`
    (`organisation_id`, `client_request_id`);

CREATE UNIQUE INDEX `compliance_sres_activation_snapshot_scope_idx`
  ON `compliance_sres_activation_snapshots`
    (`organisation_id`, `activity_template_id`, `case_id`, `snapshot_sha256`);
