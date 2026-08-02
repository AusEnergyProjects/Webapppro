CREATE TABLE `compliance_official_source_review_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `subject_type` text NOT NULL CHECK (
    `subject_type` IN ('artifact', 'binding')
  ),
  `subject_id` text NOT NULL CHECK (trim(`subject_id`) <> ''),
  `artifact_id` text NOT NULL CHECK (trim(`artifact_id`) <> ''),
  `artifact_sha256` text NOT NULL CHECK (
    length(`artifact_sha256`) = 64
    AND lower(`artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `artifact_object_key` text NOT NULL CHECK (
    trim(`artifact_object_key`) <> ''
  ),
  `binding_target_type` text DEFAULT '' NOT NULL,
  `binding_target_id` text DEFAULT '' NOT NULL,
  `citation_location` text DEFAULT '' NOT NULL,
  `decision` text NOT NULL CHECK (
    `decision` IN ('approved', 'rejected', 'withdrawn')
  ),
  `supersedes_decision_id` text DEFAULT '' NOT NULL,
  `review_note` text NOT NULL CHECK (
    trim(`review_note`) <> '' AND length(`review_note`) <= 1000
  ),
  `reviewed_by_uid` text NOT NULL CHECK (trim(`reviewed_by_uid`) <> ''),
  `reviewed_at` text NOT NULL CHECK (datetime(`reviewed_at`) IS NOT NULL),
  CHECK (
    (
      `subject_type` = 'artifact'
      AND `subject_id` = `artifact_id`
      AND `binding_target_type` = ''
      AND `binding_target_id` = ''
      AND `citation_location` = ''
    )
    OR
    (
      `subject_type` = 'binding'
      AND `binding_target_type` IN (
        'program',
        'activity',
        'evidence_policy',
        'calculator'
      )
      AND trim(`binding_target_id`) <> ''
      AND trim(`citation_location`) <> ''
    )
  ),
  CHECK (
    (`decision` IN ('approved', 'rejected') AND `supersedes_decision_id` = '')
    OR
    (`decision` = 'withdrawn' AND trim(`supersedes_decision_id`) <> '')
  )
);
CREATE UNIQUE INDEX `compliance_source_review_initial_idx`
  ON `compliance_official_source_review_decisions` (
    `organisation_id`,
    `subject_type`,
    `subject_id`
  )
  WHERE `supersedes_decision_id` = '';
CREATE UNIQUE INDEX `compliance_source_review_supersedes_idx`
  ON `compliance_official_source_review_decisions`
  (`supersedes_decision_id`)
  WHERE `supersedes_decision_id` <> '';
CREATE INDEX `compliance_source_review_subject_idx`
  ON `compliance_official_source_review_decisions` (
    `organisation_id`,
    `subject_type`,
    `subject_id`,
    `reviewed_at`,
    `id`
  );
CREATE INDEX `compliance_source_review_artifact_idx`
  ON `compliance_official_source_review_decisions` (
    `organisation_id`,
    `artifact_id`,
    `artifact_sha256`,
    `reviewed_at`,
    `id`
  );

CREATE TABLE `compliance_operational_lookup_review_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `import_id` text NOT NULL CHECK (trim(`import_id`) <> ''),
  `source_artifact_id` text NOT NULL CHECK (
    trim(`source_artifact_id`) <> ''
  ),
  `source_artifact_sha256` text NOT NULL CHECK (
    length(`source_artifact_sha256`) = 64
    AND lower(`source_artifact_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `records_sha256` text NOT NULL CHECK (
    length(`records_sha256`) = 64
    AND lower(`records_sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `record_count` integer NOT NULL CHECK (
    `record_count` > 0 AND `record_count` <= 1000
  ),
  `decision` text NOT NULL CHECK (
    `decision` IN ('approved', 'rejected', 'withdrawn')
  ),
  `supersedes_decision_id` text DEFAULT '' NOT NULL,
  `review_note` text NOT NULL CHECK (
    trim(`review_note`) <> '' AND length(`review_note`) <= 1000
  ),
  `reviewed_by_uid` text NOT NULL CHECK (trim(`reviewed_by_uid`) <> ''),
  `reviewed_at` text NOT NULL CHECK (datetime(`reviewed_at`) IS NOT NULL),
  CHECK (
    (`decision` IN ('approved', 'rejected') AND `supersedes_decision_id` = '')
    OR
    (`decision` = 'withdrawn' AND trim(`supersedes_decision_id`) <> '')
  )
);
CREATE UNIQUE INDEX `compliance_lookup_review_initial_idx`
  ON `compliance_operational_lookup_review_decisions` (
    `organisation_id`,
    `import_id`
  )
  WHERE `supersedes_decision_id` = '';
CREATE UNIQUE INDEX `compliance_lookup_review_supersedes_idx`
  ON `compliance_operational_lookup_review_decisions`
  (`supersedes_decision_id`)
  WHERE `supersedes_decision_id` <> '';
CREATE INDEX `compliance_lookup_review_import_idx`
  ON `compliance_operational_lookup_review_decisions` (
    `organisation_id`,
    `import_id`,
    `reviewed_at`,
    `id`
  );
