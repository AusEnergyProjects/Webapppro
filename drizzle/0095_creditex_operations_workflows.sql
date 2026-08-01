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
