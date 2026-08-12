CREATE TABLE `trade_team_document_expiry_warnings` (
  `id` text PRIMARY KEY NOT NULL,
  `event_key` text NOT NULL UNIQUE,
  `owner_uid` text NOT NULL,
  `team_member_id` text NOT NULL,
  `file_id` text NOT NULL,
  `document_title` text NOT NULL,
  `member_name` text NOT NULL,
  `expires_at` text NOT NULL CHECK (date(`expires_at`) = `expires_at` AND length(`expires_at`) = 10),
  `email_status` text NOT NULL DEFAULT 'pending' CHECK (`email_status` IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  `email_attempts` integer NOT NULL DEFAULT 0 CHECK (`email_attempts` >= 0),
  `email_next_attempt_at` text NOT NULL DEFAULT '',
  `email_last_attempt_at` text NOT NULL DEFAULT '',
  `email_provider` text NOT NULL DEFAULT '',
  `email_provider_message_id` text NOT NULL DEFAULT '',
  `email_idempotency_key` text NOT NULL CHECK (
    length(`email_idempotency_key`) = 64
    AND `email_idempotency_key` = lower(`email_idempotency_key`)
    AND `email_idempotency_key` NOT GLOB '*[^0-9a-f]*'
  ),
  `email_last_error` text NOT NULL DEFAULT '',
  `emailed_at` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL),
  FOREIGN KEY (`team_member_id`) REFERENCES `trade_team_members`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
  FOREIGN KEY (`file_id`) REFERENCES `trade_team_member_files`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_team_document_expiry_warnings_revision_idx`
  ON `trade_team_document_expiry_warnings` (`owner_uid`, `file_id`, `expires_at`);
--> statement-breakpoint
CREATE INDEX `trade_team_document_expiry_warnings_owner_time_idx`
  ON `trade_team_document_expiry_warnings` (`owner_uid`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `trade_team_document_expiry_warnings_email_queue_idx`
  ON `trade_team_document_expiry_warnings` (`email_status`, `email_next_attempt_at`, `created_at`);
