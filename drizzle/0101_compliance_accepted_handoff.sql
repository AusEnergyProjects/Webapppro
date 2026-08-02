ALTER TABLE `compliance_cases`
  ADD COLUMN `commercial_handoff_id` text DEFAULT '' NOT NULL;
ALTER TABLE `compliance_cases`
  ADD COLUMN `accepted_quote_version_id` text DEFAULT '' NOT NULL;
ALTER TABLE `compliance_cases`
  ADD COLUMN `accepted_scope_sha256` text DEFAULT '' NOT NULL;

CREATE UNIQUE INDEX `compliance_cases_active_work_order_idx`
  ON `compliance_cases` (`work_order_id`)
  WHERE `status` <> 'closed';
CREATE INDEX `compliance_cases_handoff_idx`
  ON `compliance_cases` (`installer_uid`, `commercial_handoff_id`, `created_at`);
