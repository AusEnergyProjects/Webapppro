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

CREATE TRIGGER `compliance_work_pack_calculation_review_insert_guard`
BEFORE INSERT ON `compliance_activity_work_pack_calculation_reviews`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_instances` instance
    JOIN `compliance_cases` compliance_case
      ON compliance_case.`id` = instance.`compliance_case_id`
      AND compliance_case.`organisation_id` = instance.`organisation_id`
    JOIN `compliance_calculation_runs` calculation
      ON calculation.`id` = NEW.`calculation_run_id`
      AND calculation.`organisation_id` = instance.`organisation_id`
      AND calculation.`case_id` = instance.`compliance_case_id`
      AND calculation.`case_revision` = compliance_case.`revision`
      AND calculation.`status` = 'calculated'
      AND calculation.`run_by_uid` <> NEW.`reviewer_uid`
    JOIN `compliance_calculator_versions` calculator
      ON calculator.`id` = NEW.`calculator_version_id`
      AND calculator.`id` = calculation.`calculator_version_id`
      AND calculator.`organisation_id` = instance.`organisation_id`
      AND calculator.`activity_version_id` = compliance_case.`activity_version_id`
      AND calculator.`approval_state` = 'approved'
      AND calculator.`official_source_sha256` = NEW.`calculator_source_sha256`
    JOIN `compliance_calculator_engine_receipts` engine_receipt
      ON engine_receipt.`id` = NEW.`engine_receipt_id`
      AND engine_receipt.`organisation_id` = instance.`organisation_id`
      AND engine_receipt.`calculator_version_id` = calculator.`id`
      AND engine_receipt.`calculator_version_number` = calculator.`version`
      AND engine_receipt.`result` = 'passed'
    JOIN json_each(
      instance.`response_snapshot`, '$.response.dependencyResolutions'
    ) dependency
      ON dependency.`key` = NEW.`dependency_key`
      AND json_extract(dependency.`value`, '$.referenceIds[0]') =
        NEW.`calculation_run_id`
      AND json_array_length(
        json_extract(dependency.`value`, '$.referenceIds')
      ) = 1
    WHERE instance.`id` = NEW.`case_instance_id`
      AND instance.`instance_key` = NEW.`instance_key`
      AND instance.`organisation_id` = NEW.`organisation_id`
      AND NOT EXISTS (
        SELECT 1 FROM `compliance_activity_work_pack_instances` newer
        WHERE newer.`organisation_id` = instance.`organisation_id`
          AND newer.`instance_key` = instance.`instance_key`
          AND newer.`revision` > instance.`revision`
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_CALCULATION_REVIEW_BINDING_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_users` reviewer
    WHERE reviewer.`organisation_id` = NEW.`organisation_id`
      AND reviewer.`firebase_uid` = NEW.`reviewer_uid`
      AND reviewer.`status` = 'active'
      AND reviewer.`role` IN ('admin', 'reviewer')
      AND reviewer.`governance_identity_verified` = 1
      AND trim(reviewer.`governance_identity_verified_by_uid`) <> ''
      AND reviewer.`governance_identity_verified_by_uid` <> reviewer.`firebase_uid`
    UNION ALL
    SELECT 1
    FROM `admin_users` reviewer
    JOIN `compliance_organisations` organisation
      ON organisation.`id` = NEW.`organisation_id`
      AND organisation.`organisation_code` = 'CREDITEX-AU'
      AND organisation.`status` = 'active'
    WHERE reviewer.`firebase_uid` = NEW.`reviewer_uid`
      AND reviewer.`status` = 'active'
      AND reviewer.`role` IN ('owner', 'admin', 'reviewer')
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_CALCULATION_REVIEWER_INVALID') END;
END;

CREATE TRIGGER `compliance_work_pack_calculation_review_update_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_calculation_reviews`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_CALCULATION_REVIEW_IMMUTABLE');
END;
CREATE TRIGGER `compliance_work_pack_calculation_review_delete_guard`
BEFORE DELETE ON `compliance_activity_work_pack_calculation_reviews`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_CALCULATION_REVIEW_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_work_pack_calculation_review_audit`
AFTER INSERT ON `compliance_activity_work_pack_calculation_reviews`
BEGIN
  INSERT INTO `compliance_audit_events` (
    `id`, `organisation_id`, `actor_type`, `actor_uid`, `event_type`,
    `target_type`, `target_id`, `summary`, `metadata`, `created_at`
  ) VALUES (
    'work-pack-calculation-review-audit:' || NEW.`id`,
    NEW.`organisation_id`, 'compliance', NEW.`reviewer_uid`,
    'work_pack.calculation_reviewed', 'calculation_run',
    NEW.`calculation_run_id`,
    'An immutable work-pack calculation review was recorded.',
    json_object(
      'instanceKey', NEW.`instance_key`,
      'dependencyKey', NEW.`dependency_key`,
      'decision', NEW.`decision`,
      'inputSha256', NEW.`input_sha256`,
      'outputSha256', NEW.`output_sha256`,
      'calculatorVersionId', NEW.`calculator_version_id`,
      'engineReceiptId', NEW.`engine_receipt_id`
    ), NEW.`created_at`
  );
END;

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

CREATE TRIGGER `compliance_work_pack_render_receipt_insert_guard`
BEFORE INSERT ON `compliance_activity_work_pack_render_receipts`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_instances` instance
    JOIN `compliance_activity_work_pack_versions` version
      ON version.`id` = instance.`work_pack_version_id`
      AND version.`organisation_id` = instance.`organisation_id`
      AND version.`publish_state` = 'published'
    JOIN json_each(version.`schema_snapshot`, '$.documentOutputs') output
      ON json_extract(output.`value`, '$.outputKey') = NEW.`output_key`
      AND json(output.`value`) = json(NEW.`output_definition_snapshot`)
      AND json_extract(output.`value`, '$.required') = 1
      AND json_extract(output.`value`, '$.rendererVersion') =
        NEW.`renderer_version`
    JOIN `compliance_activity_work_pack_source_bindings` binding
      ON binding.`organisation_id` = instance.`organisation_id`
      AND binding.`work_pack_version_id` = version.`id`
      AND binding.`schema_sha256` = version.`schema_sha256`
      AND binding.`source_role` = 'requirement'
      AND binding.`target_key` = json_extract(
        output.`value`, '$.sourceBindingTargetKey'
      )
      AND binding.`binding_state` = 'approved'
      AND binding.`source_artifact_id` = NEW.`template_source_artifact_id`
      AND binding.`source_artifact_sha256` =
        NEW.`template_source_artifact_sha256`
    JOIN `compliance_official_source_artifacts` artifact
      ON artifact.`id` = binding.`source_artifact_id`
      AND artifact.`organisation_id` = binding.`organisation_id`
      AND artifact.`sha256` = binding.`source_artifact_sha256`
      AND lower(artifact.`content_type`) = 'application/pdf'
    JOIN `compliance_official_source_review_decisions` decision
      ON decision.`organisation_id` = artifact.`organisation_id`
      AND decision.`subject_type` = 'artifact'
      AND decision.`subject_id` = artifact.`id`
      AND decision.`artifact_id` = artifact.`id`
      AND decision.`artifact_sha256` = artifact.`sha256`
      AND decision.`artifact_object_key` = artifact.`object_key`
      AND decision.`decision` = 'approved'
    WHERE instance.`id` = NEW.`case_instance_id`
      AND instance.`organisation_id` = NEW.`organisation_id`
      AND instance.`instance_key` = NEW.`instance_key`
      AND instance.`status` = 'ready_to_sign'
      AND NOT EXISTS (
        SELECT 1
        FROM `compliance_official_source_review_decisions` successor
        WHERE successor.`supersedes_decision_id` = decision.`id`
      )
      AND 1 = (
        SELECT COUNT(DISTINCT exact_binding.`source_artifact_id`)
        FROM `compliance_activity_work_pack_source_bindings` exact_binding
        WHERE exact_binding.`organisation_id` = instance.`organisation_id`
          AND exact_binding.`work_pack_version_id` = version.`id`
          AND exact_binding.`schema_sha256` = version.`schema_sha256`
          AND exact_binding.`source_role` = 'requirement'
          AND exact_binding.`target_key` = binding.`target_key`
          AND exact_binding.`binding_state` = 'approved'
      )
  ) THEN RAISE(
    ABORT, 'COMPLIANCE_WORK_PACK_RENDER_TEMPLATE_BINDING_INVALID'
  ) END;
END;

CREATE TRIGGER `compliance_work_pack_render_receipt_update_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_render_receipts`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_RENDER_RECEIPT_IMMUTABLE');
END;
CREATE TRIGGER `compliance_work_pack_render_receipt_delete_guard`
BEFORE DELETE ON `compliance_activity_work_pack_render_receipts`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_RENDER_RECEIPT_DELETE_BLOCKED');
END;

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

CREATE TRIGGER `compliance_work_pack_browser_upload_insert_guard`
BEFORE INSERT ON `compliance_activity_work_pack_browser_upload_receipts`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_instances` instance
    JOIN `compliance_activity_work_pack_versions` version
      ON version.`id` = instance.`work_pack_version_id`
      AND version.`organisation_id` = instance.`organisation_id`
    JOIN `trade_work_orders` work
      ON work.`id` = instance.`work_order_id`
      AND work.`firebase_uid` = NEW.`owner_uid`
      AND work.`record_status` = 'active'
    JOIN `trade_team_members` member
      ON member.`id` = NEW.`member_id`
      AND member.`owner_uid` = NEW.`owner_uid`
      AND member.`member_uid` = NEW.`actor_uid`
      AND member.`status` = 'active'
      AND (
        member.`job_scope` = 'team'
        OR work.`assignee_member_id` = member.`id`
      )
    JOIN json_each(version.`schema_snapshot`, '$.sections') section
    JOIN json_each(section.`value`, '$.prompts') prompt
    WHERE instance.`id` = NEW.`case_instance_id`
      AND instance.`organisation_id` = NEW.`organisation_id`
      AND instance.`instance_key` = NEW.`instance_key`
      AND instance.`work_order_id` = NEW.`work_order_id`
      AND instance.`status` IN ('not_started', 'in_progress', 'ready_to_sign')
      AND NOT EXISTS (
        SELECT 1 FROM `compliance_activity_work_pack_instances` newer
        WHERE newer.`organisation_id` = instance.`organisation_id`
          AND newer.`compliance_case_id` = instance.`compliance_case_id`
          AND newer.`revision` > instance.`revision`
      )
      AND (
        (
          json_type(section.`value`, '$.repeatability') = 'null'
          AND json_extract(prompt.`value`, '$.promptKey') = NEW.`prompt_key`
        )
        OR (
          json_type(section.`value`, '$.repeatability') = 'object'
          AND substr(
            NEW.`prompt_key`, 1,
            length(json_extract(section.`value`, '$.sectionKey')) + 1
          ) = json_extract(section.`value`, '$.sectionKey') || '['
          AND substr(NEW.`prompt_key`, instr(NEW.`prompt_key`, '].') + 2) =
            json_extract(prompt.`value`, '$.promptKey')
        )
      )
      AND (
        (
          NEW.`purpose` = 'artifact'
          AND json_extract(prompt.`value`, '$.type') = NEW.`artifact_kind`
          AND EXISTS (
            SELECT 1
            FROM json_each(
              prompt.`value`, '$.fileRequirement.allowedContentTypes'
            ) allowed
            WHERE lower(allowed.`value`) = lower(NEW.`content_type`)
          )
          AND (
            json_extract(
              prompt.`value`, '$.fileRequirement.metadataRequired'
            ) <> 1
            OR json_extract(
              NEW.`metadata_snapshot`, '$.exif.status'
            ) = 'valid'
          )
          AND (
            json_extract(prompt.`value`, '$.fileRequirement.gpsRequired') <> 1
            OR (
              json_type(NEW.`metadata_snapshot`, '$.gps.latitude')
                IN ('integer', 'real')
              AND json_type(NEW.`metadata_snapshot`, '$.gps.longitude')
                IN ('integer', 'real')
            )
          )
          AND (
            json_extract(
              prompt.`value`, '$.fileRequirement.captureTimeRequired'
            ) <> 1
            OR datetime(
              json_extract(NEW.`metadata_snapshot`, '$.capturedAt')
            ) IS NOT NULL
          )
        )
        OR (
          NEW.`purpose` = 'signature'
          AND json_extract(prompt.`value`, '$.type') = 'signature'
          AND lower(NEW.`content_type`) IN (
            'application/json', 'application/pdf', 'image/jpeg',
            'image/png', 'image/webp', 'image/svg+xml'
          )
        )
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_BROWSER_UPLOAD_INVALID') END;
END;

CREATE TRIGGER `compliance_work_pack_browser_upload_update_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_browser_upload_receipts`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_BROWSER_UPLOAD_IMMUTABLE');
END;
CREATE TRIGGER `compliance_work_pack_browser_upload_delete_guard`
BEFORE DELETE ON `compliance_activity_work_pack_browser_upload_receipts`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_BROWSER_UPLOAD_DELETE_BLOCKED');
END;

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

CREATE TRIGGER `compliance_work_pack_version_insert_guard`
BEFORE INSERT ON `compliance_activity_work_pack_versions`
BEGIN
  SELECT CASE WHEN NEW.`publish_state` <> 'draft'
    THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_DRAFT_INSERT_REQUIRED') END;
  SELECT CASE WHEN NEW.`updated_by_uid` <> NEW.`authored_by_uid`
    OR NEW.`updated_at` <> NEW.`authored_at`
    THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_INITIAL_AUTHOR_IDENTITY_INVALID') END;
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1
      FROM `compliance_users` member
      WHERE member.`organisation_id` = NEW.`organisation_id`
        AND member.`firebase_uid` = NEW.`authored_by_uid`
        AND member.`status` = 'active'
        AND member.`role` IN ('admin', 'case_manager', 'reviewer')
        AND member.`governance_identity_verified` = 1
        AND trim(member.`display_name`) <> ''
        AND instr(member.`email`, '@') > 1
    )
    OR EXISTS (
      SELECT 1
      FROM `admin_users` administrator
      JOIN `compliance_organisations` organisation
        ON organisation.`id` = NEW.`organisation_id`
      WHERE administrator.`firebase_uid` = NEW.`authored_by_uid`
        AND administrator.`status` = 'active'
        AND administrator.`role` IN ('owner', 'admin')
        AND organisation.`organisation_code` = 'CREDITEX-AU'
        AND organisation.`status` = 'active'
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_NAMED_AUTHOR_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_versions` activity
    JOIN `compliance_programs` program
      ON program.`id` = activity.`program_id`
      AND program.`organisation_id` = NEW.`organisation_id`
    WHERE activity.`id` = NEW.`activity_version_id`
      AND activity.`publish_state` IN ('draft', 'published')
      AND NEW.`effective_from` >= activity.`effective_from`
      AND (
        activity.`effective_to` = ''
        OR (
          NEW.`effective_to` <> ''
          AND NEW.`effective_to` <= activity.`effective_to`
        )
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_ACTIVITY_VERSION_REQUIRED') END;
  SELECT CASE WHEN NEW.`origin_kind` = 'manual' AND NOT EXISTS (
    SELECT 1
    FROM `compliance_manual_policy_bindings` binding
    JOIN `compliance_evidence_policy_versions` policy
      ON policy.`id` = binding.`evidence_policy_version_id`
      AND policy.`organisation_id` = binding.`organisation_id`
      AND policy.`activity_version_id` = binding.`activity_version_id`
    WHERE binding.`id` = NEW.`manual_policy_binding_id`
      AND binding.`organisation_id` = NEW.`organisation_id`
      AND binding.`activity_template_id` = NEW.`activity_template_id`
      AND binding.`activity_version_id` = NEW.`activity_version_id`
      AND binding.`version` = NEW.`manual_policy_binding_version`
      AND binding.`binding_snapshot_sha256` =
        NEW.`manual_policy_binding_sha256`
      AND binding.`evidence_policy_version_id` =
        NEW.`evidence_policy_version_id`
      AND binding.`lifecycle_state` = 'approved'
      AND policy.`version` = NEW.`evidence_policy_version`
      AND policy.`official_source_sha256` =
        NEW.`evidence_policy_source_sha256`
      AND policy.`requirements_complete` = 1
      AND policy.`publish_state` = 'published'
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_APPROVED_POLICY_BINDING_REQUIRED') END;
  SELECT CASE WHEN NEW.`version` <> 1 + COALESCE((
    SELECT MAX(existing.`version`)
    FROM `compliance_activity_work_pack_versions` existing
    WHERE existing.`organisation_id` = NEW.`organisation_id`
      AND existing.`activity_template_id` = NEW.`activity_template_id`
  ), 0) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_VERSION_SEQUENCE_INVALID') END;
END;

CREATE TRIGGER `compliance_work_pack_source_candidate_provenance_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_versions`
WHEN NEW.`origin_kind` <> OLD.`origin_kind`
  OR NEW.`client_request_id` <> OLD.`client_request_id`
  OR NEW.`source_candidate_contract` <> OLD.`source_candidate_contract`
  OR NEW.`source_candidate_snapshot` <> OLD.`source_candidate_snapshot`
  OR NEW.`source_candidate_sha256` <> OLD.`source_candidate_sha256`
  OR NEW.`source_binding_map_snapshot` <> OLD.`source_binding_map_snapshot`
  OR NEW.`source_binding_map_sha256` <> OLD.`source_binding_map_sha256`
  OR NEW.`candidate_blockers_snapshot` <> OLD.`candidate_blockers_snapshot`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SOURCE_CANDIDATE_IMMUTABLE');
END;

CREATE TRIGGER `compliance_work_pack_version_transition_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_versions`
WHEN NOT (
  (
    OLD.`publish_state` = 'draft'
    AND NEW.`publish_state` = 'draft'
    AND NEW.`id` = OLD.`id`
    AND NEW.`organisation_id` = OLD.`organisation_id`
    AND NEW.`activity_version_id` = OLD.`activity_version_id`
    AND NEW.`activity_template_id` = OLD.`activity_template_id`
    AND NEW.`manual_policy_binding_id` = OLD.`manual_policy_binding_id`
    AND NEW.`manual_policy_binding_version` = OLD.`manual_policy_binding_version`
    AND NEW.`manual_policy_binding_sha256` = OLD.`manual_policy_binding_sha256`
    AND NEW.`evidence_policy_version_id` = OLD.`evidence_policy_version_id`
    AND NEW.`evidence_policy_version` = OLD.`evidence_policy_version`
    AND NEW.`evidence_policy_source_sha256` = OLD.`evidence_policy_source_sha256`
    AND NEW.`version` = OLD.`version`
    AND NEW.`contract` = OLD.`contract`
    AND NEW.`authored_by_uid` = OLD.`authored_by_uid`
    AND NEW.`authored_at` = OLD.`authored_at`
    AND NEW.`created_at` = OLD.`created_at`
    AND NEW.`updated_at` > OLD.`updated_at`
  )
  OR (
    OLD.`publish_state` = 'draft'
    AND NEW.`publish_state` = 'published'
    AND NEW.`id` = OLD.`id`
    AND NEW.`organisation_id` = OLD.`organisation_id`
    AND NEW.`activity_version_id` = OLD.`activity_version_id`
    AND NEW.`activity_template_id` = OLD.`activity_template_id`
    AND NEW.`manual_policy_binding_id` = OLD.`manual_policy_binding_id`
    AND NEW.`manual_policy_binding_version` = OLD.`manual_policy_binding_version`
    AND NEW.`manual_policy_binding_sha256` = OLD.`manual_policy_binding_sha256`
    AND NEW.`evidence_policy_version_id` = OLD.`evidence_policy_version_id`
    AND NEW.`evidence_policy_version` = OLD.`evidence_policy_version`
    AND NEW.`evidence_policy_source_sha256` = OLD.`evidence_policy_source_sha256`
    AND NEW.`version` = OLD.`version`
    AND NEW.`contract` = OLD.`contract`
    AND NEW.`title` = OLD.`title`
    AND NEW.`schema_snapshot` = OLD.`schema_snapshot`
    AND NEW.`schema_sha256` = OLD.`schema_sha256`
    AND NEW.`effective_from` = OLD.`effective_from`
    AND NEW.`effective_to` = OLD.`effective_to`
    AND NEW.`authored_by_uid` = OLD.`authored_by_uid`
    AND NEW.`authored_at` = OLD.`authored_at`
    AND NEW.`updated_by_uid` = OLD.`updated_by_uid`
    AND NEW.`updated_at` = OLD.`updated_at`
    AND NEW.`created_at` = OLD.`created_at`
  )
  OR (
    OLD.`publish_state` = 'published'
    AND NEW.`publish_state` = 'withdrawn'
    AND NEW.`id` = OLD.`id`
    AND NEW.`organisation_id` = OLD.`organisation_id`
    AND NEW.`activity_version_id` = OLD.`activity_version_id`
    AND NEW.`activity_template_id` = OLD.`activity_template_id`
    AND NEW.`manual_policy_binding_id` = OLD.`manual_policy_binding_id`
    AND NEW.`manual_policy_binding_version` = OLD.`manual_policy_binding_version`
    AND NEW.`manual_policy_binding_sha256` = OLD.`manual_policy_binding_sha256`
    AND NEW.`evidence_policy_version_id` = OLD.`evidence_policy_version_id`
    AND NEW.`evidence_policy_version` = OLD.`evidence_policy_version`
    AND NEW.`evidence_policy_source_sha256` = OLD.`evidence_policy_source_sha256`
    AND NEW.`version` = OLD.`version`
    AND NEW.`contract` = OLD.`contract`
    AND NEW.`title` = OLD.`title`
    AND NEW.`schema_snapshot` = OLD.`schema_snapshot`
    AND NEW.`schema_sha256` = OLD.`schema_sha256`
    AND NEW.`effective_from` = OLD.`effective_from`
    AND NEW.`effective_to` = OLD.`effective_to`
    AND NEW.`authored_by_uid` = OLD.`authored_by_uid`
    AND NEW.`authored_at` = OLD.`authored_at`
    AND NEW.`reviewed_by_uid` = OLD.`reviewed_by_uid`
    AND NEW.`reviewed_at` = OLD.`reviewed_at`
    AND NEW.`review_note` = OLD.`review_note`
    AND NEW.`updated_by_uid` = OLD.`updated_by_uid`
    AND NEW.`updated_at` = OLD.`updated_at`
    AND NEW.`created_at` = OLD.`created_at`
  )
  OR (
    OLD.`publish_state` = 'draft'
    AND NEW.`publish_state` = 'abandoned'
    AND NEW.`id` = OLD.`id`
    AND NEW.`organisation_id` = OLD.`organisation_id`
    AND NEW.`activity_version_id` = OLD.`activity_version_id`
    AND NEW.`activity_template_id` = OLD.`activity_template_id`
    AND NEW.`manual_policy_binding_id` = OLD.`manual_policy_binding_id`
    AND NEW.`manual_policy_binding_version` = OLD.`manual_policy_binding_version`
    AND NEW.`manual_policy_binding_sha256` = OLD.`manual_policy_binding_sha256`
    AND NEW.`evidence_policy_version_id` = OLD.`evidence_policy_version_id`
    AND NEW.`evidence_policy_version` = OLD.`evidence_policy_version`
    AND NEW.`evidence_policy_source_sha256` = OLD.`evidence_policy_source_sha256`
    AND NEW.`version` = OLD.`version`
    AND NEW.`contract` = OLD.`contract`
    AND NEW.`title` = OLD.`title`
    AND NEW.`schema_snapshot` = OLD.`schema_snapshot`
    AND NEW.`schema_sha256` = OLD.`schema_sha256`
    AND NEW.`effective_from` = OLD.`effective_from`
    AND NEW.`effective_to` = OLD.`effective_to`
    AND NEW.`authored_by_uid` = OLD.`authored_by_uid`
    AND NEW.`authored_at` = OLD.`authored_at`
    AND NEW.`updated_by_uid` = OLD.`updated_by_uid`
    AND NEW.`updated_at` = OLD.`updated_at`
    AND NEW.`created_at` = OLD.`created_at`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_VERSION_IMMUTABLE');
END;

CREATE TRIGGER `compliance_work_pack_version_draft_edit_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_versions`
WHEN OLD.`publish_state` = 'draft' AND NEW.`publish_state` = 'draft'
BEGIN
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1
      FROM `compliance_users` editor
      WHERE editor.`organisation_id` = NEW.`organisation_id`
        AND editor.`firebase_uid` = NEW.`updated_by_uid`
        AND editor.`status` = 'active'
        AND editor.`role` IN ('admin', 'case_manager', 'reviewer')
        AND editor.`governance_identity_verified` = 1
        AND trim(editor.`display_name`) <> ''
        AND instr(editor.`email`, '@') > 1
    )
    OR EXISTS (
      SELECT 1
      FROM `admin_users` administrator
      JOIN `compliance_organisations` organisation
        ON organisation.`id` = NEW.`organisation_id`
      WHERE administrator.`firebase_uid` = NEW.`updated_by_uid`
        AND administrator.`status` = 'active'
        AND administrator.`role` IN ('owner', 'admin')
        AND organisation.`organisation_code` = 'CREDITEX-AU'
        AND organisation.`status` = 'active'
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_NAMED_DRAFT_EDITOR_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_source_bindings` binding
    WHERE binding.`organisation_id` = NEW.`organisation_id`
      AND binding.`work_pack_version_id` = NEW.`id`
      AND binding.`binding_state` = 'approved'
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_EDIT_REVIEWED_DRAFT_BLOCKED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_versions` activity
    WHERE activity.`id` = NEW.`activity_version_id`
      AND NEW.`effective_from` >= activity.`effective_from`
      AND (
        activity.`effective_to` = ''
        OR (
          NEW.`effective_to` <> ''
          AND NEW.`effective_to` <= activity.`effective_to`
        )
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_ACTIVITY_VERSION_REQUIRED') END;
END;

CREATE TRIGGER `compliance_work_pack_version_publish_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_versions`
WHEN OLD.`publish_state` = 'draft' AND NEW.`publish_state` = 'published'
BEGIN
  SELECT CASE WHEN NEW.`origin_kind` <> 'manual'
    THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SOURCE_CANDIDATE_REVIEW_REQUIRED') END;
  SELECT CASE WHEN NEW.`reviewed_by_uid` = NEW.`authored_by_uid`
    THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_INDEPENDENT_REVIEWER_REQUIRED') END;
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1
      FROM `compliance_users` reviewer
      WHERE reviewer.`organisation_id` = NEW.`organisation_id`
        AND reviewer.`firebase_uid` = NEW.`reviewed_by_uid`
        AND reviewer.`status` = 'active'
        AND reviewer.`role` IN ('admin', 'reviewer')
        AND reviewer.`governance_identity_verified` = 1
        AND trim(reviewer.`governance_identity_verified_by_uid`) <> ''
        AND reviewer.`governance_identity_verified_by_uid` <>
          reviewer.`firebase_uid`
        AND trim(reviewer.`display_name`) <> ''
        AND instr(reviewer.`email`, '@') > 1
    )
    OR EXISTS (
      SELECT 1
      FROM `admin_users` administrator
      JOIN `compliance_organisations` organisation
        ON organisation.`id` = NEW.`organisation_id`
      WHERE administrator.`firebase_uid` = NEW.`reviewed_by_uid`
        AND administrator.`status` = 'active'
        AND administrator.`role` IN ('owner', 'admin', 'reviewer')
        AND organisation.`organisation_code` = 'CREDITEX-AU'
        AND organisation.`status` = 'active'
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_INDEPENDENT_REVIEWER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_versions` activity
    JOIN `compliance_programs` program
      ON program.`id` = activity.`program_id`
      AND program.`organisation_id` = NEW.`organisation_id`
    WHERE activity.`id` = NEW.`activity_version_id`
      AND activity.`publish_state` = 'published'
      AND program.`publish_state` = 'published'
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_PUBLISHED_ACTIVITY_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_manual_policy_bindings` binding
    JOIN `compliance_evidence_policy_versions` policy
      ON policy.`id` = binding.`evidence_policy_version_id`
      AND policy.`organisation_id` = binding.`organisation_id`
      AND policy.`activity_version_id` = binding.`activity_version_id`
    WHERE binding.`id` = NEW.`manual_policy_binding_id`
      AND binding.`organisation_id` = NEW.`organisation_id`
      AND binding.`activity_template_id` = NEW.`activity_template_id`
      AND binding.`activity_version_id` = NEW.`activity_version_id`
      AND binding.`version` = NEW.`manual_policy_binding_version`
      AND binding.`binding_snapshot_sha256` =
        NEW.`manual_policy_binding_sha256`
      AND binding.`evidence_policy_version_id` =
        NEW.`evidence_policy_version_id`
      AND binding.`lifecycle_state` = 'approved'
      AND policy.`version` = NEW.`evidence_policy_version`
      AND policy.`official_source_sha256` =
        NEW.`evidence_policy_source_sha256`
      AND policy.`requirements_complete` = 1
      AND policy.`publish_state` = 'published'
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_APPROVED_POLICY_BINDING_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `compliance_evidence_requirements` requirement
    WHERE requirement.`organisation_id` = NEW.`organisation_id`
      AND requirement.`policy_version_id` = NEW.`evidence_policy_version_id`
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.`schema_snapshot`, '$.sections') section,
          json_each(section.`value`, '$.prompts') prompt,
          json_each(prompt.`value`, '$.requirementKeys') requirement_key
        WHERE requirement_key.`value` = requirement.`requirement_code`
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_REQUIREMENT_COVERAGE_INCOMPLETE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.`schema_snapshot`, '$.sections') section,
      json_each(section.`value`, '$.prompts') prompt,
      json_each(prompt.`value`, '$.requirementKeys') requirement_key
    WHERE NOT EXISTS (
      SELECT 1
      FROM `compliance_evidence_requirements` requirement
      WHERE requirement.`organisation_id` = NEW.`organisation_id`
        AND requirement.`policy_version_id` = NEW.`evidence_policy_version_id`
        AND requirement.`requirement_code` = requirement_key.`value`
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_REQUIREMENT_MAPPING_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_source_bindings` binding
    WHERE binding.`organisation_id` = NEW.`organisation_id`
      AND binding.`work_pack_version_id` = NEW.`id`
      AND binding.`source_role` = 'requirement'
      AND binding.`target_key` = 'work_pack'
      AND binding.`binding_state` = 'approved'
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_APPROVED_SOURCE_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.`schema_snapshot`, '$.dependencies') dependency
    WHERE json_extract(dependency.`value`, '$.required') = 1
      AND NOT EXISTS (
        SELECT 1
        FROM `compliance_activity_work_pack_source_bindings` binding
        WHERE binding.`organisation_id` = NEW.`organisation_id`
          AND binding.`work_pack_version_id` = NEW.`id`
          AND binding.`source_role` =
            json_extract(dependency.`value`, '$.kind')
          AND binding.`target_key` =
            json_extract(dependency.`value`, '$.dependencyKey')
          AND binding.`binding_state` = 'approved'
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_DEPENDENCY_SOURCE_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.`schema_snapshot`, '$.sections') section,
      json_each(section.`value`, '$.prompts') prompt
    WHERE json_type(prompt.`value`, '$.attestation') = 'object'
      AND NOT EXISTS (
        SELECT 1
        FROM `compliance_activity_work_pack_source_bindings` binding
        WHERE binding.`organisation_id` = NEW.`organisation_id`
          AND binding.`work_pack_version_id` = NEW.`id`
          AND binding.`source_role` = 'requirement'
          AND binding.`target_key` = json_extract(
            prompt.`value`, '$.attestation.sourceBindingTargetKey'
          )
          AND binding.`binding_state` = 'approved'
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_ATTESTATION_SOURCE_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.`schema_snapshot`, '$.sections') section,
      json_each(section.`value`, '$.prompts') prompt
    WHERE json_extract(prompt.`value`, '$.type') = 'reference_document'
      AND (
        json_type(prompt.`value`, '$.referenceDocument') <> 'object'
        OR NOT EXISTS (
          SELECT 1
          FROM `compliance_activity_work_pack_source_bindings` binding
          WHERE binding.`organisation_id` = NEW.`organisation_id`
            AND binding.`work_pack_version_id` = NEW.`id`
            AND binding.`schema_sha256` = NEW.`schema_sha256`
            AND binding.`source_role` = 'requirement'
            AND binding.`target_key` = json_extract(
              prompt.`value`, '$.referenceDocument.sourceBindingTargetKey'
            )
            AND binding.`binding_state` = 'approved'
        )
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_REFERENCE_DOCUMENT_SOURCE_REQUIRED') END;
  SELECT CASE WHEN json_type(NEW.`schema_snapshot`, '$.documentOutputs') <>
      'array'
    THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_DOCUMENT_OUTPUTS_INVALID') END;
  SELECT CASE WHEN 1 <> (
    SELECT COUNT(*)
    FROM json_each(NEW.`schema_snapshot`, '$.documentOutputs') output
    WHERE json_extract(output.`value`, '$.required') = 1
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_DOCUMENT_OUTPUT_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.`schema_snapshot`, '$.documentOutputs') output
    WHERE trim(json_extract(output.`value`, '$.outputKey')) = ''
      OR json_extract(output.`value`, '$.rendererVersion') <> '1.0.0'
      OR json_type(output.`value`, '$.placements') <> 'array'
      OR json_array_length(json_extract(output.`value`, '$.placements')) < 1
      OR 1 <> (
        SELECT COUNT(DISTINCT binding.`source_artifact_id`)
        FROM `compliance_activity_work_pack_source_bindings` binding
        JOIN `compliance_official_source_artifacts` artifact
          ON artifact.`id` = binding.`source_artifact_id`
          AND artifact.`organisation_id` = binding.`organisation_id`
          AND artifact.`sha256` = binding.`source_artifact_sha256`
          AND artifact.`content_type` = 'application/pdf'
        JOIN `compliance_official_source_review_decisions` decision
          ON decision.`organisation_id` = artifact.`organisation_id`
          AND decision.`subject_type` = 'artifact'
          AND decision.`subject_id` = artifact.`id`
          AND decision.`artifact_id` = artifact.`id`
          AND decision.`artifact_sha256` = artifact.`sha256`
          AND decision.`artifact_object_key` = artifact.`object_key`
          AND decision.`decision` = 'approved'
        WHERE binding.`organisation_id` = NEW.`organisation_id`
          AND binding.`work_pack_version_id` = NEW.`id`
          AND binding.`schema_sha256` = NEW.`schema_sha256`
          AND binding.`source_role` = 'requirement'
          AND binding.`target_key` = json_extract(
            output.`value`, '$.sourceBindingTargetKey'
          )
          AND binding.`binding_state` = 'approved'
          AND NOT EXISTS (
            SELECT 1
            FROM `compliance_official_source_review_decisions` successor
            WHERE successor.`supersedes_decision_id` = decision.`id`
          )
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_DOCUMENT_TEMPLATE_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.`schema_snapshot`, '$.sections') section,
      json_each(section.`value`, '$.prompts') prompt
    WHERE json_extract(prompt.`value`, '$.type') = 'signature'
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.`schema_snapshot`, '$.documentOutputs') output,
          json_each(output.`value`, '$.placements') placement
        WHERE json_extract(output.`value`, '$.required') = 1
          AND json_extract(placement.`value`, '$.kind') = 'signature'
          AND json_extract(placement.`value`, '$.signaturePromptKey') =
            json_extract(prompt.`value`, '$.promptKey')
          AND json_extract(placement.`value`, '$.signerRoleKey') =
            json_extract(prompt.`value`, '$.signerRoleKey')
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SIGNATURE_PLACEMENT_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_versions` existing
    WHERE existing.`organisation_id` = NEW.`organisation_id`
      AND existing.`activity_version_id` = NEW.`activity_version_id`
      AND existing.`publish_state` = 'published'
      AND existing.`effective_from` <= COALESCE(
        NULLIF(NEW.`effective_to`, ''), '9999-12-31'
      )
      AND NEW.`effective_from` <= COALESCE(
        NULLIF(existing.`effective_to`, ''), '9999-12-31'
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_EFFECTIVE_RANGE_OVERLAP') END;
END;

CREATE TRIGGER `compliance_work_pack_version_withdraw_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_versions`
WHEN OLD.`publish_state` = 'published' AND NEW.`publish_state` = 'withdrawn'
BEGIN
  SELECT CASE WHEN NEW.`withdrawn_by_uid` = NEW.`authored_by_uid`
    THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_NAMED_WITHDRAWER_REQUIRED') END;
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1 FROM `compliance_users` member
      WHERE member.`organisation_id` = NEW.`organisation_id`
        AND member.`firebase_uid` = NEW.`withdrawn_by_uid`
        AND member.`status` = 'active'
        AND member.`role` IN ('admin', 'reviewer')
        AND member.`governance_identity_verified` = 1
        AND trim(member.`display_name`) <> ''
        AND instr(member.`email`, '@') > 1
    )
    OR EXISTS (
      SELECT 1
      FROM `admin_users` administrator
      JOIN `compliance_organisations` organisation
        ON organisation.`id` = NEW.`organisation_id`
      WHERE administrator.`firebase_uid` = NEW.`withdrawn_by_uid`
        AND administrator.`status` = 'active'
        AND administrator.`role` IN ('owner', 'admin', 'reviewer')
        AND organisation.`organisation_code` = 'CREDITEX-AU'
        AND organisation.`status` = 'active'
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_NAMED_WITHDRAWER_REQUIRED') END;
END;

CREATE TRIGGER `compliance_work_pack_version_abandon_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_versions`
WHEN OLD.`publish_state` = 'draft' AND NEW.`publish_state` = 'abandoned'
BEGIN
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1 FROM `compliance_users` member
      WHERE member.`organisation_id` = NEW.`organisation_id`
        AND member.`firebase_uid` = NEW.`abandoned_by_uid`
        AND member.`status` = 'active'
        AND member.`role` IN ('admin', 'case_manager', 'reviewer')
        AND member.`governance_identity_verified` = 1
        AND trim(member.`display_name`) <> ''
        AND instr(member.`email`, '@') > 1
    )
    OR EXISTS (
      SELECT 1
      FROM `admin_users` administrator
      JOIN `compliance_organisations` organisation
        ON organisation.`id` = NEW.`organisation_id`
      WHERE administrator.`firebase_uid` = NEW.`abandoned_by_uid`
        AND administrator.`status` = 'active'
        AND administrator.`role` IN ('owner', 'admin')
        AND organisation.`organisation_code` = 'CREDITEX-AU'
        AND organisation.`status` = 'active'
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_NAMED_ABANDONER_REQUIRED') END;
END;

CREATE TRIGGER `compliance_work_pack_version_delete_guard`
BEFORE DELETE ON `compliance_activity_work_pack_versions`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_VERSION_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_work_pack_source_insert_guard`
BEFORE INSERT ON `compliance_activity_work_pack_source_bindings`
BEGIN
  SELECT CASE WHEN NEW.`binding_state` <> 'pending_review'
    THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SOURCE_PENDING_INSERT_REQUIRED') END;
  SELECT CASE WHEN NOT (
    EXISTS (
      SELECT 1
      FROM `compliance_users` author
      WHERE author.`organisation_id` = NEW.`organisation_id`
        AND author.`firebase_uid` = NEW.`created_by_uid`
        AND author.`status` = 'active'
        AND author.`role` IN ('admin', 'case_manager', 'reviewer')
        AND author.`governance_identity_verified` = 1
        AND trim(author.`display_name`) <> ''
        AND instr(author.`email`, '@') > 1
    )
    OR EXISTS (
      SELECT 1
      FROM `admin_users` administrator
      JOIN `compliance_organisations` organisation
        ON organisation.`id` = NEW.`organisation_id`
      WHERE administrator.`firebase_uid` = NEW.`created_by_uid`
        AND administrator.`status` = 'active'
        AND administrator.`role` IN ('owner', 'admin')
        AND organisation.`organisation_code` = 'CREDITEX-AU'
        AND organisation.`status` = 'active'
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SOURCE_NAMED_AUTHOR_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_versions` version
    WHERE version.`id` = NEW.`work_pack_version_id`
      AND version.`organisation_id` = NEW.`organisation_id`
      AND version.`publish_state` = 'draft'
      AND version.`schema_sha256` = NEW.`schema_sha256`
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_DRAFT_VERSION_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_official_source_artifacts` artifact
    WHERE artifact.`id` = NEW.`source_artifact_id`
      AND artifact.`organisation_id` = NEW.`organisation_id`
      AND artifact.`sha256` = NEW.`source_artifact_sha256`
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SOURCE_ARTIFACT_REQUIRED') END;
END;

CREATE TRIGGER `compliance_work_pack_source_transition_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_source_bindings`
WHEN NOT (
  (
    OLD.`binding_state` = 'pending_review'
    AND NEW.`binding_state` IN ('approved', 'rejected')
    AND NEW.`id` = OLD.`id`
    AND NEW.`organisation_id` = OLD.`organisation_id`
    AND NEW.`work_pack_version_id` = OLD.`work_pack_version_id`
    AND NEW.`schema_sha256` = OLD.`schema_sha256`
    AND NEW.`source_artifact_id` = OLD.`source_artifact_id`
    AND NEW.`source_artifact_sha256` = OLD.`source_artifact_sha256`
    AND NEW.`source_role` = OLD.`source_role`
    AND NEW.`target_key` = OLD.`target_key`
    AND NEW.`citation_location` = OLD.`citation_location`
    AND NEW.`created_by_uid` = OLD.`created_by_uid`
    AND NEW.`created_at` = OLD.`created_at`
  )
  OR (
    OLD.`binding_state` = 'approved'
    AND NEW.`binding_state` = 'withdrawn'
    AND NEW.`id` = OLD.`id`
    AND NEW.`organisation_id` = OLD.`organisation_id`
    AND NEW.`work_pack_version_id` = OLD.`work_pack_version_id`
    AND NEW.`schema_sha256` = OLD.`schema_sha256`
    AND NEW.`source_artifact_id` = OLD.`source_artifact_id`
    AND NEW.`source_artifact_sha256` = OLD.`source_artifact_sha256`
    AND NEW.`source_role` = OLD.`source_role`
    AND NEW.`target_key` = OLD.`target_key`
    AND NEW.`citation_location` = OLD.`citation_location`
    AND NEW.`created_by_uid` = OLD.`created_by_uid`
    AND NEW.`created_at` = OLD.`created_at`
    AND NEW.`reviewed_by_uid` = OLD.`reviewed_by_uid`
    AND NEW.`reviewed_at` = OLD.`reviewed_at`
    AND NEW.`review_note` = OLD.`review_note`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SOURCE_IMMUTABLE');
END;

CREATE TRIGGER `compliance_work_pack_source_review_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_source_bindings`
WHEN OLD.`binding_state` = 'pending_review'
  AND NEW.`binding_state` IN ('approved', 'rejected')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_versions` version
    WHERE version.`id` = NEW.`work_pack_version_id`
      AND version.`organisation_id` = NEW.`organisation_id`
      AND version.`publish_state` = 'draft'
      AND version.`schema_sha256` = NEW.`schema_sha256`
      AND NEW.`reviewed_by_uid` <> NEW.`created_by_uid`
      AND NEW.`reviewed_by_uid` <> version.`authored_by_uid`
      AND (
        EXISTS (
          SELECT 1
          FROM `compliance_users` reviewer
          WHERE reviewer.`organisation_id` = version.`organisation_id`
            AND reviewer.`firebase_uid` = NEW.`reviewed_by_uid`
            AND reviewer.`status` = 'active'
            AND reviewer.`role` IN ('admin', 'reviewer')
            AND reviewer.`governance_identity_verified` = 1
            AND trim(reviewer.`governance_identity_verified_by_uid`) <> ''
            AND reviewer.`governance_identity_verified_by_uid` <>
              reviewer.`firebase_uid`
            AND trim(reviewer.`display_name`) <> ''
            AND instr(reviewer.`email`, '@') > 1
        )
        OR EXISTS (
          SELECT 1
          FROM `admin_users` administrator
          JOIN `compliance_organisations` organisation
            ON organisation.`id` = version.`organisation_id`
          WHERE administrator.`firebase_uid` = NEW.`reviewed_by_uid`
            AND administrator.`status` = 'active'
            AND administrator.`role` IN ('owner', 'admin', 'reviewer')
            AND organisation.`organisation_code` = 'CREDITEX-AU'
            AND organisation.`status` = 'active'
        )
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SOURCE_INDEPENDENT_REVIEW_REQUIRED') END;
  SELECT CASE WHEN NEW.`binding_state` = 'approved' AND NOT EXISTS (
    SELECT 1
    FROM `compliance_official_source_artifacts` artifact
    JOIN `compliance_official_source_review_decisions` decision
      ON decision.`organisation_id` = artifact.`organisation_id`
      AND decision.`subject_type` = 'artifact'
      AND decision.`subject_id` = artifact.`id`
      AND decision.`artifact_id` = artifact.`id`
      AND decision.`artifact_sha256` = artifact.`sha256`
      AND decision.`artifact_object_key` = artifact.`object_key`
      AND decision.`decision` = 'approved'
    WHERE artifact.`id` = NEW.`source_artifact_id`
      AND artifact.`organisation_id` = NEW.`organisation_id`
      AND artifact.`sha256` = NEW.`source_artifact_sha256`
      AND NOT EXISTS (
        SELECT 1
        FROM `compliance_official_source_review_decisions` newer
        WHERE newer.`organisation_id` = decision.`organisation_id`
          AND newer.`subject_type` = decision.`subject_type`
          AND newer.`subject_id` = decision.`subject_id`
          AND (
            newer.`reviewed_at` > decision.`reviewed_at`
            OR (
              newer.`reviewed_at` = decision.`reviewed_at`
              AND newer.`id` > decision.`id`
            )
          )
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_APPROVED_ARTIFACT_REQUIRED') END;
END;

CREATE TRIGGER `compliance_work_pack_source_withdraw_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_source_bindings`
WHEN OLD.`binding_state` = 'approved' AND NEW.`binding_state` = 'withdrawn'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_versions` version
    WHERE version.`id` = NEW.`work_pack_version_id`
      AND version.`organisation_id` = NEW.`organisation_id`
      AND NEW.`withdrawn_by_uid` <> NEW.`created_by_uid`
      AND NEW.`withdrawn_by_uid` <> version.`authored_by_uid`
      AND (
        EXISTS (
          SELECT 1
          FROM `compliance_users` reviewer
          WHERE reviewer.`organisation_id` = version.`organisation_id`
            AND reviewer.`firebase_uid` = NEW.`withdrawn_by_uid`
            AND reviewer.`status` = 'active'
            AND reviewer.`role` IN ('admin', 'reviewer')
            AND reviewer.`governance_identity_verified` = 1
            AND trim(reviewer.`display_name`) <> ''
            AND instr(reviewer.`email`, '@') > 1
        )
        OR EXISTS (
          SELECT 1
          FROM `admin_users` administrator
          JOIN `compliance_organisations` organisation
            ON organisation.`id` = version.`organisation_id`
          WHERE administrator.`firebase_uid` = NEW.`withdrawn_by_uid`
            AND administrator.`status` = 'active'
            AND administrator.`role` IN ('owner', 'admin', 'reviewer')
            AND organisation.`organisation_code` = 'CREDITEX-AU'
            AND organisation.`status` = 'active'
        )
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SOURCE_NAMED_WITHDRAWER_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_versions` version
    WHERE version.`id` = NEW.`work_pack_version_id`
      AND version.`organisation_id` = NEW.`organisation_id`
      AND version.`publish_state` = 'published'
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_WITHDRAW_VERSION_FIRST') END;
END;

CREATE TRIGGER `compliance_work_pack_source_delete_guard`
BEFORE DELETE ON `compliance_activity_work_pack_source_bindings`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SOURCE_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_work_pack_instance_insert_guard`
BEFORE INSERT ON `compliance_activity_work_pack_instances`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_cases` case_record
    JOIN `compliance_activity_work_pack_versions` version
      ON version.`id` = NEW.`work_pack_version_id`
      AND version.`organisation_id` = case_record.`organisation_id`
      AND version.`activity_version_id` = case_record.`activity_version_id`
    WHERE case_record.`id` = NEW.`compliance_case_id`
      AND case_record.`organisation_id` = NEW.`organisation_id`
      AND case_record.`work_order_id` = NEW.`work_order_id`
      AND case_record.`compliance_intent_id` = NEW.`compliance_intent_id`
      AND case_record.`evidence_policy_version_id` =
        version.`evidence_policy_version_id`
      AND case_record.`status` <> 'closed'
      AND version.`publish_state` = 'published'
      AND version.`effective_from` <= NEW.`activity_date`
      AND (version.`effective_to` = '' OR version.`effective_to` >= NEW.`activity_date`)
      AND json_extract(NEW.`response_snapshot`, '$.definitionSha256') =
        version.`schema_sha256`
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_CURRENT_CASE_VERSION_REQUIRED') END;
  SELECT CASE WHEN NOT (
    (
      json_extract(
        NEW.`response_snapshot`, '$.prefill.customerContext.editable'
      ) = 1
      AND EXISTS (
        SELECT 1
        FROM `compliance_cases` case_record
        JOIN `trade_work_orders` work_order
          ON work_order.`id` = case_record.`work_order_id`
          AND work_order.`firebase_uid` = case_record.`installer_uid`
          AND work_order.`partner_type` = 'installer'
          AND work_order.`record_status` = 'active'
        JOIN `trade_crm_job_details` detail
          ON detail.`work_order_id` = work_order.`id`
          AND detail.`firebase_uid` = work_order.`firebase_uid`
        JOIN `trade_crm_customers` customer
          ON customer.`id` = detail.`crm_customer_id`
          AND customer.`firebase_uid` = work_order.`firebase_uid`
          AND customer.`record_status` = 'active'
        JOIN `trade_crm_service_sites` site
          ON site.`id` = detail.`service_site_id`
          AND site.`firebase_uid` = work_order.`firebase_uid`
          AND site.`customer_id` = customer.`id`
          AND site.`record_status` = 'active'
        JOIN `trade_crm_customer_contacts` contact
          ON contact.`id` = json_extract(
            NEW.`response_snapshot`, '$.prefill.customerContext.contactId'
          )
          AND contact.`firebase_uid` = work_order.`firebase_uid`
          AND contact.`customer_id` = customer.`id`
          AND contact.`record_status` = 'active'
        JOIN `trade_crm_site_contacts` site_contact
          ON site_contact.`firebase_uid` = work_order.`firebase_uid`
          AND site_contact.`service_site_id` = site.`id`
          AND site_contact.`customer_contact_id` = contact.`id`
          AND site_contact.`record_status` = 'active'
        WHERE case_record.`id` = NEW.`compliance_case_id`
          AND case_record.`organisation_id` = NEW.`organisation_id`
          AND case_record.`work_order_id` = NEW.`work_order_id`
          AND (
            (
              detail.`customer_source` = 'trade_owned'
              AND work_order.`source_type` <> 'opportunity'
            )
            OR (
              detail.`customer_source` = 'public_lead_released'
              AND work_order.`source_type` = 'public_lead'
            )
          )
          AND customer.`id` = json_extract(
            NEW.`response_snapshot`, '$.prefill.customerContext.customerId'
          )
          AND site.`id` = json_extract(
            NEW.`response_snapshot`, '$.prefill.customerContext.siteId'
          )
          AND customer.`updated_at` = json_extract(
            NEW.`response_snapshot`,
            '$.prefill.customerContext.customerRevision'
          )
          AND site.`updated_at` = json_extract(
            NEW.`response_snapshot`, '$.prefill.customerContext.siteRevision'
          )
          AND contact.`updated_at` = json_extract(
            NEW.`response_snapshot`,
            '$.prefill.customerContext.contactRevision'
          )
      )
    )
    OR (
      json_extract(
        NEW.`response_snapshot`, '$.prefill.customerContext.editable'
      ) = 0
      AND EXISTS (
        SELECT 1
        FROM `compliance_cases` case_record
        JOIN `trade_work_orders` work_order
          ON work_order.`id` = case_record.`work_order_id`
          AND work_order.`firebase_uid` = case_record.`installer_uid`
          AND work_order.`partner_type` = 'installer'
          AND work_order.`record_status` = 'active'
        LEFT JOIN `trade_crm_job_details` detail
          ON detail.`work_order_id` = work_order.`id`
          AND detail.`firebase_uid` = work_order.`firebase_uid`
        WHERE case_record.`id` = NEW.`compliance_case_id`
          AND case_record.`organisation_id` = NEW.`organisation_id`
          AND case_record.`work_order_id` = NEW.`work_order_id`
          AND COALESCE(detail.`customer_source`, 'internal') NOT IN (
            'trade_owned', 'public_lead_released'
          )
      )
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_CUSTOMER_CONTEXT_STALE') END;
  SELECT CASE WHEN NEW.`manual_policy_composition_lock_id` <> '' AND NOT EXISTS (
    SELECT 1
    FROM `compliance_manual_policy_composition_locks` composition
    JOIN `compliance_activity_work_pack_versions` version
      ON version.`id` = NEW.`work_pack_version_id`
      AND version.`organisation_id` = NEW.`organisation_id`
    WHERE composition.`id` = NEW.`manual_policy_composition_lock_id`
      AND composition.`organisation_id` = NEW.`organisation_id`
      AND composition.`binding_id` = version.`manual_policy_binding_id`
      AND composition.`binding_version` =
        version.`manual_policy_binding_version`
      AND composition.`binding_snapshot_sha256` =
        version.`manual_policy_binding_sha256`
      AND composition.`activity_template_id` = version.`activity_template_id`
      AND composition.`activity_version_id` = version.`activity_version_id`
      AND composition.`reference_type` = 'compliance_case'
      AND composition.`reference_id` = NEW.`compliance_case_id`
      AND composition.`reference_activity_date` = NEW.`activity_date`
      AND composition.`composition_sha256` =
        NEW.`manual_policy_composition_sha256`
      AND composition.`superseded_by_id` = ''
      AND composition.`superseded_at` = ''
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_CURRENT_COMPOSITION_LOCK_REQUIRED') END;
  SELECT CASE WHEN NEW.`revision` = 1 AND EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_instances` existing
    WHERE existing.`organisation_id` = NEW.`organisation_id`
      AND existing.`instance_key` = NEW.`instance_key`
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_INSTANCE_ALREADY_EXISTS') END;
  SELECT CASE WHEN NEW.`revision` > 1 AND NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_instances` prior
    WHERE prior.`id` = NEW.`supersedes_instance_id`
      AND prior.`organisation_id` = NEW.`organisation_id`
      AND prior.`instance_key` = NEW.`instance_key`
      AND prior.`compliance_case_id` = NEW.`compliance_case_id`
      AND prior.`work_order_id` = NEW.`work_order_id`
      AND prior.`compliance_intent_id` = NEW.`compliance_intent_id`
      AND prior.`work_pack_version_id` = NEW.`work_pack_version_id`
      AND prior.`activity_date` = NEW.`activity_date`
      AND json_extract(
        NEW.`response_snapshot`, '$.prefill.customerContext.editable'
      ) = json_extract(
        prior.`response_snapshot`, '$.prefill.customerContext.editable'
      )
      AND json_extract(
        NEW.`response_snapshot`, '$.prefill.customerContext.customerId'
      ) = json_extract(
        prior.`response_snapshot`, '$.prefill.customerContext.customerId'
      )
      AND json_extract(
        NEW.`response_snapshot`, '$.prefill.customerContext.siteId'
      ) = json_extract(
        prior.`response_snapshot`, '$.prefill.customerContext.siteId'
      )
      AND json_extract(
        NEW.`response_snapshot`, '$.prefill.customerContext.contactId'
      ) = json_extract(
        prior.`response_snapshot`, '$.prefill.customerContext.contactId'
      )
      AND (
        (
          json_extract(
            NEW.`response_snapshot`, '$.prefill.customerContext.contextSha256'
          ) = json_extract(
            prior.`response_snapshot`,
            '$.prefill.customerContext.contextSha256'
          )
          AND json_extract(
            NEW.`response_snapshot`,
            '$.prefill.customerContext.customerRevision'
          ) = json_extract(
            prior.`response_snapshot`,
            '$.prefill.customerContext.customerRevision'
          )
          AND json_extract(
            NEW.`response_snapshot`, '$.prefill.customerContext.siteRevision'
          ) = json_extract(
            prior.`response_snapshot`, '$.prefill.customerContext.siteRevision'
          )
          AND json_extract(
            NEW.`response_snapshot`,
            '$.prefill.customerContext.contactRevision'
          ) = json_extract(
            prior.`response_snapshot`,
            '$.prefill.customerContext.contactRevision'
          )
        )
        OR (
          json_extract(
            NEW.`response_snapshot`, '$.prefill.customerContext.contextSha256'
          ) <> json_extract(
            prior.`response_snapshot`,
            '$.prefill.customerContext.contextSha256'
          )
          AND json_extract(
            NEW.`response_snapshot`,
            '$.prefill.customerContext.customerRevision'
          ) >= json_extract(
            prior.`response_snapshot`,
            '$.prefill.customerContext.customerRevision'
          )
          AND json_extract(
            NEW.`response_snapshot`, '$.prefill.customerContext.siteRevision'
          ) >= json_extract(
            prior.`response_snapshot`, '$.prefill.customerContext.siteRevision'
          )
          AND json_extract(
            NEW.`response_snapshot`,
            '$.prefill.customerContext.contactRevision'
          ) >= json_extract(
            prior.`response_snapshot`,
            '$.prefill.customerContext.contactRevision'
          )
          AND (
            json_extract(
              NEW.`response_snapshot`,
              '$.prefill.customerContext.customerRevision'
            ) > json_extract(
              prior.`response_snapshot`,
              '$.prefill.customerContext.customerRevision'
            )
            OR json_extract(
              NEW.`response_snapshot`,
              '$.prefill.customerContext.siteRevision'
            ) > json_extract(
              prior.`response_snapshot`,
              '$.prefill.customerContext.siteRevision'
            )
            OR json_extract(
              NEW.`response_snapshot`,
              '$.prefill.customerContext.contactRevision'
            ) > json_extract(
              prior.`response_snapshot`,
              '$.prefill.customerContext.contactRevision'
            )
          )
        )
      )
      AND (
        prior.`manual_policy_composition_lock_id` = ''
        OR (
          NEW.`manual_policy_composition_lock_id` =
            prior.`manual_policy_composition_lock_id`
          AND NEW.`manual_policy_composition_sha256` =
            prior.`manual_policy_composition_sha256`
        )
      )
      AND NEW.`revision` = prior.`revision` + 1
      AND NOT EXISTS (
        SELECT 1
        FROM `compliance_activity_work_pack_instances` child
        WHERE child.`supersedes_instance_id` = prior.`id`
      )
      AND (
        (prior.`status` = 'not_started' AND NEW.`status` IN ('in_progress', 'void'))
        OR (prior.`status` = 'in_progress' AND NEW.`status` IN ('in_progress', 'ready_to_sign', 'void'))
        OR (prior.`status` = 'ready_to_sign' AND NEW.`status` IN ('in_progress', 'completed', 'void'))
      )
      AND (
        NEW.`status` <> 'completed'
        OR (
          NEW.`response_snapshot` = prior.`response_snapshot`
          AND NEW.`response_sha256` = prior.`response_sha256`
        )
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_INSTANCE_REVISION_INVALID') END;
END;

CREATE TRIGGER `compliance_work_pack_instance_update_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_instances`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_INSTANCE_IMMUTABLE');
END;
CREATE TRIGGER `compliance_work_pack_instance_delete_guard`
BEFORE DELETE ON `compliance_activity_work_pack_instances`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_INSTANCE_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_work_pack_signature_insert_guard`
BEFORE INSERT ON `compliance_activity_work_pack_signatures`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_instances` instance
    JOIN `compliance_activity_work_pack_versions` version
      ON version.`id` = instance.`work_pack_version_id`
      AND version.`organisation_id` = instance.`organisation_id`
    JOIN json_each(version.`schema_snapshot`, '$.sections') section
    JOIN json_each(section.`value`, '$.prompts') prompt
    JOIN json_each(version.`schema_snapshot`, '$.signerRoles') role
    WHERE instance.`id` = NEW.`case_instance_id`
      AND instance.`organisation_id` = NEW.`organisation_id`
      AND instance.`instance_key` = NEW.`instance_key`
      AND instance.`status` = 'ready_to_sign'
      AND (
        (
          json_type(section.`value`, '$.repeatability') = 'null'
          AND json_extract(prompt.`value`, '$.promptKey') = NEW.`prompt_key`
        )
        OR (
          json_type(section.`value`, '$.repeatability') = 'object'
          AND substr(
            NEW.`prompt_key`, 1,
            length(json_extract(section.`value`, '$.sectionKey')) + 1
          ) = json_extract(section.`value`, '$.sectionKey') || '['
          AND substr(
            NEW.`prompt_key`,
            instr(NEW.`prompt_key`, '].') + 2
          ) = json_extract(prompt.`value`, '$.promptKey')
        )
      )
      AND json_extract(prompt.`value`, '$.type') = 'signature'
      AND json_extract(prompt.`value`, '$.signerRoleKey') = NEW.`signer_role`
      AND json_extract(role.`value`, '$.roleKey') = NEW.`signer_role`
      AND json_extract(role.`value`, '$.capacity') = NEW.`signer_capacity`
      AND json_extract(role.`value`, '$.identitySource') = json_extract(
        NEW.`signer_identity_snapshot`, '$.identitySource'
      )
      AND (
        (
          NEW.`action` = 'revoked'
          AND EXISTS (
            SELECT 1
            FROM `compliance_activity_work_pack_signatures` prior
            WHERE prior.`id` = NEW.`supersedes_signature_id`
              AND prior.`organisation_id` = NEW.`organisation_id`
              AND prior.`instance_key` = NEW.`instance_key`
              AND prior.`case_instance_id` = NEW.`case_instance_id`
              AND prior.`prompt_key` = NEW.`prompt_key`
              AND prior.`signer_role` = NEW.`signer_role`
              AND prior.`signer_capacity` = NEW.`signer_capacity`
              AND prior.`signer_name` = NEW.`signer_name`
              AND prior.`signer_uid` = NEW.`signer_uid`
              AND prior.`signer_identity_snapshot` =
                NEW.`signer_identity_snapshot`
              AND prior.`signer_identity_sha256` =
                NEW.`signer_identity_sha256`
              AND prior.`action` = 'captured'
          )
        )
        OR (
          NEW.`action` = 'captured'
          AND (
            (
              json_extract(role.`value`, '$.identitySource') IN (
                'customer_context', 'manual_verified'
              )
              AND NEW.`signer_uid` = ''
            )
            OR (
              json_extract(role.`value`, '$.identitySource') =
                'authenticated_actor'
              AND NEW.`signer_uid` = NEW.`captured_by_uid`
            )
            OR (
              json_extract(role.`value`, '$.identitySource') =
                'assigned_worker'
              AND EXISTS (
                SELECT 1
                FROM `trade_work_orders` assigned_work
                WHERE assigned_work.`id` = instance.`work_order_id`
                  AND assigned_work.`record_status` = 'active'
                  AND (
                    (
                      assigned_work.`assignee_member_id` = ''
                      AND NEW.`signer_uid` = assigned_work.`firebase_uid`
                    )
                    OR EXISTS (
                      SELECT 1
                      FROM `trade_team_members` assigned_member
                      WHERE assigned_member.`id` =
                        assigned_work.`assignee_member_id`
                        AND assigned_member.`owner_uid` =
                          assigned_work.`firebase_uid`
                        AND assigned_member.`member_uid` = NEW.`signer_uid`
                        AND assigned_member.`status` = 'active'
                    )
                  )
              )
            )
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(role.`value`, '$.identityRequirements') requirement
        WHERE json_extract(requirement.`value`, '$.required') = 1
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(
              NEW.`signer_identity_snapshot`, '$.fields'
            ) identity_field
            WHERE identity_field.`key` = json_extract(
              requirement.`value`, '$.fieldKey'
            )
              AND trim(CAST(identity_field.`value` AS text)) <> ''
          )
      )
      AND json_extract(NEW.`attestation_snapshot`, '$.text') =
        json_extract(prompt.`value`, '$.attestation.text')
      AND json_extract(NEW.`attestation_snapshot`, '$.version') =
        json_extract(prompt.`value`, '$.attestation.version')
      AND json_extract(NEW.`attestation_snapshot`, '$.responseSha256') =
        NEW.`response_sha256`
      AND json_extract(NEW.`attestation_snapshot`, '$.definitionSha256') =
        NEW.`definition_sha256`
      AND json_extract(NEW.`attestation_snapshot`, '$.prefillSha256') =
        NEW.`prefill_sha256`
      AND json_extract(NEW.`attestation_snapshot`, '$.declarationsSha256') =
        NEW.`declarations_sha256`
      AND json_extract(
        NEW.`attestation_snapshot`, '$.signerIdentitySha256'
      ) = NEW.`signer_identity_sha256`
      AND json(NEW.`signer_identity_snapshot`) = json_extract(
        NEW.`attestation_snapshot`, '$.signerIdentity'
      )
      AND NEW.`definition_sha256` = json_extract(
        instance.`response_snapshot`, '$.definitionSha256'
      )
      AND NEW.`prefill_sha256` = json_extract(
        instance.`response_snapshot`, '$.prefillSha256'
      )
      AND NEW.`response_sha256` = json_extract(
        instance.`response_snapshot`, '$.responseSha256'
      )
      AND NEW.`declarations_sha256` = json_extract(
        instance.`response_snapshot`, '$.declarationsSha256'
      )
      AND json_extract(
        NEW.`signature_payload_snapshot`, '$.definitionSha256'
      ) = NEW.`definition_sha256`
      AND json_extract(
        NEW.`signature_payload_snapshot`, '$.prefillSha256'
      ) = NEW.`prefill_sha256`
      AND json_extract(
        NEW.`signature_payload_snapshot`, '$.responseSha256'
      ) = NEW.`response_sha256`
      AND json_extract(
        NEW.`signature_payload_snapshot`, '$.declarationsSha256'
      ) = NEW.`declarations_sha256`
      AND json_extract(
        NEW.`signature_payload_snapshot`, '$.signerIdentitySha256'
      ) = NEW.`signer_identity_sha256`
      AND json_extract(
        NEW.`signature_payload_snapshot`, '$.attestationSha256'
      ) = NEW.`attestation_sha256`
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SIGNATURE_PROMPT_INVALID') END;
  SELECT CASE WHEN NEW.`action` = 'captured' AND NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_instances` prepared_instance
    WHERE prepared_instance.`id` = NEW.`case_instance_id`
      AND prepared_instance.`organisation_id` = NEW.`organisation_id`
      AND prepared_instance.`instance_key` = NEW.`instance_key`
      AND prepared_instance.`status` = 'ready_to_sign'
      AND unixepoch(NEW.`signed_at`) >=
        unixepoch(prepared_instance.`created_at`) - 300
      AND unixepoch(NEW.`signed_at`) >= unixepoch(NEW.`created_at`) - 604800
      AND unixepoch(NEW.`signed_at`) <= unixepoch(NEW.`created_at`) + 300
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SIGNATURE_TIME_OUT_OF_BOUNDS') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `trade_mobile_upload_finalisation_guards` guard
    JOIN `trade_mobile_upload_sessions` session
      ON session.`id` = guard.`session_id`
      AND session.`owner_uid` = guard.`owner_uid`
    JOIN `trade_crm_job_media` media
      ON media.`id` = session.`media_id`
      AND media.`firebase_uid` = session.`owner_uid`
    JOIN `compliance_activity_work_pack_instances` instance
      ON instance.`id` = NEW.`case_instance_id`
      AND instance.`instance_key` = NEW.`instance_key`
    WHERE guard.`id` = NEW.`integrity_receipt_id`
      AND guard.`step_number` = 2
      AND guard.`verified` = 1
      AND session.`id` = NEW.`capture_session_id`
      AND session.`status` = 'completed'
      AND session.`actor_uid` = NEW.`captured_by_uid`
      AND session.`device_id` = NEW.`captured_device_id`
      AND session.`work_order_id` = instance.`work_order_id`
      AND session.`object_key` = NEW.`signature_object_key`
      AND session.`content_type` = NEW.`signature_content_type`
      AND session.`size_bytes` = NEW.`signature_size_bytes`
      AND session.`original_sha256` = NEW.`signature_sha256`
      AND media.`work_order_id` = instance.`work_order_id`
      AND media.`object_key` = NEW.`signature_object_key`
      AND media.`content_type` = NEW.`signature_content_type`
      AND media.`size_bytes` = NEW.`signature_size_bytes`
      AND media.`original_sha256` = NEW.`signature_sha256`
  ) AND NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_browser_upload_receipts` receipt
    JOIN `compliance_activity_work_pack_instances` instance
      ON instance.`id` = NEW.`case_instance_id`
      AND instance.`instance_key` = NEW.`instance_key`
    WHERE receipt.`id` = NEW.`integrity_receipt_id`
      AND receipt.`organisation_id` = NEW.`organisation_id`
      AND receipt.`instance_key` = NEW.`instance_key`
      AND receipt.`purpose` = 'signature'
      AND receipt.`prompt_key` = NEW.`prompt_key`
      AND receipt.`id` = NEW.`capture_session_id`
      AND receipt.`actor_uid` = NEW.`captured_by_uid`
      AND receipt.`device_id` = NEW.`captured_device_id`
      AND receipt.`work_order_id` = instance.`work_order_id`
      AND receipt.`object_key` = NEW.`signature_object_key`
      AND receipt.`content_type` = NEW.`signature_content_type`
      AND receipt.`size_bytes` = NEW.`signature_size_bytes`
      AND receipt.`original_sha256` = NEW.`signature_sha256`
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SIGNATURE_EXACT_BYTES_REQUIRED') END;
  SELECT CASE WHEN NEW.`supersedes_signature_id` = ''
    AND NEW.`action` <> 'captured'
    THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SIGNATURE_INITIAL_CAPTURE_REQUIRED') END;
  SELECT CASE WHEN NEW.`supersedes_signature_id` <> '' AND NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_signatures` prior
    WHERE prior.`id` = NEW.`supersedes_signature_id`
      AND prior.`organisation_id` = NEW.`organisation_id`
      AND prior.`instance_key` = NEW.`instance_key`
      AND prior.`prompt_key` = NEW.`prompt_key`
      AND prior.`signer_role` = NEW.`signer_role`
      AND (
        (
          prior.`action` = 'captured'
          AND NEW.`action` = 'revoked'
          AND NEW.`signer_name` = prior.`signer_name`
          AND NEW.`signer_capacity` = prior.`signer_capacity`
          AND NEW.`signature_sha256` = prior.`signature_sha256`
          AND NEW.`signature_object_key` = prior.`signature_object_key`
          AND NEW.`signature_payload_sha256` = prior.`signature_payload_sha256`
          AND NEW.`attestation_sha256` = prior.`attestation_sha256`
          AND NEW.`signer_identity_sha256` = prior.`signer_identity_sha256`
        )
        OR (
          prior.`action` = 'revoked'
          AND NEW.`action` = 'captured'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM `compliance_activity_work_pack_signatures` child
        WHERE child.`supersedes_signature_id` = prior.`id`
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SIGNATURE_SUCCESSOR_INVALID') END;
END;

CREATE TRIGGER `compliance_work_pack_signature_update_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_signatures`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SIGNATURE_IMMUTABLE');
END;
CREATE TRIGGER `compliance_work_pack_signature_delete_guard`
BEFORE DELETE ON `compliance_activity_work_pack_signatures`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_SIGNATURE_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_work_pack_artifact_insert_guard`
BEFORE INSERT ON `compliance_activity_work_pack_artifacts`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_instances` instance
    JOIN `compliance_activity_work_pack_versions` version
      ON version.`id` = instance.`work_pack_version_id`
      AND version.`organisation_id` = instance.`organisation_id`
    JOIN json_each(version.`schema_snapshot`, '$.sections') section
    JOIN json_each(section.`value`, '$.prompts') prompt
    WHERE instance.`id` = NEW.`case_instance_id`
      AND instance.`organisation_id` = NEW.`organisation_id`
      AND instance.`instance_key` = NEW.`instance_key`
      AND instance.`status` IN ('in_progress', 'ready_to_sign')
      AND (
        (
          json_type(section.`value`, '$.repeatability') = 'null'
          AND json_extract(prompt.`value`, '$.promptKey') = NEW.`prompt_key`
        )
        OR (
          json_type(section.`value`, '$.repeatability') = 'object'
          AND substr(
            NEW.`prompt_key`, 1,
            length(json_extract(section.`value`, '$.sectionKey')) + 1
          ) = json_extract(section.`value`, '$.sectionKey') || '['
          AND substr(
            NEW.`prompt_key`, instr(NEW.`prompt_key`, '].') + 2
          ) = json_extract(prompt.`value`, '$.promptKey')
        )
      )
      AND json_extract(prompt.`value`, '$.type') = NEW.`artifact_kind`
      AND EXISTS (
        SELECT 1
        FROM json_each(
          prompt.`value`, '$.fileRequirement.allowedContentTypes'
        ) content_type
        WHERE lower(content_type.`value`) = lower(NEW.`content_type`)
      )
      AND (
        json_extract(prompt.`value`, '$.fileRequirement.metadataRequired') <> 1
        OR json_type(NEW.`metadata_snapshot`, '$.exif') = 'object'
      )
      AND (
        json_extract(prompt.`value`, '$.fileRequirement.gpsRequired') <> 1
        OR (
          json_type(NEW.`metadata_snapshot`, '$.gps.latitude') IN ('integer', 'real')
          AND json_type(NEW.`metadata_snapshot`, '$.gps.longitude') IN ('integer', 'real')
        )
      )
      AND (
        json_extract(prompt.`value`, '$.fileRequirement.captureTimeRequired') <> 1
        OR datetime(json_extract(NEW.`metadata_snapshot`, '$.capturedAt')) IS NOT NULL
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_ARTIFACT_PROMPT_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `trade_mobile_upload_finalisation_guards` guard
    JOIN `trade_mobile_upload_sessions` session
      ON session.`id` = guard.`session_id`
      AND session.`owner_uid` = guard.`owner_uid`
    JOIN `trade_crm_job_media` media
      ON media.`id` = session.`media_id`
      AND media.`firebase_uid` = session.`owner_uid`
    JOIN `compliance_activity_work_pack_instances` instance
      ON instance.`id` = NEW.`case_instance_id`
      AND instance.`instance_key` = NEW.`instance_key`
    WHERE guard.`id` = NEW.`integrity_receipt_id`
      AND guard.`step_number` = 2
      AND guard.`verified` = 1
      AND session.`status` = 'completed'
      AND session.`actor_uid` = NEW.`captured_by_uid`
      AND session.`device_id` = NEW.`captured_device_id`
      AND session.`work_order_id` = instance.`work_order_id`
      AND session.`object_key` = NEW.`object_key`
      AND session.`file_name` = NEW.`original_file_name`
      AND session.`content_type` = NEW.`content_type`
      AND session.`size_bytes` = NEW.`size_bytes`
      AND session.`original_sha256` = NEW.`original_sha256`
      AND media.`work_order_id` = instance.`work_order_id`
      AND media.`object_key` = NEW.`object_key`
      AND media.`file_name` = NEW.`original_file_name`
      AND media.`content_type` = NEW.`content_type`
      AND media.`size_bytes` = NEW.`size_bytes`
      AND media.`original_sha256` = NEW.`original_sha256`
  ) AND NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_browser_upload_receipts` receipt
    JOIN `compliance_activity_work_pack_instances` instance
      ON instance.`id` = NEW.`case_instance_id`
      AND instance.`instance_key` = NEW.`instance_key`
    WHERE receipt.`id` = NEW.`integrity_receipt_id`
      AND receipt.`organisation_id` = NEW.`organisation_id`
      AND receipt.`instance_key` = NEW.`instance_key`
      AND receipt.`purpose` = 'artifact'
      AND receipt.`prompt_key` = NEW.`prompt_key`
      AND receipt.`artifact_kind` = NEW.`artifact_kind`
      AND receipt.`actor_uid` = NEW.`captured_by_uid`
      AND receipt.`device_id` = NEW.`captured_device_id`
      AND receipt.`work_order_id` = instance.`work_order_id`
      AND receipt.`object_key` = NEW.`object_key`
      AND receipt.`file_name` = NEW.`original_file_name`
      AND receipt.`content_type` = NEW.`content_type`
      AND receipt.`size_bytes` = NEW.`size_bytes`
      AND receipt.`original_sha256` = NEW.`original_sha256`
      AND receipt.`metadata_sha256` = NEW.`metadata_sha256`
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_MATCHED_INTEGRITY_REQUIRED') END;
  SELECT CASE WHEN NEW.`supersedes_artifact_id` <> '' AND NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_artifacts` prior
    WHERE prior.`id` = NEW.`supersedes_artifact_id`
      AND prior.`organisation_id` = NEW.`organisation_id`
      AND prior.`instance_key` = NEW.`instance_key`
      AND prior.`prompt_key` = NEW.`prompt_key`
      AND prior.`artifact_kind` = NEW.`artifact_kind`
      AND NOT EXISTS (
        SELECT 1
        FROM `compliance_activity_work_pack_artifacts` child
        WHERE child.`supersedes_artifact_id` = prior.`id`
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_ARTIFACT_SUCCESSOR_INVALID') END;
END;

CREATE TRIGGER `compliance_work_pack_artifact_update_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_artifacts`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_ARTIFACT_IMMUTABLE');
END;
CREATE TRIGGER `compliance_work_pack_artifact_delete_guard`
BEFORE DELETE ON `compliance_activity_work_pack_artifacts`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_ARTIFACT_DELETE_BLOCKED');
END;

CREATE TRIGGER `compliance_work_pack_final_record_insert_guard`
BEFORE INSERT ON `compliance_activity_work_pack_final_records`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_instances` instance
    JOIN `compliance_activity_work_pack_versions` version
      ON version.`id` = instance.`work_pack_version_id`
      AND version.`organisation_id` = instance.`organisation_id`
    WHERE instance.`id` = NEW.`case_instance_id`
      AND instance.`organisation_id` = NEW.`organisation_id`
      AND instance.`instance_key` = NEW.`instance_key`
      AND instance.`work_pack_version_id` = NEW.`work_pack_version_id`
      AND instance.`status` = 'completed'
      AND instance.`response_sha256` = NEW.`instance_sha256`
      AND version.`schema_sha256` = NEW.`definition_sha256`
      AND json_extract(instance.`response_snapshot`, '$.definitionSha256') =
        NEW.`definition_sha256`
      AND json_extract(instance.`response_snapshot`, '$.prefillSha256') =
        NEW.`prefill_sha256`
      AND json_extract(instance.`response_snapshot`, '$.responseSha256') =
        NEW.`response_sha256`
      AND json_extract(instance.`response_snapshot`, '$.declarationsSha256') =
        NEW.`declarations_sha256`
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_FINAL_RECORD_BINDING_INVALID') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(
      NEW.`signature_manifest_snapshot`, '$.signatures'
    ) manifest
    WHERE NOT EXISTS (
      SELECT 1
      FROM `compliance_activity_work_pack_signatures` signature
      WHERE signature.`id` = json_extract(manifest.`value`, '$.id')
        AND signature.`organisation_id` = NEW.`organisation_id`
        AND signature.`instance_key` = NEW.`instance_key`
        AND signature.`prompt_key` = json_extract(
          manifest.`value`, '$.promptKey'
        )
        AND signature.`signer_role` = json_extract(
          manifest.`value`, '$.signerRole'
        )
        AND signature.`signer_name` = json_extract(
          manifest.`value`, '$.signerName'
        )
        AND signature.`signature_sha256` = json_extract(
          manifest.`value`, '$.signatureSha256'
        )
        AND signature.`signature_payload_sha256` = json_extract(
          manifest.`value`, '$.signaturePayloadSha256'
        )
        AND signature.`attestation_sha256` = json_extract(
          manifest.`value`, '$.attestationSha256'
        )
        AND signature.`signer_identity_sha256` = json_extract(
          manifest.`value`, '$.signerIdentitySha256'
        )
        AND signature.`definition_sha256` = NEW.`definition_sha256`
        AND signature.`prefill_sha256` = NEW.`prefill_sha256`
        AND signature.`response_sha256` = NEW.`response_sha256`
        AND signature.`declarations_sha256` = NEW.`declarations_sha256`
        AND signature.`signed_at` = json_extract(manifest.`value`, '$.signedAt')
        AND signature.`action` = 'captured'
        AND NOT EXISTS (
          SELECT 1
          FROM `compliance_activity_work_pack_signatures` child
          WHERE child.`supersedes_signature_id` = signature.`id`
        )
    )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_FINAL_SIGNATURE_MANIFEST_INVALID') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_signatures` signature
    WHERE signature.`organisation_id` = NEW.`organisation_id`
      AND signature.`instance_key` = NEW.`instance_key`
      AND signature.`action` = 'captured'
      AND NOT EXISTS (
        SELECT 1
        FROM `compliance_activity_work_pack_signatures` child
        WHERE child.`supersedes_signature_id` = signature.`id`
      )
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(
          NEW.`signature_manifest_snapshot`, '$.signatures'
        ) manifest
        WHERE json_extract(manifest.`value`, '$.id') = signature.`id`
      )
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_FINAL_SIGNATURE_OMITTED') END;
  SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM json_each(NEW.`signature_manifest_snapshot`, '$.signatures')
  ) <> (
    SELECT COUNT(DISTINCT json_extract(manifest.`value`, '$.id'))
    FROM json_each(
      NEW.`signature_manifest_snapshot`, '$.signatures'
    ) manifest
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_FINAL_SIGNATURE_DUPLICATE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_activity_work_pack_render_receipts` receipt
    JOIN `compliance_activity_work_pack_instances` completed
      ON completed.`id` = NEW.`case_instance_id`
      AND completed.`organisation_id` = NEW.`organisation_id`
      AND completed.`instance_key` = NEW.`instance_key`
      AND completed.`status` = 'completed'
    WHERE receipt.`id` = NEW.`integrity_receipt_id`
      AND receipt.`organisation_id` = NEW.`organisation_id`
      AND receipt.`instance_key` = NEW.`instance_key`
      AND receipt.`case_instance_id` = completed.`supersedes_instance_id`
      AND receipt.`output_key` = NEW.`output_key`
      AND receipt.`output_definition_sha256` =
        NEW.`output_definition_sha256`
      AND receipt.`template_source_artifact_id` =
        NEW.`template_source_artifact_id`
      AND receipt.`template_source_artifact_sha256` =
        NEW.`template_source_artifact_sha256`
      AND receipt.`renderer_contract` = NEW.`renderer_contract`
      AND receipt.`renderer_version` = NEW.`renderer_version`
      AND receipt.`object_key` = NEW.`object_key`
      AND receipt.`file_name` = NEW.`file_name`
      AND receipt.`content_type` = NEW.`content_type`
      AND receipt.`size_bytes` = NEW.`size_bytes`
      AND receipt.`pdf_sha256` = NEW.`pdf_sha256`
      AND receipt.`rendered_by_uid` = NEW.`finalised_by_uid`
  ) THEN RAISE(ABORT, 'COMPLIANCE_WORK_PACK_FINAL_PDF_EXACT_BYTES_REQUIRED') END;
END;

CREATE TRIGGER `compliance_work_pack_final_record_update_guard`
BEFORE UPDATE ON `compliance_activity_work_pack_final_records`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_FINAL_RECORD_IMMUTABLE');
END;
CREATE TRIGGER `compliance_work_pack_final_record_delete_guard`
BEFORE DELETE ON `compliance_activity_work_pack_final_records`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_FINAL_RECORD_DELETE_BLOCKED');
END;
