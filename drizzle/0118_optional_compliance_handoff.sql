DROP TRIGGER IF EXISTS `compliance_cases_accepted_handoff_guard`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `compliance_cases_installer_actor_guard`
BEFORE INSERT ON `compliance_cases`
WHEN NEW.`created_by_type` = 'installer'
  AND NEW.`created_by_uid` <> NEW.`installer_uid`
BEGIN
  SELECT RAISE(ABORT, 'COMPLIANCE_INSTALLER_ACTOR_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `compliance_cases_accepted_handoff_guard` BEFORE INSERT ON `compliance_cases` WHEN coalesce(json_extract(NEW.`activity_snapshot`, '$.acceptedHandoff.commercialHandoffId'), '') <> NEW.`commercial_handoff_id` OR coalesce(json_extract(NEW.`activity_snapshot`, '$.acceptedHandoff.acceptedQuoteVersionId'), '') <> NEW.`accepted_quote_version_id` OR coalesce(json_extract(NEW.`activity_snapshot`, '$.acceptedHandoff.acceptedScopeSha256'), '') <> NEW.`accepted_scope_sha256` OR NOT ( ( NEW.`commercial_handoff_id` = '' AND NEW.`accepted_quote_version_id` = '' AND NEW.`accepted_scope_sha256` = '' ) OR ( NEW.`commercial_handoff_id` <> '' AND NEW.`accepted_quote_version_id` <> '' AND length(NEW.`accepted_scope_sha256`) = 64 AND NEW.`accepted_scope_sha256` = lower(NEW.`accepted_scope_sha256`) AND NEW.`accepted_scope_sha256` NOT GLOB '*[^0-9a-f]*' AND EXISTS ( SELECT 1 FROM `trade_crm_commercial_handovers` handoff JOIN `trade_crm_quote_acceptances` acceptance ON acceptance.`id` = handoff.`acceptance_id` AND acceptance.`firebase_uid` = handoff.`firebase_uid` AND acceptance.`work_order_id` = handoff.`work_order_id` AND acceptance.`quote_version_id` = handoff.`quote_version_id` WHERE handoff.`id` = NEW.`commercial_handoff_id` AND handoff.`work_order_id` = NEW.`work_order_id` AND handoff.`firebase_uid` = NEW.`installer_uid` AND handoff.`quote_version_id` = NEW.`accepted_quote_version_id` AND handoff.`status` = 'accepted' AND acceptance.`decision` = 'accepted' ) ) ) BEGIN SELECT RAISE(ABORT, 'COMPLIANCE_ACCEPTED_HANDOFF_INVALID'); END;
