ALTER TABLE `compliance_manual_evidence_test_jobs`
  ADD COLUMN `field_tester_uid` text DEFAULT '' NOT NULL;

CREATE INDEX `compliance_manual_evidence_test_job_field_tester_idx`
  ON `compliance_manual_evidence_test_jobs`
    (`organisation_id`, `field_tester_uid`, `status`, `updated_at`);

CREATE TABLE `compliance_manual_field_devices` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `firebase_uid` text NOT NULL,
  `device_id` text NOT NULL,
  `platform` text NOT NULL,
  `device_name` text NOT NULL,
  `app_version` text NOT NULL,
  `is_physical_device` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `registered_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  `revoked_at` text DEFAULT '' NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `compliance_manual_field_device_platform_check`
    CHECK (`platform` IN ('ios', 'android')),
  CONSTRAINT `compliance_manual_field_device_status_check`
    CHECK (`status` IN ('active', 'revoked')),
  CONSTRAINT `compliance_manual_field_device_physical_check`
    CHECK (`is_physical_device` IN (0, 1))
);

CREATE UNIQUE INDEX `compliance_manual_field_device_identity_idx`
  ON `compliance_manual_field_devices`
    (`organisation_id`, `firebase_uid`, `device_id`);
CREATE INDEX `compliance_manual_field_device_status_idx`
  ON `compliance_manual_field_devices`
    (`organisation_id`, `firebase_uid`, `status`, `last_seen_at`);

CREATE TABLE `compliance_manual_field_upload_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `job_id` text NOT NULL,
  `field_code` text NOT NULL,
  `field_tester_uid` text NOT NULL,
  `device_id` text NOT NULL,
  `client_upload_id` text NOT NULL,
  `object_key` text NOT NULL,
  `upload_id` text NOT NULL,
  `file_name` text NOT NULL,
  `content_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `part_size_bytes` integer NOT NULL,
  `evidence_envelope` text NOT NULL,
  `declared_sha256` text NOT NULL,
  `status` text DEFAULT 'initiated' NOT NULL,
  `capture_id` text DEFAULT '' NOT NULL,
  `last_error` text DEFAULT '' NOT NULL,
  `record_mode` text DEFAULT 'synthetic_test' NOT NULL,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL,
  `completed_at` text DEFAULT '' NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `compliance_manual_field_upload_mode_check`
    CHECK (`record_mode` = 'synthetic_test'),
  CONSTRAINT `compliance_manual_field_upload_status_check`
    CHECK (`status` IN (
      'initiated', 'uploading', 'completing', 'completed',
      'rejected', 'expired', 'aborted'
    )),
  CONSTRAINT `compliance_manual_field_upload_json_check`
    CHECK (json_valid(`evidence_envelope`)),
  CONSTRAINT `compliance_manual_field_upload_size_check`
    CHECK (
      `size_bytes` >= 1
      AND `size_bytes` <= 52428800
      AND `part_size_bytes` = 5242880
    ),
  CONSTRAINT `compliance_manual_field_upload_hash_check`
    CHECK (
      length(`declared_sha256`) = 64
      AND lower(`declared_sha256`) NOT GLOB '*[^0-9a-f]*'
    )
);

CREATE UNIQUE INDEX `compliance_manual_field_upload_client_idx`
  ON `compliance_manual_field_upload_sessions`
    (`organisation_id`, `field_tester_uid`, `client_upload_id`);
CREATE UNIQUE INDEX `compliance_manual_field_upload_object_idx`
  ON `compliance_manual_field_upload_sessions` (`object_key`);
CREATE INDEX `compliance_manual_field_upload_job_idx`
  ON `compliance_manual_field_upload_sessions`
    (`organisation_id`, `job_id`, `status`, `updated_at`);
CREATE INDEX `compliance_manual_field_upload_device_idx`
  ON `compliance_manual_field_upload_sessions`
    (`organisation_id`, `field_tester_uid`, `device_id`, `status`);

CREATE TABLE `compliance_manual_field_upload_parts` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `part_number` integer NOT NULL,
  `etag` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `compliance_manual_field_upload_part_check`
    CHECK (`part_number` >= 1 AND `size_bytes` >= 1 AND `size_bytes` <= 5242880)
);

CREATE UNIQUE INDEX `compliance_manual_field_upload_part_idx`
  ON `compliance_manual_field_upload_parts`
    (`session_id`, `part_number`);

CREATE TABLE `compliance_manual_evidence_test_captures` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `job_id` text NOT NULL,
  `field_code` text NOT NULL,
  `field_tester_uid` text NOT NULL,
  `device_id` text NOT NULL,
  `upload_session_id` text NOT NULL,
  `object_key` text NOT NULL,
  `file_name` text NOT NULL,
  `content_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `original_sha256` text NOT NULL,
  `evidence_envelope` text NOT NULL,
  `server_verification` text NOT NULL,
  `metadata_state` text NOT NULL,
  `gps_state` text NOT NULL,
  `capture_time_state` text NOT NULL,
  `physical_device_state` text NOT NULL,
  `status` text DEFAULT 'captured' NOT NULL,
  `record_mode` text DEFAULT 'synthetic_test' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `compliance_manual_evidence_test_capture_mode_check`
    CHECK (`record_mode` = 'synthetic_test'),
  CONSTRAINT `compliance_manual_evidence_test_capture_status_check`
    CHECK (`status` IN ('captured', 'superseded', 'rejected')),
  CONSTRAINT `compliance_manual_evidence_test_capture_json_check`
    CHECK (
      json_valid(`evidence_envelope`)
      AND json_valid(`server_verification`)
    ),
  CONSTRAINT `compliance_manual_evidence_test_capture_hash_check`
    CHECK (
      length(`original_sha256`) = 64
      AND lower(`original_sha256`) NOT GLOB '*[^0-9a-f]*'
    ),
  CONSTRAINT `compliance_manual_evidence_test_capture_state_check`
    CHECK (
      `metadata_state` IN ('verified', 'not_required', 'missing', 'invalid')
      AND `gps_state` IN ('verified', 'not_required', 'missing', 'invalid')
      AND `capture_time_state` IN ('verified', 'not_required', 'missing', 'invalid')
      AND `physical_device_state` IN ('reported_physical', 'reported_emulator')
    )
);

CREATE UNIQUE INDEX `compliance_manual_evidence_test_capture_session_idx`
  ON `compliance_manual_evidence_test_captures` (`upload_session_id`);
CREATE INDEX `compliance_manual_evidence_test_capture_job_idx`
  ON `compliance_manual_evidence_test_captures`
    (`organisation_id`, `job_id`, `field_code`, `status`, `created_at`);

CREATE TABLE `compliance_manual_field_integrity_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `capture_id` text NOT NULL,
  `request_id` text NOT NULL,
  `object_key` text NOT NULL,
  `expected_sha256` text NOT NULL,
  `observed_sha256` text NOT NULL,
  `expected_size_bytes` integer NOT NULL,
  `observed_size_bytes` integer NOT NULL,
  `result` text NOT NULL,
  `verification_scope` text DEFAULT 'r2_object_bytes_and_embedded_metadata' NOT NULL,
  `verified_by_uid` text NOT NULL,
  `verified_at` text NOT NULL,
  CONSTRAINT `compliance_manual_field_integrity_result_check`
    CHECK (`result` IN ('matched', 'mismatch', 'object_missing', 'storage_unavailable')),
  CONSTRAINT `compliance_manual_field_integrity_hash_check`
    CHECK (
      length(`expected_sha256`) = 64
      AND lower(`expected_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND (
        `observed_sha256` = ''
        OR (
          length(`observed_sha256`) = 64
          AND lower(`observed_sha256`) NOT GLOB '*[^0-9a-f]*'
        )
      )
    )
);

CREATE UNIQUE INDEX `compliance_manual_field_integrity_request_idx`
  ON `compliance_manual_field_integrity_receipts`
    (`organisation_id`, `request_id`);
CREATE INDEX `compliance_manual_field_integrity_capture_idx`
  ON `compliance_manual_field_integrity_receipts`
    (`organisation_id`, `capture_id`, `verified_at`);

CREATE TABLE `compliance_manual_field_acceptance_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `job_id` text NOT NULL,
  `tester_uid` text NOT NULL,
  `reviewer_uid` text DEFAULT '' NOT NULL,
  `device_id` text NOT NULL,
  `platform` text NOT NULL,
  `app_version` text NOT NULL,
  `scenario_results` text DEFAULT '[]' NOT NULL,
  `status` text DEFAULT 'not_run' NOT NULL,
  `tester_note` text DEFAULT '' NOT NULL,
  `reviewer_note` text DEFAULT '' NOT NULL,
  `record_mode` text DEFAULT 'synthetic_test' NOT NULL,
  `started_at` text DEFAULT '' NOT NULL,
  `submitted_at` text DEFAULT '' NOT NULL,
  `reviewed_at` text DEFAULT '' NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `compliance_manual_field_acceptance_mode_check`
    CHECK (`record_mode` = 'synthetic_test'),
  CONSTRAINT `compliance_manual_field_acceptance_status_check`
    CHECK (`status` IN ('not_run', 'in_progress', 'submitted', 'passed', 'failed')),
  CONSTRAINT `compliance_manual_field_acceptance_json_check`
    CHECK (json_valid(`scenario_results`)),
  CONSTRAINT `compliance_manual_field_acceptance_platform_check`
    CHECK (`platform` IN ('ios', 'android')),
  CONSTRAINT `compliance_manual_field_acceptance_dual_control_check`
    CHECK (
      `reviewer_uid` = ''
      OR `reviewer_uid` <> `tester_uid`
    )
);

CREATE INDEX `compliance_manual_field_acceptance_job_idx`
  ON `compliance_manual_field_acceptance_runs`
    (`organisation_id`, `job_id`, `status`, `updated_at`);

CREATE TABLE `compliance_manual_field_action_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `field_tester_uid` text NOT NULL,
  `client_action_id` text NOT NULL,
  `action_type` text NOT NULL,
  `job_id` text NOT NULL,
  `form_id` text NOT NULL,
  `base_revision` integer NOT NULL,
  `payload_sha256` text NOT NULL,
  `response_sha256` text NOT NULL,
  `result_revision` integer NOT NULL,
  `status` text DEFAULT 'applied' NOT NULL,
  `record_mode` text DEFAULT 'synthetic_test' NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_manual_field_action_receipt_identity_check`
    CHECK (
      trim(`organisation_id`) <> ''
      AND trim(`field_tester_uid`) <> ''
      AND trim(`client_action_id`) <> ''
      AND trim(`job_id`) <> ''
      AND `form_id` = `job_id` || ':technical'
    ),
  CONSTRAINT `compliance_manual_field_action_receipt_action_check`
    CHECK (`action_type` = 'save_job_form'),
  CONSTRAINT `compliance_manual_field_action_receipt_revision_check`
    CHECK (`base_revision` >= 1 AND `result_revision` = `base_revision` + 1),
  CONSTRAINT `compliance_manual_field_action_receipt_hash_check`
    CHECK (
      length(`payload_sha256`) = 64
      AND lower(`payload_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND length(`response_sha256`) = 64
      AND lower(`response_sha256`) NOT GLOB '*[^0-9a-f]*'
    ),
  CONSTRAINT `compliance_manual_field_action_receipt_status_check`
    CHECK (`status` = 'applied'),
  CONSTRAINT `compliance_manual_field_action_receipt_mode_check`
    CHECK (`record_mode` = 'synthetic_test')
);

CREATE UNIQUE INDEX `compliance_manual_field_action_receipt_client_idx`
  ON `compliance_manual_field_action_receipts`
    (`organisation_id`, `field_tester_uid`, `client_action_id`);
CREATE INDEX `compliance_manual_field_action_receipt_job_idx`
  ON `compliance_manual_field_action_receipts`
    (`organisation_id`, `job_id`, `created_at`, `id`);
