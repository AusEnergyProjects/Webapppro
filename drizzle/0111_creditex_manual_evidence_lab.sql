CREATE TABLE `compliance_manual_evidence_form_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `program_code` text NOT NULL,
  `activity_template_id` text NOT NULL,
  `activity_snapshot` text NOT NULL,
  `version` integer NOT NULL,
  `title` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `form_schema` text NOT NULL,
  `form_schema_sha256` text NOT NULL,
  `record_mode` text DEFAULT 'synthetic_test' NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `created_by_uid` text NOT NULL,
  `updated_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `locked_at` text DEFAULT '' NOT NULL,
  `archived_at` text DEFAULT '' NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `compliance_manual_evidence_form_mode_check`
    CHECK (`record_mode` = 'synthetic_test'),
  CONSTRAINT `compliance_manual_evidence_form_status_check`
    CHECK (`status` IN ('draft', 'test_ready', 'archived')),
  CONSTRAINT `compliance_manual_evidence_form_json_check`
    CHECK (json_valid(`activity_snapshot`) AND json_valid(`form_schema`)),
  CONSTRAINT `compliance_manual_evidence_form_hash_check`
    CHECK (
      length(`form_schema_sha256`) = 64
      AND lower(`form_schema_sha256`) NOT GLOB '*[^0-9a-f]*'
    ),
  CONSTRAINT `compliance_manual_evidence_form_version_check`
    CHECK (`version` >= 1 AND `revision` >= 1),
  CONSTRAINT `compliance_manual_evidence_form_lifecycle_check`
    CHECK (
      (`status` = 'draft' AND `locked_at` = '' AND `archived_at` = '')
      OR
      (`status` = 'test_ready' AND trim(`locked_at`) <> '' AND `archived_at` = '')
      OR
      (`status` = 'archived' AND trim(`archived_at`) <> '')
    )
);

CREATE UNIQUE INDEX `compliance_manual_evidence_form_version_idx`
  ON `compliance_manual_evidence_form_versions`
    (`organisation_id`, `activity_template_id`, `version`);
CREATE INDEX `compliance_manual_evidence_form_status_idx`
  ON `compliance_manual_evidence_form_versions`
    (`organisation_id`, `status`, `updated_at`);

CREATE TABLE `compliance_manual_evidence_test_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `form_version_id` text NOT NULL,
  `program_code` text NOT NULL,
  `activity_template_id` text NOT NULL,
  `activity_snapshot` text NOT NULL,
  `form_schema` text NOT NULL,
  `form_schema_sha256` text NOT NULL,
  `job_number` text NOT NULL,
  `installer_id` text DEFAULT '' NOT NULL,
  `installer_label` text DEFAULT 'Unassigned test installer' NOT NULL,
  `technician_id` text DEFAULT '' NOT NULL,
  `technician_label` text DEFAULT 'Unassigned test technician' NOT NULL,
  `customer_label` text NOT NULL,
  `site_state` text NOT NULL,
  `site_postcode` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `response_snapshot` text DEFAULT '[]' NOT NULL,
  `response_sha256` text NOT NULL,
  `required_count` integer DEFAULT 0 NOT NULL,
  `completed_required_count` integer DEFAULT 0 NOT NULL,
  `issue_count` integer DEFAULT 0 NOT NULL,
  `review_note` text DEFAULT '' NOT NULL,
  `record_mode` text DEFAULT 'synthetic_test' NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `created_by_uid` text NOT NULL,
  `updated_by_uid` text NOT NULL,
  `passed_by_uid` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `passed_at` text DEFAULT '' NOT NULL,
  `archived_at` text DEFAULT '' NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `compliance_manual_evidence_test_job_mode_check`
    CHECK (`record_mode` = 'synthetic_test'),
  CONSTRAINT `compliance_manual_evidence_test_job_status_check`
    CHECK (
      `status` IN (
        'draft',
        'field_testing',
        'ready_for_audit',
        'changes_required',
        'passed',
        'archived'
      )
    ),
  CONSTRAINT `compliance_manual_evidence_test_job_json_check`
    CHECK (
      json_valid(`activity_snapshot`)
      AND json_valid(`form_schema`)
      AND json_valid(`response_snapshot`)
    ),
  CONSTRAINT `compliance_manual_evidence_test_job_hash_check`
    CHECK (
      length(`form_schema_sha256`) = 64
      AND lower(`form_schema_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND length(`response_sha256`) = 64
      AND lower(`response_sha256`) NOT GLOB '*[^0-9a-f]*'
    ),
  CONSTRAINT `compliance_manual_evidence_test_job_count_check`
    CHECK (
      `required_count` >= 0
      AND `completed_required_count` >= 0
      AND `completed_required_count` <= `required_count`
      AND `issue_count` >= 0
      AND `revision` >= 1
    ),
  CONSTRAINT `compliance_manual_evidence_test_job_lifecycle_check`
    CHECK (
      (
        `status` NOT IN ('passed', 'archived')
        AND `passed_at` = ''
        AND `archived_at` = ''
      )
      OR
      (
        `status` = 'passed'
        AND trim(`passed_by_uid`) <> ''
        AND trim(`passed_at`) <> ''
        AND `archived_at` = ''
      )
      OR
      (`status` = 'archived' AND trim(`archived_at`) <> '')
    )
);

CREATE UNIQUE INDEX `compliance_manual_evidence_test_job_number_idx`
  ON `compliance_manual_evidence_test_jobs`
    (`organisation_id`, `job_number`);
CREATE INDEX `compliance_manual_evidence_test_job_status_idx`
  ON `compliance_manual_evidence_test_jobs`
    (`organisation_id`, `status`, `updated_at`);
CREATE INDEX `compliance_manual_evidence_test_job_activity_idx`
  ON `compliance_manual_evidence_test_jobs`
    (`organisation_id`, `activity_template_id`, `updated_at`);

CREATE TABLE `compliance_manual_evidence_test_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `job_id` text NOT NULL,
  `event_type` text NOT NULL,
  `actor_uid` text NOT NULL,
  `summary` text NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_manual_evidence_test_event_json_check`
    CHECK (json_valid(`metadata`))
);

CREATE INDEX `compliance_manual_evidence_test_event_job_idx`
  ON `compliance_manual_evidence_test_events`
    (`organisation_id`, `job_id`, `created_at`, `id`);
