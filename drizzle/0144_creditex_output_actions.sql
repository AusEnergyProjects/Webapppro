-- Sites-safe migration: complex trigger guards are installed through
-- src/lib/creditex-work-pack-schema-guards.ts using one prepared statement per guard.
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
