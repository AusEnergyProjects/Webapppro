CREATE TABLE `public_trade_lead_quote_preparations` (
  `id` text PRIMARY KEY NOT NULL,
  `opportunity_id` text NOT NULL,
  `source_reference` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'withdrawn')),
  `version` text NOT NULL,
  `question_answers` text DEFAULT '[]' NOT NULL CHECK (
    json_valid(`question_answers`) AND json_type(`question_answers`) = 'array'
  ),
  `photo_prompt_ids` text DEFAULT '[]' NOT NULL CHECK (
    json_valid(`photo_prompt_ids`) AND json_type(`photo_prompt_ids`) = 'array'
  ),
  `expected_photo_count` integer DEFAULT 0 NOT NULL CHECK (
    `expected_photo_count` >= 0 AND `expected_photo_count` <= 12
  ),
  `upload_key_hash` text DEFAULT '' NOT NULL CHECK (
    `upload_key_hash` = '' OR (
      length(`upload_key_hash`) = 64
      AND lower(`upload_key_hash`) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  `notice_version` text NOT NULL,
  `consent_purpose` text NOT NULL,
  `granted_at` text NOT NULL CHECK (datetime(`granted_at`) IS NOT NULL),
  `withdrawn_at` text DEFAULT '' NOT NULL CHECK (
    `withdrawn_at` = '' OR datetime(`withdrawn_at`) IS NOT NULL
  ),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_trade_lead_quote_preparations_opportunity_idx`
  ON `public_trade_lead_quote_preparations` (`opportunity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_trade_lead_quote_preparations_source_idx`
  ON `public_trade_lead_quote_preparations` (`source_reference`);
--> statement-breakpoint
CREATE INDEX `public_trade_lead_quote_preparations_status_idx`
  ON `public_trade_lead_quote_preparations` (`status`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `public_trade_lead_quote_photos` (
  `id` text PRIMARY KEY NOT NULL,
  `opportunity_id` text NOT NULL,
  `client_upload_id` text NOT NULL,
  `prompt_id` text NOT NULL,
  `prompt_label` text NOT NULL,
  `service_categories` text DEFAULT '[]' NOT NULL CHECK (
    json_valid(`service_categories`) AND json_type(`service_categories`) = 'array'
  ),
  `content_type` text NOT NULL CHECK (`content_type` IN ('image/jpeg', 'image/png')),
  `size_bytes` integer NOT NULL CHECK (`size_bytes` > 0 AND `size_bytes` <= 8388608),
  `object_key` text NOT NULL,
  `sha256` text NOT NULL CHECK (
    length(`sha256`) = 64 AND lower(`sha256`) NOT GLOB '*[^0-9a-f]*'
  ),
  `privacy_status` text DEFAULT 'metadata-stripped' NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'active', 'deleted', 'purged')),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_trade_lead_quote_photos_client_idx`
  ON `public_trade_lead_quote_photos` (`opportunity_id`, `client_upload_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_trade_lead_quote_photos_object_idx`
  ON `public_trade_lead_quote_photos` (`object_key`);
--> statement-breakpoint
CREATE INDEX `public_trade_lead_quote_photos_opportunity_idx`
  ON `public_trade_lead_quote_photos` (`opportunity_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `public_trade_lead_quote_photo_events` (
  `id` text PRIMARY KEY NOT NULL,
  `photo_id` text NOT NULL,
  `opportunity_id` text NOT NULL,
  `match_id` text NOT NULL,
  `installer_uid` text NOT NULL,
  `event_type` text NOT NULL CHECK (`event_type` = 'viewed'),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `public_trade_lead_quote_photo_events_photo_idx`
  ON `public_trade_lead_quote_photo_events` (`photo_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `public_trade_lead_quote_photo_events_match_idx`
  ON `public_trade_lead_quote_photo_events` (`match_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `public_trade_lead_quote_upload_limits` (
  `client_source_hash` text PRIMARY KEY NOT NULL,
  `timestamps` text DEFAULT '[]' NOT NULL CHECK (
    json_valid(`timestamps`) AND json_type(`timestamps`) = 'array'
  ),
  `version` integer DEFAULT 0 NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_trade_lead_quote_upload_limits_updated_idx`
  ON `public_trade_lead_quote_upload_limits` (`updated_at`);
