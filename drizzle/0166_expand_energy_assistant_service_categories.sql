CREATE TABLE `energy_assistant_leads_next` (
  `id` text PRIMARY KEY NOT NULL CHECK (
    length(`id`) = 36
    AND `id` = lower(`id`)
    AND `id` NOT GLOB '*[^0-9a-f-]*'
    AND substr(`id`, 9, 1) = '-'
    AND substr(`id`, 14, 1) = '-'
    AND substr(`id`, 19, 1) = '-'
    AND substr(`id`, 24, 1) = '-'
  ),
  `request_id` text NOT NULL CHECK (
    trim(`request_id`) = `request_id`
    AND length(`request_id`) BETWEEN 16 AND 80
    AND `request_id` NOT GLOB '*[^A-Za-z0-9:_-]*'
  ),
  `submission_key_sha256` text NOT NULL CHECK (
    length(`submission_key_sha256`) = 64
    AND `submission_key_sha256` = lower(`submission_key_sha256`)
    AND `submission_key_sha256` NOT GLOB '*[^0-9a-f]*'
  ),
  `source_request_id` text DEFAULT '' NOT NULL CHECK (
    length(`source_request_id`) <= 80
    AND (`source_request_id` = '' OR (
      length(`source_request_id`) BETWEEN 16 AND 80
      AND `source_request_id` NOT GLOB '*[^A-Za-z0-9:_-]*'
    ))
  ),
  `name` text NOT NULL CHECK (
    trim(`name`) = `name`
    AND length(`name`) BETWEEN 2 AND 120
  ),
  `email` text CHECK (
    `email` IS NULL OR (
      trim(`email`) = `email`
      AND length(`email`) BETWEEN 5 AND 254
      AND instr(`email`, '@') BETWEEN 2 AND length(`email`) - 2
    )
  ),
  `phone` text CHECK (
    `phone` IS NULL OR (
      trim(`phone`) = `phone`
      AND length(`phone`) BETWEEN 8 AND 32
    )
  ),
  `postcode` text NOT NULL CHECK (
    length(`postcode`) = 4
    AND `postcode` NOT GLOB '*[^0-9]*'
  ),
  `suburb` text NOT NULL CHECK (
    trim(`suburb`) = `suburb`
    AND length(`suburb`) BETWEEN 2 AND 80
  ),
  `residential_state` text NOT NULL CHECK (
    `residential_state` IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
  ),
  `service_categories_json` text NOT NULL CHECK (
    json_valid(`service_categories_json`)
    AND json_type(`service_categories_json`) = 'array'
    AND json_array_length(`service_categories_json`) BETWEEN 1 AND 14
    AND length(`service_categories_json`) <= 1000
  ),
  `quote_brief_version` text NOT NULL CHECK (
    `quote_brief_version` = 'energy-assistant-quote-brief/v1'
  ),
  `quote_brief_json` text NOT NULL CHECK (
    json_valid(`quote_brief_json`)
    AND json_type(`quote_brief_json`) = 'object'
    AND length(`quote_brief_json`) BETWEEN 2 AND 32768
  ),
  `interest_confirmed` integer NOT NULL CHECK (`interest_confirmed` = 1),
  `source_journey` text NOT NULL CHECK (
    `source_journey` = 'energy-assistant-explicit-follow-up'
  ),
  `service_consent_version` text NOT NULL CHECK (
    `service_consent_version` = 'aea-energy-assistant-service-contact/v1'
  ),
  `service_consent_purpose` text NOT NULL CHECK (
    `service_consent_purpose` = 'respond_to_requested_energy_assistance'
  ),
  `service_consent_granted_at` text NOT NULL CHECK (
    datetime(`service_consent_granted_at`) IS NOT NULL
  ),
  `marketing_consent` integer DEFAULT 0 NOT NULL CHECK (
    `marketing_consent` IN (0, 1)
  ),
  `marketing_consent_granted_at` text DEFAULT '' NOT NULL CHECK (
    (`marketing_consent` = 0 AND `marketing_consent_granted_at` = '')
    OR (`marketing_consent` = 1 AND datetime(`marketing_consent_granted_at`) IS NOT NULL)
  ),
  `trade_sharing_consent` integer DEFAULT 0 NOT NULL CHECK (
    `trade_sharing_consent` IN (0, 1)
  ),
  `trade_sharing_notice_version` text DEFAULT '' NOT NULL,
  `trade_sharing_purpose` text DEFAULT '' NOT NULL,
  `trade_sharing_granted_at` text DEFAULT '' NOT NULL,
  `trade_disclosed_fields_json` text DEFAULT '[]' NOT NULL CHECK (
    json_valid(`trade_disclosed_fields_json`)
    AND json_type(`trade_disclosed_fields_json`) = 'array'
    AND length(`trade_disclosed_fields_json`) <= 1000
  ),
  `trade_disclosed_snapshot_json` text DEFAULT '{}' NOT NULL CHECK (
    json_valid(`trade_disclosed_snapshot_json`)
    AND json_type(`trade_disclosed_snapshot_json`) = 'object'
    AND length(`trade_disclosed_snapshot_json`) <= 40000
  ),
  `trade_disclosed_snapshot_sha256` text DEFAULT '' NOT NULL CHECK (
    `trade_disclosed_snapshot_sha256` = '' OR (
      length(`trade_disclosed_snapshot_sha256`) = 64
      AND `trade_disclosed_snapshot_sha256` = lower(`trade_disclosed_snapshot_sha256`)
      AND `trade_disclosed_snapshot_sha256` NOT GLOB '*[^0-9a-f]*'
    )
  ),
  `opportunity_id` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'new' NOT NULL CHECK (
    `status` IN (
      'new', 'needs_information', 'acknowledged', 'contacting', 'quote_ready',
      'shared_with_trades', 'resolved', 'withdrawn'
    )
  ),
  `assigned_to_uid` text DEFAULT '' NOT NULL CHECK (
    length(`assigned_to_uid`) <= 180
  ),
  `due_at` text DEFAULT '' NOT NULL CHECK (
    `due_at` = '' OR datetime(`due_at`) IS NOT NULL
  ),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (
    datetime(`updated_at`) IS NOT NULL
    AND datetime(`updated_at`) >= datetime(`created_at`)
    AND datetime(`service_consent_granted_at`) <= datetime(`created_at`)
  ),
  CHECK (`email` IS NOT NULL OR `phone` IS NOT NULL),
  CHECK (
    (`trade_sharing_consent` = 0
      AND `trade_sharing_notice_version` = ''
      AND `trade_sharing_purpose` = ''
      AND `trade_sharing_granted_at` = ''
      AND `trade_disclosed_fields_json` = '[]'
      AND `trade_disclosed_snapshot_json` = '{}'
      AND `trade_disclosed_snapshot_sha256` = '')
    OR
    (`trade_sharing_consent` = 1
      AND `trade_sharing_notice_version` = '2026-08-20-energy-assistant-trade-sharing-v1'
      AND `trade_sharing_purpose` = 'Share this quote brief and selected contact details with approved matched TLink trades'
      AND datetime(`trade_sharing_granted_at`) IS NOT NULL
      AND json_array_length(`trade_disclosed_fields_json`) BETWEEN 5 AND 8
      AND length(`trade_disclosed_snapshot_sha256`) = 64)
  ),
  CHECK (
    `status` NOT IN ('quote_ready', 'shared_with_trades')
    OR (
      json_extract(`quote_brief_json`, '$.readiness.state') = 'quote_ready'
      AND json_type(`quote_brief_json`, '$.readiness.missingQuestionIds') = 'array'
      AND json_array_length(json_extract(`quote_brief_json`, '$.readiness.missingQuestionIds')) = 0
      AND json_type(`quote_brief_json`, '$.readiness.insufficientKnownServiceIds') = 'array'
      AND json_array_length(json_extract(`quote_brief_json`, '$.readiness.insufficientKnownServiceIds')) = 0
    )
  ),
  CHECK (
    `status` <> 'needs_information'
    OR json_extract(`quote_brief_json`, '$.readiness.state') = 'needs_information'
  ),
  CHECK (
    `opportunity_id` = ''
    OR (`trade_sharing_consent` = 1
      AND json_extract(`quote_brief_json`, '$.readiness.state') = 'quote_ready'
      AND json_array_length(json_extract(`quote_brief_json`, '$.readiness.missingQuestionIds')) = 0
      AND json_array_length(json_extract(`quote_brief_json`, '$.readiness.insufficientKnownServiceIds')) = 0)
  ),
  CHECK (
    `status` <> 'shared_with_trades'
    OR (`opportunity_id` <> '' AND `trade_sharing_consent` = 1)
  ),
  UNIQUE (`request_id`)
);
--> statement-breakpoint

INSERT INTO `energy_assistant_leads_next` (
  `id`, `request_id`, `submission_key_sha256`, `source_request_id`, `name`,
  `email`, `phone`, `postcode`, `suburb`, `residential_state`,
  `service_categories_json`, `quote_brief_version`, `quote_brief_json`,
  `interest_confirmed`, `source_journey`, `service_consent_version`,
  `service_consent_purpose`, `service_consent_granted_at`, `marketing_consent`,
  `marketing_consent_granted_at`, `trade_sharing_consent`,
  `trade_sharing_notice_version`, `trade_sharing_purpose`, `trade_sharing_granted_at`,
  `trade_disclosed_fields_json`, `trade_disclosed_snapshot_json`,
  `trade_disclosed_snapshot_sha256`, `opportunity_id`, `status`, `assigned_to_uid`,
  `due_at`, `created_at`, `updated_at`
)
SELECT
  `id`, `request_id`, `submission_key_sha256`, `source_request_id`, `name`,
  `email`, `phone`, `postcode`, `suburb`, `residential_state`,
  `service_categories_json`, `quote_brief_version`, `quote_brief_json`,
  `interest_confirmed`, `source_journey`, `service_consent_version`,
  `service_consent_purpose`, `service_consent_granted_at`, `marketing_consent`,
  `marketing_consent_granted_at`, `trade_sharing_consent`,
  `trade_sharing_notice_version`, `trade_sharing_purpose`, `trade_sharing_granted_at`,
  `trade_disclosed_fields_json`, `trade_disclosed_snapshot_json`,
  `trade_disclosed_snapshot_sha256`, `opportunity_id`, `status`, `assigned_to_uid`,
  `due_at`, `created_at`, `updated_at`
FROM `energy_assistant_leads`;
--> statement-breakpoint

CREATE TABLE `energy_assistant_lead_events_next` (
  `id` text PRIMARY KEY NOT NULL,
  `lead_id` text NOT NULL REFERENCES `energy_assistant_leads_next` (`id`) ON DELETE CASCADE,
  `actor_type` text NOT NULL CHECK (`actor_type` IN ('visitor', 'admin', 'system')),
  `actor_uid` text DEFAULT '' NOT NULL CHECK (length(`actor_uid`) <= 180),
  `action` text NOT NULL CHECK (
    `action` IN (
      'created', 'assigned', 'due_changed', 'status_changed',
      'note_added', 'trade_opportunity_created'
    )
  ),
  `note` text DEFAULT '' NOT NULL CHECK (
    trim(`note`) = `note` AND length(`note`) <= 1000
  ),
  `metadata_json` text DEFAULT '{}' NOT NULL CHECK (
    json_valid(`metadata_json`)
    AND json_type(`metadata_json`) = 'object'
    AND length(`metadata_json`) <= 4000
  ),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
--> statement-breakpoint

INSERT INTO `energy_assistant_lead_events_next` (
  `id`, `lead_id`, `actor_type`, `actor_uid`, `action`, `note`, `metadata_json`, `created_at`
)
SELECT
  `id`, `lead_id`, `actor_type`, `actor_uid`, `action`, `note`, `metadata_json`, `created_at`
FROM `energy_assistant_lead_events`;
--> statement-breakpoint

DROP TABLE `energy_assistant_lead_events`;
--> statement-breakpoint

DROP TABLE `energy_assistant_leads`;
--> statement-breakpoint

ALTER TABLE `energy_assistant_leads_next` RENAME TO `energy_assistant_leads`;
--> statement-breakpoint

ALTER TABLE `energy_assistant_lead_events_next` RENAME TO `energy_assistant_lead_events`;
--> statement-breakpoint

CREATE INDEX `energy_assistant_leads_status_idx`
  ON `energy_assistant_leads` (`status`, `created_at`, `id`);
--> statement-breakpoint

CREATE INDEX `energy_assistant_leads_source_request_idx`
  ON `energy_assistant_leads` (`source_request_id`, `created_at`, `id`)
  WHERE `source_request_id` <> '';
--> statement-breakpoint

CREATE INDEX `energy_assistant_leads_assignment_idx`
  ON `energy_assistant_leads` (`assigned_to_uid`, `status`, `due_at`, `id`);
--> statement-breakpoint

CREATE UNIQUE INDEX `energy_assistant_leads_opportunity_idx`
  ON `energy_assistant_leads` (`opportunity_id`)
  WHERE `opportunity_id` <> '';
--> statement-breakpoint

CREATE INDEX `energy_assistant_lead_events_lead_idx`
  ON `energy_assistant_lead_events` (`lead_id`, `created_at`, `id`);
