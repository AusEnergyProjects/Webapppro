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
CREATE TRIGGER `trade_crm_job_media_accepted_lead_insert_guard`
BEFORE INSERT ON `trade_crm_job_media`
FOR EACH ROW
WHEN NEW.source = 'accepted_public_lead'
BEGIN
  SELECT CASE WHEN
    NEW.category <> 'before'
    OR NEW.photo_request_id <> ''
    OR NEW.photo_requirement_id <> ''
    OR NEW.request_revision <> 0
    OR NEW.checklist_version <> ''
    OR NEW.customer_acknowledged_at = ''
    OR datetime(NEW.customer_acknowledged_at) IS NULL
    OR json_extract(NEW.evidence_envelope, '$.contract') <> 'tlink-accepted-public-lead-job-file-v1'
    OR NEW.original_sha256 = ''
    OR NEW.accepted_disclosure_sha256 = ''
    OR NEW.accepted_lead_source_photo_id = ''
    OR NEW.accepted_lead_source_opportunity_id = ''
    OR NEW.accepted_lead_source_preparation_id = ''
    OR NEW.accepted_lead_source_release_id = ''
    OR NEW.accepted_lead_prompt_id = ''
    OR json_array_length(NEW.accepted_lead_service_categories) = 0
    OR NOT EXISTS (
      SELECT 1
      FROM public_trade_lead_quote_photos source_photo
      JOIN public_trade_lead_quote_preparations preparation
        ON preparation.id = NEW.accepted_lead_source_preparation_id
        AND preparation.opportunity_id = source_photo.opportunity_id
        AND preparation.status = 'active'
        AND preparation.withdrawn_at = ''
        AND datetime(preparation.granted_at) IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM json_each(preparation.photo_prompt_ids)
          WHERE CAST(value AS text) = source_photo.prompt_id
        )
      JOIN trade_opportunities opportunity
        ON opportunity.id = source_photo.opportunity_id
        AND opportunity.source_reference = preparation.source_reference
        AND opportunity.status = 'open'
        AND datetime(opportunity.expires_at) > datetime(NEW.created_at)
      JOIN trade_opportunity_matches opportunity_match
        ON opportunity_match.opportunity_id = opportunity.id
        AND opportunity_match.firebase_uid = NEW.firebase_uid
        AND opportunity_match.id = replace(NEW.work_order_id, 'public-lead-work-', '')
        AND opportunity_match.status = 'interested'
        AND opportunity_match.updated_at = NEW.created_at
        AND EXISTS (
          SELECT 1
          FROM json_each(source_photo.service_categories) source_category
          JOIN json_each(opportunity_match.matched_categories) matched_category
            ON CAST(matched_category.value AS text) = CAST(source_category.value AS text)
        )
      JOIN public_trade_lead_contact_releases contact
        ON contact.id = NEW.accepted_lead_source_release_id
        AND contact.opportunity_id = opportunity.id
        AND contact.source_reference = opportunity.source_reference
        AND contact.status = 'active'
        AND contact.withdrawn_at = ''
        AND datetime(contact.granted_at) IS NOT NULL
      WHERE source_photo.id = NEW.accepted_lead_source_photo_id
        AND source_photo.opportunity_id = NEW.accepted_lead_source_opportunity_id
        AND source_photo.status = 'active'
        AND source_photo.prompt_id = NEW.accepted_lead_prompt_id
        AND source_photo.prompt_label = NEW.caption
        AND source_photo.content_type = NEW.content_type
        AND source_photo.size_bytes = NEW.size_bytes
        AND source_photo.sha256 = NEW.original_sha256
        AND source_photo.privacy_status = 'metadata-stripped'
        AND EXISTS (
          SELECT 1
          FROM json_each(source_photo.service_categories) source_category
          JOIN json_each(NEW.accepted_lead_service_categories) accepted_category
            ON CAST(accepted_category.value AS text) = CAST(source_category.value AS text)
        )
    )
  THEN RAISE(ABORT, 'accepted public lead job file source is invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trade_crm_job_media_accepted_lead_update_guard`
BEFORE UPDATE ON `trade_crm_job_media`
FOR EACH ROW
WHEN OLD.source = 'accepted_public_lead'
BEGIN
  SELECT RAISE(ABORT, 'accepted public lead job file is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `trade_crm_job_media_accepted_lead_delete_guard`
BEFORE DELETE ON `trade_crm_job_media`
FOR EACH ROW
WHEN OLD.source = 'accepted_public_lead'
BEGIN
  SELECT RAISE(ABORT, 'accepted public lead job file is retained with job history');
END;
--> statement-breakpoint
CREATE TRIGGER `trade_crm_job_details_accepted_job_file_manifest_guard`
BEFORE INSERT ON `trade_crm_job_details`
FOR EACH ROW
WHEN NEW.customer_source = 'public_lead_released'
BEGIN
  SELECT CASE WHEN
    NOT EXISTS (
      SELECT 1 FROM trade_work_orders work
      JOIN trade_opportunity_matches accepted_match
        ON accepted_match.id = work.source_reference
        AND accepted_match.firebase_uid = work.firebase_uid
        AND accepted_match.status = 'interested'
        AND accepted_match.updated_at = NEW.created_at
      WHERE work.id = NEW.work_order_id AND work.firebase_uid = NEW.firebase_uid
        AND work.source_type = 'public_lead' AND work.record_status = 'active'
    )
    OR json_type(NEW.accepted_disclosure_snapshot, '$.photos') <> 'array'
    OR json_array_length(NEW.accepted_disclosure_snapshot, '$.photos') <> (
      SELECT COUNT(*) FROM trade_crm_job_media media
      WHERE media.firebase_uid = NEW.firebase_uid
        AND media.work_order_id = NEW.work_order_id
        AND media.source = 'accepted_public_lead'
        AND media.accepted_disclosure_sha256 = NEW.accepted_disclosure_sha256
    )
    OR EXISTS (
      SELECT 1
      FROM json_each(NEW.accepted_disclosure_snapshot, '$.photos') manifest
      WHERE NOT EXISTS (
        SELECT 1 FROM trade_crm_job_media media
        WHERE media.id = json_extract(manifest.value, '$.id')
          AND media.firebase_uid = NEW.firebase_uid
          AND media.work_order_id = NEW.work_order_id
          AND media.source = 'accepted_public_lead'
          AND media.accepted_disclosure_sha256 = NEW.accepted_disclosure_sha256
          AND media.accepted_lead_source_photo_id = json_extract(manifest.value, '$.sourcePhotoId')
          AND media.accepted_lead_prompt_id = json_extract(manifest.value, '$.promptId')
          AND media.caption = json_extract(manifest.value, '$.label')
          AND media.content_type = json_extract(manifest.value, '$.contentType')
          AND media.size_bytes = json_extract(manifest.value, '$.sizeBytes')
          AND media.original_sha256 = json_extract(manifest.value, '$.sha256')
          AND json_extract(media.evidence_envelope, '$.privacyStatus') = json_extract(manifest.value, '$.privacyStatus')
      )
    )
  THEN RAISE(ABORT, 'accepted public lead job file manifest is incomplete') END;
END;
--> statement-breakpoint
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
CREATE TRIGGER `trade_crm_job_media_events_insert_guard`
BEFORE INSERT ON `trade_crm_job_media_events`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM trade_crm_job_media media
    WHERE media.id = NEW.job_media_id
      AND media.firebase_uid = NEW.firebase_uid
      AND media.work_order_id = NEW.work_order_id
  ) OR NOT EXISTS (
    SELECT 1 FROM trade_team_members member
    WHERE member.id = NEW.actor_member_id
      AND member.owner_uid = NEW.firebase_uid
      AND member.member_uid = NEW.actor_uid
      AND member.status = 'active'
  ) THEN RAISE(ABORT, 'job file event scope is invalid') END;
END;
