ALTER TABLE `trade_work_order_compliance_intents`
  ADD COLUMN `intent_key` text DEFAULT 'primary' NOT NULL;

DROP TRIGGER IF EXISTS `trade_compliance_intent_update_guard`;

UPDATE `trade_work_order_compliance_intents`
SET `intent_key` =
  'program:' || `program_template_id`
  || ':activity:' || `activity_template_id`;

DROP INDEX `trade_compliance_intent_work_revision_idx`;
DROP INDEX `trade_compliance_intent_active_work_idx`;

CREATE UNIQUE INDEX `trade_compliance_intent_work_key_revision_idx`
  ON `trade_work_order_compliance_intents`
    (`work_order_id`, `intent_key`, `revision`);

CREATE UNIQUE INDEX `trade_compliance_intent_active_work_key_idx`
  ON `trade_work_order_compliance_intents`
    (`work_order_id`, `intent_key`)
  WHERE `status` = 'planned';

CREATE TRIGGER `trade_compliance_intent_update_guard`
BEFORE UPDATE ON `trade_work_order_compliance_intents`
FOR EACH ROW
WHEN
  NEW.`id` <> OLD.`id`
  OR NEW.`work_order_id` <> OLD.`work_order_id`
  OR NEW.`intent_key` <> OLD.`intent_key`
  OR NEW.`installer_uid` <> OLD.`installer_uid`
  OR NEW.`compliance_organisation_id` <> OLD.`compliance_organisation_id`
  OR NEW.`program_template_id` <> OLD.`program_template_id`
  OR NEW.`activity_template_id` <> OLD.`activity_template_id`
  OR NEW.`program_code` <> OLD.`program_code`
  OR NEW.`registry_activity_code` <> OLD.`registry_activity_code`
  OR NEW.`service_category` <> OLD.`service_category`
  OR NEW.`site_jurisdiction` <> OLD.`site_jurisdiction`
  OR NEW.`planned_start` <> OLD.`planned_start`
  OR NEW.`catalogue_reviewed_on` <> OLD.`catalogue_reviewed_on`
  OR NEW.`intent_snapshot` <> OLD.`intent_snapshot`
  OR NEW.`intent_snapshot_sha256` <> OLD.`intent_snapshot_sha256`
  OR NEW.`revision` <> OLD.`revision`
  OR NEW.`created_by_uid` <> OLD.`created_by_uid`
  OR NEW.`created_at` <> OLD.`created_at`
  OR NEW.`status` NOT IN ('case_linked', 'superseded')
  OR OLD.`status` <> 'planned'
  OR (
    NEW.`status` = 'case_linked'
    AND trim(NEW.`compliance_case_id`) = ''
  )
  OR (
    NEW.`status` = 'superseded'
    AND NEW.`compliance_case_id` <> ''
  )
BEGIN
  SELECT RAISE(ABORT, 'TRADE_COMPLIANCE_INTENT_IMMUTABLE');
END;

ALTER TABLE `compliance_cases`
  ADD COLUMN `compliance_intent_id` text DEFAULT '' NOT NULL;

UPDATE `compliance_cases`
SET `compliance_intent_id` = COALESCE((
  SELECT intent.`id`
  FROM `trade_work_order_compliance_intents` intent
  WHERE intent.`compliance_case_id` = `compliance_cases`.`id`
    AND intent.`work_order_id` = `compliance_cases`.`work_order_id`
    AND intent.`installer_uid` = `compliance_cases`.`installer_uid`
    AND intent.`compliance_organisation_id` =
      `compliance_cases`.`organisation_id`
  LIMIT 1
), '');

DROP INDEX `compliance_cases_active_work_order_idx`;

CREATE UNIQUE INDEX `compliance_cases_active_intent_idx`
  ON `compliance_cases` (`work_order_id`, `compliance_intent_id`)
  WHERE `status` <> 'closed';

DROP TRIGGER IF EXISTS `compliance_cases_work_order_owner_guard`;
CREATE TRIGGER `compliance_cases_work_order_owner_guard`
BEFORE INSERT ON `compliance_cases`
WHEN NOT EXISTS (
  SELECT 1
  FROM `trade_work_orders` work
  JOIN `trade_crm_job_details` job_detail
    ON job_detail.`work_order_id` = work.`id`
    AND job_detail.`firebase_uid` = work.`firebase_uid`
  JOIN `trade_crm_service_sites` service_site
    ON service_site.`id` = job_detail.`service_site_id`
    AND service_site.`firebase_uid` = job_detail.`firebase_uid`
  JOIN `compliance_activity_versions` activity
    ON activity.`id` = NEW.`activity_version_id`
  WHERE work.`id` = NEW.`work_order_id`
    AND work.`firebase_uid` = NEW.`installer_uid`
    AND substr(work.`scheduled_start`, 1, 10) = NEW.`activity_date`
    AND service_site.`address_state` = NEW.`site_jurisdiction`
    AND (
      (
        NEW.`compliance_intent_id` = ''
        AND activity.`service_category` = work.`service_category`
        AND NOT EXISTS (
          SELECT 1
          FROM `trade_work_order_compliance_intents` governed_intent
          WHERE governed_intent.`work_order_id` = work.`id`
            AND governed_intent.`installer_uid` = work.`firebase_uid`
            AND governed_intent.`compliance_organisation_id` =
              NEW.`organisation_id`
            AND governed_intent.`status` IN ('planned', 'case_linked')
        )
      )
      OR EXISTS (
        SELECT 1
        FROM `trade_work_order_compliance_intents` intent
        JOIN `compliance_programs` program
          ON program.`id` = activity.`program_id`
        WHERE intent.`id` = NEW.`compliance_intent_id`
          AND intent.`work_order_id` = work.`id`
          AND intent.`installer_uid` = work.`firebase_uid`
          AND intent.`compliance_organisation_id` = NEW.`organisation_id`
          AND intent.`status` = 'planned'
          AND intent.`service_category` = activity.`service_category`
          AND intent.`program_code` = program.`program_code`
          AND substr(intent.`planned_start`, 1, 10) = NEW.`activity_date`
          AND intent.`site_jurisdiction` = NEW.`site_jurisdiction`
          AND (
            intent.`registry_activity_code` = ''
            OR intent.`registry_activity_code` =
              activity.`registry_activity_code`
          )
          AND (
            COALESCE(
              json_extract(
                intent.`intent_snapshot`,
                '$.activity.activityKey'
              ),
              ''
            ) = ''
            OR json_extract(
              intent.`intent_snapshot`,
              '$.activity.activityKey'
            ) = activity.`activity_key`
          )
          AND (
            intent.`registry_activity_code` <> ''
            OR COALESCE(
              json_extract(
                intent.`intent_snapshot`,
                '$.activity.activityKey'
              ),
              ''
            ) <> ''
          )
      )
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Compliance case work order, installer and planned activity do not match'
  );
END;

DROP TRIGGER IF EXISTS `compliance_cases_linkage_no_update`;
CREATE TRIGGER `compliance_cases_linkage_no_update`
BEFORE UPDATE OF
  `case_number`,
  `organisation_id`,
  `program_id`,
  `work_order_id`,
  `compliance_intent_id`,
  `installer_uid`,
  `activity_version_id`,
  `activity_date`,
  `site_jurisdiction`,
  `activity_snapshot`,
  `created_by_type`,
  `created_by_uid`,
  `created_at`
ON `compliance_cases`
BEGIN
  SELECT RAISE(
    ABORT,
    'Compliance case linkage and activity snapshot are immutable'
  );
END;
