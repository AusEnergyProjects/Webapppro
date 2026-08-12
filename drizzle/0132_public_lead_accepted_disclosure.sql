ALTER TABLE `trade_crm_job_details`
  ADD COLUMN `accepted_disclosure_snapshot` text NOT NULL DEFAULT '{}'
  CHECK (
    json_valid(`accepted_disclosure_snapshot`)
    AND json_type(`accepted_disclosure_snapshot`) = 'object'
    AND length(`accepted_disclosure_snapshot`) <= 65536
  );
--> statement-breakpoint
ALTER TABLE `trade_crm_job_details`
  ADD COLUMN `accepted_disclosure_sha256` text NOT NULL DEFAULT ''
  CHECK (
    `accepted_disclosure_sha256` = ''
    OR (
      length(`accepted_disclosure_sha256`) = 64
      AND `accepted_disclosure_sha256` = lower(`accepted_disclosure_sha256`)
      AND `accepted_disclosure_sha256` NOT GLOB '*[^0-9a-f]*'
    )
  );
--> statement-breakpoint
ALTER TABLE `trade_crm_job_details`
  ADD COLUMN `accepted_disclosure_at` text NOT NULL DEFAULT ''
  CHECK (`accepted_disclosure_at` = '' OR datetime(`accepted_disclosure_at`) IS NOT NULL);
--> statement-breakpoint
CREATE TRIGGER `trade_crm_job_details_accepted_disclosure_insert_guard`
BEFORE INSERT ON `trade_crm_job_details`
FOR EACH ROW
WHEN NEW.customer_source = 'public_lead_released'
BEGIN
  SELECT CASE WHEN
    json_extract(NEW.accepted_disclosure_snapshot, '$.contract') <> 'tlink-public-lead-accepted-disclosure-v1'
    OR NEW.accepted_disclosure_sha256 = ''
    OR NEW.accepted_disclosure_at = ''
  THEN RAISE(ABORT, 'accepted public lead disclosure required') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trade_crm_job_details_accepted_disclosure_update_guard`
BEFORE UPDATE OF customer_source, accepted_disclosure_snapshot, accepted_disclosure_sha256, accepted_disclosure_at
  ON `trade_crm_job_details`
FOR EACH ROW
WHEN OLD.customer_source = 'public_lead_released'
  AND (
    NEW.customer_source <> OLD.customer_source
    OR
    NEW.accepted_disclosure_snapshot <> OLD.accepted_disclosure_snapshot
    OR NEW.accepted_disclosure_sha256 <> OLD.accepted_disclosure_sha256
    OR NEW.accepted_disclosure_at <> OLD.accepted_disclosure_at
  )
BEGIN
  SELECT RAISE(ABORT, 'accepted public lead disclosure is immutable');
END;
