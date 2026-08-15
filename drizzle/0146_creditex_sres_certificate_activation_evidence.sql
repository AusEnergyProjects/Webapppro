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

CREATE TRIGGER `compliance_sres_activation_record_insert_guard`
BEFORE INSERT ON `compliance_sres_activation_records`
BEGIN
  SELECT CASE WHEN NOT (
    NEW.`created_actor_kind` = 'compliance' AND EXISTS (
      SELECT 1 FROM `compliance_users` member
      WHERE member.`organisation_id` = NEW.`organisation_id`
        AND member.`firebase_uid` = NEW.`created_by_uid`
        AND member.`status` = 'active'
        AND member.`role` IN ('admin', 'case_manager', 'reviewer')
        AND member.`governance_identity_verified` = 1
    )
    OR NEW.`created_actor_kind` = 'admin' AND EXISTS (
      SELECT 1 FROM `admin_users` administrator
      JOIN `compliance_organisations` organisation
        ON organisation.`id` = NEW.`organisation_id`
        AND organisation.`organisation_code` = 'CREDITEX-AU'
        AND organisation.`status` = 'active'
      WHERE administrator.`firebase_uid` = NEW.`created_by_uid`
        AND administrator.`status` = 'active'
        AND administrator.`role` IN ('owner', 'admin')
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_AUTHOR_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `compliance_activity_versions` activity
    JOIN `compliance_programs` program
      ON program.`id` = activity.`program_id`
      AND program.`organisation_id` = NEW.`organisation_id`
      AND program.`program_code` = 'SRES'
    WHERE activity.`id` = (
      SELECT version.`activity_version_id`
      FROM `compliance_activity_work_pack_versions` version
      WHERE version.`organisation_id` = NEW.`organisation_id`
        AND version.`activity_template_id` = NEW.`activity_template_id`
      ORDER BY version.`version` DESC LIMIT 1
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_ACTIVITY_INVALID') END;
  SELECT CASE WHEN NEW.`case_id` <> '' AND NOT EXISTS (
    SELECT 1 FROM `compliance_cases` compliance_case
    JOIN `compliance_activity_versions` activity
      ON activity.`id` = compliance_case.`activity_version_id`
    JOIN `compliance_activity_work_pack_versions` version
      ON version.`activity_version_id` = activity.`id`
      AND version.`organisation_id` = compliance_case.`organisation_id`
      AND version.`activity_template_id` = NEW.`activity_template_id`
    WHERE compliance_case.`id` = NEW.`case_id`
      AND compliance_case.`organisation_id` = NEW.`organisation_id`
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_CASE_INVALID') END;
  SELECT CASE WHEN NEW.`evidence_kind` IN (
      'component_recall_status', 'registered_agent_assignment',
      'component_eligibility', 'installer_accreditation',
      'designer_accreditation'
    ) AND NEW.`case_id` = ''
    THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_CASE_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `compliance_official_source_artifacts` artifact
    JOIN `compliance_official_source_review_decisions` source_review
      ON source_review.`organisation_id` = artifact.`organisation_id`
      AND source_review.`subject_type` = 'artifact'
      AND source_review.`subject_id` = artifact.`id`
      AND source_review.`artifact_id` = artifact.`id`
      AND source_review.`artifact_sha256` = artifact.`sha256`
      AND source_review.`artifact_object_key` = artifact.`object_key`
      AND source_review.`decision` = 'approved'
    WHERE artifact.`id` = NEW.`source_artifact_id`
      AND artifact.`organisation_id` = NEW.`organisation_id`
      AND artifact.`sha256` = NEW.`source_artifact_sha256`
      AND NOT EXISTS (
        SELECT 1 FROM `compliance_official_source_review_decisions` successor
        WHERE successor.`supersedes_decision_id` = source_review.`id`
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_SOURCE_INVALID') END;
  SELECT CASE WHEN NEW.`supersedes_record_id` <> '' AND NOT EXISTS (
    SELECT 1 FROM `compliance_sres_activation_records` prior
    WHERE prior.`id` = NEW.`supersedes_record_id`
      AND prior.`organisation_id` = NEW.`organisation_id`
      AND prior.`program_code` = NEW.`program_code`
      AND prior.`activity_template_id` = NEW.`activity_template_id`
      AND prior.`case_id` = NEW.`case_id`
      AND prior.`evidence_kind` = NEW.`evidence_kind`
      AND prior.`subject_key` = NEW.`subject_key`
      AND datetime(NEW.`created_at`) >= datetime(prior.`created_at`)
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_SUPERSESSION_INVALID') END;
END;

CREATE TRIGGER `compliance_sres_activation_record_update_guard`
BEFORE UPDATE ON `compliance_sres_activation_records`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_RECORD_IMMUTABLE');
END;
CREATE TRIGGER `compliance_sres_activation_record_delete_guard`
BEFORE DELETE ON `compliance_sres_activation_records`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_RECORD_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_sres_activation_review_insert_guard`
BEFORE INSERT ON `compliance_sres_activation_reviews`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `compliance_sres_activation_records` record
    WHERE record.`id` = NEW.`activation_record_id`
      AND record.`organisation_id` = NEW.`organisation_id`
      AND record.`response_sha256` = NEW.`response_sha256`
      AND record.`source_artifact_id` = NEW.`source_artifact_id`
      AND record.`source_artifact_sha256` = NEW.`source_artifact_sha256`
      AND record.`created_by_uid` <> NEW.`reviewed_by_uid`
      AND datetime(NEW.`reviewed_at`) >= datetime(record.`created_at`)
      AND NOT EXISTS (
        SELECT 1 FROM `compliance_sres_activation_records` successor
        WHERE successor.`supersedes_record_id` = record.`id`
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_REVIEW_BINDING_INVALID') END;
  SELECT CASE WHEN NOT (
    NEW.`reviewed_actor_kind` = 'compliance' AND EXISTS (
      SELECT 1 FROM `compliance_users` reviewer
      WHERE reviewer.`organisation_id` = NEW.`organisation_id`
        AND reviewer.`firebase_uid` = NEW.`reviewed_by_uid`
        AND reviewer.`status` = 'active'
        AND reviewer.`role` IN ('admin', 'reviewer')
        AND reviewer.`governance_identity_verified` = 1
        AND trim(reviewer.`governance_identity_verified_by_uid`) <> ''
        AND reviewer.`governance_identity_verified_by_uid` <>
          reviewer.`firebase_uid`
    )
    OR NEW.`reviewed_actor_kind` = 'admin' AND EXISTS (
      SELECT 1 FROM `admin_users` reviewer
      JOIN `compliance_organisations` organisation
        ON organisation.`id` = NEW.`organisation_id`
        AND organisation.`organisation_code` = 'CREDITEX-AU'
        AND organisation.`status` = 'active'
      WHERE reviewer.`firebase_uid` = NEW.`reviewed_by_uid`
        AND reviewer.`status` = 'active'
        AND reviewer.`role` IN ('owner', 'admin', 'reviewer')
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_REVIEWER_INVALID') END;
END;

CREATE TRIGGER `compliance_sres_activation_review_update_guard`
BEFORE UPDATE ON `compliance_sres_activation_reviews`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_REVIEW_IMMUTABLE');
END;
CREATE TRIGGER `compliance_sres_activation_review_delete_guard`
BEFORE DELETE ON `compliance_sres_activation_reviews`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_REVIEW_DELETE_BLOCKED');
END;

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

CREATE TRIGGER `compliance_sres_activation_snapshot_insert_guard`
BEFORE INSERT ON `compliance_sres_activation_snapshots`
BEGIN
  SELECT CASE WHEN NOT (
    NEW.`created_actor_kind` = 'compliance' AND EXISTS (
      SELECT 1 FROM `compliance_users` member
      WHERE member.`organisation_id` = NEW.`organisation_id`
        AND member.`firebase_uid` = NEW.`created_by_uid`
        AND member.`status` = 'active'
        AND member.`role` IN ('admin', 'case_manager', 'reviewer')
        AND member.`governance_identity_verified` = 1
    )
    OR NEW.`created_actor_kind` = 'admin' AND EXISTS (
      SELECT 1 FROM `admin_users` administrator
      JOIN `compliance_organisations` organisation
        ON organisation.`id` = NEW.`organisation_id`
        AND organisation.`organisation_code` = 'CREDITEX-AU'
        AND organisation.`status` = 'active'
      WHERE administrator.`firebase_uid` = NEW.`created_by_uid`
        AND administrator.`status` = 'active'
        AND administrator.`role` IN ('owner', 'admin')
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_SNAPSHOT_AUTHOR_INVALID') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.`snapshot_json`, '$.records') evidence
    WHERE NOT EXISTS (
      SELECT 1
      FROM `compliance_sres_activation_records` record
      JOIN `compliance_sres_activation_reviews` review
        ON review.`organisation_id` = record.`organisation_id`
        AND review.`activation_record_id` = record.`id`
        AND review.`response_sha256` = record.`response_sha256`
        AND review.`source_artifact_id` = record.`source_artifact_id`
        AND review.`source_artifact_sha256` = record.`source_artifact_sha256`
        AND review.`decision` = 'approved'
      JOIN `compliance_official_source_artifacts` artifact
        ON artifact.`id` = record.`source_artifact_id`
        AND artifact.`organisation_id` = record.`organisation_id`
        AND artifact.`sha256` = record.`source_artifact_sha256`
      JOIN `compliance_official_source_review_decisions` source_review
        ON source_review.`organisation_id` = artifact.`organisation_id`
        AND source_review.`subject_type` = 'artifact'
        AND source_review.`subject_id` = artifact.`id`
        AND source_review.`artifact_id` = artifact.`id`
        AND source_review.`artifact_sha256` = artifact.`sha256`
        AND source_review.`artifact_object_key` = artifact.`object_key`
        AND source_review.`decision` = 'approved'
      WHERE record.`id` = json_extract(evidence.`value`, '$.recordId')
        AND record.`organisation_id` = NEW.`organisation_id`
        AND record.`program_code` = NEW.`program_code`
        AND record.`activity_template_id` = NEW.`activity_template_id`
        AND record.`case_id` IN ('', NEW.`case_id`)
        AND record.`evidence_kind` =
          json_extract(evidence.`value`, '$.evidenceKind')
        AND record.`subject_key` =
          json_extract(evidence.`value`, '$.subjectKey')
        AND record.`result_code` =
          json_extract(evidence.`value`, '$.resultCode')
        AND record.`source_artifact_id` =
          json_extract(evidence.`value`, '$.sourceArtifactId')
        AND record.`source_artifact_sha256` =
          json_extract(evidence.`value`, '$.sourceArtifactSha256')
        AND record.`response_sha256` =
          json_extract(evidence.`value`, '$.responseSha256')
        AND record.`source_record_key` =
          json_extract(evidence.`value`, '$.sourceRecordKey')
        AND record.`effective_from` =
          json_extract(evidence.`value`, '$.effectiveFrom')
        AND record.`effective_to` =
          json_extract(evidence.`value`, '$.effectiveTo')
        AND record.`observed_at` =
          json_extract(evidence.`value`, '$.observedAt')
        AND record.`valid_until` =
          json_extract(evidence.`value`, '$.validUntil')
        AND record.`supersedes_record_id` = COALESCE(
          json_extract(evidence.`value`, '$.supersedesRecordId'), ''
        )
        AND json_extract(evidence.`value`, '$.reviewed') = 1
        AND review.`id` = json_extract(evidence.`value`, '$.reviewId')
        AND review.`reviewed_by_uid` =
          json_extract(evidence.`value`, '$.reviewedByUid')
        AND review.`reviewed_at` =
          json_extract(evidence.`value`, '$.reviewedAt')
        AND record.`effective_from` <= NEW.`activity_date`
        AND (record.`effective_to` = ''
          OR record.`effective_to` >= NEW.`activity_date`)
        AND (record.`valid_until` = ''
          OR datetime(record.`valid_until`) >= datetime(NEW.`created_at`))
        AND datetime(NEW.`created_at`) >= datetime(review.`reviewed_at`)
        AND NOT EXISTS (
          SELECT 1 FROM `compliance_sres_activation_records` successor
          WHERE successor.`supersedes_record_id` = record.`id`
        )
        AND NOT EXISTS (
          SELECT 1 FROM `compliance_official_source_review_decisions` successor
          WHERE successor.`supersedes_decision_id` = source_review.`id`
        )
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_SNAPSHOT_RECORD_INVALID') END;
  SELECT CASE WHEN NOT (
    EXISTS (SELECT 1 FROM json_each(NEW.`snapshot_json`, '$.records') item
      WHERE json_extract(item.`value`, '$.evidenceKind') =
        'rec_registry_submission_contract'
      AND json_extract(item.`value`, '$.resultCode') IN (
        'manual_submission_contract_current',
        'adapter_submission_contract_current'
      ))
    AND EXISTS (SELECT 1 FROM json_each(NEW.`snapshot_json`, '$.records') item
      WHERE json_extract(item.`value`, '$.evidenceKind') =
        'declaration_snapshot'
      AND json_extract(item.`value`, '$.resultCode') = 'current')
    AND EXISTS (SELECT 1 FROM json_each(NEW.`snapshot_json`, '$.records') item
      WHERE json_extract(item.`value`, '$.evidenceKind') =
        'component_recall_status'
      AND json_extract(item.`value`, '$.resultCode') = 'listed_not_removed')
    AND EXISTS (SELECT 1 FROM json_each(NEW.`snapshot_json`, '$.records') item
      WHERE json_extract(item.`value`, '$.evidenceKind') =
        'calculator_vector_suite'
      AND json_extract(item.`value`, '$.resultCode') = 'passed')
    AND EXISTS (SELECT 1 FROM json_each(NEW.`snapshot_json`, '$.records') item
      WHERE json_extract(item.`value`, '$.evidenceKind') =
        'registered_agent_assignment'
      AND json_extract(item.`value`, '$.resultCode') = 'verified_assigned')
    AND EXISTS (SELECT 1 FROM json_each(NEW.`snapshot_json`, '$.records') item
      WHERE json_extract(item.`value`, '$.evidenceKind') =
        'component_eligibility'
      AND json_extract(item.`value`, '$.resultCode') = 'eligible')
    AND EXISTS (SELECT 1 FROM json_each(NEW.`snapshot_json`, '$.records') item
      WHERE json_extract(item.`value`, '$.evidenceKind') =
        'installer_accreditation'
      AND json_extract(item.`value`, '$.resultCode') = 'active')
    AND EXISTS (SELECT 1 FROM json_each(NEW.`snapshot_json`, '$.records') item
      WHERE json_extract(item.`value`, '$.evidenceKind') =
        'designer_accreditation'
      AND json_extract(item.`value`, '$.resultCode') = 'active')
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_SNAPSHOT_INCOMPLETE') END;
END;

CREATE TRIGGER `compliance_sres_activation_snapshot_update_guard`
BEFORE UPDATE ON `compliance_sres_activation_snapshots`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_SNAPSHOT_IMMUTABLE');
END;
CREATE TRIGGER `compliance_sres_activation_snapshot_delete_guard`
BEFORE DELETE ON `compliance_sres_activation_snapshots`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SRES_ACTIVATION_SNAPSHOT_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_sres_output_action_activation_guard`
BEFORE INSERT ON `compliance_output_action_packets`
WHEN NEW.`action_kind` = 'certificate_submission'
  AND NEW.`program_code` = 'SRES'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `compliance_sres_activation_snapshots` activation
    WHERE activation.`id` = json_extract(
      NEW.`packet_snapshot`, '$.programActivationEvidence.snapshotId'
    )
      AND activation.`organisation_id` = NEW.`organisation_id`
      AND activation.`program_code` = NEW.`program_code`
      AND activation.`activity_template_id` = NEW.`activity_template_id`
      AND activation.`case_id` = NEW.`compliance_case_id`
      AND activation.`snapshot_sha256` = json_extract(
        NEW.`packet_snapshot`, '$.programActivationEvidenceSha256'
      )
      AND activation.`snapshot_json` = json_extract(
        NEW.`packet_snapshot`, '$.programActivationEvidence'
      )
      AND datetime(NEW.`prepared_at`) >= datetime(activation.`created_at`)
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(activation.`snapshot_json`, '$.records') evidence
        WHERE NOT EXISTS (
          SELECT 1
          FROM `compliance_sres_activation_records` record
          JOIN `compliance_sres_activation_reviews` review
            ON review.`organisation_id` = record.`organisation_id`
            AND review.`activation_record_id` = record.`id`
            AND review.`response_sha256` = record.`response_sha256`
            AND review.`source_artifact_id` = record.`source_artifact_id`
            AND review.`source_artifact_sha256` =
              record.`source_artifact_sha256`
            AND review.`decision` = 'approved'
          JOIN `compliance_official_source_artifacts` artifact
            ON artifact.`id` = record.`source_artifact_id`
            AND artifact.`organisation_id` = record.`organisation_id`
            AND artifact.`sha256` = record.`source_artifact_sha256`
          JOIN `compliance_official_source_review_decisions` source_review
            ON source_review.`organisation_id` = artifact.`organisation_id`
            AND source_review.`subject_type` = 'artifact'
            AND source_review.`subject_id` = artifact.`id`
            AND source_review.`artifact_id` = artifact.`id`
            AND source_review.`artifact_sha256` = artifact.`sha256`
            AND source_review.`artifact_object_key` = artifact.`object_key`
            AND source_review.`decision` = 'approved'
          WHERE record.`id` = json_extract(evidence.`value`, '$.recordId')
            AND record.`organisation_id` = activation.`organisation_id`
            AND record.`program_code` = activation.`program_code`
            AND record.`activity_template_id` =
              activation.`activity_template_id`
            AND record.`case_id` IN ('', activation.`case_id`)
            AND record.`evidence_kind` =
              json_extract(evidence.`value`, '$.evidenceKind')
            AND record.`subject_key` =
              json_extract(evidence.`value`, '$.subjectKey')
            AND record.`result_code` =
              json_extract(evidence.`value`, '$.resultCode')
            AND record.`source_artifact_id` =
              json_extract(evidence.`value`, '$.sourceArtifactId')
            AND record.`source_artifact_sha256` =
              json_extract(evidence.`value`, '$.sourceArtifactSha256')
            AND record.`source_record_key` =
              json_extract(evidence.`value`, '$.sourceRecordKey')
            AND record.`response_sha256` =
              json_extract(evidence.`value`, '$.responseSha256')
            AND record.`effective_from` =
              json_extract(evidence.`value`, '$.effectiveFrom')
            AND record.`effective_to` =
              json_extract(evidence.`value`, '$.effectiveTo')
            AND record.`observed_at` =
              json_extract(evidence.`value`, '$.observedAt')
            AND record.`valid_until` =
              json_extract(evidence.`value`, '$.validUntil')
            AND record.`supersedes_record_id` = COALESCE(
              json_extract(evidence.`value`, '$.supersedesRecordId'), ''
            )
            AND json_extract(evidence.`value`, '$.reviewed') = 1
            AND review.`id` = json_extract(evidence.`value`, '$.reviewId')
            AND review.`reviewed_by_uid` =
              json_extract(evidence.`value`, '$.reviewedByUid')
            AND review.`reviewed_at` =
              json_extract(evidence.`value`, '$.reviewedAt')
            AND record.`effective_from` <= activation.`activity_date`
            AND (record.`effective_to` = '' OR record.`effective_to` >=
              activation.`activity_date`)
            AND (record.`valid_until` = '' OR datetime(record.`valid_until`) >=
              datetime(NEW.`prepared_at`))
            AND datetime(NEW.`prepared_at`) >= datetime(review.`reviewed_at`)
            AND NOT EXISTS (
              SELECT 1 FROM `compliance_sres_activation_records` successor
              WHERE successor.`supersedes_record_id` = record.`id`
            )
            AND NOT EXISTS (
              SELECT 1
              FROM `compliance_official_source_review_decisions` successor
              WHERE successor.`supersedes_decision_id` = source_review.`id`
            )
        )
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_SRES_OUTPUT_ACTIVATION_INVALID') END;
END;

CREATE TRIGGER `compliance_sres_activation_record_audit`
AFTER INSERT ON `compliance_sres_activation_records`
BEGIN
  INSERT INTO `compliance_audit_events` (
    `id`, `organisation_id`, `actor_type`, `actor_uid`, `event_type`,
    `target_type`, `target_id`, `summary`, `metadata`, `created_at`
  ) VALUES (
    'sres-activation-record:' || NEW.`id`, NEW.`organisation_id`,
    'compliance', NEW.`created_by_uid`, 'sres_activation.recorded',
    'compliance_sres_activation_record', NEW.`id`,
    'An immutable SRES activation evidence response was retained.',
    json_object(
      'identityRealm', NEW.`created_actor_kind`,
      'evidenceKind', NEW.`evidence_kind`,
      'activityTemplateId', NEW.`activity_template_id`,
      'caseId', NEW.`case_id`,
      'responseSha256', NEW.`response_sha256`,
      'sourceArtifactId', NEW.`source_artifact_id`,
      'sourceArtifactSha256', NEW.`source_artifact_sha256`
    ), NEW.`created_at`
  );
END;

CREATE TRIGGER `compliance_sres_activation_review_audit`
AFTER INSERT ON `compliance_sres_activation_reviews`
BEGIN
  INSERT INTO `compliance_audit_events` (
    `id`, `organisation_id`, `actor_type`, `actor_uid`, `event_type`,
    `target_type`, `target_id`, `summary`, `metadata`, `created_at`
  ) VALUES (
    'sres-activation-review:' || NEW.`id`, NEW.`organisation_id`,
    'compliance', NEW.`reviewed_by_uid`,
    'sres_activation.' || NEW.`decision`,
    'compliance_sres_activation_record', NEW.`activation_record_id`,
    'An independent SRES activation evidence review was retained.',
    json_object(
      'identityRealm', NEW.`reviewed_actor_kind`,
      'decision', NEW.`decision`,
      'responseSha256', NEW.`response_sha256`,
      'sourceArtifactId', NEW.`source_artifact_id`,
      'sourceArtifactSha256', NEW.`source_artifact_sha256`
    ), NEW.`reviewed_at`
  );
END;

CREATE TRIGGER `compliance_sres_activation_snapshot_audit`
AFTER INSERT ON `compliance_sres_activation_snapshots`
BEGIN
  INSERT INTO `compliance_audit_events` (
    `id`, `organisation_id`, `actor_type`, `actor_uid`, `event_type`,
    `target_type`, `target_id`, `summary`, `metadata`, `created_at`
  ) VALUES (
    'sres-activation-snapshot:' || NEW.`id`, NEW.`organisation_id`,
    'compliance', NEW.`created_by_uid`, 'sres_activation.snapshot_frozen',
    'compliance_sres_activation_snapshot', NEW.`id`,
    'The exact independently reviewed SRES activation evidence was frozen.',
    json_object(
      'identityRealm', NEW.`created_actor_kind`,
      'activityTemplateId', NEW.`activity_template_id`,
      'caseId', NEW.`case_id`,
      'activityDate', NEW.`activity_date`,
      'snapshotSha256', NEW.`snapshot_sha256`
    ), NEW.`created_at`
  );
END;
