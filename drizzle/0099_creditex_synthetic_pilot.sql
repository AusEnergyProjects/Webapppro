CREATE TABLE `compliance_pilot_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `program_code` text NOT NULL,
  `name` text NOT NULL,
  `seed_version` text NOT NULL,
  `record_mode` text DEFAULT 'synthetic_test' NOT NULL CHECK (`record_mode` = 'synthetic_test'),
  `status` text DEFAULT 'provisioning' NOT NULL CHECK (`status` IN ('provisioning', 'active', 'archived')),
  `installer_target` integer DEFAULT 10 NOT NULL CHECK (`installer_target` = 10),
  `technicians_per_installer` integer DEFAULT 3 NOT NULL CHECK (`technicians_per_installer` = 3),
  `jobs_per_technician` integer DEFAULT 10 NOT NULL CHECK (`jobs_per_technician` = 10),
  `activity_catalogue_sha256` text NOT NULL CHECK (length(`activity_catalogue_sha256`) = 64 AND lower(`activity_catalogue_sha256`) NOT GLOB '*[^0-9a-f]*'),
  `source_manifest_sha256` text NOT NULL CHECK (length(`source_manifest_sha256`) = 64 AND lower(`source_manifest_sha256`) NOT GLOB '*[^0-9a-f]*'),
  `rule_import_status` text DEFAULT 'captured_pending_independent_review' NOT NULL CHECK (`rule_import_status` IN ('captured_pending_independent_review', 'independently_verified')),
  `lookup_status` text DEFAULT 'contracts_ready_live_sources_blocked' NOT NULL CHECK (`lookup_status` IN ('contracts_ready_live_sources_blocked', 'verified')),
  `evidence_status` text DEFAULT 'transport_contract_ready_physical_acceptance_blocked' NOT NULL CHECK (`evidence_status` IN ('transport_contract_ready_physical_acceptance_blocked', 'verified')),
  `calculator_status` text DEFAULT 'typed_contract_ready_formula_blocked' NOT NULL CHECK (`calculator_status` IN ('typed_contract_ready_formula_blocked', 'verified')),
  `connector_status` text DEFAULT 'dry_run_only' NOT NULL CHECK (`connector_status` IN ('dry_run_only', 'authorised')),
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `activated_at` text DEFAULT '' NOT NULL,
  `archived_at` text DEFAULT '' NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (
    (`status` = 'provisioning' AND `activated_at` = '' AND `archived_at` = '') OR
    (`status` = 'active' AND trim(`activated_at`) <> '' AND `archived_at` = '') OR
    (`status` = 'archived' AND trim(`archived_at`) <> '')
  )
);
CREATE UNIQUE INDEX `compliance_pilot_runs_org_seed_idx` ON `compliance_pilot_runs` (`organisation_id`, `program_code`, `seed_version`);
CREATE INDEX `compliance_pilot_runs_org_status_idx` ON `compliance_pilot_runs` (`organisation_id`, `status`, `updated_at`);

CREATE TABLE `compliance_pilot_source_instruments` (
  `id` text PRIMARY KEY NOT NULL,
  `pilot_run_id` text NOT NULL,
  `source_key` text NOT NULL,
  `source_kind` text NOT NULL CHECK (`source_kind` IN ('act', 'regulations', 'specification', 'guideline', 'activity_guide', 'registry', 'program_document')),
  `title` text NOT NULL,
  `official_source_url` text NOT NULL CHECK (`official_source_url` LIKE 'https://%'),
  `official_version` text DEFAULT '' NOT NULL,
  `effective_from` text DEFAULT '' NOT NULL,
  `effective_to` text DEFAULT '' NOT NULL,
  `official_source_sha256` text DEFAULT '' NOT NULL CHECK (`official_source_sha256` = '' OR (length(`official_source_sha256`) = 64 AND lower(`official_source_sha256`) NOT GLOB '*[^0-9a-f]*')),
  `hash_status` text NOT NULL CHECK (`hash_status` IN ('research_hashed_bytes_not_retained', 'download_blocked_pending_hash', 'dynamic_registry')),
  `verification_status` text DEFAULT 'pending_independent_review' NOT NULL CHECK (`verification_status` IN ('pending_independent_review', 'independently_verified', 'superseded')),
  `source_priority` integer NOT NULL CHECK (`source_priority` > 0),
  `captured_at` text NOT NULL,
  `verified_by_uid` text DEFAULT '' NOT NULL,
  `verified_at` text DEFAULT '' NOT NULL,
  `verification_note` text DEFAULT '' NOT NULL,
  CHECK (
    (`verification_status` = 'pending_independent_review' AND `verified_by_uid` = '' AND `verified_at` = '') OR
    (`verification_status` = 'independently_verified' AND trim(`verified_by_uid`) <> '' AND trim(`verified_at`) <> '' AND trim(`verification_note`) <> '') OR
    (`verification_status` = 'superseded' AND trim(`verification_note`) <> '')
  )
);
CREATE UNIQUE INDEX `compliance_pilot_source_key_idx` ON `compliance_pilot_source_instruments` (`pilot_run_id`, `source_key`);
CREATE INDEX `compliance_pilot_source_status_idx` ON `compliance_pilot_source_instruments` (`pilot_run_id`, `verification_status`, `source_priority`);

CREATE TABLE `compliance_pilot_control_options` (
  `id` text PRIMARY KEY NOT NULL,
  `pilot_run_id` text NOT NULL,
  `control_type` text NOT NULL CHECK (`control_type` IN ('participant_status', 'accreditation_status', 'licence_status', 'product_status', 'recall_status', 'suspension_status', 'evidence_status', 'review_status', 'activity_status')),
  `option_code` text NOT NULL,
  `label` text NOT NULL,
  `option_order` integer NOT NULL CHECK (`option_order` >= 0),
  `effective_from` text NOT NULL,
  `effective_to` text DEFAULT '' NOT NULL,
  `source_key` text NOT NULL,
  `live_lookup_enabled` integer DEFAULT 0 NOT NULL CHECK (`live_lookup_enabled` IN (0, 1)),
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `compliance_pilot_control_option_idx` ON `compliance_pilot_control_options` (`pilot_run_id`, `control_type`, `option_code`);
CREATE INDEX `compliance_pilot_control_type_idx` ON `compliance_pilot_control_options` (`pilot_run_id`, `control_type`, `option_order`);

CREATE TABLE `compliance_pilot_evidence_contracts` (
  `id` text PRIMARY KEY NOT NULL,
  `pilot_run_id` text NOT NULL,
  `requirement_code` text NOT NULL,
  `title` text NOT NULL,
  `evidence_kind` text NOT NULL CHECK (`evidence_kind` IN ('photo', 'document', 'declaration', 'signature')),
  `capture_timing` text NOT NULL CHECK (`capture_timing` IN ('before', 'during', 'after', 'any')),
  `original_required` integer DEFAULT 1 NOT NULL CHECK (`original_required` IN (0, 1)),
  `metadata_required` integer DEFAULT 1 NOT NULL CHECK (`metadata_required` IN (0, 1)),
  `gps_required` integer DEFAULT 0 NOT NULL CHECK (`gps_required` IN (0, 1)),
  `minimum_count` integer DEFAULT 1 NOT NULL CHECK (`minimum_count` >= 0),
  `maximum_count` integer DEFAULT 1 NOT NULL CHECK (`maximum_count` = 0 OR `maximum_count` >= `minimum_count`),
  `allowed_content_types` text DEFAULT '[]' NOT NULL CHECK (json_valid(`allowed_content_types`)),
  `contract_scope` text DEFAULT 'transport_validation_only' NOT NULL CHECK (`contract_scope` = 'transport_validation_only'),
  `government_requirement_status` text DEFAULT 'not_transcribed' NOT NULL CHECK (`government_requirement_status` IN ('not_transcribed', 'pending_independent_review', 'independently_verified')),
  `source_key` text NOT NULL,
  `option_order` integer NOT NULL CHECK (`option_order` >= 0),
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `compliance_pilot_evidence_contract_idx` ON `compliance_pilot_evidence_contracts` (`pilot_run_id`, `requirement_code`);
CREATE INDEX `compliance_pilot_evidence_order_idx` ON `compliance_pilot_evidence_contracts` (`pilot_run_id`, `option_order`);

CREATE TABLE `compliance_pilot_calculator_contracts` (
  `id` text PRIMARY KEY NOT NULL,
  `pilot_run_id` text NOT NULL,
  `activity_template_id` text NOT NULL,
  `registry_activity_code` text NOT NULL,
  `input_schema` text NOT NULL CHECK (json_valid(`input_schema`)),
  `output_schema` text NOT NULL CHECK (json_valid(`output_schema`)),
  `output_unit` text DEFAULT 'VEEC' NOT NULL CHECK (`output_unit` = 'VEEC'),
  `formula_status` text DEFAULT 'blocked_pending_independent_verification' NOT NULL CHECK (`formula_status` IN ('blocked_pending_independent_verification', 'verified')),
  `test_vector_status` text DEFAULT 'not_available' NOT NULL CHECK (`test_vector_status` IN ('not_available', 'pending_reconciliation', 'reconciled')),
  `source_key` text NOT NULL,
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `compliance_pilot_calculator_activity_idx` ON `compliance_pilot_calculator_contracts` (`pilot_run_id`, `activity_template_id`);
CREATE INDEX `compliance_pilot_calculator_status_idx` ON `compliance_pilot_calculator_contracts` (`pilot_run_id`, `formula_status`, `test_vector_status`);

CREATE TABLE `compliance_pilot_installers` (
  `id` text PRIMARY KEY NOT NULL,
  `pilot_run_id` text NOT NULL,
  `installer_slot` integer NOT NULL CHECK (`installer_slot` BETWEEN 1 AND 10),
  `trade_account_uid` text NOT NULL,
  `company_code` text NOT NULL,
  `business_name` text NOT NULL,
  `status` text DEFAULT 'test_active' NOT NULL CHECK (`status` IN ('test_active', 'archived')),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `compliance_pilot_installer_slot_idx` ON `compliance_pilot_installers` (`pilot_run_id`, `installer_slot`);
CREATE UNIQUE INDEX `compliance_pilot_installer_account_idx` ON `compliance_pilot_installers` (`pilot_run_id`, `trade_account_uid`);

CREATE TABLE `compliance_pilot_technicians` (
  `id` text PRIMARY KEY NOT NULL,
  `pilot_run_id` text NOT NULL,
  `installer_id` text NOT NULL,
  `technician_slot` integer NOT NULL CHECK (`technician_slot` BETWEEN 1 AND 3),
  `team_member_id` text NOT NULL,
  `technician_code` text NOT NULL,
  `display_name` text NOT NULL,
  `status` text DEFAULT 'test_active' NOT NULL CHECK (`status` IN ('test_active', 'archived')),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `compliance_pilot_technician_slot_idx` ON `compliance_pilot_technicians` (`pilot_run_id`, `installer_id`, `technician_slot`);
CREATE UNIQUE INDEX `compliance_pilot_technician_member_idx` ON `compliance_pilot_technicians` (`pilot_run_id`, `team_member_id`);

CREATE TABLE `compliance_pilot_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `pilot_run_id` text NOT NULL,
  `installer_id` text NOT NULL,
  `technician_id` text NOT NULL,
  `work_order_id` text NOT NULL,
  `case_number` text NOT NULL,
  `job_number` text NOT NULL,
  `activity_template_id` text NOT NULL,
  `activity_key` text NOT NULL,
  `registry_activity_code` text NOT NULL,
  `specification_part` text DEFAULT '' NOT NULL,
  `title` text NOT NULL,
  `service_category` text NOT NULL,
  `product_category` text DEFAULT '' NOT NULL,
  `scenario_code` text DEFAULT '' NOT NULL,
  `scenario` text DEFAULT '' NOT NULL,
  `catalogue_state` text NOT NULL,
  `activity_date` text NOT NULL,
  `record_mode` text DEFAULT 'synthetic_test' NOT NULL CHECK (`record_mode` = 'synthetic_test'),
  `rule_status` text DEFAULT 'blocked_pending_independent_review' NOT NULL CHECK (`rule_status` IN ('blocked_pending_independent_review', 'verified')),
  `lookup_status` text DEFAULT 'not_checked' NOT NULL CHECK (`lookup_status` IN ('not_checked', 'blocked', 'verified')),
  `evidence_status` text DEFAULT 'not_started' NOT NULL CHECK (`evidence_status` IN ('not_started', 'in_progress', 'transport_complete', 'changes_required')),
  `calculator_status` text DEFAULT 'blocked_unverified_formula' NOT NULL CHECK (`calculator_status` IN ('blocked_unverified_formula', 'verified')),
  `connector_status` text DEFAULT 'not_staged' NOT NULL CHECK (`connector_status` IN ('not_staged', 'dry_run_staged', 'dry_run_reconciled')),
  `review_status` text DEFAULT 'test_ready' NOT NULL CHECK (`review_status` IN ('test_ready', 'in_review', 'changes_required', 'test_complete', 'archived')),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `compliance_pilot_jobs_case_idx` ON `compliance_pilot_jobs` (`pilot_run_id`, `case_number`);
CREATE UNIQUE INDEX `compliance_pilot_jobs_number_idx` ON `compliance_pilot_jobs` (`pilot_run_id`, `job_number`);
CREATE UNIQUE INDEX `compliance_pilot_jobs_work_order_idx` ON `compliance_pilot_jobs` (`work_order_id`);
CREATE INDEX `compliance_pilot_jobs_run_activity_idx` ON `compliance_pilot_jobs` (`pilot_run_id`, `activity_template_id`, `review_status`);
CREATE INDEX `compliance_pilot_jobs_run_installer_idx` ON `compliance_pilot_jobs` (`pilot_run_id`, `installer_id`, `technician_id`, `job_number`);

CREATE TABLE `compliance_pilot_connector_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `pilot_run_id` text NOT NULL,
  `connector_code` text NOT NULL,
  `mapping_version` text NOT NULL,
  `mode` text DEFAULT 'dry_run' NOT NULL CHECK (`mode` = 'dry_run'),
  `status` text NOT NULL CHECK (`status` IN ('prepared', 'validated', 'reconciled', 'failed')),
  `item_count` integer DEFAULT 0 NOT NULL CHECK (`item_count` >= 0),
  `accepted_count` integer DEFAULT 0 NOT NULL CHECK (`accepted_count` >= 0),
  `rejected_count` integer DEFAULT 0 NOT NULL CHECK (`rejected_count` >= 0),
  `unmatched_count` integer DEFAULT 0 NOT NULL CHECK (`unmatched_count` >= 0),
  `duplicate_count` integer DEFAULT 0 NOT NULL CHECK (`duplicate_count` >= 0),
  `artifact_sha256` text NOT NULL CHECK (length(`artifact_sha256`) = 64 AND lower(`artifact_sha256`) NOT GLOB '*[^0-9a-f]*'),
  `artifact_manifest` text NOT NULL CHECK (json_valid(`artifact_manifest`)),
  `external_submission_enabled` integer DEFAULT 0 NOT NULL CHECK (`external_submission_enabled` = 0),
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `compliance_pilot_connector_run_idx` ON `compliance_pilot_connector_runs` (`pilot_run_id`, `connector_code`, `mapping_version`);
CREATE INDEX `compliance_pilot_connector_status_idx` ON `compliance_pilot_connector_runs` (`pilot_run_id`, `status`, `updated_at`);

CREATE TABLE `compliance_pilot_events` (
  `id` text PRIMARY KEY NOT NULL,
  `pilot_run_id` text NOT NULL,
  `organisation_id` text NOT NULL,
  `event_type` text NOT NULL,
  `actor_uid` text NOT NULL,
  `summary` text NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL CHECK (json_valid(`metadata`)),
  `created_at` text NOT NULL
);
CREATE INDEX `compliance_pilot_events_run_time_idx` ON `compliance_pilot_events` (`pilot_run_id`, `created_at`, `id`);
CREATE INDEX `compliance_pilot_events_org_time_idx` ON `compliance_pilot_events` (`organisation_id`, `created_at`, `id`);
