CREATE TABLE `compliance_legacy_mapping_artifact_payloads` (
  `artifact_id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `legacy_system_key` text NOT NULL CHECK (
    trim(`legacy_system_key`) <> ''
    AND length(`legacy_system_key`) <= 120
  ),
  `mapping_version` text NOT NULL CHECK (
    trim(`mapping_version`) <> ''
    AND length(`mapping_version`) <= 120
  ),
  `contract_format` text DEFAULT
    'creditex-legacy-field-mapping-v1'
    NOT NULL CHECK (
      `contract_format` = 'creditex-legacy-field-mapping-v1'
    ),
  `canonical_mapping_json` text NOT NULL CHECK (
    json_valid(`canonical_mapping_json`)
    AND json_type(`canonical_mapping_json`) = 'object'
    AND length(`canonical_mapping_json`) BETWEEN 2 AND 131072
  ),
  `artifact_sha256` text NOT NULL CHECK (
    length(`artifact_sha256`) = 64
    AND lower(`artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `created_by_uid` text NOT NULL CHECK (trim(`created_by_uid`) <> ''),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
CREATE UNIQUE INDEX `compliance_legacy_mapping_payloads_version_idx`
  ON `compliance_legacy_mapping_artifact_payloads`
  (`organisation_id`, `legacy_system_key`, `mapping_version`);
CREATE INDEX `compliance_legacy_mapping_payloads_org_time_idx`
  ON `compliance_legacy_mapping_artifact_payloads`
  (`organisation_id`, `created_at`, `artifact_id`);

CREATE TABLE `compliance_legacy_mapping_review_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `artifact_id` text NOT NULL,
  `legacy_system_key` text NOT NULL CHECK (
    trim(`legacy_system_key`) <> ''
    AND length(`legacy_system_key`) <= 120
  ),
  `mapping_version` text NOT NULL CHECK (
    trim(`mapping_version`) <> ''
    AND length(`mapping_version`) <= 120
  ),
  `artifact_sha256` text NOT NULL CHECK (
    length(`artifact_sha256`) = 64
    AND lower(`artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `decision` text NOT NULL CHECK (
    `decision` IN ('approved', 'rejected', 'withdrawn')
  ),
  `supersedes_decision_id` text DEFAULT '' NOT NULL,
  `review_note` text NOT NULL CHECK (
    trim(`review_note`) <> ''
    AND length(`review_note`) <= 1000
  ),
  `reviewed_by_uid` text NOT NULL CHECK (trim(`reviewed_by_uid`) <> ''),
  `reviewed_at` text NOT NULL CHECK (datetime(`reviewed_at`) IS NOT NULL),
  CHECK (
    (
      `decision` IN ('approved', 'rejected')
      AND `supersedes_decision_id` = ''
    )
    OR (
      `decision` = 'withdrawn'
      AND trim(`supersedes_decision_id`) <> ''
    )
  )
);
CREATE INDEX `compliance_legacy_mapping_reviews_subject_idx`
  ON `compliance_legacy_mapping_review_decisions`
  (`organisation_id`, `artifact_id`, `reviewed_at`, `id`);
CREATE INDEX `compliance_legacy_mapping_reviews_state_idx`
  ON `compliance_legacy_mapping_review_decisions`
  (`organisation_id`, `decision`, `reviewed_at`, `id`);

CREATE VIEW `compliance_current_legacy_mapping_approvals` AS
SELECT
  artifact.`id` `artifact_id`,
  artifact.`organisation_id`,
  artifact.`legacy_system_key`,
  artifact.`mapping_version`,
  artifact.`artifact_sha256`,
  payload.`contract_format`,
  payload.`canonical_mapping_json`,
  artifact.`requested_by_uid` `created_by_uid`,
  artifact.`created_at`,
  decision.`id` `approval_decision_id`,
  decision.`reviewed_by_uid` `approved_by_uid`,
  decision.`reviewed_at` `approved_at`
FROM `compliance_legacy_mapping_artifacts` artifact
JOIN `compliance_legacy_mapping_artifact_payloads` payload
  ON payload.`artifact_id` = artifact.`id`
  AND payload.`organisation_id` = artifact.`organisation_id`
  AND payload.`legacy_system_key` = artifact.`legacy_system_key`
  AND payload.`mapping_version` = artifact.`mapping_version`
  AND payload.`artifact_sha256` = artifact.`artifact_sha256`
JOIN `compliance_legacy_mapping_review_decisions` decision
  ON decision.`organisation_id` = artifact.`organisation_id`
  AND decision.`artifact_id` = artifact.`id`
  AND decision.`legacy_system_key` = artifact.`legacy_system_key`
  AND decision.`mapping_version` = artifact.`mapping_version`
  AND decision.`artifact_sha256` = artifact.`artifact_sha256`
  AND decision.`decision` = 'approved'
WHERE artifact.`authorization_state` = 'draft'
  AND artifact.`artifact_format` = 'json'
  AND NOT EXISTS (
    SELECT 1
    FROM `compliance_legacy_mapping_review_decisions` newer
    WHERE newer.`organisation_id` = decision.`organisation_id`
      AND newer.`artifact_id` = decision.`artifact_id`
      AND (
        newer.`reviewed_at` > decision.`reviewed_at`
        OR (
          newer.`reviewed_at` = decision.`reviewed_at`
          AND newer.`id` > decision.`id`
        )
      )
  );
