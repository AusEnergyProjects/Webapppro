CREATE TABLE `compliance_organisations` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_code` text NOT NULL,
  `legal_name` text NOT NULL,
  `trading_name` text DEFAULT '' NOT NULL,
  `abn` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL
    CHECK (`status` IN ('active', 'suspended', 'retired')),
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_organisations_code_idx`
ON `compliance_organisations` (`organisation_code`);
--> statement-breakpoint
CREATE INDEX `compliance_organisations_status_name_idx`
ON `compliance_organisations` (`status`, `trading_name`, `legal_name`);
--> statement-breakpoint
CREATE TABLE `compliance_users` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `firebase_uid` text NOT NULL,
  `email` text NOT NULL,
  `display_name` text DEFAULT '' NOT NULL,
  `role` text NOT NULL
    CHECK (`role` IN ('admin', 'case_manager', 'reviewer', 'auditor')),
  `status` text DEFAULT 'active' NOT NULL
    CHECK (`status` IN ('active', 'suspended', 'revoked')),
  `created_by_uid` text NOT NULL,
  `last_login_at` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_users_org_uid_idx`
ON `compliance_users` (`organisation_id`, `firebase_uid`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_users_org_email_idx`
ON `compliance_users` (`organisation_id`, `email` COLLATE NOCASE);
--> statement-breakpoint
CREATE INDEX `compliance_users_uid_status_idx`
ON `compliance_users` (`firebase_uid`, `status`);
--> statement-breakpoint
CREATE INDEX `compliance_users_org_role_status_idx`
ON `compliance_users` (`organisation_id`, `role`, `status`);
--> statement-breakpoint
CREATE TABLE `compliance_programs` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `program_code` text NOT NULL,
  `name` text NOT NULL,
  `scheme_kind` text NOT NULL,
  `jurisdiction` text NOT NULL CHECK (
    `jurisdiction` IN ('AU', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
  ),
  `administering_body` text NOT NULL,
  `official_source_url` text NOT NULL,
  `official_source_title` text NOT NULL,
  `official_source_version` text DEFAULT '' NOT NULL,
  `official_source_sha256` text DEFAULT '' NOT NULL
    CHECK (`official_source_sha256` = '' OR (
      length(`official_source_sha256`) = 64
      AND `official_source_sha256` NOT GLOB '*[^0-9a-fA-F]*'
    )),
  `official_source_checked_at` text NOT NULL,
  `publish_state` text DEFAULT 'draft' NOT NULL
    CHECK (`publish_state` IN ('draft', 'published', 'withdrawn'))
    CHECK (`publish_state` = 'draft' OR length(`official_source_sha256`) = 64),
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
      AND trim(`published_by_uid`) <> '' AND trim(`published_at`) <> ''
      AND `withdrawn_by_uid` = '' AND `withdrawn_at` = '')
    OR (`publish_state` = 'withdrawn'
      AND trim(`published_by_uid`) <> '' AND trim(`published_at`) <> ''
      AND trim(`withdrawn_by_uid`) <> '' AND trim(`withdrawn_at`) <> '')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_programs_org_code_idx`
ON `compliance_programs` (`organisation_id`, `program_code`);
--> statement-breakpoint
CREATE INDEX `compliance_programs_org_state_idx`
ON `compliance_programs` (`organisation_id`, `publish_state`, `name`);
--> statement-breakpoint
CREATE INDEX `compliance_programs_scheme_jurisdiction_idx`
ON `compliance_programs` (`scheme_kind`, `jurisdiction`, `publish_state`);
--> statement-breakpoint
CREATE TABLE `compliance_activity_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL,
  `activity_key` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` > 0),
  `title` text NOT NULL,
  `service_category` text NOT NULL
    CHECK (`service_category` IN (
      'assessment', 'solar', 'battery', 'heating-cooling', 'hot-water',
      'draught-proofing', 'insulation', 'glazing', 'window-coverings',
      'ev-charging', 'electrical', 'plumbing', 'mounting-hardware',
      'controls', 'other'
    )),
  `registry_activity_code` text DEFAULT '' NOT NULL,
  `specification_part` text DEFAULT '' NOT NULL,
  `product_category` text NOT NULL,
  `scenario_code` text DEFAULT '' NOT NULL,
  `scenario` text NOT NULL,
  `jurisdiction` text NOT NULL CHECK (
    `jurisdiction` IN ('AU', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
  ),
  `effective_from` text NOT NULL
    CHECK (date(`effective_from`) = `effective_from`),
  `effective_to` text DEFAULT '' NOT NULL
    CHECK (
      `effective_to` = ''
      OR (
        date(`effective_to`) = `effective_to`
        AND `effective_to` >= `effective_from`
      )
    ),
  `official_source_url` text NOT NULL,
  `official_source_title` text NOT NULL,
  `official_source_version` text DEFAULT '' NOT NULL,
  `official_source_sha256` text DEFAULT '' NOT NULL
    CHECK (`official_source_sha256` = '' OR (
      length(`official_source_sha256`) = 64
      AND `official_source_sha256` NOT GLOB '*[^0-9a-fA-F]*'
    )),
  `official_source_checked_at` text NOT NULL,
  `requirements_snapshot` text DEFAULT '{}' NOT NULL
    CHECK (json_valid(`requirements_snapshot`)),
  `publish_state` text DEFAULT 'draft' NOT NULL
    CHECK (`publish_state` IN ('draft', 'published', 'withdrawn'))
    CHECK (`publish_state` = 'draft' OR length(`official_source_sha256`) = 64),
  `calculation_approval_state` text DEFAULT 'not_assessed' NOT NULL
    CHECK (`calculation_approval_state` IN (
      'not_assessed', 'approved', 'rejected', 'not_applicable'
    )),
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
      AND trim(`published_by_uid`) <> '' AND trim(`published_at`) <> ''
      AND `withdrawn_by_uid` = '' AND `withdrawn_at` = '')
    OR (`publish_state` = 'withdrawn'
      AND trim(`published_by_uid`) <> '' AND trim(`published_at`) <> ''
      AND trim(`withdrawn_by_uid`) <> '' AND trim(`withdrawn_at`) <> '')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_activity_versions_key_version_idx`
ON `compliance_activity_versions` (`program_id`, `activity_key`, `version`);
--> statement-breakpoint
CREATE INDEX `compliance_activity_versions_program_state_idx`
ON `compliance_activity_versions`
  (`program_id`, `publish_state`, `effective_from`, `effective_to`);
--> statement-breakpoint
CREATE INDEX `compliance_activity_versions_installer_idx`
ON `compliance_activity_versions`
  (`service_category`, `jurisdiction`, `publish_state`, `effective_from`);
--> statement-breakpoint
CREATE INDEX `compliance_activity_versions_registry_idx`
ON `compliance_activity_versions`
  (`registry_activity_code`, `specification_part`, `scenario_code`);
--> statement-breakpoint
CREATE TABLE `compliance_cases` (
  `id` text PRIMARY KEY NOT NULL,
  `case_number` text NOT NULL,
  `organisation_id` text NOT NULL,
  `program_id` text NOT NULL,
  `work_order_id` text NOT NULL,
  `installer_uid` text NOT NULL,
  `activity_version_id` text NOT NULL,
  `activity_date` text NOT NULL CHECK (
    length(`activity_date`) = 10
    AND `activity_date` GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(`activity_date`) = `activity_date`
  ),
  `site_jurisdiction` text NOT NULL CHECK (
    `site_jurisdiction` IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
  ),
  `activity_snapshot` text NOT NULL CHECK (json_valid(`activity_snapshot`)),
  `status` text DEFAULT 'draft' NOT NULL
    CHECK (`status` IN (
      'draft', 'ready_for_submission', 'submitted', 'in_review',
      'changes_requested', 'accepted', 'rejected', 'closed'
    )),
  `evidence_status` text DEFAULT 'not_started' NOT NULL
    CHECK (`evidence_status` IN (
      'not_started', 'in_progress', 'complete', 'changes_required', 'verified'
    )),
  `revision` integer DEFAULT 1 NOT NULL CHECK (`revision` > 0),
  `created_by_type` text NOT NULL
    CHECK (`created_by_type` IN ('installer', 'compliance', 'platform')),
  `created_by_uid` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_cases_number_idx`
ON `compliance_cases` (`case_number`);
--> statement-breakpoint
CREATE INDEX `compliance_cases_org_status_idx`
ON `compliance_cases`
  (`organisation_id`, `status`, `evidence_status`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `compliance_cases_work_order_idx`
ON `compliance_cases` (`work_order_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `compliance_cases_installer_idx`
ON `compliance_cases` (`installer_uid`, `status`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `compliance_cases_activity_idx`
ON `compliance_cases` (`activity_version_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `compliance_case_events` (
  `id` text PRIMARY KEY NOT NULL,
  `case_id` text NOT NULL,
  `organisation_id` text NOT NULL,
  `event_type` text NOT NULL,
  `actor_type` text NOT NULL
    CHECK (`actor_type` IN ('installer', 'compliance', 'platform')),
  `actor_uid` text NOT NULL,
  `summary` text NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL CHECK (json_valid(`metadata`)),
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_case_events_case_time_idx`
ON `compliance_case_events` (`case_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `compliance_case_events_org_time_idx`
ON `compliance_case_events` (`organisation_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `compliance_programs_publish_requirements`
BEFORE INSERT ON `compliance_programs`
WHEN NEW.`publish_state` = 'published' AND (
  trim(NEW.`official_source_url`) = ''
  OR trim(NEW.`official_source_title`) = ''
  OR trim(NEW.`official_source_checked_at`) = ''
  OR length(NEW.`official_source_sha256`) <> 64
  OR trim(NEW.`published_by_uid`) = ''
  OR trim(NEW.`published_at`) = ''
)
BEGIN
  SELECT RAISE(ABORT, 'Published compliance programs require source and publisher evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_programs_publish_update_requirements`
BEFORE UPDATE OF `publish_state` ON `compliance_programs`
WHEN NEW.`publish_state` = 'published' AND (
  trim(NEW.`official_source_url`) = ''
  OR trim(NEW.`official_source_title`) = ''
  OR trim(NEW.`official_source_checked_at`) = ''
  OR length(NEW.`official_source_sha256`) <> 64
  OR trim(NEW.`published_by_uid`) = ''
  OR trim(NEW.`published_at`) = ''
)
BEGIN
  SELECT RAISE(ABORT, 'Published compliance programs require source and publisher evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_programs_state_transition_guard`
BEFORE UPDATE OF `publish_state` ON `compliance_programs`
WHEN NOT (
  (OLD.`publish_state` = 'draft' AND NEW.`publish_state` IN ('draft', 'published'))
  OR (OLD.`publish_state` = 'published' AND NEW.`publish_state` IN ('published', 'withdrawn'))
  OR (OLD.`publish_state` = 'withdrawn' AND NEW.`publish_state` = 'withdrawn')
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance program publish state cannot move backwards');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_programs_published_content_no_update`
BEFORE UPDATE OF
  `organisation_id`, `program_code`, `name`, `scheme_kind`, `jurisdiction`,
  `administering_body`, `official_source_url`, `official_source_title`,
  `official_source_version`, `official_source_sha256`,
  `official_source_checked_at`, `published_by_uid`, `published_at`,
  `created_by_uid`, `created_at`
ON `compliance_programs`
WHEN OLD.`publish_state` IN ('published', 'withdrawn')
BEGIN
  SELECT RAISE(ABORT, 'Published compliance programs are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_programs_withdrawn_no_update`
BEFORE UPDATE ON `compliance_programs`
WHEN OLD.`publish_state` = 'withdrawn'
BEGIN
  SELECT RAISE(ABORT, 'Withdrawn compliance programs are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_programs_non_draft_no_delete`
BEFORE DELETE ON `compliance_programs`
WHEN OLD.`publish_state` <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Published or withdrawn compliance programs cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_programs_draft_with_activities_no_delete`
BEFORE DELETE ON `compliance_programs`
WHEN OLD.`publish_state` = 'draft' AND EXISTS (
  SELECT 1
  FROM `compliance_activity_versions` activity
  WHERE activity.`program_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'Draft compliance programs with activity versions cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_activity_versions_publish_requirements`
BEFORE INSERT ON `compliance_activity_versions`
WHEN NEW.`publish_state` = 'published' AND (
  trim(NEW.`official_source_url`) = ''
  OR trim(NEW.`official_source_title`) = ''
  OR trim(NEW.`official_source_checked_at`) = ''
  OR length(NEW.`official_source_sha256`) <> 64
  OR trim(NEW.`effective_from`) = ''
  OR trim(NEW.`published_by_uid`) = ''
  OR trim(NEW.`published_at`) = ''
)
BEGIN
  SELECT RAISE(ABORT, 'Published compliance activities require source, effective date, and publisher evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_activity_versions_publish_update_requirements`
BEFORE UPDATE OF `publish_state` ON `compliance_activity_versions`
WHEN NEW.`publish_state` = 'published' AND (
  trim(NEW.`official_source_url`) = ''
  OR trim(NEW.`official_source_title`) = ''
  OR trim(NEW.`official_source_checked_at`) = ''
  OR length(NEW.`official_source_sha256`) <> 64
  OR trim(NEW.`effective_from`) = ''
  OR trim(NEW.`published_by_uid`) = ''
  OR trim(NEW.`published_at`) = ''
)
BEGIN
  SELECT RAISE(ABORT, 'Published compliance activities require source, effective date, and publisher evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_activity_versions_state_transition_guard`
BEFORE UPDATE OF `publish_state` ON `compliance_activity_versions`
WHEN NOT (
  (OLD.`publish_state` = 'draft' AND NEW.`publish_state` IN ('draft', 'published'))
  OR (OLD.`publish_state` = 'published' AND NEW.`publish_state` IN ('published', 'withdrawn'))
  OR (OLD.`publish_state` = 'withdrawn' AND NEW.`publish_state` = 'withdrawn')
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance activity publish state cannot move backwards');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_activity_versions_published_content_no_update`
BEFORE UPDATE OF
  `program_id`, `activity_key`, `version`, `title`, `service_category`,
  `registry_activity_code`, `specification_part`, `product_category`,
  `scenario_code`, `scenario`, `jurisdiction`, `effective_from`, `effective_to`,
  `official_source_url`, `official_source_title`, `official_source_version`,
  `official_source_sha256`, `official_source_checked_at`,
  `requirements_snapshot`, `calculation_approval_state`,
  `published_by_uid`, `published_at`, `created_by_uid`, `created_at`
ON `compliance_activity_versions`
WHEN OLD.`publish_state` IN ('published', 'withdrawn')
BEGIN
  SELECT RAISE(ABORT, 'Published compliance activity versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_activity_versions_withdrawn_no_update`
BEFORE UPDATE ON `compliance_activity_versions`
WHEN OLD.`publish_state` = 'withdrawn'
BEGIN
  SELECT RAISE(ABORT, 'Withdrawn compliance activity versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_activity_versions_non_draft_no_delete`
BEFORE DELETE ON `compliance_activity_versions`
WHEN OLD.`publish_state` <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Published or withdrawn compliance activity versions cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_activity_versions_program_jurisdiction_insert_guard`
BEFORE INSERT ON `compliance_activity_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_programs` program
  WHERE program.`id` = NEW.`program_id`
    AND (
      program.`jurisdiction` = 'AU'
      OR program.`jurisdiction` = NEW.`jurisdiction`
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance activity jurisdiction must match its program');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_activity_versions_program_jurisdiction_update_guard`
BEFORE UPDATE OF `program_id`, `jurisdiction`
ON `compliance_activity_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_programs` program
  WHERE program.`id` = NEW.`program_id`
    AND (
      program.`jurisdiction` = 'AU'
      OR program.`jurisdiction` = NEW.`jurisdiction`
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance activity jurisdiction must match its program');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_programs_activity_jurisdiction_update_guard`
BEFORE UPDATE OF `jurisdiction` ON `compliance_programs`
WHEN EXISTS (
  SELECT 1
  FROM `compliance_activity_versions` activity
  WHERE activity.`program_id` = OLD.`id`
    AND NEW.`jurisdiction` <> 'AU'
    AND activity.`jurisdiction` <> NEW.`jurisdiction`
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance program jurisdiction conflicts with an activity version');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_cases_work_order_owner_guard`
BEFORE INSERT ON `compliance_cases`
WHEN NOT EXISTS (
  SELECT 1
  FROM `trade_work_orders` work
  WHERE work.`id` = NEW.`work_order_id`
    AND work.`firebase_uid` = NEW.`installer_uid`
    AND substr(work.`scheduled_start`, 1, 10) = NEW.`activity_date`
    AND EXISTS (
      SELECT 1
      FROM `compliance_activity_versions` activity
      WHERE activity.`id` = NEW.`activity_version_id`
        AND activity.`service_category` = work.`service_category`
    )
    AND EXISTS (
      SELECT 1
      FROM `trade_crm_job_details` job_detail
      JOIN `trade_crm_service_sites` service_site
        ON service_site.`id` = job_detail.`service_site_id`
        AND service_site.`firebase_uid` = job_detail.`firebase_uid`
      WHERE job_detail.`work_order_id` = work.`id`
        AND job_detail.`firebase_uid` = work.`firebase_uid`
        AND service_site.`address_state` = NEW.`site_jurisdiction`
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance case work order and installer do not match');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_cases_live_activity_guard`
BEFORE INSERT ON `compliance_cases`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_activity_versions` activity
  JOIN `compliance_programs` program
    ON program.`id` = activity.`program_id`
  JOIN `compliance_organisations` organisation
    ON organisation.`id` = program.`organisation_id`
  WHERE activity.`id` = NEW.`activity_version_id`
    AND activity.`program_id` = NEW.`program_id`
    AND program.`organisation_id` = NEW.`organisation_id`
    AND organisation.`status` = 'active'
    AND program.`publish_state` = 'published'
    AND activity.`publish_state` = 'published'
    AND activity.`jurisdiction` IN (NEW.`site_jurisdiction`, 'AU')
    AND activity.`effective_from` <= NEW.`activity_date`
    AND (
      activity.`effective_to` = ''
      OR activity.`effective_to` >= NEW.`activity_date`
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance case activity is not live for the case date');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_cases_snapshot_guard`
BEFORE INSERT ON `compliance_cases`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_activity_versions` activity
  JOIN `compliance_programs` program
    ON program.`id` = activity.`program_id`
  JOIN `compliance_organisations` organisation
    ON organisation.`id` = program.`organisation_id`
  WHERE activity.`id` = NEW.`activity_version_id`
    AND json_extract(NEW.`activity_snapshot`, '$.activityVersionId') = activity.`id`
    AND json_extract(NEW.`activity_snapshot`, '$.programId') = program.`id`
    AND json_extract(NEW.`activity_snapshot`, '$.organisationId') = organisation.`id`
    AND json_extract(NEW.`activity_snapshot`, '$.activityDate') = NEW.`activity_date`
    AND json_extract(NEW.`activity_snapshot`, '$.siteJurisdiction') = NEW.`site_jurisdiction`
    AND json_extract(NEW.`activity_snapshot`, '$.organisationCode') = organisation.`organisation_code`
    AND json_extract(NEW.`activity_snapshot`, '$.organisationLegalName') = organisation.`legal_name`
    AND json_extract(NEW.`activity_snapshot`, '$.organisationTradingName') = organisation.`trading_name`
    AND json_extract(NEW.`activity_snapshot`, '$.programCode') = program.`program_code`
    AND json_extract(NEW.`activity_snapshot`, '$.programName') = program.`name`
    AND json_extract(NEW.`activity_snapshot`, '$.schemeKind') = program.`scheme_kind`
    AND json_extract(NEW.`activity_snapshot`, '$.programJurisdiction') = program.`jurisdiction`
    AND json_extract(NEW.`activity_snapshot`, '$.administeringBody') = program.`administering_body`
    AND json_extract(NEW.`activity_snapshot`, '$.activityKey') = activity.`activity_key`
    AND CAST(json_extract(NEW.`activity_snapshot`, '$.version') AS INTEGER) = activity.`version`
    AND json_extract(NEW.`activity_snapshot`, '$.title') = activity.`title`
    AND json_extract(NEW.`activity_snapshot`, '$.serviceCategory') = activity.`service_category`
    AND json_extract(NEW.`activity_snapshot`, '$.registryActivityCode') = activity.`registry_activity_code`
    AND json_extract(NEW.`activity_snapshot`, '$.specificationPart') = activity.`specification_part`
    AND json_extract(NEW.`activity_snapshot`, '$.productCategory') = activity.`product_category`
    AND json_extract(NEW.`activity_snapshot`, '$.scenarioCode') = activity.`scenario_code`
    AND json_extract(NEW.`activity_snapshot`, '$.scenario') = activity.`scenario`
    AND json_extract(NEW.`activity_snapshot`, '$.jurisdiction') = activity.`jurisdiction`
    AND json_extract(NEW.`activity_snapshot`, '$.effectiveFrom') = activity.`effective_from`
    AND json_extract(NEW.`activity_snapshot`, '$.effectiveTo') = activity.`effective_to`
    AND json_extract(NEW.`activity_snapshot`, '$.officialSourceUrl') = activity.`official_source_url`
    AND json_extract(NEW.`activity_snapshot`, '$.officialSourceTitle') = activity.`official_source_title`
    AND json_extract(NEW.`activity_snapshot`, '$.officialSourceVersion') = activity.`official_source_version`
    AND json_extract(NEW.`activity_snapshot`, '$.officialSourceSha256') = activity.`official_source_sha256`
    AND json_extract(NEW.`activity_snapshot`, '$.officialSourceCheckedAt') = activity.`official_source_checked_at`
    AND json_extract(NEW.`activity_snapshot`, '$.calculationApprovalState') = activity.`calculation_approval_state`
    AND json_extract(NEW.`activity_snapshot`, '$.requirementsSnapshotJson') = activity.`requirements_snapshot`
    AND json(json_extract(NEW.`activity_snapshot`, '$.requirementsSnapshot'))
      = json(activity.`requirements_snapshot`)
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance case activity snapshot does not match the governed version');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_cases_linkage_no_update`
BEFORE UPDATE OF
  `case_number`, `organisation_id`, `program_id`, `work_order_id`,
  `installer_uid`, `activity_version_id`, `activity_date`, `site_jurisdiction`,
  `activity_snapshot`,
  `created_by_type`, `created_by_uid`, `created_at`
ON `compliance_cases`
BEGIN
  SELECT RAISE(ABORT, 'Compliance case linkage and activity snapshot are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_cases_no_delete`
BEFORE DELETE ON `compliance_cases`
BEGIN
  SELECT RAISE(ABORT, 'Compliance cases cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_events_case_guard`
BEFORE INSERT ON `compliance_case_events`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_cases` compliance_case
  WHERE compliance_case.`id` = NEW.`case_id`
    AND compliance_case.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance case event organisation does not match the case');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_events_no_update`
BEFORE UPDATE ON `compliance_case_events`
BEGIN
  SELECT RAISE(ABORT, 'Compliance case events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_case_events_no_delete`
BEFORE DELETE ON `compliance_case_events`
BEGIN
  SELECT RAISE(ABORT, 'Compliance case events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_linked_work_order_date_guard`
BEFORE UPDATE OF `scheduled_start` ON `trade_work_orders`
WHEN OLD.`scheduled_start` <> NEW.`scheduled_start` AND EXISTS (
  SELECT 1
  FROM `compliance_cases` compliance_case
  WHERE compliance_case.`work_order_id` = OLD.`id`
    AND compliance_case.`installer_uid` = OLD.`firebase_uid`
    AND compliance_case.`activity_date` <> substr(NEW.`scheduled_start`, 1, 10)
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance-linked job activity date cannot change without case supersession');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_linked_job_service_site_guard`
BEFORE UPDATE OF `service_site_id` ON `trade_crm_job_details`
WHEN OLD.`service_site_id` <> NEW.`service_site_id` AND EXISTS (
  SELECT 1
  FROM `compliance_cases` compliance_case
  WHERE compliance_case.`work_order_id` = OLD.`work_order_id`
    AND compliance_case.`installer_uid` = OLD.`firebase_uid`
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance-linked job service site cannot change without case supersession');
END;
--> statement-breakpoint
CREATE TRIGGER `compliance_linked_service_site_jurisdiction_guard`
BEFORE UPDATE OF `address_state` ON `trade_crm_service_sites`
WHEN OLD.`address_state` <> NEW.`address_state` AND EXISTS (
  SELECT 1
  FROM `trade_crm_job_details` job_detail
  JOIN `compliance_cases` compliance_case
    ON compliance_case.`work_order_id` = job_detail.`work_order_id`
    AND compliance_case.`installer_uid` = job_detail.`firebase_uid`
  WHERE job_detail.`service_site_id` = OLD.`id`
    AND job_detail.`firebase_uid` = OLD.`firebase_uid`
)
BEGIN
  SELECT RAISE(ABORT, 'Compliance-linked service site jurisdiction cannot change without case supersession');
END;
