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
-- Accepted-disclosure triggers are installed and verified by src/lib/tlink-schema-guards.ts.
