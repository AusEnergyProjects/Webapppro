-- 0144: immutable Creditex certificate and governed operational-output packets.
CREATE TABLE `compliance_output_action_packets` (
  `id` text PRIMARY KEY NOT NULL,
  `idempotency_key` text NOT NULL,
  `contract` text NOT NULL,
  `organisation_id` text NOT NULL,
  `action_kind` text NOT NULL,
  `output_class` text NOT NULL,
  `output_code` text NOT NULL,
  `program_code` text NOT NULL,
  `activity_template_id` text NOT NULL,
  `activity_version_id` text NOT NULL,
  `compliance_case_id` text NOT NULL,
  `case_revision` integer NOT NULL,
  `work_pack_instance_id` text NOT NULL,
  `work_pack_instance_key` text NOT NULL,
  `work_pack_revision` integer NOT NULL,
  `work_pack_version_id` text NOT NULL,
  `work_pack_definition_sha256` text NOT NULL,
  `work_pack_instance_sha256` text NOT NULL,
  `work_pack_response_sha256` text NOT NULL,
  `work_pack_final_record_id` text NOT NULL,
  `work_pack_final_pdf_sha256` text NOT NULL,
  `calculation_run_id` text DEFAULT '' NOT NULL,
  `calculation_input_sha256` text DEFAULT '' NOT NULL,
  `calculation_output_sha256` text DEFAULT '' NOT NULL,
  `calculation_receipt_sha256` text DEFAULT '' NOT NULL,
  `calculator_version_id` text DEFAULT '' NOT NULL,
  `catalogue_formula_key` text DEFAULT '' NOT NULL,
  `engine_calculator_key` text DEFAULT '' NOT NULL,
  `engine_calculator_version` integer DEFAULT 0 NOT NULL,
  `calculator_source_binding_id` text DEFAULT '' NOT NULL,
  `calculator_source_artifact_id` text DEFAULT '' NOT NULL,
  `calculator_source_sha256` text DEFAULT '' NOT NULL,
  `product_evidence_snapshot` text NOT NULL,
  `product_evidence_sha256` text NOT NULL,
  `scenario_evidence_snapshot` text NOT NULL,
  `scenario_evidence_sha256` text NOT NULL,
  `source_manifest_snapshot` text NOT NULL,
  `source_manifest_sha256` text NOT NULL,
  `quantity_text` text DEFAULT '' NOT NULL,
  `unit` text DEFAULT '' NOT NULL,
  `packet_snapshot` text NOT NULL,
  `packet_sha256` text NOT NULL,
  `prepared_by_uid` text NOT NULL,
  `prepared_actor_kind` text NOT NULL,
  `prepared_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_output_action_packet_identity_check` CHECK (
    trim(`id`) <> ''
    AND length(trim(`idempotency_key`)) BETWEEN 8 AND 240
    AND `contract` = 'creditex-output-action-packet/v1'
    AND trim(`organisation_id`) <> ''
    AND `action_kind` IN ('certificate_submission', 'operational_output')
    AND `output_class` IN (
      'tradable_certificate', 'retailer_obligation_credit', 'rebate',
      'grant', 'loan', 'project_credit', 'tariff_only', 'procurement_only'
    )
    AND trim(`output_code`) <> ''
    AND trim(`program_code`) <> ''
    AND trim(`activity_template_id`) <> ''
    AND trim(`activity_version_id`) <> ''
    AND trim(`compliance_case_id`) <> ''
    AND `case_revision` > 0
    AND trim(`work_pack_instance_id`) <> ''
    AND trim(`work_pack_instance_key`) <> ''
    AND `work_pack_revision` > 0
    AND trim(`work_pack_version_id`) <> ''
    AND trim(`work_pack_final_record_id`) <> ''
    AND trim(`prepared_by_uid`) <> ''
    AND `prepared_actor_kind` IN ('compliance', 'admin')
    AND datetime(`prepared_at`) IS NOT NULL
    AND datetime(`created_at`) IS NOT NULL
    AND `created_at` = `prepared_at`
  ),
  CONSTRAINT `compliance_output_action_packet_hash_check` CHECK (
    length(`work_pack_definition_sha256`) = 71
    AND substr(`work_pack_definition_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`work_pack_definition_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `work_pack_definition_sha256` = lower(`work_pack_definition_sha256`)
    AND length(`work_pack_instance_sha256`) = 71
    AND substr(`work_pack_instance_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`work_pack_instance_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `work_pack_instance_sha256` = lower(`work_pack_instance_sha256`)
    AND length(`work_pack_response_sha256`) = 71
    AND substr(`work_pack_response_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`work_pack_response_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `work_pack_response_sha256` = lower(`work_pack_response_sha256`)
    AND length(`work_pack_final_pdf_sha256`) = 64
    AND lower(`work_pack_final_pdf_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `work_pack_final_pdf_sha256` = lower(`work_pack_final_pdf_sha256`)
    AND length(`product_evidence_sha256`) = 71
    AND substr(`product_evidence_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`product_evidence_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `product_evidence_sha256` = lower(`product_evidence_sha256`)
    AND length(`scenario_evidence_sha256`) = 71
    AND substr(`scenario_evidence_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`scenario_evidence_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `scenario_evidence_sha256` = lower(`scenario_evidence_sha256`)
    AND length(`source_manifest_sha256`) = 71
    AND substr(`source_manifest_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`source_manifest_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `source_manifest_sha256` = lower(`source_manifest_sha256`)
    AND length(`packet_sha256`) = 71
    AND substr(`packet_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`packet_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `packet_sha256` = lower(`packet_sha256`)
  ),
  CONSTRAINT `compliance_output_action_packet_json_check` CHECK (
    json_valid(`product_evidence_snapshot`)
    AND json_valid(`scenario_evidence_snapshot`)
    AND json_valid(`source_manifest_snapshot`)
    AND json_type(`source_manifest_snapshot`, '$.sources') = 'array'
    AND json_valid(`packet_snapshot`)
    AND json_extract(`packet_snapshot`, '$.contract') = `contract`
    AND json_extract(`packet_snapshot`, '$.actionKind') = `action_kind`
    AND json_extract(`packet_snapshot`, '$.outputClass') = `output_class`
    AND json_extract(`packet_snapshot`, '$.outputCode') = `output_code`
    AND json_extract(`packet_snapshot`, '$.activityTemplateId') =
      `activity_template_id`
    AND json_extract(`packet_snapshot`, '$.workPack.instanceId') =
      `work_pack_instance_id`
    AND json_extract(`packet_snapshot`, '$.workPack.instanceSha256') =
      `work_pack_instance_sha256`
    AND json_extract(`packet_snapshot`, '$.workPack.responseSha256') =
      `work_pack_response_sha256`
    AND json_extract(`packet_snapshot`, '$.workPack.finalRecordId') =
      `work_pack_final_record_id`
    AND (
      `action_kind` <> 'certificate_submission'
      OR (
        json_extract(`packet_snapshot`, '$.calculation.catalogueFormulaKey') =
          `catalogue_formula_key`
        AND json_extract(`packet_snapshot`, '$.calculation.engineCalculatorKey') =
          `engine_calculator_key`
        AND json_extract(`packet_snapshot`, '$.calculation.engineCalculatorVersion') =
          `engine_calculator_version`
        AND json_extract(`packet_snapshot`, '$.calculation.calculatorSourceBindingId') =
          `calculator_source_binding_id`
        AND json_extract(`packet_snapshot`, '$.calculation.calculatorSourceArtifactId') =
          `calculator_source_artifact_id`
      )
    )
  ),
  CONSTRAINT `compliance_output_action_packet_class_check` CHECK (
    (
      `action_kind` = 'certificate_submission'
      AND `output_class` = 'tradable_certificate'
      AND length(`quantity_text`) > 0
      AND `quantity_text` NOT GLOB '*[^0-9]*'
      AND substr(`quantity_text`, 1, 1) <> '0'
      AND CAST(`quantity_text` AS integer) > 0
      AND trim(`unit`) <> ''
      AND trim(`calculation_run_id`) <> ''
      AND length(`calculation_input_sha256`) = 71
      AND substr(`calculation_input_sha256`, 1, 7) = 'sha256:'
      AND length(`calculation_output_sha256`) = 71
      AND substr(`calculation_output_sha256`, 1, 7) = 'sha256:'
      AND length(`calculation_receipt_sha256`) = 71
      AND substr(`calculation_receipt_sha256`, 1, 7) = 'sha256:'
      AND trim(`calculator_version_id`) <> ''
      AND trim(`catalogue_formula_key`) <> ''
      AND trim(`engine_calculator_key`) <> ''
      AND `engine_calculator_key` NOT GLOB '*[^a-z0-9_]*'
      AND `engine_calculator_key` GLOB '[a-z]*'
      AND `engine_calculator_version` > 0
      AND trim(`calculator_source_binding_id`) <> ''
      AND trim(`calculator_source_artifact_id`) <> ''
      AND length(`calculator_source_sha256`) = 64
      AND lower(`calculator_source_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND json_type(`packet_snapshot`, '$.operationalOutputDefinition') IS NULL
    )
    OR (
      `action_kind` = 'operational_output'
      AND `output_class` <> 'tradable_certificate'
      AND `calculation_run_id` = ''
      AND `calculation_input_sha256` = ''
      AND `calculation_output_sha256` = ''
      AND `calculation_receipt_sha256` = ''
      AND `calculator_version_id` = ''
      AND `catalogue_formula_key` = ''
      AND `engine_calculator_key` = ''
      AND `engine_calculator_version` = 0
      AND `calculator_source_binding_id` = ''
      AND `calculator_source_artifact_id` = ''
      AND `calculator_source_sha256` = ''
      AND `quantity_text` = ''
      AND `unit` = ''
      AND json_extract(
        `packet_snapshot`, '$.operationalOutputDefinition.contract'
      ) = 'creditex-operational-output-definition/v1'
      AND json_extract(
        `packet_snapshot`, '$.operationalOutputDefinition.outputClass'
      ) = `output_class`
      AND json_extract(
        `packet_snapshot`, '$.operationalOutputDefinition.outputCode'
      ) = `output_code`
    )
  )
);

CREATE UNIQUE INDEX `compliance_output_action_packet_idempotency_idx`
  ON `compliance_output_action_packets`
    (`organisation_id`, `action_kind`, `idempotency_key`);
CREATE UNIQUE INDEX `compliance_output_action_final_record_idx`
  ON `compliance_output_action_packets`
    (`organisation_id`, `work_pack_final_record_id`);
CREATE INDEX `compliance_output_action_packet_case_idx`
  ON `compliance_output_action_packets`
    (`organisation_id`, `compliance_case_id`, `prepared_at`, `id`);

CREATE TABLE `compliance_output_action_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `packet_id` text NOT NULL,
  `decision` text NOT NULL CHECK (`decision` IN ('approved', 'rejected')),
  `packet_sha256` text NOT NULL,
  `reviewed_by_uid` text NOT NULL,
  `reviewed_actor_kind` text NOT NULL,
  `review_note` text NOT NULL,
  `reviewed_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_output_action_review_check` CHECK (
    trim(`id`) <> ''
    AND trim(`organisation_id`) <> ''
    AND trim(`packet_id`) <> ''
    AND length(`packet_sha256`) = 71
    AND substr(`packet_sha256`, 1, 7) = 'sha256:'
    AND trim(`reviewed_by_uid`) <> ''
    AND `reviewed_actor_kind` IN ('compliance', 'admin')
    AND length(trim(`review_note`)) BETWEEN 10 AND 2000
    AND datetime(`reviewed_at`) IS NOT NULL
    AND `created_at` = `reviewed_at`
  )
);
CREATE UNIQUE INDEX `compliance_output_action_review_packet_idx`
  ON `compliance_output_action_reviews` (`organisation_id`, `packet_id`);

CREATE TABLE `compliance_output_action_adapter_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `packet_id` text NOT NULL,
  `adapter_id` text NOT NULL,
  `provider_name` text NOT NULL,
  `request_snapshot` text NOT NULL,
  `request_sha256` text NOT NULL,
  `response_snapshot` text NOT NULL,
  `response_sha256` text NOT NULL,
  `provider_reference` text DEFAULT '' NOT NULL,
  `provider_status` text NOT NULL,
  `http_status` integer NOT NULL,
  `response_received_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_output_action_adapter_receipt_check` CHECK (
    trim(`id`) <> ''
    AND trim(`organisation_id`) <> ''
    AND trim(`packet_id`) <> ''
    AND trim(`adapter_id`) <> ''
    AND trim(`provider_name`) <> ''
    AND json_valid(`request_snapshot`)
    AND json_valid(`response_snapshot`)
    AND length(`request_sha256`) = 71
    AND substr(`request_sha256`, 1, 7) = 'sha256:'
    AND length(`response_sha256`) = 71
    AND substr(`response_sha256`, 1, 7) = 'sha256:'
    AND `provider_status` IN (
      'submitted', 'provider_accepted', 'rejected',
      'reconciliation_required'
    )
    AND `http_status` BETWEEN 100 AND 599
    AND datetime(`response_received_at`) IS NOT NULL
    AND datetime(`created_at`) IS NOT NULL
    AND datetime(`created_at`) >= datetime(`response_received_at`)
  )
);
CREATE UNIQUE INDEX `compliance_output_action_adapter_receipt_packet_idx`
  ON `compliance_output_action_adapter_receipts`
    (`organisation_id`, `packet_id`, `adapter_id`, `provider_status`,
      `request_sha256`, `response_sha256`);

CREATE TABLE `compliance_output_action_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `packet_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `from_status` text NOT NULL,
  `to_status` text NOT NULL,
  `actor_kind` text NOT NULL,
  `actor_uid` text NOT NULL,
  `adapter_receipt_id` text DEFAULT '' NOT NULL,
  `summary` text NOT NULL,
  `metadata` text NOT NULL,
  `occurred_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_output_action_event_check` CHECK (
    trim(`id`) <> ''
    AND trim(`organisation_id`) <> ''
    AND trim(`packet_id`) <> ''
    AND `sequence` > 0
    AND `from_status` IN (
      '', 'prepared', 'submitted', 'provider_accepted', 'rejected',
      'reconciliation_required'
    )
    AND `to_status` IN (
      'prepared', 'submitted', 'provider_accepted', 'rejected',
      'reconciliation_required'
    )
    AND `actor_kind` IN ('compliance', 'admin', 'adapter')
    AND trim(`actor_uid`) <> ''
    AND length(trim(`summary`)) BETWEEN 10 AND 500
    AND json_valid(`metadata`)
    AND datetime(`occurred_at`) IS NOT NULL
    AND datetime(`created_at`) IS NOT NULL
    AND datetime(`created_at`) >= datetime(`occurred_at`)
  )
);
CREATE UNIQUE INDEX `compliance_output_action_event_sequence_idx`
  ON `compliance_output_action_events`
    (`organisation_id`, `packet_id`, `sequence`);
CREATE INDEX `compliance_output_action_event_status_idx`
  ON `compliance_output_action_events`
    (`organisation_id`, `to_status`, `occurred_at`, `id`);

CREATE TRIGGER `compliance_output_action_packet_insert_guard`
BEFORE INSERT ON `compliance_output_action_packets`
BEGIN
  SELECT CASE WHEN NOT (
    NEW.`prepared_actor_kind` = 'compliance' AND EXISTS (
      SELECT 1 FROM `compliance_users` member
      WHERE member.`organisation_id` = NEW.`organisation_id`
        AND member.`firebase_uid` = NEW.`prepared_by_uid`
        AND member.`status` = 'active'
        AND member.`role` IN ('admin', 'case_manager', 'reviewer')
        AND member.`governance_identity_verified` = 1
    )
    OR NEW.`prepared_actor_kind` = 'admin' AND EXISTS (
      SELECT 1 FROM `admin_users` administrator
      JOIN `compliance_organisations` organisation
        ON organisation.`id` = NEW.`organisation_id`
        AND organisation.`organisation_code` = 'CREDITEX-AU'
        AND organisation.`status` = 'active'
      WHERE administrator.`firebase_uid` = NEW.`prepared_by_uid`
        AND administrator.`status` = 'active'
        AND administrator.`role` IN ('owner', 'admin')
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_PREPARER_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_instances` instance
    JOIN `compliance_cases` compliance_case
      ON compliance_case.`id` = instance.`compliance_case_id`
      AND compliance_case.`organisation_id` = instance.`organisation_id`
      AND compliance_case.`activity_version_id` = NEW.`activity_version_id`
      AND compliance_case.`revision` = NEW.`case_revision`
    JOIN `compliance_activity_work_pack_versions` pack
      ON pack.`id` = instance.`work_pack_version_id`
      AND pack.`organisation_id` = instance.`organisation_id`
      AND pack.`activity_version_id` = compliance_case.`activity_version_id`
      AND pack.`activity_template_id` = NEW.`activity_template_id`
      AND pack.`publish_state` = 'published'
      AND pack.`schema_sha256` = NEW.`work_pack_definition_sha256`
    JOIN `compliance_activity_work_pack_final_records` final_record
      ON final_record.`id` = NEW.`work_pack_final_record_id`
      AND final_record.`organisation_id` = instance.`organisation_id`
      AND final_record.`case_instance_id` = instance.`id`
      AND final_record.`work_pack_version_id` = pack.`id`
      AND final_record.`instance_sha256` = NEW.`work_pack_instance_sha256`
      AND final_record.`response_sha256` = NEW.`work_pack_response_sha256`
      AND final_record.`pdf_sha256` = NEW.`work_pack_final_pdf_sha256`
      AND datetime(NEW.`prepared_at`) >= datetime(final_record.`finalised_at`)
    WHERE instance.`id` = NEW.`work_pack_instance_id`
      AND instance.`organisation_id` = NEW.`organisation_id`
      AND instance.`compliance_case_id` = NEW.`compliance_case_id`
      AND instance.`instance_key` = NEW.`work_pack_instance_key`
      AND instance.`revision` = NEW.`work_pack_revision`
      AND instance.`work_pack_version_id` = NEW.`work_pack_version_id`
      AND instance.`status` = 'completed'
      AND instance.`response_sha256` = NEW.`work_pack_instance_sha256`
      AND NOT EXISTS (
        SELECT 1 FROM `compliance_activity_work_pack_instances` newer
        WHERE newer.`organisation_id` = instance.`organisation_id`
          AND newer.`instance_key` = instance.`instance_key`
          AND newer.`revision` > instance.`revision`
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_WORK_PACK_INVALID') END;
  SELECT CASE WHEN NEW.`action_kind` = 'certificate_submission' AND NOT EXISTS (
    SELECT 1
    FROM `compliance_calculation_runs` calculation
    JOIN `compliance_activity_work_pack_calculation_reviews` review
      ON review.`organisation_id` = calculation.`organisation_id`
      AND review.`calculation_run_id` = calculation.`id`
      AND review.`decision` = 'approved'
      AND review.`input_sha256` = NEW.`calculation_input_sha256`
      AND review.`output_sha256` = NEW.`calculation_output_sha256`
      AND review.`reviewer_uid` <> calculation.`run_by_uid`
      AND datetime(NEW.`prepared_at`) >= datetime(review.`reviewed_at`)
    JOIN `compliance_calculator_versions` calculator
      ON calculator.`id` = calculation.`calculator_version_id`
      AND calculator.`organisation_id` = calculation.`organisation_id`
      AND calculator.`activity_version_id` = NEW.`activity_version_id`
      AND calculator.`approval_state` = 'approved'
      AND calculator.`calculator_key` = NEW.`engine_calculator_key`
      AND calculator.`version` = NEW.`engine_calculator_version`
      AND calculator.`official_source_sha256` = NEW.`calculator_source_sha256`
    JOIN `compliance_activity_work_pack_source_bindings` calculator_binding
      ON calculator_binding.`id` = NEW.`calculator_source_binding_id`
      AND calculator_binding.`organisation_id` = calculation.`organisation_id`
      AND calculator_binding.`work_pack_version_id` = NEW.`work_pack_version_id`
      AND calculator_binding.`schema_sha256` = NEW.`work_pack_definition_sha256`
      AND calculator_binding.`source_artifact_id` =
        NEW.`calculator_source_artifact_id`
      AND calculator_binding.`source_artifact_sha256` =
        NEW.`calculator_source_sha256`
      AND calculator_binding.`source_role` = 'calculator'
      AND calculator_binding.`target_key` = json_extract(
        NEW.`packet_snapshot`, '$.calculation.dependencyKey'
      )
      AND calculator_binding.`binding_state` = 'approved'
      AND calculator_binding.`created_by_uid` <>
        calculator_binding.`reviewed_by_uid`
      AND datetime(calculator_binding.`reviewed_at`) IS NOT NULL
    JOIN `compliance_activity_work_pack_versions` calculator_work_pack
      ON calculator_work_pack.`id` = calculator_binding.`work_pack_version_id`
      AND calculator_work_pack.`organisation_id` = calculation.`organisation_id`
      AND calculator_work_pack.`schema_sha256` = calculator_binding.`schema_sha256`
      AND calculator_work_pack.`publish_state` = 'published'
    JOIN `compliance_official_source_artifacts` calculator_artifact
      ON calculator_artifact.`id` = calculator_binding.`source_artifact_id`
      AND calculator_artifact.`organisation_id` = calculation.`organisation_id`
      AND calculator_artifact.`sha256` = calculator_binding.`source_artifact_sha256`
    JOIN `compliance_official_source_review_decisions` calculator_source_review
      ON calculator_source_review.`organisation_id` = calculation.`organisation_id`
      AND calculator_source_review.`subject_type` = 'artifact'
      AND calculator_source_review.`subject_id` = calculator_artifact.`id`
      AND calculator_source_review.`artifact_id` = calculator_artifact.`id`
      AND calculator_source_review.`artifact_sha256` = calculator_artifact.`sha256`
      AND calculator_source_review.`artifact_object_key` =
        calculator_artifact.`object_key`
      AND calculator_source_review.`decision` = 'approved'
    JOIN `compliance_calculator_engine_receipts` engine_receipt
      ON engine_receipt.`id` = review.`engine_receipt_id`
      AND engine_receipt.`organisation_id` = calculation.`organisation_id`
      AND engine_receipt.`calculator_version_id` = calculator.`id`
      AND engine_receipt.`calculator_version_number` = calculator.`version`
      AND engine_receipt.`suite_receipt_hash` =
        NEW.`calculation_receipt_sha256`
      AND engine_receipt.`result` = 'passed'
    WHERE calculation.`id` = NEW.`calculation_run_id`
      AND calculation.`organisation_id` = NEW.`organisation_id`
      AND calculation.`case_id` = NEW.`compliance_case_id`
      AND calculation.`case_revision` = NEW.`case_revision`
      AND calculation.`calculator_version_id` = NEW.`calculator_version_id`
      AND calculation.`status` IN ('calculated', 'verified')
      AND json_extract(NEW.`packet_snapshot`, '$.calculation.catalogueFormulaKey') =
        NEW.`catalogue_formula_key`
      AND EXISTS (
        SELECT 1
        FROM json_each(calculator_work_pack.`schema_snapshot`, '$.dependencies') dependency
        WHERE json_extract(dependency.`value`, '$.kind') = 'calculator'
          AND json_extract(dependency.`value`, '$.required') = 1
          AND json_extract(dependency.`value`, '$.dependencyKey') =
            calculator_binding.`target_key`
          AND json_extract(dependency.`value`, '$.catalogueFormulaKey') =
            NEW.`catalogue_formula_key`
          AND json_extract(dependency.`value`, '$.calculatorKey') =
            NEW.`engine_calculator_key`
          AND json_extract(dependency.`value`, '$.calculatorVersion') =
            NEW.`engine_calculator_version`
      )
      AND NOT EXISTS (
        SELECT 1 FROM `compliance_official_source_review_decisions` successor
        WHERE successor.`supersedes_decision_id` = calculator_source_review.`id`
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_CALCULATION_INVALID') END;
END;

CREATE TRIGGER `compliance_output_action_packet_update_guard`
BEFORE UPDATE ON `compliance_output_action_packets`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_PACKET_IMMUTABLE');
END;
CREATE TRIGGER `compliance_output_action_packet_delete_guard`
BEFORE DELETE ON `compliance_output_action_packets`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_PACKET_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_output_action_review_insert_guard`
BEFORE INSERT ON `compliance_output_action_reviews`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `compliance_output_action_packets` packet
    WHERE packet.`id` = NEW.`packet_id`
      AND packet.`organisation_id` = NEW.`organisation_id`
      AND packet.`packet_sha256` = NEW.`packet_sha256`
      AND packet.`prepared_by_uid` <> NEW.`reviewed_by_uid`
      AND datetime(NEW.`reviewed_at`) >= datetime(packet.`prepared_at`)
  ) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_REVIEW_BINDING_INVALID') END;
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
  ) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_REVIEWER_INVALID') END;
END;

CREATE TRIGGER `compliance_output_action_review_update_guard`
BEFORE UPDATE ON `compliance_output_action_reviews`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_REVIEW_IMMUTABLE');
END;
CREATE TRIGGER `compliance_output_action_review_delete_guard`
BEFORE DELETE ON `compliance_output_action_reviews`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_REVIEW_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_output_action_adapter_receipt_insert_guard`
BEFORE INSERT ON `compliance_output_action_adapter_receipts`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `compliance_output_action_packets` packet
    JOIN `compliance_output_action_reviews` review
      ON review.`packet_id` = packet.`id`
      AND review.`organisation_id` = packet.`organisation_id`
      AND review.`packet_sha256` = packet.`packet_sha256`
      AND review.`decision` = 'approved'
    WHERE packet.`id` = NEW.`packet_id`
      AND packet.`organisation_id` = NEW.`organisation_id`
      AND datetime(NEW.`response_received_at`) >= datetime(review.`reviewed_at`)
  ) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_APPROVAL_REQUIRED') END;
  SELECT CASE WHEN NEW.`provider_status` <> 'submitted' AND NOT EXISTS (
    SELECT 1 FROM `compliance_output_action_events` submitted
    WHERE submitted.`organisation_id` = NEW.`organisation_id`
      AND submitted.`packet_id` = NEW.`packet_id`
      AND submitted.`to_status` = 'submitted'
      AND datetime(NEW.`response_received_at`) >= datetime(submitted.`occurred_at`)
  ) THEN RAISE(
    ABORT, 'COMPLIANCE_OUTPUT_ACTION_SUBMISSION_RECEIPT_REQUIRED'
  ) END;
END;
CREATE TRIGGER `compliance_output_action_adapter_receipt_update_guard`
BEFORE UPDATE ON `compliance_output_action_adapter_receipts`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_ADAPTER_RECEIPT_IMMUTABLE');
END;
CREATE TRIGGER `compliance_output_action_adapter_receipt_delete_guard`
BEFORE DELETE ON `compliance_output_action_adapter_receipts`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_ADAPTER_RECEIPT_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_output_action_event_insert_guard`
BEFORE INSERT ON `compliance_output_action_events`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `compliance_output_action_packets` packet
    WHERE packet.`id` = NEW.`packet_id`
      AND packet.`organisation_id` = NEW.`organisation_id`
      AND datetime(NEW.`occurred_at`) >= datetime(packet.`prepared_at`)
  ) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_EVENT_PACKET_INVALID') END;
  SELECT CASE WHEN NEW.`sequence` <> 1 + COALESCE((
    SELECT MAX(event.`sequence`) FROM `compliance_output_action_events` event
    WHERE event.`organisation_id` = NEW.`organisation_id`
      AND event.`packet_id` = NEW.`packet_id`
  ), 0) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_EVENT_SEQUENCE_INVALID') END;
  SELECT CASE WHEN NEW.`sequence` = 1 AND NOT (
    NEW.`from_status` = '' AND NEW.`to_status` = 'prepared'
    AND NEW.`adapter_receipt_id` = ''
    AND EXISTS (
      SELECT 1 FROM `compliance_output_action_packets` packet
      WHERE packet.`id` = NEW.`packet_id`
        AND packet.`prepared_by_uid` = NEW.`actor_uid`
        AND packet.`prepared_actor_kind` = NEW.`actor_kind`
        AND NEW.`occurred_at` = packet.`prepared_at`
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_INITIAL_EVENT_INVALID') END;
  SELECT CASE WHEN NEW.`sequence` > 1 AND NEW.`from_status` <> (
    SELECT event.`to_status` FROM `compliance_output_action_events` event
    WHERE event.`organisation_id` = NEW.`organisation_id`
      AND event.`packet_id` = NEW.`packet_id`
    ORDER BY event.`sequence` DESC LIMIT 1
  ) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_EVENT_FROM_STATUS_INVALID') END;
  SELECT CASE WHEN NEW.`sequence` > 1 AND datetime(NEW.`occurred_at`) < datetime((
    SELECT event.`occurred_at` FROM `compliance_output_action_events` event
    WHERE event.`organisation_id` = NEW.`organisation_id`
      AND event.`packet_id` = NEW.`packet_id`
    ORDER BY event.`sequence` DESC LIMIT 1
  )) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_EVENT_TIME_INVALID') END;
  SELECT CASE WHEN NEW.`from_status` = 'provider_accepted'
    THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_ACCEPTED_TERMINAL') END;
  SELECT CASE WHEN NEW.`sequence` > 1 AND NOT (
    (
      NEW.`from_status` = 'prepared' AND NEW.`to_status` = 'rejected'
      AND NEW.`actor_kind` IN ('compliance', 'admin')
      AND NEW.`adapter_receipt_id` = ''
      AND EXISTS (
        SELECT 1 FROM `compliance_output_action_reviews` review
        WHERE review.`organisation_id` = NEW.`organisation_id`
          AND review.`packet_id` = NEW.`packet_id`
          AND review.`decision` = 'rejected'
          AND review.`reviewed_by_uid` = NEW.`actor_uid`
          AND review.`reviewed_actor_kind` = NEW.`actor_kind`
          AND review.`reviewed_at` = NEW.`occurred_at`
      )
    )
    OR (
      NEW.`from_status` IN ('prepared', 'submitted', 'reconciliation_required')
      AND NEW.`to_status` IN (
        'submitted', 'provider_accepted', 'rejected',
        'reconciliation_required'
      )
      AND NEW.`actor_kind` = 'adapter'
      AND NEW.`adapter_receipt_id` <> ''
      AND EXISTS (
        SELECT 1 FROM `compliance_output_action_adapter_receipts` receipt
        WHERE receipt.`id` = NEW.`adapter_receipt_id`
          AND receipt.`organisation_id` = NEW.`organisation_id`
          AND receipt.`packet_id` = NEW.`packet_id`
          AND receipt.`adapter_id` = NEW.`actor_uid`
          AND receipt.`provider_status` = NEW.`to_status`
          AND receipt.`response_received_at` = NEW.`occurred_at`
      )
    )
    OR (
      NEW.`from_status` IN ('prepared', 'submitted', 'reconciliation_required')
      AND NEW.`to_status` IN (
        'submitted', 'provider_accepted', 'rejected',
        'reconciliation_required'
      )
      AND NEW.`actor_kind` IN ('compliance', 'admin')
      AND NEW.`adapter_receipt_id` <> ''
      AND EXISTS (
        SELECT 1 FROM `compliance_output_action_adapter_receipts` receipt
        WHERE receipt.`id` = NEW.`adapter_receipt_id`
          AND receipt.`organisation_id` = NEW.`organisation_id`
          AND receipt.`packet_id` = NEW.`packet_id`
          AND receipt.`adapter_id` = 'manual-provider-record/v1'
          AND receipt.`provider_status` = NEW.`to_status`
          AND receipt.`response_received_at` = NEW.`occurred_at`
      )
      AND (
        EXISTS (
          SELECT 1 FROM `compliance_users` member
          WHERE member.`organisation_id` = NEW.`organisation_id`
            AND member.`firebase_uid` = NEW.`actor_uid`
            AND member.`status` = 'active'
            AND member.`role` IN ('admin', 'case_manager', 'reviewer')
            AND member.`governance_identity_verified` = 1
        )
        OR EXISTS (
          SELECT 1 FROM `admin_users` administrator
          JOIN `compliance_organisations` organisation
            ON organisation.`id` = NEW.`organisation_id`
            AND organisation.`organisation_code` = 'CREDITEX-AU'
            AND organisation.`status` = 'active'
          WHERE administrator.`firebase_uid` = NEW.`actor_uid`
            AND administrator.`status` = 'active'
            AND administrator.`role` IN ('owner', 'admin', 'reviewer')
        )
      )
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_TRANSITION_INVALID') END;
  SELECT CASE WHEN NEW.`to_status` IN (
      'provider_accepted', 'rejected', 'reconciliation_required'
    ) AND NEW.`actor_kind` IN ('compliance', 'admin') AND EXISTS (
      SELECT 1 FROM `compliance_output_action_events` submitted
      WHERE submitted.`organisation_id` = NEW.`organisation_id`
        AND submitted.`packet_id` = NEW.`packet_id`
        AND submitted.`to_status` = 'submitted'
        AND submitted.`actor_uid` = NEW.`actor_uid`
    ) THEN RAISE(
      ABORT, 'COMPLIANCE_OUTPUT_ACTION_MANUAL_OUTCOME_REVIEW_SEPARATION_REQUIRED'
    ) END;
END;

CREATE TRIGGER `compliance_output_action_event_update_guard`
BEFORE UPDATE ON `compliance_output_action_events`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_EVENT_IMMUTABLE');
END;
CREATE TRIGGER `compliance_output_action_event_delete_guard`
BEFORE DELETE ON `compliance_output_action_events`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_OUTPUT_ACTION_EVENT_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_output_action_packet_audit`
AFTER INSERT ON `compliance_output_action_packets`
BEGIN
  INSERT INTO `compliance_audit_events` (
    `id`, `organisation_id`, `actor_type`, `actor_uid`, `event_type`,
    `target_type`, `target_id`, `summary`, `metadata`, `created_at`
  ) VALUES (
    'output-action-packet:' || NEW.`id`, NEW.`organisation_id`,
    'compliance', NEW.`prepared_by_uid`, 'output_action.prepared',
    'compliance_output_action_packet', NEW.`id`,
    'An immutable governed output action packet was prepared.',
    json_object(
      'actionKind', NEW.`action_kind`, 'outputClass', NEW.`output_class`,
      'outputCode', NEW.`output_code`,
      'activityTemplateId', NEW.`activity_template_id`,
      'workPackFinalRecordId', NEW.`work_pack_final_record_id`,
      'packetSha256', NEW.`packet_sha256`,
      'identityRealm', NEW.`prepared_actor_kind`
    ), NEW.`created_at`
  );
END;

CREATE TRIGGER `compliance_output_action_review_audit`
AFTER INSERT ON `compliance_output_action_reviews`
BEGIN
  INSERT INTO `compliance_audit_events` (
    `id`, `organisation_id`, `actor_type`, `actor_uid`, `event_type`,
    `target_type`, `target_id`, `summary`, `metadata`, `created_at`
  ) VALUES (
    'output-action-review:' || NEW.`id`, NEW.`organisation_id`,
    'compliance', NEW.`reviewed_by_uid`, 'output_action.reviewed',
    'compliance_output_action_packet', NEW.`packet_id`,
    'An immutable governed output action review was recorded.',
    json_object(
      'decision', NEW.`decision`, 'packetSha256', NEW.`packet_sha256`,
      'identityRealm', NEW.`reviewed_actor_kind`
    ),
    NEW.`created_at`
  );
END;

CREATE TRIGGER `compliance_output_action_event_audit`
AFTER INSERT ON `compliance_output_action_events`
WHEN NEW.`sequence` > 1
BEGIN
  INSERT INTO `compliance_audit_events` (
    `id`, `organisation_id`, `actor_type`, `actor_uid`, `event_type`,
    `target_type`, `target_id`, `summary`, `metadata`, `created_at`
  ) VALUES (
    'output-action-event:' || NEW.`id`, NEW.`organisation_id`,
    CASE NEW.`actor_kind`
      WHEN 'adapter' THEN 'platform'
      ELSE 'compliance'
    END,
    NEW.`actor_uid`, 'output_action.status_changed',
    'compliance_output_action_packet', NEW.`packet_id`, NEW.`summary`,
    json_object(
      'sequence', NEW.`sequence`, 'fromStatus', NEW.`from_status`,
      'toStatus', NEW.`to_status`,
      'adapterReceiptId', NEW.`adapter_receipt_id`,
      'identityRealm', NEW.`actor_kind`
    ), NEW.`created_at`
  );
END;
