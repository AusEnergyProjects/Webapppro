CREATE TABLE `trade_issued_document_cleanup` (
  `object_key` text PRIMARY KEY NOT NULL CHECK (
    length(`object_key`) BETWEEN 1 AND 512
    AND `object_key` NOT GLOB '*[^A-Za-z0-9._/-]*'
  ),
  `document_kind` text NOT NULL CHECK (`document_kind` IN ('quote', 'invoice')),
  `document_id` text NOT NULL CHECK (
    length(`document_id`) BETWEEN 1 AND 180
    AND `document_id` NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  `revision` integer NOT NULL CHECK (`revision` > 0),
  `sha256` text NOT NULL CHECK (
    length(`sha256`) = 64
    AND `sha256` = lower(`sha256`)
    AND `sha256` NOT GLOB '*[^0-9a-f]*'
  ),
  `size_bytes` integer NOT NULL CHECK (`size_bytes` >= 5 AND `size_bytes` <= 12582912),
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('staged', 'pending')),
  `attempts` integer DEFAULT 0 NOT NULL CHECK (`attempts` >= 0),
  `next_attempt_at` text NOT NULL CHECK (datetime(`next_attempt_at`) IS NOT NULL),
  `last_error` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `trade_issued_document_cleanup_due_idx`
  ON `trade_issued_document_cleanup` (`status`,`next_attempt_at`);
