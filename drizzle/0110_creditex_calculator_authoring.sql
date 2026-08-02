CREATE TABLE `compliance_calculator_authoring_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `client_request_id` text NOT NULL,
  `request_sha256` text NOT NULL,
  `calculator_version_id` text NOT NULL,
  `activity_version_id` text NOT NULL,
  `source_artifact_id` text NOT NULL,
  `activity_source_binding_id` text NOT NULL,
  `calculator_source_binding_id` text NOT NULL,
  `source_artifact_sha256` text NOT NULL,
  `specification_sha256` text NOT NULL,
  `engine_contract_hash` text NOT NULL,
  `authoring_contract_sha256` text NOT NULL,
  `authoring_state` text DEFAULT 'pending_review' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_calculator_authoring_state_check`
    CHECK (`authoring_state` = 'pending_review'),
  CONSTRAINT `compliance_calculator_authoring_hashes_check`
    CHECK (
      length(`request_sha256`) = 64
      AND lower(`request_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND length(`source_artifact_sha256`) = 64
      AND lower(`source_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND length(`specification_sha256`) = 64
      AND lower(`specification_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND `engine_contract_hash` LIKE 'sha256:%'
      AND length(`engine_contract_hash`) = 71
      AND lower(substr(`engine_contract_hash`, 8))
        NOT GLOB '*[^0-9a-f]*'
      AND length(`authoring_contract_sha256`) = 64
      AND lower(`authoring_contract_sha256`) NOT GLOB '*[^0-9a-f]*'
    )
);

CREATE UNIQUE INDEX `compliance_calculator_authoring_org_request_idx`
  ON `compliance_calculator_authoring_receipts`
    (`organisation_id`, `client_request_id`);
CREATE UNIQUE INDEX `compliance_calculator_authoring_version_idx`
  ON `compliance_calculator_authoring_receipts` (`calculator_version_id`);
CREATE INDEX `compliance_calculator_authoring_org_state_idx`
  ON `compliance_calculator_authoring_receipts`
    (`organisation_id`, `authoring_state`, `created_at`);

CREATE TABLE `compliance_calculator_vector_authoring_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `client_request_id` text NOT NULL,
  `request_sha256` text NOT NULL,
  `vector_id` text NOT NULL,
  `calculator_version_id` text NOT NULL,
  `source_artifact_id` text NOT NULL,
  `activity_source_binding_id` text NOT NULL,
  `source_artifact_sha256` text NOT NULL,
  `input_sha256` text NOT NULL,
  `expected_output_sha256` text NOT NULL,
  `source_citation_sha256` text NOT NULL,
  `vector_contract_sha256` text NOT NULL,
  `authoring_state` text DEFAULT 'pending_review' NOT NULL,
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `compliance_calculator_vector_authoring_state_check`
    CHECK (`authoring_state` = 'pending_review'),
  CONSTRAINT `compliance_calculator_vector_authoring_hashes_check`
    CHECK (
      length(`request_sha256`) = 64
      AND lower(`request_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND length(`source_artifact_sha256`) = 64
      AND lower(`source_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND length(`input_sha256`) = 64
      AND lower(`input_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND length(`expected_output_sha256`) = 64
      AND lower(`expected_output_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND length(`source_citation_sha256`) = 64
      AND lower(`source_citation_sha256`) NOT GLOB '*[^0-9a-f]*'
      AND length(`vector_contract_sha256`) = 64
      AND lower(`vector_contract_sha256`) NOT GLOB '*[^0-9a-f]*'
    )
);

CREATE UNIQUE INDEX `compliance_calculator_vector_authoring_org_request_idx`
  ON `compliance_calculator_vector_authoring_receipts`
    (`organisation_id`, `client_request_id`);
CREATE UNIQUE INDEX `compliance_calculator_vector_authoring_vector_idx`
  ON `compliance_calculator_vector_authoring_receipts` (`vector_id`);
CREATE INDEX `compliance_calculator_vector_authoring_parent_idx`
  ON `compliance_calculator_vector_authoring_receipts`
    (`organisation_id`, `calculator_version_id`, `created_at`);

CREATE TRIGGER `compliance_calculator_authoring_receipt_insert_guard`
BEFORE INSERT ON `compliance_calculator_authoring_receipts`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_users` member
    JOIN `compliance_organisations` organisation
      ON organisation.id = member.organisation_id
      AND organisation.status = 'active'
    WHERE member.organisation_id = NEW.organisation_id
      AND member.firebase_uid = NEW.created_by_uid
      AND member.status = 'active'
      AND member.role IN ('admin', 'reviewer')
      AND member.governance_identity_verified = 1
      AND trim(member.governance_identity_verified_by_uid) <> ''
      AND member.governance_identity_verified_by_uid <> member.firebase_uid
      AND trim(member.governance_identity_verified_at) <> ''
      AND trim(member.governance_identity_verification_basis) <> ''
      AND trim(member.display_name) <> ''
      AND instr(member.email, '@') > 1
      AND lower(trim(member.email)) <> 'info@ausenergyassessments.com'
  ) THEN RAISE(ABORT, 'COMPLIANCE_CALCULATOR_NAMED_GOVERNANCE_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_calculator_versions` calculator
    JOIN `compliance_activity_versions` activity
      ON activity.id = calculator.activity_version_id
    JOIN `compliance_programs` program
      ON program.id = activity.program_id
      AND program.organisation_id = calculator.organisation_id
    WHERE calculator.id = NEW.calculator_version_id
      AND calculator.organisation_id = NEW.organisation_id
      AND calculator.activity_version_id = NEW.activity_version_id
      AND calculator.approval_state = 'draft'
      AND calculator.primary_approver_uid = ''
      AND calculator.secondary_approver_uid = ''
      AND calculator.approved_at = ''
      AND calculator.withdrawn_at = ''
      AND activity.publish_state IN ('draft', 'published')
      AND program.publish_state IN ('draft', 'published')
  ) THEN RAISE(ABORT, 'COMPLIANCE_CALCULATOR_DRAFT_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_official_source_artifacts` artifact
    WHERE artifact.id = NEW.source_artifact_id
      AND artifact.organisation_id = NEW.organisation_id
      AND artifact.sha256 = NEW.source_artifact_sha256
      AND artifact.custody_state IN ('draft', 'pending_review')
      AND artifact.rule_activation_enabled = 0
  ) THEN RAISE(ABORT, 'COMPLIANCE_CALCULATOR_SOURCE_ARTIFACT_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_official_source_bindings` binding
    WHERE binding.id = NEW.activity_source_binding_id
      AND binding.organisation_id = NEW.organisation_id
      AND binding.artifact_id = NEW.source_artifact_id
      AND binding.target_type = 'activity'
      AND binding.target_id = NEW.activity_version_id
      AND binding.binding_state IN ('draft', 'pending_review')
      AND binding.rule_activation_enabled = 0
  ) THEN RAISE(ABORT, 'COMPLIANCE_CALCULATOR_ACTIVITY_SOURCE_BINDING_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_official_source_bindings` binding
    WHERE binding.id = NEW.calculator_source_binding_id
      AND binding.organisation_id = NEW.organisation_id
      AND binding.artifact_id = NEW.source_artifact_id
      AND binding.target_type = 'calculator'
      AND binding.target_id = NEW.calculator_version_id
      AND binding.binding_state IN ('draft', 'pending_review')
      AND binding.rule_activation_enabled = 0
  ) THEN RAISE(ABORT, 'COMPLIANCE_CALCULATOR_SOURCE_BINDING_REQUIRED') END;
END;

CREATE TRIGGER `compliance_calculator_authoring_receipt_immutable_update`
BEFORE UPDATE ON `compliance_calculator_authoring_receipts`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_AUTHORING_IMMUTABLE');
END;

CREATE TRIGGER `compliance_calculator_authoring_receipt_immutable_delete`
BEFORE DELETE ON `compliance_calculator_authoring_receipts`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_AUTHORING_IMMUTABLE');
END;

CREATE TRIGGER `compliance_calculator_authored_version_immutable_update`
BEFORE UPDATE ON `compliance_calculator_versions`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `compliance_calculator_authoring_receipts`
  WHERE calculator_version_id = OLD.id
)
AND (
  NEW.id <> OLD.id
  OR NEW.organisation_id <> OLD.organisation_id
  OR NEW.activity_version_id <> OLD.activity_version_id
  OR NEW.calculator_key <> OLD.calculator_key
  OR NEW.version <> OLD.version
  OR NEW.title <> OLD.title
  OR NEW.output_type <> OLD.output_type
  OR NEW.specification <> OLD.specification
  OR NEW.rounding_policy <> OLD.rounding_policy
  OR NEW.official_source_url <> OLD.official_source_url
  OR NEW.official_source_version <> OLD.official_source_version
  OR NEW.official_source_sha256 <> OLD.official_source_sha256
  OR NEW.created_by_uid <> OLD.created_by_uid
  OR NEW.created_at <> OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_AUTHORING_IMMUTABLE');
END;

CREATE TRIGGER `compliance_calculator_authored_version_draft_only`
BEFORE UPDATE ON `compliance_calculator_versions`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `compliance_calculator_authoring_receipts`
  WHERE calculator_version_id = OLD.id
)
AND (
  NEW.approval_state <> 'draft'
  OR NEW.primary_approver_uid <> ''
  OR NEW.secondary_approver_uid <> ''
  OR NEW.approved_at <> ''
  OR NEW.withdrawn_at <> ''
)
BEGIN
  SELECT RAISE(
    ABORT,
    'COMPLIANCE_CALCULATOR_AUTHORING_DRAFT_ONLY'
  );
END;

CREATE TRIGGER `compliance_calculator_authored_version_immutable_delete`
BEFORE DELETE ON `compliance_calculator_versions`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `compliance_calculator_authoring_receipts`
  WHERE calculator_version_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_AUTHORING_IMMUTABLE');
END;

CREATE TRIGGER `compliance_calculator_vector_authoring_receipt_insert_guard`
BEFORE INSERT ON `compliance_calculator_vector_authoring_receipts`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_users` member
    JOIN `compliance_organisations` organisation
      ON organisation.id = member.organisation_id
      AND organisation.status = 'active'
    WHERE member.organisation_id = NEW.organisation_id
      AND member.firebase_uid = NEW.created_by_uid
      AND member.status = 'active'
      AND member.role IN ('admin', 'reviewer')
      AND member.governance_identity_verified = 1
      AND trim(member.governance_identity_verified_by_uid) <> ''
      AND member.governance_identity_verified_by_uid <> member.firebase_uid
      AND trim(member.governance_identity_verified_at) <> ''
      AND trim(member.governance_identity_verification_basis) <> ''
      AND trim(member.display_name) <> ''
      AND instr(member.email, '@') > 1
      AND lower(trim(member.email)) <> 'info@ausenergyassessments.com'
  ) THEN RAISE(ABORT, 'COMPLIANCE_CALCULATOR_NAMED_GOVERNANCE_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `compliance_calculator_test_vectors` vector
    JOIN `compliance_calculator_authoring_receipts` receipt
      ON receipt.calculator_version_id = vector.calculator_version_id
      AND receipt.organisation_id = NEW.organisation_id
      AND receipt.authoring_state = 'pending_review'
      AND receipt.source_artifact_id = NEW.source_artifact_id
      AND receipt.activity_source_binding_id =
        NEW.activity_source_binding_id
      AND receipt.source_artifact_sha256 =
        NEW.source_artifact_sha256
    JOIN `compliance_calculator_versions` calculator
      ON calculator.id = receipt.calculator_version_id
      AND calculator.organisation_id = receipt.organisation_id
      AND calculator.approval_state = 'draft'
    WHERE vector.id = NEW.vector_id
      AND vector.calculator_version_id = NEW.calculator_version_id
      AND vector.created_by_uid = NEW.created_by_uid
      AND vector.created_by_uid <> receipt.created_by_uid
      AND vector.last_result = 'not_run'
      AND vector.last_run_at = ''
  ) THEN RAISE(ABORT, 'COMPLIANCE_CALCULATOR_VECTOR_DRAFT_REQUIRED') END;
END;

CREATE TRIGGER `compliance_calculator_vector_authoring_receipt_immutable_update`
BEFORE UPDATE ON `compliance_calculator_vector_authoring_receipts`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_VECTOR_IMMUTABLE');
END;

CREATE TRIGGER `compliance_calculator_vector_authoring_receipt_immutable_delete`
BEFORE DELETE ON `compliance_calculator_vector_authoring_receipts`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_VECTOR_IMMUTABLE');
END;

CREATE TRIGGER `compliance_calculator_authored_vector_immutable_update`
BEFORE UPDATE ON `compliance_calculator_test_vectors`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `compliance_calculator_vector_authoring_receipts`
  WHERE vector_id = OLD.id
)
AND (
  NEW.id <> OLD.id
  OR NEW.calculator_version_id <> OLD.calculator_version_id
  OR NEW.vector_key <> OLD.vector_key
  OR NEW.input_snapshot <> OLD.input_snapshot
  OR NEW.expected_output <> OLD.expected_output
  OR NEW.tolerance_snapshot <> OLD.tolerance_snapshot
  OR NEW.source_citation <> OLD.source_citation
  OR NEW.created_by_uid <> OLD.created_by_uid
  OR NEW.created_at <> OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_VECTOR_IMMUTABLE');
END;

CREATE TRIGGER `compliance_calculator_authored_vector_not_run_only`
BEFORE UPDATE ON `compliance_calculator_test_vectors`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `compliance_calculator_vector_authoring_receipts`
  WHERE vector_id = OLD.id
)
AND (
  NEW.last_result <> 'not_run'
  OR NEW.last_run_at <> ''
)
BEGIN
  SELECT RAISE(
    ABORT,
    'COMPLIANCE_CALCULATOR_VECTOR_NOT_RUN_ONLY'
  );
END;

CREATE TRIGGER `compliance_calculator_authored_vector_immutable_delete`
BEFORE DELETE ON `compliance_calculator_test_vectors`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `compliance_calculator_vector_authoring_receipts`
  WHERE vector_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATOR_VECTOR_IMMUTABLE');
END;

CREATE TRIGGER `compliance_calculator_authoring_audit`
AFTER INSERT ON `compliance_calculator_authoring_receipts`
FOR EACH ROW
BEGIN
  INSERT INTO `compliance_audit_events` (
    id, organisation_id, actor_type, actor_uid, event_type,
    target_type, target_id, summary, metadata, created_at
  ) VALUES (
    'calculator-authoring-audit:' || NEW.id,
    NEW.organisation_id,
    'compliance',
    NEW.created_by_uid,
    'calculator.draft_authored',
    'calculator_version',
    NEW.calculator_version_id,
    'Immutable calculator draft recorded pending independent review.',
    json_object(
      'activityVersionId', NEW.activity_version_id,
      'sourceArtifactId', NEW.source_artifact_id,
      'sourceArtifactSha256', NEW.source_artifact_sha256,
      'specificationSha256', NEW.specification_sha256,
      'engineContractHash', NEW.engine_contract_hash,
      'authoringContractSha256', NEW.authoring_contract_sha256,
      'authoringState', NEW.authoring_state
    ),
    NEW.created_at
  );
END;

CREATE TRIGGER `compliance_calculator_vector_authoring_audit`
AFTER INSERT ON `compliance_calculator_vector_authoring_receipts`
FOR EACH ROW
BEGIN
  INSERT INTO `compliance_audit_events` (
    id, organisation_id, actor_type, actor_uid, event_type,
    target_type, target_id, summary, metadata, created_at
  ) VALUES (
    'calculator-vector-authoring-audit:' || NEW.id,
    NEW.organisation_id,
    'compliance',
    NEW.created_by_uid,
    'calculator.vector_authored',
    'calculator_test_vector',
    NEW.vector_id,
    'Immutable authoritative calculator vector recorded pending independent review.',
    json_object(
      'calculatorVersionId', NEW.calculator_version_id,
      'sourceArtifactId', NEW.source_artifact_id,
      'activitySourceBindingId', NEW.activity_source_binding_id,
      'sourceArtifactSha256', NEW.source_artifact_sha256,
      'inputSha256', NEW.input_sha256,
      'expectedOutputSha256', NEW.expected_output_sha256,
      'sourceCitationSha256', NEW.source_citation_sha256,
      'vectorContractSha256', NEW.vector_contract_sha256,
      'authoringState', NEW.authoring_state
    ),
    NEW.created_at
  );
END;
