ALTER TABLE `trade_crm_job_media`
  ADD COLUMN `accepted_lead_source_photo_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `trade_crm_job_media`
  ADD COLUMN `accepted_lead_source_opportunity_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `trade_crm_job_media`
  ADD COLUMN `accepted_lead_source_preparation_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `trade_crm_job_media`
  ADD COLUMN `accepted_lead_source_release_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `trade_crm_job_media`
  ADD COLUMN `accepted_lead_prompt_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `trade_crm_job_media`
  ADD COLUMN `accepted_lead_service_categories` text NOT NULL DEFAULT '[]'
  CHECK (
    json_valid(`accepted_lead_service_categories`)
    AND json_type(`accepted_lead_service_categories`) = 'array'
  );
--> statement-breakpoint
ALTER TABLE `trade_crm_job_media`
  ADD COLUMN `accepted_disclosure_sha256` text NOT NULL DEFAULT '' CHECK (
    `accepted_disclosure_sha256` = ''
    OR (
      length(`accepted_disclosure_sha256`) = 64
      AND `accepted_disclosure_sha256` = lower(`accepted_disclosure_sha256`)
      AND `accepted_disclosure_sha256` NOT GLOB '*[^0-9a-f]*'
    )
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_job_media_accepted_source_idx`
  ON `trade_crm_job_media`
    (`firebase_uid`, `work_order_id`, `accepted_lead_source_photo_id`)
  WHERE `source` = 'accepted_public_lead';
--> statement-breakpoint
CREATE INDEX `trade_crm_job_media_accepted_job_idx`
  ON `trade_crm_job_media`
    (`firebase_uid`, `work_order_id`, `source`, `created_at`, `id`);
--> statement-breakpoint
-- Accepted job-file triggers are installed and verified by src/lib/tlink-schema-guards.ts.
CREATE TABLE `trade_crm_job_media_cleanup` (
  `object_key` text PRIMARY KEY NOT NULL CHECK (
    length(`object_key`) BETWEEN 1 AND 512
    AND `object_key` NOT GLOB '*[^A-Za-z0-9._/-]*'
  ),
  `firebase_uid` text NOT NULL,
  `work_order_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `claim_token` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'staged' NOT NULL CHECK (`status` IN ('staged', 'claimed', 'retry')),
  `attempts` integer DEFAULT 0 NOT NULL CHECK (`attempts` >= 0),
  `next_attempt_at` text NOT NULL CHECK (datetime(`next_attempt_at`) IS NOT NULL),
  `last_error` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `trade_crm_job_media_cleanup_due_idx`
  ON `trade_crm_job_media_cleanup`
    (`status`, `next_attempt_at`, `created_at`, `object_key`);
--> statement-breakpoint
CREATE TABLE `trade_crm_job_media_events` (
  `id` text PRIMARY KEY NOT NULL,
  `firebase_uid` text NOT NULL,
  `work_order_id` text NOT NULL,
  `job_media_id` text NOT NULL,
  `actor_uid` text NOT NULL,
  `actor_member_id` text NOT NULL,
  `event_type` text NOT NULL CHECK (`event_type` = 'viewed'),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `trade_crm_job_media_events_job_idx`
  ON `trade_crm_job_media_events`
    (`firebase_uid`, `work_order_id`, `created_at`, `id`);
--> statement-breakpoint
