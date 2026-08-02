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
