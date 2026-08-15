-- Sites-safe migration: complex trigger guards are installed through
-- src/lib/creditex-work-pack-schema-guards.ts using one prepared statement per guard.
-- 0142: governed, effective-dated activity work-pack definitions and immutable field records.
CREATE TABLE `compliance_activity_work_pack_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `activity_version_id` text NOT NULL,
  `activity_template_id` text NOT NULL,
  `manual_policy_binding_id` text NOT NULL,
  `manual_policy_binding_version` integer NOT NULL,
  `manual_policy_binding_sha256` text NOT NULL,
  `evidence_policy_version_id` text NOT NULL,
  `evidence_policy_version` integer NOT NULL,
  `evidence_policy_source_sha256` text NOT NULL,
  `origin_kind` text DEFAULT 'manual' NOT NULL,
  `client_request_id` text DEFAULT '' NOT NULL,
  `source_candidate_contract` text DEFAULT '' NOT NULL,
  `source_candidate_snapshot` text DEFAULT '{}' NOT NULL,
  `source_candidate_sha256` text DEFAULT '' NOT NULL,
  `source_binding_map_snapshot` text DEFAULT '[]' NOT NULL,
  `source_binding_map_sha256` text DEFAULT '' NOT NULL,
  `candidate_blockers_snapshot` text DEFAULT '[]' NOT NULL,
  `version` integer NOT NULL,
  `contract` text NOT NULL,
  `title` text NOT NULL,
  `schema_snapshot` text NOT NULL,
  `schema_sha256` text NOT NULL,
  `effective_from` text NOT NULL,
  `effective_to` text DEFAULT '' NOT NULL,
  `publish_state` text DEFAULT 'draft' NOT NULL,
  `authored_by_uid` text NOT NULL,
  `authored_at` text NOT NULL,
  `updated_by_uid` text NOT NULL,
  `updated_at` text NOT NULL,
  `reviewed_by_uid` text DEFAULT '' NOT NULL,
  `reviewed_at` text DEFAULT '' NOT NULL,
  `review_note` text DEFAULT '' NOT NULL,
  `withdrawn_by_uid` text DEFAULT '' NOT NULL,
  `withdrawn_at` text DEFAULT '' NOT NULL,
  `withdrawal_note` text DEFAULT '' NOT NULL,
  `abandoned_by_uid` text DEFAULT '' NOT NULL,
  `abandoned_at` text DEFAULT '' NOT NULL,
  `abandonment_note` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_work_pack_version_identity_check` CHECK (
    trim(`id`) <> ''
    AND trim(`organisation_id`) <> ''
    AND trim(`activity_version_id`) <> ''
    AND trim(`activity_template_id`) <> ''
    AND (
      (
        `origin_kind` = 'manual'
        AND `client_request_id` = ''
        AND `source_candidate_contract` = ''
        AND `source_candidate_snapshot` = '{}'
        AND `source_candidate_sha256` = ''
        AND `source_binding_map_snapshot` = '[]'
        AND `source_binding_map_sha256` = ''
        AND `candidate_blockers_snapshot` = '[]'
        AND trim(`manual_policy_binding_id`) <> ''
        AND `manual_policy_binding_version` > 0
        AND length(`manual_policy_binding_sha256`) = 64
        AND lower(`manual_policy_binding_sha256`) NOT GLOB '*[^0-9a-f]*'
        AND `manual_policy_binding_sha256` = lower(`manual_policy_binding_sha256`)
        AND trim(`evidence_policy_version_id`) <> ''
        AND `evidence_policy_version` > 0
        AND length(`evidence_policy_source_sha256`) = 64
        AND lower(`evidence_policy_source_sha256`) NOT GLOB '*[^0-9a-f]*'
        AND `evidence_policy_source_sha256` = lower(`evidence_policy_source_sha256`)
      )
      OR (
        `origin_kind` = 'source_candidate'
        AND length(trim(`client_request_id`)) BETWEEN 8 AND 240
        AND `source_candidate_contract` =
          'creditex-current-work-pack-content/v1'
        AND json_valid(`source_candidate_snapshot`)
        AND json_extract(
          `source_candidate_snapshot`, '$.schema'
        ) = `source_candidate_contract`
        AND json_extract(
          `source_candidate_snapshot`, '$.templateId'
        ) = `activity_template_id`
        AND json_extract(
          `source_candidate_snapshot`, '$.draftCreationState'
        ) IN ('source_bound_guided_capture', 'source_backed_review_draft')
        AND json_extract(
          `source_candidate_snapshot`, '$.activationReady'
        ) = 0
        AND length(`source_candidate_sha256`) = 71
        AND substr(`source_candidate_sha256`, 1, 7) = 'sha256:'
        AND lower(substr(`source_candidate_sha256`, 8))
          NOT GLOB '*[^0-9a-f]*'
        AND `source_candidate_sha256` = lower(`source_candidate_sha256`)
        AND json_valid(`source_binding_map_snapshot`)
        AND json_type(`source_binding_map_snapshot`) = 'array'
        AND json_array_length(`source_binding_map_snapshot`) > 0
        AND length(`source_binding_map_sha256`) = 71
        AND substr(`source_binding_map_sha256`, 1, 7) = 'sha256:'
        AND lower(substr(`source_binding_map_sha256`, 8))
          NOT GLOB '*[^0-9a-f]*'
        AND `source_binding_map_sha256` = lower(`source_binding_map_sha256`)
        AND json_valid(`candidate_blockers_snapshot`)
        AND json_type(`candidate_blockers_snapshot`) = 'array'
        AND json_array_length(`candidate_blockers_snapshot`) > 0
        AND `manual_policy_binding_id` = ''
        AND `manual_policy_binding_version` = 0
        AND `manual_policy_binding_sha256` = ''
        AND `evidence_policy_version_id` = ''
        AND `evidence_policy_version` = 0
        AND `evidence_policy_source_sha256` = ''
      )
    )
    AND `version` > 0
    AND `contract` = 'creditex-activity-work-pack/v1'
    AND trim(`title`) <> ''
    AND datetime(`authored_at`) IS NOT NULL
    AND trim(`updated_by_uid`) <> ''
    AND datetime(`updated_at`) IS NOT NULL
    AND `updated_at` >= `authored_at`
    AND datetime(`created_at`) IS NOT NULL
  ),
  CONSTRAINT `compliance_work_pack_version_date_check` CHECK (
    date(`effective_from`) = `effective_from`
    AND (
      `effective_to` = ''
      OR (
        date(`effective_to`) = `effective_to`
        AND `effective_to` >= `effective_from`
      )
    )
  ),
  CONSTRAINT `compliance_work_pack_version_schema_check` CHECK (
    json_valid(`schema_snapshot`)
    AND json_extract(`schema_snapshot`, '$.contract') = `contract`
    AND json_extract(`schema_snapshot`, '$.activityTemplateId') =
      `activity_template_id`
    AND json_extract(`schema_snapshot`, '$.version') = `version`
    AND json_extract(`schema_snapshot`, '$.effectiveFrom') = `effective_from`
    AND json_extract(`schema_snapshot`, '$.effectiveTo') = `effective_to`
    AND json_type(`schema_snapshot`, '$.stages') = 'array'
    AND json_array_length(json_extract(`schema_snapshot`, '$.stages')) > 0
    AND json_type(`schema_snapshot`, '$.signerRoles') = 'array'
    AND json_type(`schema_snapshot`, '$.dependencies') = 'array'
    AND json_type(`schema_snapshot`, '$.sections') = 'array'
    AND json_array_length(json_extract(`schema_snapshot`, '$.sections')) > 0
    AND length(`schema_sha256`) = 71
    AND substr(`schema_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`schema_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `schema_sha256` = lower(`schema_sha256`)
  ),
  CONSTRAINT `compliance_work_pack_version_state_check` CHECK (
    `publish_state` IN ('draft', 'published', 'withdrawn', 'abandoned')
  ),
  CONSTRAINT `compliance_work_pack_version_lifecycle_check` CHECK (
    (
      `publish_state` = 'draft'
      AND `reviewed_by_uid` = ''
      AND `reviewed_at` = ''
      AND `review_note` = ''
      AND `withdrawn_by_uid` = ''
      AND `withdrawn_at` = ''
      AND `withdrawal_note` = ''
      AND `abandoned_by_uid` = ''
      AND `abandoned_at` = ''
      AND `abandonment_note` = ''
    )
    OR (
      `publish_state` = 'published'
      AND trim(`reviewed_by_uid`) <> ''
      AND `reviewed_by_uid` <> `authored_by_uid`
      AND datetime(`reviewed_at`) IS NOT NULL
      AND `reviewed_at` >= `authored_at`
      AND length(trim(`review_note`)) BETWEEN 10 AND 2000
      AND `withdrawn_by_uid` = ''
      AND `withdrawn_at` = ''
      AND `withdrawal_note` = ''
      AND `abandoned_by_uid` = ''
      AND `abandoned_at` = ''
      AND `abandonment_note` = ''
    )
    OR (
      `publish_state` = 'withdrawn'
      AND trim(`reviewed_by_uid`) <> ''
      AND `reviewed_by_uid` <> `authored_by_uid`
      AND datetime(`reviewed_at`) IS NOT NULL
      AND `reviewed_at` >= `authored_at`
      AND length(trim(`review_note`)) BETWEEN 10 AND 2000
      AND trim(`withdrawn_by_uid`) <> ''
      AND datetime(`withdrawn_at`) IS NOT NULL
      AND `withdrawn_at` >= `reviewed_at`
      AND length(trim(`withdrawal_note`)) BETWEEN 10 AND 2000
      AND `abandoned_by_uid` = ''
      AND `abandoned_at` = ''
      AND `abandonment_note` = ''
    )
    OR (
      `publish_state` = 'abandoned'
      AND `reviewed_by_uid` = ''
      AND `reviewed_at` = ''
      AND `review_note` = ''
      AND `withdrawn_by_uid` = ''
      AND `withdrawn_at` = ''
      AND `withdrawal_note` = ''
      AND trim(`abandoned_by_uid`) <> ''
      AND datetime(`abandoned_at`) IS NOT NULL
      AND `abandoned_at` >= `authored_at`
      AND length(trim(`abandonment_note`)) BETWEEN 10 AND 2000
    )
  )
);

CREATE UNIQUE INDEX `compliance_work_pack_version_number_idx`
  ON `compliance_activity_work_pack_versions`
    (`organisation_id`, `activity_template_id`, `version`);

CREATE UNIQUE INDEX `compliance_work_pack_open_version_idx`
  ON `compliance_activity_work_pack_versions`
    (`organisation_id`, `activity_version_id`)
  WHERE `publish_state` = 'published' AND `effective_to` = '';

CREATE INDEX `compliance_work_pack_activity_date_idx`
  ON `compliance_activity_work_pack_versions`
    (`organisation_id`, `activity_version_id`, `publish_state`,
      `effective_from`, `effective_to`);

CREATE UNIQUE INDEX `compliance_work_pack_source_candidate_request_idx`
  ON `compliance_activity_work_pack_versions`
    (`organisation_id`, `client_request_id`)
  WHERE `client_request_id` <> '';

CREATE TABLE `compliance_activity_work_pack_source_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `work_pack_version_id` text NOT NULL,
  `schema_sha256` text NOT NULL,
  `source_artifact_id` text NOT NULL,
  `source_artifact_sha256` text NOT NULL,
  `source_role` text NOT NULL,
  `target_key` text NOT NULL,
  `citation_location` text NOT NULL,
  `binding_state` text DEFAULT 'pending_review' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `reviewed_by_uid` text DEFAULT '' NOT NULL,
  `reviewed_at` text DEFAULT '' NOT NULL,
  `review_note` text DEFAULT '' NOT NULL,
  `withdrawn_by_uid` text DEFAULT '' NOT NULL,
  `withdrawn_at` text DEFAULT '' NOT NULL,
  `withdrawal_note` text DEFAULT '' NOT NULL,
  CONSTRAINT `compliance_work_pack_source_identity_check` CHECK (
    trim(`id`) <> ''
    AND trim(`organisation_id`) <> ''
    AND trim(`work_pack_version_id`) <> ''
    AND length(`schema_sha256`) = 71
    AND substr(`schema_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`schema_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `schema_sha256` = lower(`schema_sha256`)
    AND trim(`source_artifact_id`) <> ''
    AND length(`source_artifact_sha256`) = 64
    AND lower(`source_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `source_artifact_sha256` = lower(`source_artifact_sha256`)
    AND `source_role` IN ('requirement', 'product', 'scenario', 'calculator')
    AND trim(`target_key`) <> ''
    AND trim(`citation_location`) <> ''
    AND trim(`created_by_uid`) <> ''
    AND datetime(`created_at`) IS NOT NULL
  ),
  CONSTRAINT `compliance_work_pack_source_state_check` CHECK (
    `binding_state` IN (
      'pending_review', 'approved', 'rejected', 'withdrawn'
    )
  ),
  CONSTRAINT `compliance_work_pack_source_lifecycle_check` CHECK (
    (
      `binding_state` = 'pending_review'
      AND `reviewed_by_uid` = ''
      AND `reviewed_at` = ''
      AND `review_note` = ''
      AND `withdrawn_by_uid` = ''
      AND `withdrawn_at` = ''
      AND `withdrawal_note` = ''
    )
    OR (
      `binding_state` IN ('approved', 'rejected')
      AND trim(`reviewed_by_uid`) <> ''
      AND `reviewed_by_uid` <> `created_by_uid`
      AND datetime(`reviewed_at`) IS NOT NULL
      AND length(trim(`review_note`)) BETWEEN 10 AND 2000
      AND `withdrawn_by_uid` = ''
      AND `withdrawn_at` = ''
      AND `withdrawal_note` = ''
    )
    OR (
      `binding_state` = 'withdrawn'
      AND trim(`reviewed_by_uid`) <> ''
      AND `reviewed_by_uid` <> `created_by_uid`
      AND datetime(`reviewed_at`) IS NOT NULL
      AND length(trim(`review_note`)) BETWEEN 10 AND 2000
      AND trim(`withdrawn_by_uid`) <> ''
      AND datetime(`withdrawn_at`) IS NOT NULL
      AND length(trim(`withdrawal_note`)) BETWEEN 10 AND 2000
    )
  )
);

CREATE UNIQUE INDEX `compliance_work_pack_source_identity_idx`
  ON `compliance_activity_work_pack_source_bindings`
    (`organisation_id`, `work_pack_version_id`, `source_artifact_id`,
      `source_role`, `target_key`, `citation_location`, `schema_sha256`);

CREATE INDEX `compliance_work_pack_source_version_idx`
  ON `compliance_activity_work_pack_source_bindings`
    (`organisation_id`, `work_pack_version_id`, `binding_state`, `target_key`);

CREATE TABLE `compliance_activity_work_pack_instances` (
  `id` text PRIMARY KEY NOT NULL,
  `instance_key` text NOT NULL,
  `organisation_id` text NOT NULL,
  `compliance_case_id` text NOT NULL,
  `work_order_id` text NOT NULL,
  `compliance_intent_id` text DEFAULT '' NOT NULL,
  `work_pack_version_id` text NOT NULL,
  `manual_policy_composition_lock_id` text DEFAULT '' NOT NULL,
  `manual_policy_composition_sha256` text DEFAULT '' NOT NULL,
  `activity_date` text NOT NULL,
  `revision` integer NOT NULL,
  `supersedes_instance_id` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'not_started' NOT NULL,
  `response_snapshot` text NOT NULL,
  `response_sha256` text NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_work_pack_instance_identity_check` CHECK (
    trim(`id`) <> ''
    AND trim(`instance_key`) <> ''
    AND trim(`organisation_id`) <> ''
    AND trim(`compliance_case_id`) <> ''
    AND trim(`work_order_id`) <> ''
    AND trim(`work_pack_version_id`) <> ''
    AND `revision` > 0
    AND trim(`created_by_uid`) <> ''
    AND datetime(`created_at`) IS NOT NULL
    AND (
      (`revision` = 1 AND `supersedes_instance_id` = '')
      OR (`revision` > 1 AND trim(`supersedes_instance_id`) <> '')
    )
    AND (
      (
        `manual_policy_composition_lock_id` = ''
        AND `manual_policy_composition_sha256` = ''
        AND `status` IN ('not_started', 'in_progress', 'void')
      )
      OR (
        trim(`manual_policy_composition_lock_id`) <> ''
        AND length(`manual_policy_composition_sha256`) = 64
        AND lower(`manual_policy_composition_sha256`) NOT GLOB '*[^0-9a-f]*'
        AND `manual_policy_composition_sha256` =
          lower(`manual_policy_composition_sha256`)
      )
    )
  ),
  CONSTRAINT `compliance_work_pack_instance_date_check` CHECK (
    date(`activity_date`) = `activity_date`
  ),
  CONSTRAINT `compliance_work_pack_instance_status_check` CHECK (
    `status` IN (
      'not_started', 'in_progress', 'ready_to_sign', 'completed', 'void'
    )
  ),
  CONSTRAINT `compliance_work_pack_instance_response_check` CHECK (
    json_valid(`response_snapshot`)
    AND json_extract(`response_snapshot`, '$.contract') =
      'creditex-activity-work-pack-instance/v1'
    AND json_type(`response_snapshot`, '$.prefill') = 'object'
    AND json_extract(`response_snapshot`, '$.prefill.contract') =
      'creditex-activity-work-pack-prefill/v1'
    AND json_type(`response_snapshot`, '$.prefill.customerContext') = 'object'
    AND json_extract(
      `response_snapshot`, '$.prefill.customerContext.contract'
    ) = 'creditex-activity-work-pack-customer-context/v1'
    AND json_type(
      `response_snapshot`, '$.prefill.customerContext.editable'
    ) IN ('integer', 'true', 'false')
    AND length(json_extract(
      `response_snapshot`, '$.prefill.customerContext.contextSha256'
    )) = 71
    AND substr(json_extract(
      `response_snapshot`, '$.prefill.customerContext.contextSha256'
    ), 1, 7) = 'sha256:'
    AND lower(substr(json_extract(
      `response_snapshot`, '$.prefill.customerContext.contextSha256'
    ), 8)) NOT GLOB '*[^0-9a-f]*'
    AND json_extract(
      `response_snapshot`, '$.prefill.customerContext.contextSha256'
    ) = lower(json_extract(
      `response_snapshot`, '$.prefill.customerContext.contextSha256'
    ))
    AND (
      (
        json_extract(
          `response_snapshot`, '$.prefill.customerContext.editable'
        ) = 0
        AND json_extract(
          `response_snapshot`, '$.prefill.customerContext.customerId'
        ) = ''
        AND json_extract(
          `response_snapshot`, '$.prefill.customerContext.siteId'
        ) = ''
        AND json_extract(
          `response_snapshot`, '$.prefill.customerContext.contactId'
        ) = ''
        AND json_extract(
          `response_snapshot`, '$.prefill.customerContext.customerRevision'
        ) = ''
        AND json_extract(
          `response_snapshot`, '$.prefill.customerContext.siteRevision'
        ) = ''
        AND json_extract(
          `response_snapshot`, '$.prefill.customerContext.contactRevision'
        ) = ''
      )
      OR (
        json_extract(
          `response_snapshot`, '$.prefill.customerContext.editable'
        ) = 1
        AND trim(json_extract(
          `response_snapshot`, '$.prefill.customerContext.customerId'
        )) <> ''
        AND trim(json_extract(
          `response_snapshot`, '$.prefill.customerContext.siteId'
        )) <> ''
        AND trim(json_extract(
          `response_snapshot`, '$.prefill.customerContext.contactId'
        )) <> ''
        AND datetime(json_extract(
          `response_snapshot`, '$.prefill.customerContext.customerRevision'
        )) IS NOT NULL
        AND datetime(json_extract(
          `response_snapshot`, '$.prefill.customerContext.siteRevision'
        )) IS NOT NULL
        AND datetime(json_extract(
          `response_snapshot`, '$.prefill.customerContext.contactRevision'
        )) IS NOT NULL
      )
    )
    AND json_type(`response_snapshot`, '$.response') = 'object'
    AND json_extract(`response_snapshot`, '$.response.contract') =
      'creditex-activity-work-pack-response/v1'
    AND json_type(`response_snapshot`, '$.response.answers') = 'object'
    AND json_type(
      `response_snapshot`, '$.response.repeatableSections'
    ) = 'object'
    AND json_type(
      `response_snapshot`, '$.response.dependencyResolutions'
    ) = 'object'
    AND json_type(`response_snapshot`, '$.declarations') = 'object'
    AND json_type(`response_snapshot`, '$.finalisation') IN ('null', 'object')
    AND json_extract(`response_snapshot`, '$.compositionLockId') =
      `manual_policy_composition_lock_id`
    AND json_extract(`response_snapshot`, '$.compositionSha256') =
      `manual_policy_composition_sha256`
    AND json_extract(`response_snapshot`, '$.response.schemaSha256') =
      json_extract(`response_snapshot`, '$.definitionSha256')
    AND length(json_extract(`response_snapshot`, '$.definitionSha256')) = 71
    AND substr(json_extract(`response_snapshot`, '$.definitionSha256'), 1, 7)
      = 'sha256:'
    AND length(json_extract(`response_snapshot`, '$.prefillSha256')) = 71
    AND substr(json_extract(`response_snapshot`, '$.prefillSha256'), 1, 7)
      = 'sha256:'
    AND length(json_extract(`response_snapshot`, '$.responseSha256')) = 71
    AND substr(json_extract(`response_snapshot`, '$.responseSha256'), 1, 7)
      = 'sha256:'
    AND length(json_extract(`response_snapshot`, '$.declarationsSha256')) = 71
    AND substr(
      json_extract(`response_snapshot`, '$.declarationsSha256'), 1, 7
    ) = 'sha256:'
    AND length(`response_sha256`) = 71
    AND substr(`response_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`response_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `response_sha256` = lower(`response_sha256`)
  )
);

CREATE UNIQUE INDEX `compliance_work_pack_instance_revision_idx`
  ON `compliance_activity_work_pack_instances`
    (`organisation_id`, `instance_key`, `revision`);

CREATE UNIQUE INDEX `compliance_work_pack_instance_initial_idx`
  ON `compliance_activity_work_pack_instances`
    (`organisation_id`, `instance_key`)
  WHERE `supersedes_instance_id` = '';

CREATE UNIQUE INDEX `compliance_work_pack_instance_supersedes_idx`
  ON `compliance_activity_work_pack_instances` (`supersedes_instance_id`)
  WHERE `supersedes_instance_id` <> '';

CREATE INDEX `compliance_work_pack_instance_case_idx`
  ON `compliance_activity_work_pack_instances`
    (`organisation_id`, `compliance_case_id`, `created_at`, `id`);

CREATE TABLE `compliance_activity_work_pack_calculation_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `instance_key` text NOT NULL,
  `case_instance_id` text NOT NULL,
  `calculation_run_id` text NOT NULL,
  `dependency_key` text NOT NULL,
  `decision` text NOT NULL CHECK (`decision` IN ('approved', 'rejected')),
  `input_sha256` text NOT NULL,
  `output_sha256` text NOT NULL,
  `calculator_version_id` text NOT NULL,
  `calculator_source_sha256` text NOT NULL,
  `engine_receipt_id` text NOT NULL,
  `reviewer_uid` text NOT NULL,
  `review_note` text NOT NULL,
  `reviewed_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_work_pack_calculation_review_check` CHECK (
    trim(`organisation_id`) <> ''
    AND trim(`instance_key`) <> ''
    AND trim(`case_instance_id`) <> ''
    AND trim(`calculation_run_id`) <> ''
    AND trim(`dependency_key`) <> ''
    AND length(`input_sha256`) = 71
    AND substr(`input_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`input_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `input_sha256` = lower(`input_sha256`)
    AND length(`output_sha256`) = 71
    AND substr(`output_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`output_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `output_sha256` = lower(`output_sha256`)
    AND trim(`calculator_version_id`) <> ''
    AND length(`calculator_source_sha256`) = 64
    AND lower(`calculator_source_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `calculator_source_sha256` = lower(`calculator_source_sha256`)
    AND trim(`engine_receipt_id`) <> ''
    AND trim(`reviewer_uid`) <> ''
    AND length(trim(`review_note`)) BETWEEN 3 AND 2000
    AND datetime(`reviewed_at`) IS NOT NULL
    AND datetime(`created_at`) IS NOT NULL
  )
);

CREATE UNIQUE INDEX `compliance_work_pack_calculation_review_run_idx`
  ON `compliance_activity_work_pack_calculation_reviews`
    (`organisation_id`, `calculation_run_id`);

CREATE INDEX `compliance_work_pack_calculation_review_instance_idx`
  ON `compliance_activity_work_pack_calculation_reviews`
    (`organisation_id`, `instance_key`, `reviewed_at`, `id`);

CREATE TABLE `compliance_activity_work_pack_signatures` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `instance_key` text NOT NULL,
  `case_instance_id` text NOT NULL,
  `prompt_key` text NOT NULL,
  `signer_role` text NOT NULL,
  `signer_capacity` text NOT NULL,
  `signer_name` text NOT NULL,
  `signer_uid` text DEFAULT '' NOT NULL,
  `signer_identity_snapshot` text NOT NULL,
  `signer_identity_sha256` text NOT NULL,
  `signature_sha256` text NOT NULL,
  `signature_object_key` text NOT NULL,
  `signature_content_type` text NOT NULL,
  `signature_size_bytes` integer NOT NULL,
  `signature_payload_contract` text NOT NULL,
  `signature_payload_snapshot` text NOT NULL,
  `signature_payload_sha256` text NOT NULL,
  `integrity_receipt_id` text NOT NULL,
  `attestation_snapshot` text NOT NULL,
  `attestation_sha256` text NOT NULL,
  `definition_sha256` text NOT NULL,
  `prefill_sha256` text NOT NULL,
  `response_sha256` text NOT NULL,
  `declarations_sha256` text NOT NULL,
  `action` text DEFAULT 'captured' NOT NULL,
  `supersedes_signature_id` text DEFAULT '' NOT NULL,
  `app_id` text NOT NULL,
  `app_version` text NOT NULL,
  `app_build` text NOT NULL,
  `capture_session_id` text NOT NULL,
  `captured_device_id` text NOT NULL,
  `captured_by_uid` text NOT NULL,
  `device_attestation_snapshot` text NOT NULL,
  `device_attestation_sha256` text NOT NULL,
  `signed_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_work_pack_signature_identity_check` CHECK (
    trim(`id`) <> ''
    AND trim(`organisation_id`) <> ''
    AND trim(`instance_key`) <> ''
    AND trim(`case_instance_id`) <> ''
    AND trim(`prompt_key`) <> ''
    AND trim(`signer_role`) <> ''
    AND trim(`signer_capacity`) <> ''
    AND trim(`signer_name`) <> ''
    AND length(`signature_sha256`) = 64
    AND lower(`signature_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `signature_sha256` = lower(`signature_sha256`)
    AND trim(`signature_object_key`) <> ''
    AND `signature_content_type` IN (
      'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
      'application/json', 'application/pdf'
    )
    AND `signature_size_bytes` BETWEEN 1 AND 52428800
    AND `signature_payload_contract` =
      'creditex-activity-work-pack-signature-payload/v1'
    AND trim(`integrity_receipt_id`) <> ''
    AND trim(`app_id`) <> ''
    AND trim(`app_version`) <> ''
    AND trim(`app_build`) <> ''
    AND trim(`capture_session_id`) <> ''
    AND trim(`captured_device_id`) <> ''
    AND trim(`captured_by_uid`) <> ''
    AND datetime(`signed_at`) IS NOT NULL
    AND datetime(`created_at`) IS NOT NULL
    AND (
      `action` <> 'captured'
      OR (
        unixepoch(`signed_at`) >= unixepoch(`created_at`) - 604800
        AND unixepoch(`signed_at`) <= unixepoch(`created_at`) + 300
      )
    )
  ),
  CONSTRAINT `compliance_work_pack_signature_identity_snapshot_check` CHECK (
    json_valid(`signer_identity_snapshot`)
    AND json_extract(`signer_identity_snapshot`, '$.contract') =
      'creditex-activity-work-pack-signer-identity/v1'
    AND json_extract(`signer_identity_snapshot`, '$.roleKey') = `signer_role`
    AND json_extract(`signer_identity_snapshot`, '$.capacity') =
      `signer_capacity`
    AND json_extract(`signer_identity_snapshot`, '$.identitySource') IN (
      'customer_context', 'assigned_worker', 'authenticated_actor',
      'manual_verified'
    )
    AND json_extract(`signer_identity_snapshot`, '$.signerName') =
      `signer_name`
    AND json_extract(`signer_identity_snapshot`, '$.signerUid') =
      `signer_uid`
    AND json_type(`signer_identity_snapshot`, '$.fields') = 'object'
    AND length(`signer_identity_sha256`) = 71
    AND substr(`signer_identity_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`signer_identity_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `signer_identity_sha256` = lower(`signer_identity_sha256`)
  ),
  CONSTRAINT `compliance_work_pack_signature_payload_check` CHECK (
    json_valid(`signature_payload_snapshot`)
    AND json_extract(`signature_payload_snapshot`, '$.contract') =
      `signature_payload_contract`
    AND json_type(`signature_payload_snapshot`, '$.strokes') = 'array'
    AND json_array_length(`signature_payload_snapshot`, '$.strokes') > 0
    AND json_extract(`signature_payload_snapshot`, '$.promptKey') =
      `prompt_key`
    AND json_extract(`signature_payload_snapshot`, '$.signerRoleKey') =
      `signer_role`
    AND json_extract(`signature_payload_snapshot`, '$.signedAt') = `signed_at`
    AND length(`signature_payload_sha256`) = 71
    AND substr(`signature_payload_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`signature_payload_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `signature_payload_sha256` = lower(`signature_payload_sha256`)
  ),
  CONSTRAINT `compliance_work_pack_signature_attestation_check` CHECK (
    json_valid(`attestation_snapshot`)
    AND json_extract(`attestation_snapshot`, '$.contract') =
      'creditex-activity-work-pack-signature-attestation/v1'
    AND json_extract(`attestation_snapshot`, '$.promptKey') = `prompt_key`
    AND json_extract(`attestation_snapshot`, '$.signerRoleKey') =
      `signer_role`
    AND json_type(`attestation_snapshot`, '$.text') = 'text'
    AND json_type(`attestation_snapshot`, '$.version') = 'text'
    AND json_type(`attestation_snapshot`, '$.signerIdentity') = 'object'
    AND length(`attestation_sha256`) = 71
    AND substr(`attestation_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`attestation_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `attestation_sha256` = lower(`attestation_sha256`)
  ),
  CONSTRAINT `compliance_work_pack_signature_binding_hash_check` CHECK (
    length(`definition_sha256`) = 71
    AND substr(`definition_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`definition_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `definition_sha256` = lower(`definition_sha256`)
    AND length(`prefill_sha256`) = 71
    AND substr(`prefill_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`prefill_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `prefill_sha256` = lower(`prefill_sha256`)
    AND length(`response_sha256`) = 71
    AND substr(`response_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`response_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `response_sha256` = lower(`response_sha256`)
    AND length(`declarations_sha256`) = 71
    AND substr(`declarations_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`declarations_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `declarations_sha256` = lower(`declarations_sha256`)
  ),
  CONSTRAINT `compliance_work_pack_signature_device_check` CHECK (
    json_valid(`device_attestation_snapshot`)
    AND json_extract(`device_attestation_snapshot`, '$.contract') =
      'creditex-activity-work-pack-device-attestation/v1'
    AND json_extract(`device_attestation_snapshot`, '$.deviceId') =
      `captured_device_id`
    AND json_extract(`device_attestation_snapshot`, '$.appId') = `app_id`
    AND json_extract(`device_attestation_snapshot`, '$.appVersion') =
      `app_version`
    AND json_extract(`device_attestation_snapshot`, '$.appBuild') = `app_build`
    AND json_extract(`device_attestation_snapshot`, '$.sessionId') =
      `capture_session_id`
    AND json_extract(`device_attestation_snapshot`, '$.capturedByUid') =
      `captured_by_uid`
    AND json_extract(`device_attestation_snapshot`, '$.signedAt') = `signed_at`
    AND length(`device_attestation_sha256`) = 71
    AND substr(`device_attestation_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`device_attestation_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `device_attestation_sha256` = lower(`device_attestation_sha256`)
  ),
  CONSTRAINT `compliance_work_pack_signature_action_check` CHECK (
    `action` IN ('captured', 'revoked')
    AND (
      (`action` = 'captured')
      OR (`action` = 'revoked' AND trim(`supersedes_signature_id`) <> '')
    )
  )
);

CREATE UNIQUE INDEX `compliance_work_pack_signature_initial_idx`
  ON `compliance_activity_work_pack_signatures`
    (`organisation_id`, `instance_key`, `prompt_key`, `signer_role`,
      `signer_name`)
  WHERE `supersedes_signature_id` = '';

CREATE UNIQUE INDEX `compliance_work_pack_signature_supersedes_idx`
  ON `compliance_activity_work_pack_signatures` (`supersedes_signature_id`)
  WHERE `supersedes_signature_id` <> '';

CREATE UNIQUE INDEX `compliance_work_pack_signature_object_idx`
  ON `compliance_activity_work_pack_signatures`
    (`organisation_id`, `signature_object_key`)
  WHERE `action` = 'captured';

CREATE TABLE `compliance_activity_work_pack_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `instance_key` text NOT NULL,
  `case_instance_id` text NOT NULL,
  `prompt_key` text NOT NULL,
  `artifact_kind` text NOT NULL,
  `object_key` text NOT NULL,
  `original_file_name` text NOT NULL,
  `content_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `original_sha256` text NOT NULL,
  `metadata_snapshot` text NOT NULL,
  `metadata_sha256` text NOT NULL,
  `integrity_receipt_id` text NOT NULL,
  `verification_state` text DEFAULT 'matched' NOT NULL,
  `supersedes_artifact_id` text DEFAULT '' NOT NULL,
  `captured_device_id` text NOT NULL,
  `captured_by_uid` text NOT NULL,
  `captured_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_work_pack_artifact_identity_check` CHECK (
    trim(`id`) <> ''
    AND trim(`organisation_id`) <> ''
    AND trim(`instance_key`) <> ''
    AND trim(`case_instance_id`) <> ''
    AND trim(`prompt_key`) <> ''
    AND `artifact_kind` IN ('photo', 'document')
    AND trim(`object_key`) <> ''
    AND trim(`original_file_name`) <> ''
    AND trim(`content_type`) <> ''
    AND `size_bytes` BETWEEN 1 AND 52428800
    AND length(`original_sha256`) = 64
    AND lower(`original_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `original_sha256` = lower(`original_sha256`)
    AND trim(`integrity_receipt_id`) <> ''
    AND `verification_state` = 'matched'
    AND trim(`captured_device_id`) <> ''
    AND trim(`captured_by_uid`) <> ''
    AND datetime(`captured_at`) IS NOT NULL
    AND datetime(`created_at`) IS NOT NULL
  ),
  CONSTRAINT `compliance_work_pack_artifact_metadata_check` CHECK (
    json_valid(`metadata_snapshot`)
    AND json_extract(`metadata_snapshot`, '$.contract') =
      'creditex-work-pack-artifact-metadata/v1'
    AND json_extract(`metadata_snapshot`, '$.originalSha256') =
      `original_sha256`
    AND json_extract(`metadata_snapshot`, '$.deviceId') =
      `captured_device_id`
    AND json_extract(`metadata_snapshot`, '$.capturedAt') = `captured_at`
    AND length(`metadata_sha256`) = 71
    AND substr(`metadata_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`metadata_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `metadata_sha256` = lower(`metadata_sha256`)
  )
);

CREATE UNIQUE INDEX `compliance_work_pack_artifact_initial_idx`
  ON `compliance_activity_work_pack_artifacts`
    (`organisation_id`, `instance_key`, `prompt_key`, `object_key`)
  WHERE `supersedes_artifact_id` = '';

CREATE UNIQUE INDEX `compliance_work_pack_artifact_supersedes_idx`
  ON `compliance_activity_work_pack_artifacts` (`supersedes_artifact_id`)
  WHERE `supersedes_artifact_id` <> '';

CREATE UNIQUE INDEX `compliance_work_pack_artifact_object_idx`
  ON `compliance_activity_work_pack_artifacts`
    (`organisation_id`, `object_key`);

CREATE TABLE `compliance_activity_work_pack_render_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `contract` text NOT NULL,
  `organisation_id` text NOT NULL,
  `instance_key` text NOT NULL,
  `case_instance_id` text NOT NULL,
  `output_key` text NOT NULL,
  `output_definition_snapshot` text NOT NULL,
  `output_definition_sha256` text NOT NULL,
  `template_source_artifact_id` text NOT NULL,
  `template_source_artifact_sha256` text NOT NULL,
  `renderer_contract` text NOT NULL,
  `renderer_version` text NOT NULL,
  `object_key` text NOT NULL,
  `file_name` text NOT NULL,
  `content_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `pdf_sha256` text NOT NULL,
  `rendered_by_uid` text NOT NULL,
  `rendered_at` text NOT NULL,
  CONSTRAINT `compliance_work_pack_render_receipt_check` CHECK (
    `contract` = 'creditex-activity-work-pack-render-receipt/v1'
    AND trim(`organisation_id`) <> ''
    AND trim(`instance_key`) <> ''
    AND trim(`case_instance_id`) <> ''
    AND trim(`output_key`) <> ''
    AND json_valid(`output_definition_snapshot`)
    AND json_extract(`output_definition_snapshot`, '$.outputKey') =
      `output_key`
    AND json_extract(`output_definition_snapshot`, '$.rendererVersion') =
      `renderer_version`
    AND json_type(`output_definition_snapshot`, '$.placements') = 'array'
    AND json_array_length(
      json_extract(`output_definition_snapshot`, '$.placements')
    ) > 0
    AND length(`output_definition_sha256`) = 71
    AND substr(`output_definition_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`output_definition_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `output_definition_sha256` = lower(`output_definition_sha256`)
    AND trim(`template_source_artifact_id`) <> ''
    AND length(`template_source_artifact_sha256`) = 64
    AND lower(`template_source_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `template_source_artifact_sha256` =
      lower(`template_source_artifact_sha256`)
    AND `renderer_contract` =
      'creditex-activity-work-pack-pdf-renderer/v1'
    AND `renderer_version` = '1.0.0'
    AND trim(`object_key`) <> ''
    AND trim(`file_name`) <> ''
    AND lower(`content_type`) = 'application/pdf'
    AND `size_bytes` BETWEEN 1 AND 52428800
    AND length(`pdf_sha256`) = 64
    AND lower(`pdf_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `pdf_sha256` = lower(`pdf_sha256`)
    AND trim(`rendered_by_uid`) <> ''
    AND datetime(`rendered_at`) IS NOT NULL
  )
);

CREATE UNIQUE INDEX `compliance_work_pack_render_receipt_instance_idx`
  ON `compliance_activity_work_pack_render_receipts`
    (`organisation_id`, `case_instance_id`);

CREATE UNIQUE INDEX `compliance_work_pack_render_receipt_object_idx`
  ON `compliance_activity_work_pack_render_receipts`
    (`organisation_id`, `object_key`);

CREATE TABLE `compliance_activity_work_pack_browser_upload_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `contract` text NOT NULL,
  `organisation_id` text NOT NULL,
  `instance_key` text NOT NULL,
  `case_instance_id` text NOT NULL,
  `owner_uid` text NOT NULL,
  `actor_uid` text NOT NULL,
  `member_id` text NOT NULL,
  `work_order_id` text NOT NULL,
  `client_upload_id` text NOT NULL,
  `prompt_key` text NOT NULL,
  `purpose` text NOT NULL,
  `artifact_kind` text NOT NULL,
  `device_id` text NOT NULL,
  `object_key` text NOT NULL,
  `file_name` text NOT NULL,
  `content_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `original_sha256` text NOT NULL,
  `metadata_snapshot` text NOT NULL,
  `metadata_sha256` text NOT NULL,
  `captured_at` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_work_pack_browser_upload_check` CHECK (
    `contract` = 'creditex-activity-work-pack-browser-upload/v1'
    AND trim(`organisation_id`) <> ''
    AND trim(`instance_key`) <> ''
    AND trim(`case_instance_id`) <> ''
    AND trim(`owner_uid`) <> ''
    AND trim(`actor_uid`) <> ''
    AND trim(`member_id`) <> ''
    AND trim(`work_order_id`) <> ''
    AND trim(`client_upload_id`) <> ''
    AND trim(`prompt_key`) <> ''
    AND `purpose` IN ('artifact', 'signature')
    AND (
      (`purpose` = 'artifact' AND `artifact_kind` IN ('photo', 'document'))
      OR (`purpose` = 'signature' AND `artifact_kind` = '')
    )
    AND trim(`device_id`) <> ''
    AND trim(`object_key`) <> ''
    AND trim(`file_name`) <> ''
    AND trim(`content_type`) <> ''
    AND `size_bytes` BETWEEN 1 AND 52428800
    AND length(`original_sha256`) = 64
    AND lower(`original_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `original_sha256` = lower(`original_sha256`)
    AND json_valid(`metadata_snapshot`)
    AND length(`metadata_sha256`) = 71
    AND substr(`metadata_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`metadata_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `metadata_sha256` = lower(`metadata_sha256`)
    AND datetime(`captured_at`) IS NOT NULL
    AND datetime(`created_at`) IS NOT NULL
  )
);

CREATE UNIQUE INDEX `compliance_work_pack_browser_upload_client_idx`
  ON `compliance_activity_work_pack_browser_upload_receipts`
    (`owner_uid`, `actor_uid`, `client_upload_id`);

CREATE UNIQUE INDEX `compliance_work_pack_browser_upload_object_idx`
  ON `compliance_activity_work_pack_browser_upload_receipts` (`object_key`);

CREATE INDEX `compliance_work_pack_browser_upload_instance_idx`
  ON `compliance_activity_work_pack_browser_upload_receipts`
    (`organisation_id`, `instance_key`, `prompt_key`, `created_at`);

CREATE TABLE `compliance_activity_work_pack_final_records` (
  `id` text PRIMARY KEY NOT NULL,
  `contract` text NOT NULL,
  `organisation_id` text NOT NULL,
  `instance_key` text NOT NULL,
  `case_instance_id` text NOT NULL,
  `work_pack_version_id` text NOT NULL,
  `instance_sha256` text NOT NULL,
  `definition_sha256` text NOT NULL,
  `prefill_sha256` text NOT NULL,
  `response_sha256` text NOT NULL,
  `declarations_sha256` text NOT NULL,
  `signature_manifest_snapshot` text NOT NULL,
  `signature_manifest_sha256` text NOT NULL,
  `renderer_contract` text NOT NULL,
  `renderer_version` text NOT NULL,
  `output_key` text NOT NULL,
  `output_definition_sha256` text NOT NULL,
  `template_source_artifact_id` text NOT NULL,
  `template_source_artifact_sha256` text NOT NULL,
  `object_key` text NOT NULL,
  `file_name` text NOT NULL,
  `content_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `pdf_sha256` text NOT NULL,
  `integrity_receipt_id` text NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `finalised_by_uid` text NOT NULL,
  `finalised_at` text NOT NULL,
  CONSTRAINT `compliance_work_pack_final_record_identity_check` CHECK (
    trim(`id`) <> ''
    AND `contract` = 'creditex-activity-work-pack-final-record/v1'
    AND trim(`organisation_id`) <> ''
    AND trim(`instance_key`) <> ''
    AND trim(`case_instance_id`) <> ''
    AND trim(`work_pack_version_id`) <> ''
    AND `renderer_contract` =
      'creditex-activity-work-pack-pdf-renderer/v1'
    AND `renderer_version` = '1.0.0'
    AND trim(`output_key`) <> ''
    AND length(`output_definition_sha256`) = 71
    AND substr(`output_definition_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`output_definition_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `output_definition_sha256` = lower(`output_definition_sha256`)
    AND trim(`template_source_artifact_id`) <> ''
    AND length(`template_source_artifact_sha256`) = 64
    AND lower(`template_source_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `template_source_artifact_sha256` =
      lower(`template_source_artifact_sha256`)
    AND trim(`object_key`) <> ''
    AND trim(`file_name`) <> ''
    AND lower(`content_type`) = 'application/pdf'
    AND `size_bytes` BETWEEN 1 AND 52428800
    AND length(`pdf_sha256`) = 64
    AND lower(`pdf_sha256`) NOT GLOB '*[^0-9a-f]*'
    AND `pdf_sha256` = lower(`pdf_sha256`)
    AND trim(`integrity_receipt_id`) <> ''
    AND trim(`created_by_uid`) <> ''
    AND datetime(`created_at`) IS NOT NULL
    AND trim(`finalised_by_uid`) <> ''
    AND datetime(`finalised_at`) IS NOT NULL
    AND `finalised_at` >= `created_at`
  ),
  CONSTRAINT `compliance_work_pack_final_record_hash_check` CHECK (
    length(`instance_sha256`) = 71
    AND substr(`instance_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`instance_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `instance_sha256` = lower(`instance_sha256`)
    AND length(`definition_sha256`) = 71
    AND substr(`definition_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`definition_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `definition_sha256` = lower(`definition_sha256`)
    AND length(`prefill_sha256`) = 71
    AND substr(`prefill_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`prefill_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `prefill_sha256` = lower(`prefill_sha256`)
    AND length(`response_sha256`) = 71
    AND substr(`response_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`response_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `response_sha256` = lower(`response_sha256`)
    AND length(`declarations_sha256`) = 71
    AND substr(`declarations_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`declarations_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `declarations_sha256` = lower(`declarations_sha256`)
    AND length(`signature_manifest_sha256`) = 71
    AND substr(`signature_manifest_sha256`, 1, 7) = 'sha256:'
    AND lower(substr(`signature_manifest_sha256`, 8)) NOT GLOB '*[^0-9a-f]*'
    AND `signature_manifest_sha256` = lower(`signature_manifest_sha256`)
  ),
  CONSTRAINT `compliance_work_pack_final_record_manifest_check` CHECK (
    json_valid(`signature_manifest_snapshot`)
    AND json_extract(`signature_manifest_snapshot`, '$.contract') =
      'creditex-activity-work-pack-signature-manifest/v1'
    AND json_extract(`signature_manifest_snapshot`, '$.instanceKey') =
      `instance_key`
    AND json_extract(`signature_manifest_snapshot`, '$.caseInstanceId') =
      `case_instance_id`
    AND json_extract(`signature_manifest_snapshot`, '$.definitionSha256') =
      `definition_sha256`
    AND json_extract(`signature_manifest_snapshot`, '$.prefillSha256') =
      `prefill_sha256`
    AND json_extract(`signature_manifest_snapshot`, '$.responseSha256') =
      `response_sha256`
    AND json_extract(
      `signature_manifest_snapshot`, '$.declarationsSha256'
    ) = `declarations_sha256`
    AND json_type(`signature_manifest_snapshot`, '$.signatures') = 'array'
  )
);

CREATE UNIQUE INDEX `compliance_work_pack_final_record_instance_idx`
  ON `compliance_activity_work_pack_final_records`
    (`organisation_id`, `case_instance_id`);

CREATE UNIQUE INDEX `compliance_work_pack_final_record_object_idx`
  ON `compliance_activity_work_pack_final_records`
    (`organisation_id`, `object_key`);

CREATE INDEX `compliance_work_pack_final_record_lineage_idx`
  ON `compliance_activity_work_pack_final_records`
    (`organisation_id`, `instance_key`, `finalised_at`, `id`);
