DROP TRIGGER IF EXISTS `compliance_official_source_artifacts_actor_guard`;

CREATE TRIGGER `compliance_official_source_artifacts_actor_guard`
BEFORE INSERT ON `compliance_official_source_artifacts`
WHEN NOT EXISTS (
  SELECT 1
  FROM `compliance_users` member
  WHERE member.`organisation_id` = NEW.`organisation_id`
    AND member.`firebase_uid` = NEW.`captured_by_uid`
    AND member.`role` IN ('admin', 'case_manager')
    AND member.`status` = 'active'
)
AND NOT EXISTS (
  SELECT 1
  FROM `admin_users` administrator
  JOIN `compliance_organisations` organisation
    ON organisation.`id` = NEW.`organisation_id`
    AND organisation.`organisation_code` = 'CREDITEX-AU'
    AND organisation.`status` = 'active'
  WHERE administrator.`firebase_uid` = NEW.`captured_by_uid`
    AND administrator.`role` IN ('owner', 'admin')
    AND administrator.`status` = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_SOURCE_CUSTODY_ACTOR_INVALID');
END;
