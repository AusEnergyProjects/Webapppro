CREATE TABLE `compliance_invitations` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `email` text NOT NULL CHECK (
    length(`email`) BETWEEN 3 AND 320
    AND `email` = lower(trim(`email`))
  ),
  `display_name` text DEFAULT '' NOT NULL,
  `role` text NOT NULL CHECK (
    `role` IN ('admin', 'case_manager', 'reviewer', 'auditor')
  ),
  `status` text DEFAULT 'pending' NOT NULL CHECK (
    `status` IN ('pending', 'claimed', 'revoked', 'expired')
  ),
  `invited_by_uid` text NOT NULL,
  `expires_at` text NOT NULL,
  `claimed_by_uid` text DEFAULT '' NOT NULL,
  `claimed_at` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (
    (`status` = 'claimed' AND `claimed_by_uid` <> '' AND `claimed_at` <> '')
    OR (`status` <> 'claimed' AND `claimed_by_uid` = '' AND `claimed_at` = '')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_invitations_org_email_idx`
ON `compliance_invitations` (`organisation_id`, `email` COLLATE NOCASE)
WHERE `status` IN ('pending', 'claimed');
--> statement-breakpoint
CREATE INDEX `compliance_invitations_email_status_idx`
ON `compliance_invitations` (`email` COLLATE NOCASE, `status`, `expires_at`);
--> statement-breakpoint
CREATE TABLE `compliance_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `actor_type` text NOT NULL CHECK (
    `actor_type` IN ('installer', 'compliance', 'platform')
  ),
  `actor_uid` text NOT NULL,
  `event_type` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `summary` text NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL CHECK (json_valid(`metadata`)),
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_audit_events_org_time_idx`
ON `compliance_audit_events` (`organisation_id`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_audit_events_target_idx`
ON `compliance_audit_events`
  (`organisation_id`, `target_type`, `target_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `compliance_audit_events_no_update`
BEFORE UPDATE ON `compliance_audit_events`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_AUDIT_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_audit_events_no_delete`
BEFORE DELETE ON `compliance_audit_events`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_AUDIT_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TABLE `compliance_write_guards` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `operation_id` text NOT NULL,
  `step_number` integer NOT NULL CHECK (`step_number` > 0),
  `verified` integer NOT NULL CHECK (`verified` = 1),
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_write_guards_operation_step_idx`
ON `compliance_write_guards` (`operation_id`, `step_number`);
--> statement-breakpoint
CREATE INDEX `compliance_write_guards_org_time_idx`
ON `compliance_write_guards` (`organisation_id`, `created_at`, `id`);
--> statement-breakpoint
CREATE TRIGGER `compliance_write_guards_no_update`
BEFORE UPDATE ON `compliance_write_guards`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WRITE_GUARD_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_write_guards_no_delete`
BEFORE DELETE ON `compliance_write_guards`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WRITE_GUARD_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TABLE `trade_mobile_upload_finalisation_guards` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_uid` text NOT NULL CHECK (trim(`owner_uid`) <> ''),
  `session_id` text NOT NULL CHECK (trim(`session_id`) <> ''),
  `step_number` integer NOT NULL CHECK (`step_number` > 0),
  `verified` integer NOT NULL CHECK (`verified` = 1),
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_mobile_upload_finalisation_guards_session_step_idx`
ON `trade_mobile_upload_finalisation_guards` (`session_id`, `step_number`);
--> statement-breakpoint
CREATE INDEX `trade_mobile_upload_finalisation_guards_owner_time_idx`
ON `trade_mobile_upload_finalisation_guards` (`owner_uid`, `created_at`, `id`);
--> statement-breakpoint
CREATE TRIGGER `trade_mobile_upload_finalisation_guards_session_guard`
BEFORE INSERT ON `trade_mobile_upload_finalisation_guards`
WHEN NOT EXISTS (
  SELECT 1
  FROM `trade_mobile_upload_sessions` session
  WHERE session.`id` = NEW.`session_id`
    AND session.`owner_uid` = NEW.`owner_uid`
)
BEGIN
  SELECT RAISE(ABORT, 'TRADE_MOBILE_FINALISATION_SESSION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `trade_mobile_upload_finalisation_guards_no_update`
BEFORE UPDATE ON `trade_mobile_upload_finalisation_guards`
BEGIN
  SELECT RAISE(ABORT, 'TRADE_MOBILE_FINALISATION_GUARD_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `trade_mobile_upload_finalisation_guards_no_delete`
BEFORE DELETE ON `trade_mobile_upload_finalisation_guards`
BEGIN
  SELECT RAISE(ABORT, 'TRADE_MOBILE_FINALISATION_GUARD_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TABLE `compliance_evidence_policy_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `activity_version_id` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` > 0),
  `title` text NOT NULL,
  `official_source_url` text NOT NULL,
  `official_source_title` text NOT NULL,
  `official_source_version` text NOT NULL,
  `official_source_sha256` text NOT NULL CHECK (
    length(`official_source_sha256`) = 64
    AND lower(`official_source_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `official_source_checked_at` text NOT NULL,
  `requirements_complete` integer DEFAULT 0 NOT NULL CHECK (
    `requirements_complete` IN (0, 1)
  ),
  `publish_state` text DEFAULT 'draft' NOT NULL CHECK (
    `publish_state` IN ('draft', 'published', 'withdrawn')
  ),
  `published_by_uid` text DEFAULT '' NOT NULL,
  `published_at` text DEFAULT '' NOT NULL,
  `withdrawn_by_uid` text DEFAULT '' NOT NULL,
  `withdrawn_at` text DEFAULT '' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (
    (`publish_state` = 'draft'
      AND `published_by_uid` = '' AND `published_at` = ''
      AND `withdrawn_by_uid` = '' AND `withdrawn_at` = '')
    OR (`publish_state` = 'published'
      AND `published_by_uid` <> '' AND `published_at` <> ''
      AND `withdrawn_by_uid` = '' AND `withdrawn_at` = '')
    OR (`publish_state` = 'withdrawn'
      AND `published_by_uid` <> '' AND `published_at` <> ''
      AND `withdrawn_by_uid` <> '' AND `withdrawn_at` <> '')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_evidence_policies_activity_version_idx`
ON `compliance_evidence_policy_versions` (`activity_version_id`, `version`);
--> statement-breakpoint
CREATE INDEX `compliance_evidence_policies_org_state_idx`
ON `compliance_evidence_policy_versions`
  (`organisation_id`, `publish_state`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `compliance_evidence_requirements` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `policy_version_id` text NOT NULL,
  `requirement_code` text NOT NULL,
  `title` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `evidence_type` text NOT NULL CHECK (
    `evidence_type` IN (
      'photo', 'document', 'declaration', 'signature', 'licence',
      'invoice', 'payment', 'product', 'serial', 'decommission',
      'location', 'other'
    )
  ),
  `capture_timing` text NOT NULL CHECK (
    `capture_timing` IN (
      'pre_install', 'during_install', 'post_install', 'any', 'periodic'
    )
  ),
  `minimum_count` integer DEFAULT 1 NOT NULL CHECK (`minimum_count` >= 0),
  `maximum_count` integer DEFAULT 1 NOT NULL CHECK (
    `maximum_count` = 0 OR `maximum_count` >= `minimum_count`
  ),
  `original_required` integer DEFAULT 0 NOT NULL CHECK (
    `original_required` IN (0, 1)
  ),
  `metadata_required` integer DEFAULT 0 NOT NULL CHECK (
    `metadata_required` IN (0, 1)
  ),
  `gps_required` integer DEFAULT 0 NOT NULL CHECK (`gps_required` IN (0, 1)),
  `date_stamp_required` integer DEFAULT 0 NOT NULL CHECK (
    `date_stamp_required` IN (0, 1)
  ),
  `installer_signature_required` integer DEFAULT 0 NOT NULL CHECK (
    `installer_signature_required` IN (0, 1)
  ),
  `customer_signature_required` integer DEFAULT 0 NOT NULL CHECK (
    `customer_signature_required` IN (0, 1)
  ),
  `allowed_content_types` text DEFAULT '[]' NOT NULL CHECK (
    json_valid(`allowed_content_types`)
  ),
  `condition_snapshot` text DEFAULT '{}' NOT NULL CHECK (
    json_valid(`condition_snapshot`)
  ),
  `field_schema` text DEFAULT '{}' NOT NULL CHECK (json_valid(`field_schema`)),
  `source_citation` text NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL CHECK (`sort_order` >= 0),
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_evidence_requirements_policy_code_idx`
ON `compliance_evidence_requirements`
  (`policy_version_id`, `requirement_code`);
--> statement-breakpoint
CREATE INDEX `compliance_evidence_requirements_policy_order_idx`
ON `compliance_evidence_requirements`
  (`policy_version_id`, `sort_order`, `requirement_code`);
--> statement-breakpoint
ALTER TABLE `compliance_cases`
ADD `evidence_policy_version_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `compliance_cases_evidence_policy_idx`
ON `compliance_cases` (`evidence_policy_version_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `compliance_cases_evidence_policy_insert_guard`
BEFORE INSERT ON `compliance_cases`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_evidence_policy_versions` policy
  WHERE policy.`id` = NEW.`evidence_policy_version_id`
    AND policy.`organisation_id` = NEW.`organisation_id`
    AND policy.`activity_version_id` = NEW.`activity_version_id`
    AND policy.`publish_state` = 'published'
    AND policy.`requirements_complete` = 1
    AND json_extract(
      NEW.`activity_snapshot`,
      '$.evidencePolicyVersionId'
    ) = policy.`id`
    AND CAST(json_extract(
      NEW.`activity_snapshot`,
      '$.evidencePolicyVersion'
    ) AS INTEGER) = policy.`version`
    AND json_extract(
      NEW.`activity_snapshot`,
      '$.evidencePolicyOfficialSourceVersion'
    ) = policy.`official_source_version`
    AND json_extract(
      NEW.`activity_snapshot`,
      '$.evidencePolicyOfficialSourceSha256'
    ) = policy.`official_source_sha256`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CASE_EVIDENCE_POLICY_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_cases_evidence_policy_update_guard`
BEFORE UPDATE OF `evidence_policy_version_id` ON `compliance_cases`
WHEN (
  OLD.`evidence_policy_version_id` <> ''
  OR NOT EXISTS (
    SELECT 1
    FROM `compliance_evidence_policy_versions` policy
    WHERE policy.`id` = NEW.`evidence_policy_version_id`
      AND policy.`organisation_id` = NEW.`organisation_id`
      AND policy.`activity_version_id` = NEW.`activity_version_id`
      AND policy.`publish_state` IN ('published', 'withdrawn')
      AND policy.`requirements_complete` = 1
      AND json_extract(
        NEW.`activity_snapshot`,
        '$.evidencePolicyVersionId'
      ) = policy.`id`
      AND CAST(json_extract(
        NEW.`activity_snapshot`,
        '$.evidencePolicyVersion'
      ) AS INTEGER) = policy.`version`
      AND json_extract(
        NEW.`activity_snapshot`,
        '$.evidencePolicyOfficialSourceVersion'
      ) = policy.`official_source_version`
      AND json_extract(
        NEW.`activity_snapshot`,
        '$.evidencePolicyOfficialSourceSha256'
      ) = policy.`official_source_sha256`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CASE_EVIDENCE_POLICY_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_policy_publish_guard`
BEFORE UPDATE OF `publish_state` ON `compliance_evidence_policy_versions`
WHEN NEW.`publish_state` = 'published'
BEGIN
  SELECT CASE WHEN NEW.`requirements_complete` <> 1
    THEN RAISE(ABORT, 'COMPLIANCE_EVIDENCE_POLICY_INCOMPLETE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `compliance_evidence_requirements` requirement
    WHERE requirement.`policy_version_id` = NEW.`id`
      AND requirement.`organisation_id` = NEW.`organisation_id`
  ) THEN RAISE(ABORT, 'COMPLIANCE_EVIDENCE_POLICY_EMPTY') END;
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_policy_transition_guard`
BEFORE UPDATE OF `publish_state` ON `compliance_evidence_policy_versions`
WHEN NOT (
  OLD.`publish_state` = NEW.`publish_state`
  OR (OLD.`publish_state` = 'draft' AND NEW.`publish_state` = 'published')
  OR (OLD.`publish_state` = 'published' AND NEW.`publish_state` = 'withdrawn')
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_POLICY_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_policy_published_content_no_update`
BEFORE UPDATE ON `compliance_evidence_policy_versions`
WHEN OLD.`publish_state` <> 'draft' AND (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`activity_version_id` <> OLD.`activity_version_id`
  OR NEW.`version` <> OLD.`version`
  OR NEW.`title` <> OLD.`title`
  OR NEW.`official_source_url` <> OLD.`official_source_url`
  OR NEW.`official_source_title` <> OLD.`official_source_title`
  OR NEW.`official_source_version` <> OLD.`official_source_version`
  OR NEW.`official_source_sha256` <> OLD.`official_source_sha256`
  OR NEW.`official_source_checked_at` <> OLD.`official_source_checked_at`
  OR NEW.`requirements_complete` <> OLD.`requirements_complete`
  OR NEW.`published_by_uid` <> OLD.`published_by_uid`
  OR NEW.`published_at` <> OLD.`published_at`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
  OR (
    NEW.`publish_state` = OLD.`publish_state`
    AND (
      NEW.`withdrawn_by_uid` <> OLD.`withdrawn_by_uid`
      OR NEW.`withdrawn_at` <> OLD.`withdrawn_at`
      OR NEW.`updated_at` <> OLD.`updated_at`
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_POLICY_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_policy_non_draft_no_delete`
BEFORE DELETE ON `compliance_evidence_policy_versions`
WHEN OLD.`publish_state` <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_POLICY_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_requirement_published_no_update`
BEFORE UPDATE ON `compliance_evidence_requirements`
WHEN EXISTS (
  SELECT 1 FROM `compliance_evidence_policy_versions` policy
  WHERE policy.`id` = OLD.`policy_version_id`
    AND policy.`publish_state` <> 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_REQUIREMENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_requirement_published_no_delete`
BEFORE DELETE ON `compliance_evidence_requirements`
WHEN EXISTS (
  SELECT 1 FROM `compliance_evidence_policy_versions` policy
  WHERE policy.`id` = OLD.`policy_version_id`
    AND policy.`publish_state` <> 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_REQUIREMENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_requirement_non_draft_no_insert`
BEFORE INSERT ON `compliance_evidence_requirements`
WHEN EXISTS (
  SELECT 1 FROM `compliance_evidence_policy_versions` policy
  WHERE policy.`id` = NEW.`policy_version_id`
    AND policy.`organisation_id` = NEW.`organisation_id`
    AND policy.`publish_state` <> 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_REQUIREMENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TABLE `compliance_participants` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `participant_type` text NOT NULL CHECK (
    `participant_type` IN (
      'installer', 'retailer', 'aggregator', 'auditor', 'supplier', 'agent'
    )
  ),
  `external_reference` text DEFAULT '' NOT NULL,
  `legal_name` text NOT NULL,
  `trading_name` text DEFAULT '' NOT NULL,
  `abn` text DEFAULT '' NOT NULL,
  `contact_email` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (
    `status` IN ('pending', 'active', 'suspended', 'expired', 'retired')
  ),
  `effective_from` text DEFAULT '' NOT NULL,
  `effective_to` text DEFAULT '' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_participants_org_status_idx`
ON `compliance_participants`
  (`organisation_id`, `participant_type`, `status`, `trading_name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_participants_external_idx`
ON `compliance_participants` (`organisation_id`, `external_reference`)
WHERE `external_reference` <> '';
--> statement-breakpoint
CREATE TABLE `compliance_participant_abilities` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `participant_id` text NOT NULL,
  `program_id` text DEFAULT '' NOT NULL,
  `activity_version_id` text DEFAULT '' NOT NULL,
  `ability_code` text NOT NULL,
  `ability_role` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (
    `status` IN ('pending', 'active', 'suspended', 'expired', 'revoked')
  ),
  `effective_from` text NOT NULL,
  `effective_to` text DEFAULT '' NOT NULL,
  `evidence_snapshot` text DEFAULT '{}' NOT NULL CHECK (
    json_valid(`evidence_snapshot`)
  ),
  `approved_by_uid` text DEFAULT '' NOT NULL,
  `approved_at` text DEFAULT '' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_participant_abilities_key_idx`
ON `compliance_participant_abilities`
  (`participant_id`, `ability_code`, `effective_from`);
--> statement-breakpoint
CREATE INDEX `compliance_participant_abilities_expiry_idx`
ON `compliance_participant_abilities`
  (`organisation_id`, `status`, `effective_to`, `participant_id`);
--> statement-breakpoint
CREATE TABLE `compliance_case_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `case_id` text NOT NULL,
  `compliance_user_id` text NOT NULL,
  `assignment_role` text NOT NULL CHECK (
    `assignment_role` IN (
      'case_manager', 'primary_reviewer', 'secondary_reviewer', 'auditor'
    )
  ),
  `status` text DEFAULT 'assigned' NOT NULL CHECK (
    `status` IN ('assigned', 'released', 'completed')
  ),
  `assigned_by_uid` text NOT NULL,
  `assigned_at` text NOT NULL,
  `released_at` text DEFAULT '' NOT NULL,
  `completed_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_case_assignments_active_role_idx`
ON `compliance_case_assignments`
  (`case_id`, `compliance_user_id`, `assignment_role`);
--> statement-breakpoint
CREATE INDEX `compliance_case_assignments_user_status_idx`
ON `compliance_case_assignments`
  (`organisation_id`, `compliance_user_id`, `status`, `assigned_at`);
--> statement-breakpoint
CREATE TABLE `compliance_case_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `case_id` text NOT NULL,
  `task_type` text NOT NULL CHECK (
    `task_type` IN (
      'evidence', 'review', 'correction', 'submission',
      'reconciliation', 'participant', 'general'
    )
  ),
  `title` text NOT NULL,
  `detail` text DEFAULT '' NOT NULL,
  `priority` text DEFAULT 'normal' NOT NULL CHECK (
    `priority` IN ('low', 'normal', 'high', 'urgent')
  ),
  `status` text DEFAULT 'open' NOT NULL CHECK (
    `status` IN ('open', 'in_progress', 'blocked', 'completed', 'cancelled')
  ),
  `assignee_user_id` text DEFAULT '' NOT NULL,
  `due_at` text DEFAULT '' NOT NULL,
  `created_by_uid` text NOT NULL,
  `completed_by_uid` text DEFAULT '' NOT NULL,
  `completed_at` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_case_tasks_queue_idx`
ON `compliance_case_tasks`
  (`organisation_id`, `status`, `priority`, `due_at`, `created_at`);
--> statement-breakpoint
CREATE INDEX `compliance_case_tasks_case_idx`
ON `compliance_case_tasks` (`case_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `compliance_case_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `case_id` text NOT NULL,
  `requirement_id` text NOT NULL,
  `job_media_id` text DEFAULT '' NOT NULL,
  `supersedes_evidence_id` text DEFAULT '' NOT NULL,
  `source_type` text NOT NULL CHECK (
    `source_type` IN (
      'field_app', 'installer_upload', 'customer_upload', 'import', 'registry'
    )
  ),
  `status` text DEFAULT 'received' NOT NULL CHECK (
    `status` IN (
      'received', 'under_review', 'accepted', 'rejected',
      'superseded', 'withdrawn'
    )
  ),
  `object_key` text NOT NULL,
  `file_name` text NOT NULL,
  `content_type` text NOT NULL,
  `size_bytes` integer NOT NULL CHECK (`size_bytes` > 0),
  `original_sha256` text NOT NULL CHECK (
    length(`original_sha256`) = 64
    AND lower(`original_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `evidence_envelope` text NOT NULL CHECK (json_valid(`evidence_envelope`)),
  `received_by_type` text NOT NULL CHECK (
    `received_by_type` IN ('installer', 'compliance', 'platform')
  ),
  `received_by_uid` text NOT NULL,
  `received_at` text NOT NULL,
  `reviewed_by_uid` text DEFAULT '' NOT NULL,
  `reviewed_at` text DEFAULT '' NOT NULL,
  `retention_until` text DEFAULT '' NOT NULL,
  `legal_hold` integer DEFAULT 0 NOT NULL CHECK (`legal_hold` IN (0, 1)),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_case_evidence_job_media_idx`
ON `compliance_case_evidence` (`job_media_id`)
WHERE `job_media_id` <> '';
--> statement-breakpoint
CREATE INDEX `compliance_case_evidence_case_requirement_idx`
ON `compliance_case_evidence`
  (`case_id`, `requirement_id`, `status`, `received_at`);
--> statement-breakpoint
CREATE INDEX `compliance_case_evidence_review_idx`
ON `compliance_case_evidence`
  (`organisation_id`, `status`, `received_at`);
--> statement-breakpoint
CREATE TRIGGER `compliance_case_evidence_original_no_update`
BEFORE UPDATE ON `compliance_case_evidence`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`case_id` <> OLD.`case_id`
  OR NEW.`requirement_id` <> OLD.`requirement_id`
  OR NEW.`job_media_id` <> OLD.`job_media_id`
  OR NEW.`supersedes_evidence_id` <> OLD.`supersedes_evidence_id`
  OR NEW.`source_type` <> OLD.`source_type`
  OR NEW.`object_key` <> OLD.`object_key`
  OR NEW.`file_name` <> OLD.`file_name`
  OR NEW.`content_type` <> OLD.`content_type`
  OR NEW.`size_bytes` <> OLD.`size_bytes`
  OR NEW.`original_sha256` <> OLD.`original_sha256`
  OR NEW.`evidence_envelope` <> OLD.`evidence_envelope`
  OR NEW.`received_by_type` <> OLD.`received_by_type`
  OR NEW.`received_by_uid` <> OLD.`received_by_uid`
  OR NEW.`received_at` <> OLD.`received_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_evidence_no_delete`
BEFORE DELETE ON `compliance_case_evidence`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_job_media_no_delete`
BEFORE DELETE ON `trade_crm_job_media`
WHEN EXISTS (
  SELECT 1
  FROM `compliance_case_evidence` evidence
  WHERE evidence.`job_media_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_MEDIA_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_evidence_transition_guard`
BEFORE UPDATE OF `status` ON `compliance_case_evidence`
WHEN NOT (
  OLD.`status` = NEW.`status`
  OR (
    OLD.`status` = 'received'
    AND NEW.`status` IN ('under_review', 'accepted', 'rejected', 'withdrawn')
  )
  OR (
    OLD.`status` = 'under_review'
    AND NEW.`status` IN ('accepted', 'rejected', 'withdrawn')
  )
  OR (
    OLD.`status` IN ('accepted', 'rejected')
    AND NEW.`status` IN ('superseded', 'withdrawn')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TABLE `compliance_case_findings` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `case_id` text NOT NULL,
  `evidence_id` text DEFAULT '' NOT NULL,
  `requirement_id` text DEFAULT '' NOT NULL,
  `finding_code` text NOT NULL,
  `severity` text NOT NULL CHECK (
    `severity` IN ('information', 'minor', 'major', 'critical')
  ),
  `description` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL CHECK (
    `status` IN ('open', 'resolved', 'waived')
  ),
  `raised_by_uid` text NOT NULL,
  `raised_at` text NOT NULL,
  `resolved_by_uid` text DEFAULT '' NOT NULL,
  `resolved_at` text DEFAULT '' NOT NULL,
  `resolution_note` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_case_findings_case_status_idx`
ON `compliance_case_findings` (`case_id`, `status`, `severity`, `raised_at`);
--> statement-breakpoint
CREATE INDEX `compliance_case_findings_org_status_idx`
ON `compliance_case_findings`
  (`organisation_id`, `status`, `severity`, `raised_at`);
--> statement-breakpoint
CREATE TABLE `compliance_case_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `case_id` text NOT NULL,
  `case_revision` integer NOT NULL CHECK (`case_revision` > 0),
  `decision_type` text NOT NULL CHECK (
    `decision_type` IN (
      'evidence_complete', 'eligibility', 'ready_to_submit',
      'submission_outcome', 'case_closure'
    )
  ),
  `outcome` text NOT NULL CHECK (
    `outcome` IN ('approved', 'rejected', 'changes_required', 'withdrawn')
  ),
  `basis_snapshot` text NOT NULL CHECK (json_valid(`basis_snapshot`)),
  `primary_reviewer_uid` text NOT NULL,
  `secondary_reviewer_uid` text DEFAULT '' NOT NULL,
  `decided_at` text NOT NULL,
  `created_at` text NOT NULL,
  CHECK (
    `outcome` <> 'approved'
    OR `decision_type` NOT IN ('eligibility', 'ready_to_submit')
    OR (
      `secondary_reviewer_uid` <> ''
      AND `secondary_reviewer_uid` <> `primary_reviewer_uid`
    )
  )
);
--> statement-breakpoint
CREATE INDEX `compliance_case_decisions_case_time_idx`
ON `compliance_case_decisions` (`case_id`, `decided_at`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_case_decisions_case_revision_idx`
ON `compliance_case_decisions`
  (`case_id`, `case_revision`, `decision_type`, `decided_at`, `id`);
--> statement-breakpoint
CREATE TRIGGER `compliance_case_decisions_no_update`
BEFORE UPDATE ON `compliance_case_decisions`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CASE_DECISION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_decisions_no_delete`
BEFORE DELETE ON `compliance_case_decisions`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CASE_DECISION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TABLE `compliance_decision_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `case_id` text NOT NULL,
  `case_revision` integer NOT NULL CHECK (`case_revision` > 0),
  `decision_type` text NOT NULL CHECK (
    `decision_type` IN ('eligibility', 'ready_to_submit')
  ),
  `outcome` text NOT NULL CHECK (`outcome` = 'approved'),
  `basis_snapshot` text NOT NULL CHECK (json_valid(`basis_snapshot`)),
  `status` text DEFAULT 'pending' NOT NULL CHECK (
    `status` IN ('pending', 'approved', 'rejected', 'withdrawn')
  ),
  `primary_reviewer_uid` text NOT NULL,
  `secondary_reviewer_uid` text DEFAULT '' NOT NULL,
  `reviewed_at` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (
    (`status` = 'pending'
      AND `secondary_reviewer_uid` = '' AND `reviewed_at` = '')
    OR (`status` <> 'pending'
      AND `secondary_reviewer_uid` <> ''
      AND `secondary_reviewer_uid` <> `primary_reviewer_uid`
      AND `reviewed_at` <> '')
  )
);
--> statement-breakpoint
CREATE INDEX `compliance_decision_requests_case_status_idx`
ON `compliance_decision_requests`
  (`case_id`, `case_revision`, `status`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `compliance_decision_requests_org_status_idx`
ON `compliance_decision_requests`
  (`organisation_id`, `status`, `created_at`, `id`);
--> statement-breakpoint
CREATE TRIGGER `compliance_decision_requests_original_no_update`
BEFORE UPDATE ON `compliance_decision_requests`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`case_id` <> OLD.`case_id`
  OR NEW.`case_revision` <> OLD.`case_revision`
  OR NEW.`decision_type` <> OLD.`decision_type`
  OR NEW.`outcome` <> OLD.`outcome`
  OR NEW.`basis_snapshot` <> OLD.`basis_snapshot`
  OR NEW.`primary_reviewer_uid` <> OLD.`primary_reviewer_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_DECISION_REQUEST_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_decision_requests_transition_guard`
BEFORE UPDATE OF `status` ON `compliance_decision_requests`
WHEN NOT (
  OLD.`status` = NEW.`status`
  OR (
    OLD.`status` = 'pending'
    AND NEW.`status` IN ('approved', 'rejected', 'withdrawn')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_DECISION_REQUEST_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_decision_requests_no_delete`
BEFORE DELETE ON `compliance_decision_requests`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_DECISION_REQUEST_NO_DELETE');
END;
--> statement-breakpoint
CREATE TABLE `compliance_equipment_records` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `case_id` text NOT NULL,
  `record_type` text NOT NULL CHECK (
    `record_type` IN ('installed', 'decommissioned', 'stock')
  ),
  `manufacturer` text DEFAULT '' NOT NULL,
  `model` text DEFAULT '' NOT NULL,
  `serial_number` text DEFAULT '' NOT NULL,
  `product_registry` text DEFAULT '' NOT NULL,
  `product_reference` text DEFAULT '' NOT NULL,
  `quantity` integer DEFAULT 1 NOT NULL CHECK (`quantity` > 0),
  `status` text NOT NULL CHECK (
    `status` IN (
      'expected', 'received', 'installed', 'decommissioned',
      'removed', 'returned', 'scrapped'
    )
  ),
  `evidence_snapshot` text DEFAULT '{}' NOT NULL CHECK (
    json_valid(`evidence_snapshot`)
  ),
  `recorded_by_uid` text NOT NULL,
  `recorded_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_equipment_case_type_idx`
ON `compliance_equipment_records`
  (`case_id`, `record_type`, `status`, `recorded_at`);
--> statement-breakpoint
CREATE INDEX `compliance_equipment_serial_idx`
ON `compliance_equipment_records`
  (`organisation_id`, `serial_number`, `status`);
--> statement-breakpoint
CREATE TABLE `compliance_calculator_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `activity_version_id` text NOT NULL,
  `calculator_key` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` > 0),
  `title` text NOT NULL,
  `output_type` text NOT NULL CHECK (
    `output_type` IN (
      'STC', 'VEEC', 'ESC', 'PRC', 'GJ', 'dollars', 'other'
    )
  ),
  `specification` text NOT NULL CHECK (json_valid(`specification`)),
  `rounding_policy` text NOT NULL,
  `official_source_url` text NOT NULL,
  `official_source_version` text NOT NULL,
  `official_source_sha256` text NOT NULL CHECK (
    length(`official_source_sha256`) = 64
    AND lower(`official_source_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `approval_state` text DEFAULT 'draft' NOT NULL CHECK (
    `approval_state` IN (
      'draft', 'testing', 'approved', 'blocked', 'withdrawn'
    )
  ),
  `primary_approver_uid` text DEFAULT '' NOT NULL,
  `secondary_approver_uid` text DEFAULT '' NOT NULL,
  `approved_at` text DEFAULT '' NOT NULL,
  `withdrawn_at` text DEFAULT '' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (
    `approval_state` <> 'approved'
    OR (
      `primary_approver_uid` <> ''
      AND `secondary_approver_uid` <> ''
      AND `primary_approver_uid` <> `secondary_approver_uid`
      AND `approved_at` <> ''
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_calculator_versions_key_idx`
ON `compliance_calculator_versions`
  (`activity_version_id`, `calculator_key`, `version`);
--> statement-breakpoint
CREATE INDEX `compliance_calculator_versions_state_idx`
ON `compliance_calculator_versions`
  (`organisation_id`, `approval_state`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `compliance_calculator_test_vectors` (
  `id` text PRIMARY KEY NOT NULL,
  `calculator_version_id` text NOT NULL,
  `vector_key` text NOT NULL,
  `input_snapshot` text NOT NULL CHECK (json_valid(`input_snapshot`)),
  `expected_output` text NOT NULL CHECK (json_valid(`expected_output`)),
  `tolerance_snapshot` text DEFAULT '{}' NOT NULL CHECK (
    json_valid(`tolerance_snapshot`)
  ),
  `source_citation` text NOT NULL,
  `last_result` text DEFAULT 'not_run' NOT NULL CHECK (
    `last_result` IN ('not_run', 'passed', 'failed')
  ),
  `last_run_at` text DEFAULT '' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_calculator_vectors_key_idx`
ON `compliance_calculator_test_vectors`
  (`calculator_version_id`, `vector_key`);
--> statement-breakpoint
CREATE TABLE `compliance_calculation_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `case_id` text NOT NULL,
  `case_revision` integer NOT NULL CHECK (`case_revision` > 0),
  `calculator_version_id` text NOT NULL,
  `input_snapshot` text NOT NULL CHECK (json_valid(`input_snapshot`)),
  `output_snapshot` text DEFAULT '{}' NOT NULL CHECK (
    json_valid(`output_snapshot`)
  ),
  `status` text DEFAULT 'blocked' NOT NULL CHECK (
    `status` IN ('blocked', 'calculated', 'verified', 'rejected')
  ),
  `blocked_reason` text DEFAULT '' NOT NULL,
  `run_by_uid` text NOT NULL,
  `run_at` text NOT NULL,
  `verified_by_uid` text DEFAULT '' NOT NULL,
  `verified_at` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_calculation_runs_case_idx`
ON `compliance_calculation_runs` (`case_id`, `case_revision`, `run_at`);
--> statement-breakpoint
CREATE TRIGGER `compliance_calculation_runs_no_update`
BEFORE UPDATE ON `compliance_calculation_runs`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATION_RUN_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_calculation_runs_no_delete`
BEFORE DELETE ON `compliance_calculation_runs`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATION_RUN_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TABLE `compliance_submission_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `program_id` text NOT NULL,
  `batch_number` text NOT NULL,
  `external_reference` text DEFAULT '' NOT NULL,
  `format` text NOT NULL CHECK (`format` IN ('json', 'csv', 'manual', 'api')),
  `status` text DEFAULT 'draft' NOT NULL CHECK (
    `status` IN (
      'draft', 'ready', 'exported', 'submitted', 'partially_accepted',
      'accepted', 'rejected', 'reconciled', 'cancelled'
    )
  ),
  `payload_sha256` text DEFAULT '' NOT NULL CHECK (
    `payload_sha256` = ''
    OR (
      length(`payload_sha256`) = 64
      AND lower(`payload_sha256`) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  `case_count` integer DEFAULT 0 NOT NULL CHECK (`case_count` >= 0),
  `certificate_quantity` integer DEFAULT 0 NOT NULL CHECK (
    `certificate_quantity` >= 0
  ),
  `created_by_uid` text NOT NULL,
  `exported_at` text DEFAULT '' NOT NULL,
  `submitted_at` text DEFAULT '' NOT NULL,
  `reconciled_at` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_submission_batches_number_idx`
ON `compliance_submission_batches` (`organisation_id`, `batch_number`);
--> statement-breakpoint
CREATE INDEX `compliance_submission_batches_queue_idx`
ON `compliance_submission_batches`
  (`organisation_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `compliance_submission_batch_items` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `batch_id` text NOT NULL,
  `case_id` text NOT NULL,
  `case_revision` integer NOT NULL CHECK (`case_revision` > 0),
  `status` text DEFAULT 'staged' NOT NULL CHECK (
    `status` IN (
      'staged', 'submitted', 'accepted', 'rejected',
      'correction_required', 'removed'
    )
  ),
  `external_reference` text DEFAULT '' NOT NULL,
  `result_snapshot` text DEFAULT '{}' NOT NULL CHECK (
    json_valid(`result_snapshot`)
  ),
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_submission_batch_items_case_idx`
ON `compliance_submission_batch_items` (`batch_id`, `case_id`);
--> statement-breakpoint
CREATE INDEX `compliance_submission_batch_items_status_idx`
ON `compliance_submission_batch_items`
  (`batch_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `compliance_submission_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `batch_id` text NOT NULL,
  `artifact_type` text NOT NULL CHECK (
    `artifact_type` IN (
      'export_json', 'export_csv', 'submission_receipt',
      'response_file', 'reconciliation_report'
    )
  ),
  `object_key` text NOT NULL,
  `file_name` text NOT NULL,
  `content_type` text NOT NULL,
  `size_bytes` integer NOT NULL CHECK (`size_bytes` > 0),
  `sha256` text NOT NULL CHECK (
    length(`sha256`) = 64
    AND lower(`sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_submission_artifacts_batch_idx`
ON `compliance_submission_artifacts` (`batch_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_artifacts_no_update`
BEFORE UPDATE ON `compliance_submission_artifacts`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_ARTIFACT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_artifacts_no_delete`
BEFORE DELETE ON `compliance_submission_artifacts`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_ARTIFACT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TABLE `compliance_submission_responses` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `batch_id` text NOT NULL,
  `batch_item_id` text DEFAULT '' NOT NULL,
  `response_type` text NOT NULL CHECK (
    `response_type` IN ('accepted', 'rejected', 'warning', 'error', 'duplicate')
  ),
  `response_code` text DEFAULT '' NOT NULL,
  `message` text NOT NULL,
  `payload_snapshot` text DEFAULT '{}' NOT NULL CHECK (
    json_valid(`payload_snapshot`)
  ),
  `occurred_at` text NOT NULL,
  `recorded_by_uid` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_submission_responses_batch_idx`
ON `compliance_submission_responses`
  (`batch_id`, `occurred_at`, `id`);
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_responses_no_update`
BEFORE UPDATE ON `compliance_submission_responses`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_RESPONSE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_responses_no_delete`
BEFORE DELETE ON `compliance_submission_responses`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_RESPONSE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TABLE `compliance_certificate_lots` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `program_id` text NOT NULL,
  `batch_id` text DEFAULT '' NOT NULL,
  `certificate_type` text NOT NULL,
  `registry_lot_reference` text DEFAULT '' NOT NULL,
  `quantity` integer NOT NULL CHECK (`quantity` >= 0),
  `status` text DEFAULT 'pending' NOT NULL CHECK (
    `status` IN (
      'pending', 'created', 'available', 'reserved',
      'traded', 'retired', 'cancelled'
    )
  ),
  `vintage_from` text DEFAULT '' NOT NULL,
  `vintage_to` text DEFAULT '' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_certificate_lots_inventory_idx`
ON `compliance_certificate_lots`
  (`organisation_id`, `certificate_type`, `status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `compliance_trades` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `certificate_lot_id` text NOT NULL,
  `counterparty_reference` text NOT NULL,
  `quantity` integer NOT NULL CHECK (`quantity` > 0),
  `unit_price_cents` integer NOT NULL CHECK (`unit_price_cents` >= 0),
  `trade_date` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (
    `status` IN ('pending', 'confirmed', 'settled', 'cancelled')
  ),
  `external_reference` text DEFAULT '' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_trades_status_idx`
ON `compliance_trades` (`organisation_id`, `status`, `trade_date`);
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_quantity_guard`
BEFORE INSERT ON `compliance_trades`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_certificate_lots` lot
  WHERE lot.`id` = NEW.`certificate_lot_id`
    AND lot.`organisation_id` = NEW.`organisation_id`
    AND lot.`status` IN ('available', 'reserved')
    AND NEW.`quantity` + COALESCE((
      SELECT SUM(existing.`quantity`)
      FROM `compliance_trades` existing
      WHERE existing.`certificate_lot_id` = lot.`id`
        AND existing.`organisation_id` = lot.`organisation_id`
        AND existing.`status` IN ('pending', 'confirmed', 'settled')
    ), 0) <= lot.`quantity`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_QUANTITY_INVALID');
END;
--> statement-breakpoint
CREATE TABLE `compliance_settlements` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `trade_id` text NOT NULL,
  `gross_cents` integer NOT NULL CHECK (`gross_cents` >= 0),
  `fee_cents` integer DEFAULT 0 NOT NULL CHECK (`fee_cents` >= 0),
  `net_cents` integer NOT NULL CHECK (`net_cents` >= 0),
  `due_date` text NOT NULL,
  `settled_at` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (
    `status` IN ('pending', 'processing', 'settled', 'failed', 'cancelled')
  ),
  `external_reference` text DEFAULT '' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (`net_cents` = `gross_cents` - `fee_cents`)
);
--> statement-breakpoint
CREATE INDEX `compliance_settlements_status_idx`
ON `compliance_settlements`
  (`organisation_id`, `status`, `due_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_settlements_active_trade_idx`
ON `compliance_settlements` (`trade_id`)
WHERE `status` <> 'cancelled';
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_trade_guard`
BEFORE INSERT ON `compliance_settlements`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_trades` trade
  WHERE trade.`id` = NEW.`trade_id`
    AND trade.`organisation_id` = NEW.`organisation_id`
    AND trade.`status` IN ('pending', 'confirmed')
    AND NEW.`gross_cents` = trade.`quantity` * trade.`unit_price_cents`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_TRADE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_invitations_organisation_guard`
BEFORE INSERT ON `compliance_invitations`
WHEN NOT EXISTS (
  SELECT 1 FROM `compliance_organisations` organisation
  WHERE organisation.`id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_INVITATION_ORGANISATION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_audit_events_organisation_guard`
BEFORE INSERT ON `compliance_audit_events`
WHEN NOT EXISTS (
  SELECT 1 FROM `compliance_organisations` organisation
  WHERE organisation.`id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_AUDIT_ORGANISATION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_write_guards_organisation_guard`
BEFORE INSERT ON `compliance_write_guards`
WHEN NOT EXISTS (
  SELECT 1 FROM `compliance_organisations` organisation
  WHERE organisation.`id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_WRITE_GUARD_ORGANISATION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_users_organisation_guard`
BEFORE INSERT ON `compliance_users`
WHEN NOT EXISTS (
  SELECT 1 FROM `compliance_organisations` organisation
  WHERE organisation.`id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_USER_ORGANISATION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_policies_activity_insert_guard`
BEFORE INSERT ON `compliance_evidence_policy_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_activity_versions` activity
  JOIN `compliance_programs` program
    ON program.`id` = activity.`program_id`
  WHERE activity.`id` = NEW.`activity_version_id`
    AND program.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_POLICY_ACTIVITY_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_policies_activity_update_guard`
BEFORE UPDATE OF `organisation_id`, `activity_version_id`
ON `compliance_evidence_policy_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_activity_versions` activity
  JOIN `compliance_programs` program
    ON program.`id` = activity.`program_id`
  WHERE activity.`id` = NEW.`activity_version_id`
    AND program.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_POLICY_ACTIVITY_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_requirements_policy_insert_guard`
BEFORE INSERT ON `compliance_evidence_requirements`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_evidence_policy_versions` policy
  WHERE policy.`id` = NEW.`policy_version_id`
    AND policy.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_REQUIREMENT_POLICY_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_evidence_requirements_policy_update_guard`
BEFORE UPDATE OF `organisation_id`, `policy_version_id`
ON `compliance_evidence_requirements`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_evidence_policy_versions` policy
  WHERE policy.`id` = NEW.`policy_version_id`
    AND policy.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_REQUIREMENT_POLICY_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_participants_organisation_guard`
BEFORE INSERT ON `compliance_participants`
WHEN NOT EXISTS (
  SELECT 1 FROM `compliance_organisations` organisation
  WHERE organisation.`id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_PARTICIPANT_ORGANISATION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_participant_abilities_links_insert_guard`
BEFORE INSERT ON `compliance_participant_abilities`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `compliance_participants` participant
    WHERE participant.`id` = NEW.`participant_id`
      AND participant.`organisation_id` = NEW.`organisation_id`
  )
  OR (
    NEW.`program_id` <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_programs` program
      WHERE program.`id` = NEW.`program_id`
        AND program.`organisation_id` = NEW.`organisation_id`
    )
  )
  OR (
    NEW.`activity_version_id` <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_activity_versions` activity
      JOIN `compliance_programs` program
        ON program.`id` = activity.`program_id`
      WHERE activity.`id` = NEW.`activity_version_id`
        AND program.`organisation_id` = NEW.`organisation_id`
        AND (
          NEW.`program_id` = ''
          OR activity.`program_id` = NEW.`program_id`
        )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_PARTICIPANT_ABILITY_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_assignments_links_guard`
BEFORE INSERT ON `compliance_case_assignments`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `compliance_cases` compliance_case
    WHERE compliance_case.`id` = NEW.`case_id`
      AND compliance_case.`organisation_id` = NEW.`organisation_id`
  )
  OR NOT EXISTS (
    SELECT 1
    FROM `compliance_users` compliance_user
    WHERE compliance_user.`id` = NEW.`compliance_user_id`
      AND compliance_user.`organisation_id` = NEW.`organisation_id`
      AND (
        (NEW.`assignment_role` = 'case_manager'
          AND compliance_user.`role` IN ('admin', 'case_manager'))
        OR (NEW.`assignment_role` IN ('primary_reviewer', 'secondary_reviewer')
          AND compliance_user.`role` IN ('admin', 'reviewer'))
        OR (NEW.`assignment_role` = 'auditor'
          AND compliance_user.`role` IN ('admin', 'auditor'))
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_ASSIGNMENT_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_tasks_links_insert_guard`
BEFORE INSERT ON `compliance_case_tasks`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `compliance_cases` compliance_case
    WHERE compliance_case.`id` = NEW.`case_id`
      AND compliance_case.`organisation_id` = NEW.`organisation_id`
  )
  OR (
    NEW.`assignee_user_id` <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_users` compliance_user
      WHERE compliance_user.`id` = NEW.`assignee_user_id`
        AND compliance_user.`organisation_id` = NEW.`organisation_id`
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TASK_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_tasks_assignee_update_guard`
BEFORE UPDATE OF `assignee_user_id` ON `compliance_case_tasks`
WHEN (
  NEW.`assignee_user_id` <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM `compliance_users` compliance_user
    WHERE compliance_user.`id` = NEW.`assignee_user_id`
      AND compliance_user.`organisation_id` = NEW.`organisation_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TASK_ASSIGNEE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_evidence_links_guard`
BEFORE INSERT ON `compliance_case_evidence`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `compliance_cases` compliance_case
    JOIN `compliance_evidence_requirements` requirement
      ON requirement.`id` = NEW.`requirement_id`
      AND requirement.`organisation_id` = compliance_case.`organisation_id`
      AND requirement.`policy_version_id`
        = compliance_case.`evidence_policy_version_id`
    WHERE compliance_case.`id` = NEW.`case_id`
      AND compliance_case.`organisation_id` = NEW.`organisation_id`
  )
  OR (
    NEW.`job_media_id` <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM `trade_crm_job_media` media
      JOIN `compliance_cases` compliance_case
        ON compliance_case.`id` = NEW.`case_id`
      WHERE media.`id` = NEW.`job_media_id`
        AND media.`work_order_id` = compliance_case.`work_order_id`
        AND media.`firebase_uid` = compliance_case.`installer_uid`
        AND compliance_case.`organisation_id` = NEW.`organisation_id`
    )
  )
  OR (
    NEW.`supersedes_evidence_id` <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_case_evidence` superseded
      WHERE superseded.`id` = NEW.`supersedes_evidence_id`
        AND superseded.`organisation_id` = NEW.`organisation_id`
        AND superseded.`case_id` = NEW.`case_id`
        AND superseded.`requirement_id` = NEW.`requirement_id`
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_findings_links_guard`
BEFORE INSERT ON `compliance_case_findings`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `compliance_cases` compliance_case
    WHERE compliance_case.`id` = NEW.`case_id`
      AND compliance_case.`organisation_id` = NEW.`organisation_id`
  )
  OR (
    NEW.`evidence_id` <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_case_evidence` evidence
      WHERE evidence.`id` = NEW.`evidence_id`
        AND evidence.`organisation_id` = NEW.`organisation_id`
        AND evidence.`case_id` = NEW.`case_id`
        AND (
          NEW.`requirement_id` = ''
          OR evidence.`requirement_id` = NEW.`requirement_id`
        )
    )
  )
  OR (
    NEW.`requirement_id` <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_cases` compliance_case
      JOIN `compliance_evidence_requirements` requirement
        ON requirement.`id` = NEW.`requirement_id`
        AND requirement.`organisation_id` = compliance_case.`organisation_id`
        AND requirement.`policy_version_id`
          = compliance_case.`evidence_policy_version_id`
      WHERE compliance_case.`id` = NEW.`case_id`
        AND compliance_case.`organisation_id` = NEW.`organisation_id`
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_FINDING_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_decisions_links_guard`
BEFORE INSERT ON `compliance_case_decisions`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `compliance_cases` compliance_case
    WHERE compliance_case.`id` = NEW.`case_id`
      AND compliance_case.`organisation_id` = NEW.`organisation_id`
      AND compliance_case.`revision` = NEW.`case_revision`
  )
  OR NOT EXISTS (
    SELECT 1
    FROM `compliance_users` reviewer
    WHERE reviewer.`firebase_uid` = NEW.`primary_reviewer_uid`
      AND reviewer.`organisation_id` = NEW.`organisation_id`
      AND reviewer.`status` = 'active'
      AND reviewer.`role` IN ('admin', 'reviewer')
  )
  OR (
    NEW.`secondary_reviewer_uid` <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_users` reviewer
      WHERE reviewer.`firebase_uid` = NEW.`secondary_reviewer_uid`
        AND reviewer.`organisation_id` = NEW.`organisation_id`
        AND reviewer.`status` = 'active'
        AND reviewer.`role` IN ('admin', 'reviewer')
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_DECISION_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_decision_requests_links_guard`
BEFORE INSERT ON `compliance_decision_requests`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `compliance_cases` compliance_case
    WHERE compliance_case.`id` = NEW.`case_id`
      AND compliance_case.`organisation_id` = NEW.`organisation_id`
      AND compliance_case.`revision` = NEW.`case_revision`
  )
  OR NOT EXISTS (
    SELECT 1
    FROM `compliance_users` reviewer
    WHERE reviewer.`firebase_uid` = NEW.`primary_reviewer_uid`
      AND reviewer.`organisation_id` = NEW.`organisation_id`
      AND reviewer.`status` = 'active'
      AND reviewer.`role` IN ('admin', 'reviewer')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_DECISION_REQUEST_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_decision_requests_secondary_update_guard`
BEFORE UPDATE OF `status`, `secondary_reviewer_uid`
ON `compliance_decision_requests`
WHEN (
  NEW.`status` = 'approved'
  AND NOT EXISTS (
    SELECT 1
    FROM `compliance_users` primary_reviewer
    WHERE primary_reviewer.`firebase_uid` = NEW.`primary_reviewer_uid`
      AND primary_reviewer.`organisation_id` = NEW.`organisation_id`
      AND primary_reviewer.`status` = 'active'
      AND primary_reviewer.`role` IN ('admin', 'reviewer')
  )
)
OR (
  NEW.`status` = 'approved'
  AND NOT EXISTS (
    SELECT 1
    FROM `compliance_cases` compliance_case
    WHERE compliance_case.`id` = NEW.`case_id`
      AND compliance_case.`organisation_id` = NEW.`organisation_id`
      AND compliance_case.`revision` = NEW.`case_revision`
  )
)
OR (
  NEW.`secondary_reviewer_uid` <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM `compliance_users` secondary_reviewer
    WHERE secondary_reviewer.`firebase_uid` = NEW.`secondary_reviewer_uid`
      AND secondary_reviewer.`organisation_id` = NEW.`organisation_id`
      AND secondary_reviewer.`status` = 'active'
      AND secondary_reviewer.`role` IN ('admin', 'reviewer')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_DECISION_REQUEST_REVIEWER_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_equipment_records_case_guard`
BEFORE INSERT ON `compliance_equipment_records`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_cases` compliance_case
  WHERE compliance_case.`id` = NEW.`case_id`
    AND compliance_case.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EQUIPMENT_CASE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_calculator_versions_activity_insert_guard`
BEFORE INSERT ON `compliance_calculator_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_activity_versions` activity
  JOIN `compliance_programs` program
    ON program.`id` = activity.`program_id`
  WHERE activity.`id` = NEW.`activity_version_id`
    AND program.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_ACTIVITY_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_calculator_versions_activity_update_guard`
BEFORE UPDATE OF `organisation_id`, `activity_version_id`
ON `compliance_calculator_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_activity_versions` activity
  JOIN `compliance_programs` program
    ON program.`id` = activity.`program_id`
  WHERE activity.`id` = NEW.`activity_version_id`
    AND program.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_ACTIVITY_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_calculator_vectors_parent_guard`
BEFORE INSERT ON `compliance_calculator_test_vectors`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_calculator_versions` calculator
  WHERE calculator.`id` = NEW.`calculator_version_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_VECTOR_PARENT_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_calculation_runs_links_guard`
BEFORE INSERT ON `compliance_calculation_runs`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_cases` compliance_case
  JOIN `compliance_calculator_versions` calculator
    ON calculator.`id` = NEW.`calculator_version_id`
    AND calculator.`organisation_id` = compliance_case.`organisation_id`
    AND calculator.`activity_version_id` = compliance_case.`activity_version_id`
  WHERE compliance_case.`id` = NEW.`case_id`
    AND compliance_case.`organisation_id` = NEW.`organisation_id`
    AND compliance_case.`revision` = NEW.`case_revision`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATION_RUN_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_batches_program_guard`
BEFORE INSERT ON `compliance_submission_batches`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_programs` program
  WHERE program.`id` = NEW.`program_id`
    AND program.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_BATCH_PROGRAM_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_items_links_guard`
BEFORE INSERT ON `compliance_submission_batch_items`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_submission_batches` batch
  JOIN `compliance_cases` compliance_case
    ON compliance_case.`id` = NEW.`case_id`
    AND compliance_case.`organisation_id` = batch.`organisation_id`
    AND compliance_case.`program_id` = batch.`program_id`
    AND compliance_case.`revision` = NEW.`case_revision`
  WHERE batch.`id` = NEW.`batch_id`
    AND batch.`organisation_id` = NEW.`organisation_id`
    AND EXISTS (
      SELECT 1
      FROM `compliance_case_decisions` decision
      WHERE decision.`id` = (
        SELECT latest.`id`
        FROM `compliance_case_decisions` latest
        WHERE latest.`case_id` = compliance_case.`id`
          AND latest.`organisation_id` = compliance_case.`organisation_id`
          AND latest.`case_revision` = NEW.`case_revision`
          AND latest.`decision_type` = 'ready_to_submit'
        ORDER BY latest.`decided_at` DESC, latest.`id` DESC
        LIMIT 1
      )
        AND decision.`outcome` = 'approved'
    )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_ITEM_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_artifacts_batch_guard`
BEFORE INSERT ON `compliance_submission_artifacts`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_submission_batches` batch
  WHERE batch.`id` = NEW.`batch_id`
    AND batch.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_ARTIFACT_BATCH_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_responses_links_guard`
BEFORE INSERT ON `compliance_submission_responses`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `compliance_submission_batches` batch
    WHERE batch.`id` = NEW.`batch_id`
      AND batch.`organisation_id` = NEW.`organisation_id`
  )
  OR (
    NEW.`batch_item_id` <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_submission_batch_items` item
      WHERE item.`id` = NEW.`batch_item_id`
        AND item.`batch_id` = NEW.`batch_id`
        AND item.`organisation_id` = NEW.`organisation_id`
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_RESPONSE_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_links_guard`
BEFORE INSERT ON `compliance_certificate_lots`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `compliance_programs` program
    WHERE program.`id` = NEW.`program_id`
      AND program.`organisation_id` = NEW.`organisation_id`
  )
  OR (
    NEW.`batch_id` <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_submission_batches` batch
      WHERE batch.`id` = NEW.`batch_id`
        AND batch.`organisation_id` = NEW.`organisation_id`
        AND batch.`program_id` = NEW.`program_id`
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_LINK_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_invitations_no_delete`
BEFORE DELETE ON `compliance_invitations`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_INVITATION_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_invitations_original_no_update`
BEFORE UPDATE ON `compliance_invitations`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`email` <> OLD.`email`
  OR NEW.`role` <> OLD.`role`
  OR NEW.`invited_by_uid` <> OLD.`invited_by_uid`
  OR NEW.`expires_at` <> OLD.`expires_at`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_INVITATION_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_invitations_transition_guard`
BEFORE UPDATE OF `status` ON `compliance_invitations`
WHEN NOT (
  OLD.`status` = NEW.`status`
  OR (
    OLD.`status` = 'pending'
    AND NEW.`status` IN ('claimed', 'revoked', 'expired')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_INVITATION_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_invitations_claim_no_update`
BEFORE UPDATE ON `compliance_invitations`
WHEN OLD.`status` = 'claimed' AND (
  NEW.`claimed_by_uid` <> OLD.`claimed_by_uid`
  OR NEW.`claimed_at` <> OLD.`claimed_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_INVITATION_CLAIM_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_users_no_delete`
BEFORE DELETE ON `compliance_users`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_USER_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_users_identity_no_update`
BEFORE UPDATE ON `compliance_users`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`firebase_uid` <> OLD.`firebase_uid`
  OR NEW.`email` <> OLD.`email`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_USER_IDENTITY_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_users_status_transition_guard`
BEFORE UPDATE OF `status` ON `compliance_users`
WHEN NOT (
  OLD.`status` = NEW.`status`
  OR (
    OLD.`status` = 'active'
    AND NEW.`status` IN ('suspended', 'revoked')
  )
  OR (
    OLD.`status` = 'suspended'
    AND NEW.`status` IN ('active', 'revoked')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_USER_STATUS_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_users_final_admin_guard`
BEFORE UPDATE OF `role`, `status` ON `compliance_users`
WHEN OLD.`role` = 'admin'
  AND OLD.`status` = 'active'
  AND (NEW.`role` <> 'admin' OR NEW.`status` <> 'active')
  AND NOT EXISTS (
    SELECT 1
    FROM `compliance_users` other_admin
    WHERE other_admin.`organisation_id` = OLD.`organisation_id`
      AND other_admin.`id` <> OLD.`id`
      AND other_admin.`role` = 'admin'
      AND other_admin.`status` = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_FINAL_ADMIN_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_assignments_original_no_update`
BEFORE UPDATE ON `compliance_case_assignments`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`case_id` <> OLD.`case_id`
  OR NEW.`compliance_user_id` <> OLD.`compliance_user_id`
  OR NEW.`assignment_role` <> OLD.`assignment_role`
  OR NEW.`assigned_by_uid` <> OLD.`assigned_by_uid`
  OR NEW.`assigned_at` <> OLD.`assigned_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_ASSIGNMENT_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_assignments_no_delete`
BEFORE DELETE ON `compliance_case_assignments`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_ASSIGNMENT_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_tasks_original_no_update`
BEFORE UPDATE ON `compliance_case_tasks`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`case_id` <> OLD.`case_id`
  OR NEW.`task_type` <> OLD.`task_type`
  OR NEW.`title` <> OLD.`title`
  OR NEW.`detail` <> OLD.`detail`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TASK_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_tasks_no_delete`
BEFORE DELETE ON `compliance_case_tasks`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TASK_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_findings_original_no_update`
BEFORE UPDATE ON `compliance_case_findings`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`case_id` <> OLD.`case_id`
  OR NEW.`evidence_id` <> OLD.`evidence_id`
  OR NEW.`requirement_id` <> OLD.`requirement_id`
  OR NEW.`finding_code` <> OLD.`finding_code`
  OR NEW.`severity` <> OLD.`severity`
  OR NEW.`description` <> OLD.`description`
  OR NEW.`raised_by_uid` <> OLD.`raised_by_uid`
  OR NEW.`raised_at` <> OLD.`raised_at`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_FINDING_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_findings_no_delete`
BEFORE DELETE ON `compliance_case_findings`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_FINDING_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_participants_no_delete`
BEFORE DELETE ON `compliance_participants`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_PARTICIPANT_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_participants_organisation_no_update`
BEFORE UPDATE OF `organisation_id` ON `compliance_participants`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_PARTICIPANT_ORGANISATION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_participant_abilities_original_no_update`
BEFORE UPDATE ON `compliance_participant_abilities`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`participant_id` <> OLD.`participant_id`
  OR NEW.`program_id` <> OLD.`program_id`
  OR NEW.`activity_version_id` <> OLD.`activity_version_id`
  OR NEW.`ability_code` <> OLD.`ability_code`
  OR NEW.`ability_role` <> OLD.`ability_role`
  OR NEW.`effective_from` <> OLD.`effective_from`
  OR NEW.`effective_to` <> OLD.`effective_to`
  OR NEW.`evidence_snapshot` <> OLD.`evidence_snapshot`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_ABILITY_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_participant_abilities_no_delete`
BEFORE DELETE ON `compliance_participant_abilities`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_ABILITY_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_equipment_records_no_delete`
BEFORE DELETE ON `compliance_equipment_records`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EQUIPMENT_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_equipment_records_original_no_update`
BEFORE UPDATE ON `compliance_equipment_records`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`case_id` <> OLD.`case_id`
  OR NEW.`record_type` <> OLD.`record_type`
  OR NEW.`manufacturer` <> OLD.`manufacturer`
  OR NEW.`model` <> OLD.`model`
  OR NEW.`serial_number` <> OLD.`serial_number`
  OR NEW.`product_registry` <> OLD.`product_registry`
  OR NEW.`product_reference` <> OLD.`product_reference`
  OR NEW.`quantity` <> OLD.`quantity`
  OR NEW.`recorded_by_uid` <> OLD.`recorded_by_uid`
  OR NEW.`recorded_at` <> OLD.`recorded_at`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_EQUIPMENT_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_calculator_transition_guard`
BEFORE UPDATE OF `approval_state` ON `compliance_calculator_versions`
WHEN NOT (
  OLD.`approval_state` = NEW.`approval_state`
  OR (
    OLD.`approval_state` = 'draft'
    AND NEW.`approval_state` IN ('testing', 'blocked', 'withdrawn')
  )
  OR (
    OLD.`approval_state` = 'testing'
    AND NEW.`approval_state` IN ('approved', 'blocked', 'withdrawn')
  )
  OR (
    OLD.`approval_state` = 'approved'
    AND NEW.`approval_state` IN ('blocked', 'withdrawn')
  )
  OR (
    OLD.`approval_state` = 'blocked'
    AND NEW.`approval_state` = 'withdrawn'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_calculator_non_draft_content_no_update`
BEFORE UPDATE ON `compliance_calculator_versions`
WHEN OLD.`approval_state` <> 'draft' AND (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`activity_version_id` <> OLD.`activity_version_id`
  OR NEW.`calculator_key` <> OLD.`calculator_key`
  OR NEW.`version` <> OLD.`version`
  OR NEW.`title` <> OLD.`title`
  OR NEW.`output_type` <> OLD.`output_type`
  OR NEW.`specification` <> OLD.`specification`
  OR NEW.`rounding_policy` <> OLD.`rounding_policy`
  OR NEW.`official_source_url` <> OLD.`official_source_url`
  OR NEW.`official_source_version` <> OLD.`official_source_version`
  OR NEW.`official_source_sha256` <> OLD.`official_source_sha256`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_CONTENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_calculator_non_draft_no_delete`
BEFORE DELETE ON `compliance_calculator_versions`
WHEN OLD.`approval_state` <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_calculator_vectors_original_no_update`
BEFORE UPDATE ON `compliance_calculator_test_vectors`
WHEN (
  NEW.`calculator_version_id` <> OLD.`calculator_version_id`
  OR NEW.`vector_key` <> OLD.`vector_key`
  OR NEW.`input_snapshot` <> OLD.`input_snapshot`
  OR NEW.`expected_output` <> OLD.`expected_output`
  OR NEW.`tolerance_snapshot` <> OLD.`tolerance_snapshot`
  OR NEW.`source_citation` <> OLD.`source_citation`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_VECTOR_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_calculator_vectors_published_no_delete`
BEFORE DELETE ON `compliance_calculator_test_vectors`
WHEN EXISTS (
  SELECT 1 FROM `compliance_calculator_versions` calculator
  WHERE calculator.`id` = OLD.`calculator_version_id`
    AND calculator.`approval_state` <> 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_VECTOR_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_batches_no_delete`
BEFORE DELETE ON `compliance_submission_batches`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_BATCH_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_batches_original_no_update`
BEFORE UPDATE ON `compliance_submission_batches`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`program_id` <> OLD.`program_id`
  OR NEW.`batch_number` <> OLD.`batch_number`
  OR NEW.`format` <> OLD.`format`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_BATCH_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_items_original_no_update`
BEFORE UPDATE ON `compliance_submission_batch_items`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`batch_id` <> OLD.`batch_id`
  OR NEW.`case_id` <> OLD.`case_id`
  OR NEW.`case_revision` <> OLD.`case_revision`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_ITEM_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_submission_items_no_delete`
BEFORE DELETE ON `compliance_submission_batch_items`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SUBMISSION_ITEM_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_no_delete`
BEFORE DELETE ON `compliance_certificate_lots`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_original_no_update`
BEFORE UPDATE ON `compliance_certificate_lots`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`program_id` <> OLD.`program_id`
  OR NEW.`batch_id` <> OLD.`batch_id`
  OR NEW.`certificate_type` <> OLD.`certificate_type`
  OR NEW.`quantity` <> OLD.`quantity`
  OR NEW.`vintage_from` <> OLD.`vintage_from`
  OR NEW.`vintage_to` <> OLD.`vintage_to`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_registry_reference_guard`
BEFORE UPDATE OF `registry_lot_reference` ON `compliance_certificate_lots`
WHEN (
  NEW.`registry_lot_reference` <> OLD.`registry_lot_reference`
  AND (
    OLD.`registry_lot_reference` <> ''
    OR trim(NEW.`registry_lot_reference`) = ''
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_REFERENCE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_transition_guard`
BEFORE UPDATE OF `status` ON `compliance_certificate_lots`
WHEN NOT (
  OLD.`status` = NEW.`status`
  OR (
    OLD.`status` = 'pending'
    AND NEW.`status` IN ('created', 'available', 'cancelled')
  )
  OR (
    OLD.`status` = 'created'
    AND NEW.`status` IN ('available', 'cancelled')
  )
  OR (
    OLD.`status` = 'available'
    AND NEW.`status` IN ('reserved', 'traded', 'retired', 'cancelled')
  )
  OR (
    OLD.`status` = 'reserved'
    AND NEW.`status` IN ('available', 'traded', 'cancelled')
  )
  OR (
    OLD.`status` = 'traded'
    AND NEW.`status` = 'retired'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_certificate_lots_active_trade_guard`
BEFORE UPDATE OF `status` ON `compliance_certificate_lots`
WHEN NEW.`status` IN ('retired', 'cancelled') AND EXISTS (
  SELECT 1
  FROM `compliance_trades` trade
  WHERE trade.`certificate_lot_id` = OLD.`id`
    AND trade.`organisation_id` = OLD.`organisation_id`
    AND trade.`status` IN ('pending', 'confirmed', 'settled')
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CERTIFICATE_LOT_HAS_ACTIVE_TRADES');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_original_no_update`
BEFORE UPDATE ON `compliance_trades`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`certificate_lot_id` <> OLD.`certificate_lot_id`
  OR NEW.`counterparty_reference` <> OLD.`counterparty_reference`
  OR NEW.`quantity` <> OLD.`quantity`
  OR NEW.`unit_price_cents` <> OLD.`unit_price_cents`
  OR NEW.`trade_date` <> OLD.`trade_date`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_no_delete`
BEFORE DELETE ON `compliance_trades`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_external_reference_guard`
BEFORE UPDATE OF `external_reference` ON `compliance_trades`
WHEN (
  NEW.`external_reference` <> OLD.`external_reference`
  AND (
    OLD.`external_reference` <> ''
    OR trim(NEW.`external_reference`) = ''
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_REFERENCE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_transition_guard`
BEFORE UPDATE OF `status` ON `compliance_trades`
WHEN NOT (
  OLD.`status` = NEW.`status`
  OR (
    OLD.`status` = 'pending'
    AND NEW.`status` IN ('confirmed', 'cancelled')
  )
  OR (
    OLD.`status` = 'confirmed'
    AND NEW.`status` IN ('settled', 'cancelled')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_trades_settlement_state_guard`
BEFORE UPDATE OF `status` ON `compliance_trades`
WHEN (
  NEW.`status` = 'settled'
  AND NOT EXISTS (
    SELECT 1
    FROM `compliance_settlements` settlement
    WHERE settlement.`trade_id` = OLD.`id`
      AND settlement.`organisation_id` = OLD.`organisation_id`
      AND settlement.`status` = 'settled'
  )
)
OR (
  NEW.`status` = 'cancelled'
  AND EXISTS (
    SELECT 1
    FROM `compliance_settlements` settlement
    WHERE settlement.`trade_id` = OLD.`id`
      AND settlement.`organisation_id` = OLD.`organisation_id`
      AND settlement.`status` <> 'cancelled'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_TRADE_SETTLEMENT_STATE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_original_no_update`
BEFORE UPDATE ON `compliance_settlements`
WHEN (
  NEW.`organisation_id` <> OLD.`organisation_id`
  OR NEW.`trade_id` <> OLD.`trade_id`
  OR NEW.`gross_cents` <> OLD.`gross_cents`
  OR NEW.`fee_cents` <> OLD.`fee_cents`
  OR NEW.`net_cents` <> OLD.`net_cents`
  OR NEW.`due_date` <> OLD.`due_date`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_ORIGINAL_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_no_delete`
BEFORE DELETE ON `compliance_settlements`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_NO_DELETE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_external_reference_guard`
BEFORE UPDATE OF `external_reference` ON `compliance_settlements`
WHEN (
  NEW.`external_reference` <> OLD.`external_reference`
  AND (
    OLD.`external_reference` <> ''
    OR trim(NEW.`external_reference`) = ''
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_REFERENCE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_insert_state_guard`
BEFORE INSERT ON `compliance_settlements`
WHEN (
  (NEW.`status` = 'settled' AND trim(NEW.`settled_at`) = '')
  OR (NEW.`status` <> 'settled' AND NEW.`settled_at` <> '')
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_STATE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_settlements_transition_guard`
BEFORE UPDATE OF `status`, `settled_at` ON `compliance_settlements`
WHEN (
  NOT (
    OLD.`status` = NEW.`status`
    OR (
      OLD.`status` = 'pending'
      AND NEW.`status` IN ('processing', 'settled', 'failed', 'cancelled')
    )
    OR (
      OLD.`status` = 'processing'
      AND NEW.`status` IN ('settled', 'failed', 'cancelled')
    )
    OR (
      OLD.`status` = 'failed'
      AND NEW.`status` IN ('processing', 'cancelled')
    )
  )
  OR (NEW.`status` = 'settled' AND trim(NEW.`settled_at`) = '')
  OR (NEW.`status` <> 'settled' AND NEW.`settled_at` <> '')
  OR (
    NEW.`status` = 'settled'
    AND NOT EXISTS (
      SELECT 1
      FROM `compliance_trades` trade
      WHERE trade.`id` = NEW.`trade_id`
        AND trade.`organisation_id` = NEW.`organisation_id`
        AND trade.`status` = 'confirmed'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SETTLEMENT_TRANSITION_INVALID');
END;
--> statement-breakpoint
ALTER TABLE `trade_mobile_upload_sessions`
ADD `evidence_envelope` text DEFAULT '{}' NOT NULL
CHECK (json_valid(`evidence_envelope`));
--> statement-breakpoint
ALTER TABLE `trade_mobile_upload_sessions`
ADD `original_sha256` text DEFAULT '' NOT NULL CHECK (
  `original_sha256` = ''
  OR (
    length(`original_sha256`) = 64
    AND lower(`original_sha256`) NOT GLOB '*[^0-9a-f]*'
  )
);
--> statement-breakpoint
ALTER TABLE `trade_crm_job_media`
ADD `evidence_envelope` text DEFAULT '{}' NOT NULL
CHECK (json_valid(`evidence_envelope`));
--> statement-breakpoint
ALTER TABLE `trade_crm_job_media`
ADD `original_sha256` text DEFAULT '' NOT NULL CHECK (
  `original_sha256` = ''
  OR (
    length(`original_sha256`) = 64
    AND lower(`original_sha256`) NOT GLOB '*[^0-9a-f]*'
  )
);
--> statement-breakpoint
INSERT OR IGNORE INTO `compliance_organisations` (
  `id`, `organisation_code`, `legal_name`, `trading_name`, `abn`, `status`,
  `created_by_uid`, `created_at`, `updated_at`
) VALUES (
  'org_creditex_au',
  'CREDITEX-AU',
  'Creditex Pty Ltd',
  'Creditex',
  '76105513040',
  'active',
  'platform:creditex-partnership',
  '2026-08-01T00:00:00.000Z',
  '2026-08-01T00:00:00.000Z'
);
--> statement-breakpoint
INSERT OR IGNORE INTO `compliance_invitations` (
  `id`, `organisation_id`, `email`, `display_name`, `role`, `status`,
  `invited_by_uid`, `expires_at`, `claimed_by_uid`, `claimed_at`,
  `created_at`, `updated_at`
) VALUES (
  'invite_creditex_aea_info',
  'org_creditex_au',
  'info@ausenergyassessments.com',
  'AEA Creditex administrator',
  'admin',
  'pending',
  'platform:creditex-partnership',
  '2026-08-31T00:00:00.000Z',
  '',
  '',
  '2026-08-01T00:00:00.000Z',
  '2026-08-01T00:00:00.000Z'
);
