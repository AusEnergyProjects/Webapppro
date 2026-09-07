-- Preserve every version and source record. Author saves activate new immutable masters; official source artifact verification is unchanged.
-- Runtime reinstalls exact revised guards before accepting governed work.
DROP TRIGGER IF EXISTS `compliance_work_pack_render_receipt_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_browser_upload_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_version_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_source_candidate_provenance_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_version_transition_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_version_draft_edit_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_version_publish_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_version_withdraw_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_version_abandon_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_version_delete_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_source_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_source_transition_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_source_review_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_source_withdraw_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_source_delete_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_instance_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_signature_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_artifact_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_work_pack_final_record_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_output_action_packet_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `compliance_sres_activation_record_insert_guard`;
--> statement-breakpoint
CREATE TABLE `compliance_activity_work_pack_versions_author_save` (
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
--> statement-breakpoint
INSERT INTO `compliance_activity_work_pack_versions_author_save` (`id`, `organisation_id`, `activity_version_id`, `activity_template_id`, `manual_policy_binding_id`, `manual_policy_binding_version`, `manual_policy_binding_sha256`, `evidence_policy_version_id`, `evidence_policy_version`, `evidence_policy_source_sha256`, `origin_kind`, `client_request_id`, `source_candidate_contract`, `source_candidate_snapshot`, `source_candidate_sha256`, `source_binding_map_snapshot`, `source_binding_map_sha256`, `candidate_blockers_snapshot`, `version`, `contract`, `title`, `schema_snapshot`, `schema_sha256`, `effective_from`, `effective_to`, `publish_state`, `authored_by_uid`, `authored_at`, `updated_by_uid`, `updated_at`, `reviewed_by_uid`, `reviewed_at`, `review_note`, `withdrawn_by_uid`, `withdrawn_at`, `withdrawal_note`, `abandoned_by_uid`, `abandoned_at`, `abandonment_note`, `created_at`) SELECT `id`, `organisation_id`, `activity_version_id`, `activity_template_id`, `manual_policy_binding_id`, `manual_policy_binding_version`, `manual_policy_binding_sha256`, `evidence_policy_version_id`, `evidence_policy_version`, `evidence_policy_source_sha256`, `origin_kind`, `client_request_id`, `source_candidate_contract`, `source_candidate_snapshot`, `source_candidate_sha256`, `source_binding_map_snapshot`, `source_binding_map_sha256`, `candidate_blockers_snapshot`, `version`, `contract`, `title`, `schema_snapshot`, `schema_sha256`, `effective_from`, `effective_to`, `publish_state`, `authored_by_uid`, `authored_at`, `updated_by_uid`, `updated_at`, `reviewed_by_uid`, `reviewed_at`, `review_note`, `withdrawn_by_uid`, `withdrawn_at`, `withdrawal_note`, `abandoned_by_uid`, `abandoned_at`, `abandonment_note`, `created_at` FROM `compliance_activity_work_pack_versions`;
--> statement-breakpoint
DROP TABLE `compliance_activity_work_pack_versions`;
--> statement-breakpoint
ALTER TABLE `compliance_activity_work_pack_versions_author_save` RENAME TO `compliance_activity_work_pack_versions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_work_pack_version_number_idx`
  ON `compliance_activity_work_pack_versions`
    (`organisation_id`, `activity_template_id`, `version`);
--> statement-breakpoint
CREATE INDEX `compliance_work_pack_activity_date_idx`
  ON `compliance_activity_work_pack_versions`
    (`organisation_id`, `activity_version_id`, `publish_state`,
      `effective_from`, `effective_to`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_work_pack_source_candidate_request_idx`
  ON `compliance_activity_work_pack_versions`
    (`organisation_id`, `client_request_id`)
  WHERE `client_request_id` <> '';
--> statement-breakpoint
CREATE TABLE `compliance_activity_work_pack_source_bindings_author_save` (
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
      AND datetime(`reviewed_at`) IS NOT NULL
      AND length(trim(`review_note`)) BETWEEN 10 AND 2000
      AND `withdrawn_by_uid` = ''
      AND `withdrawn_at` = ''
      AND `withdrawal_note` = ''
    )
    OR (
      `binding_state` = 'withdrawn'
      AND trim(`reviewed_by_uid`) <> ''
      AND datetime(`reviewed_at`) IS NOT NULL
      AND length(trim(`review_note`)) BETWEEN 10 AND 2000
      AND trim(`withdrawn_by_uid`) <> ''
      AND datetime(`withdrawn_at`) IS NOT NULL
      AND length(trim(`withdrawal_note`)) BETWEEN 10 AND 2000
    )
  )
);
--> statement-breakpoint
INSERT INTO `compliance_activity_work_pack_source_bindings_author_save` (`id`, `organisation_id`, `work_pack_version_id`, `schema_sha256`, `source_artifact_id`, `source_artifact_sha256`, `source_role`, `target_key`, `citation_location`, `binding_state`, `created_by_uid`, `created_at`, `reviewed_by_uid`, `reviewed_at`, `review_note`, `withdrawn_by_uid`, `withdrawn_at`, `withdrawal_note`) SELECT `id`, `organisation_id`, `work_pack_version_id`, `schema_sha256`, `source_artifact_id`, `source_artifact_sha256`, `source_role`, `target_key`, `citation_location`, `binding_state`, `created_by_uid`, `created_at`, `reviewed_by_uid`, `reviewed_at`, `review_note`, `withdrawn_by_uid`, `withdrawn_at`, `withdrawal_note` FROM `compliance_activity_work_pack_source_bindings`;
--> statement-breakpoint
DROP TABLE `compliance_activity_work_pack_source_bindings`;
--> statement-breakpoint
ALTER TABLE `compliance_activity_work_pack_source_bindings_author_save` RENAME TO `compliance_activity_work_pack_source_bindings`;
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_work_pack_source_identity_idx`
  ON `compliance_activity_work_pack_source_bindings`
    (`organisation_id`, `work_pack_version_id`, `source_artifact_id`,
      `source_role`, `target_key`, `citation_location`, `schema_sha256`);
--> statement-breakpoint
CREATE INDEX `compliance_work_pack_source_version_idx`
  ON `compliance_activity_work_pack_source_bindings`
    (`organisation_id`, `work_pack_version_id`, `binding_state`, `target_key`);
--> statement-breakpoint
CREATE TABLE compliance_master_save_schema (id integer PRIMARY KEY CHECK (id = 1), version integer NOT NULL CHECK (version = 1));
--> statement-breakpoint
INSERT INTO compliance_master_save_schema (id, version) VALUES (1, 1);
