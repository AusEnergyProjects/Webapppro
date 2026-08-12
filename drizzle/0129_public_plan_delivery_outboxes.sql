CREATE TABLE `public_plan_lead_intakes` (
  `id` text PRIMARY KEY NOT NULL,
  `source_reference` text NOT NULL,
  `submission_fingerprint` text NOT NULL CHECK (
    length(`submission_fingerprint`) = 64
    AND lower(`submission_fingerprint`) NOT GLOB '*[^0-9a-f]*'
  ),
  `payload_object_key` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (
    `status` IN ('pending', 'processing', 'completed', 'failed')
  ),
  `opportunity_id` text DEFAULT '' NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL CHECK (`attempts` >= 0),
  `next_attempt_at` text DEFAULT '' NOT NULL,
  `last_attempt_at` text DEFAULT '' NOT NULL,
  `completed_at` text DEFAULT '' NOT NULL,
  `failed_at` text DEFAULT '' NOT NULL,
  `last_error` text DEFAULT '' NOT NULL,
  `payload_deleted_at` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_lead_intakes_source_idx`
  ON `public_plan_lead_intakes` (`source_reference`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_lead_intakes_payload_idx`
  ON `public_plan_lead_intakes` (`payload_object_key`);
--> statement-breakpoint
CREATE INDEX `public_plan_lead_intakes_status_idx`
  ON `public_plan_lead_intakes` (`status`, `next_attempt_at`, `created_at`);
--> statement-breakpoint
CREATE TABLE `public_plan_customer_email_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `intake_id` text NOT NULL,
  `source_reference` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (
    `status` IN ('pending', 'generating', 'sending', 'sent', 'delivered', 'failed',
      'provider_failed', 'bounced', 'complained', 'suppressed', 'waiting_for_channel')
  ),
  `attempts` integer DEFAULT 0 NOT NULL CHECK (`attempts` >= 0),
  `next_attempt_at` text DEFAULT '' NOT NULL,
  `provider` text DEFAULT 'resend' NOT NULL,
  `provider_message_id` text DEFAULT '' NOT NULL,
  `provider_status` text DEFAULT '' NOT NULL,
  `recipient_email_hash` text DEFAULT '' NOT NULL,
  `idempotency_key` text NOT NULL,
  `subject` text DEFAULT '' NOT NULL,
  `body` text DEFAULT '' NOT NULL,
  `attachment_object_key` text DEFAULT '' NOT NULL,
  `attachment_filename` text DEFAULT '' NOT NULL,
  `attachment_content_type` text DEFAULT 'application/pdf' NOT NULL,
  `attachment_size_bytes` integer DEFAULT 0 NOT NULL CHECK (`attachment_size_bytes` >= 0),
  `attachment_sha256` text DEFAULT '' NOT NULL,
  `attachment_deleted_at` text DEFAULT '' NOT NULL,
  `attachment_cleanup_next_attempt_at` text DEFAULT '' NOT NULL,
  `last_attempt_at` text DEFAULT '' NOT NULL,
  `sent_at` text DEFAULT '' NOT NULL,
  `delivered_at` text DEFAULT '' NOT NULL,
  `failed_at` text DEFAULT '' NOT NULL,
  `last_error` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_customer_email_intake_idx`
  ON `public_plan_customer_email_deliveries` (`intake_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_customer_email_source_idx`
  ON `public_plan_customer_email_deliveries` (`source_reference`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_customer_email_idempotency_idx`
  ON `public_plan_customer_email_deliveries` (`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_customer_email_provider_idx`
  ON `public_plan_customer_email_deliveries` (`provider`, `provider_message_id`)
  WHERE `provider_message_id` <> '';
--> statement-breakpoint
CREATE INDEX `public_plan_customer_email_status_idx`
  ON `public_plan_customer_email_deliveries` (`status`, `next_attempt_at`, `created_at`);
--> statement-breakpoint
CREATE INDEX `public_plan_customer_email_recipient_idx`
  ON `public_plan_customer_email_deliveries` (`recipient_email_hash`, `created_at`);
--> statement-breakpoint
CREATE TABLE `public_plan_customer_email_delivery_events` (
  `id` text PRIMARY KEY NOT NULL,
  `delivery_id` text NOT NULL,
  `provider_event_key` text NOT NULL,
  `event_type` text NOT NULL,
  `provider_status` text DEFAULT '' NOT NULL,
  `summary` text NOT NULL,
  `occurred_at` text NOT NULL CHECK (datetime(`occurred_at`) IS NOT NULL),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_customer_email_events_provider_idx`
  ON `public_plan_customer_email_delivery_events` (`provider_event_key`);
--> statement-breakpoint
CREATE INDEX `public_plan_customer_email_events_delivery_idx`
  ON `public_plan_customer_email_delivery_events` (`delivery_id`, `occurred_at`);
--> statement-breakpoint
CREATE TABLE `public_plan_customer_email_suppressions` (
  `email_hash` text PRIMARY KEY NOT NULL,
  `reason` text NOT NULL,
  `provider` text DEFAULT 'resend' NOT NULL,
  `provider_status` text NOT NULL,
  `provider_message_id` text DEFAULT '' NOT NULL,
  `suppressed_at` text NOT NULL CHECK (datetime(`suppressed_at`) IS NOT NULL),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `public_plan_internal_relay_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `intake_id` text NOT NULL,
  `source_reference` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (
    `status` IN ('pending', 'sending', 'sent', 'failed', 'waiting_for_channel')
  ),
  `attempts` integer DEFAULT 0 NOT NULL CHECK (`attempts` >= 0),
  `next_attempt_at` text DEFAULT '' NOT NULL,
  `idempotency_key` text NOT NULL,
  `provider_status` text DEFAULT '' NOT NULL,
  `last_attempt_at` text DEFAULT '' NOT NULL,
  `sent_at` text DEFAULT '' NOT NULL,
  `failed_at` text DEFAULT '' NOT NULL,
  `last_error` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_internal_relay_intake_idx`
  ON `public_plan_internal_relay_deliveries` (`intake_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_internal_relay_source_idx`
  ON `public_plan_internal_relay_deliveries` (`source_reference`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_internal_relay_idempotency_idx`
  ON `public_plan_internal_relay_deliveries` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `public_plan_internal_relay_status_idx`
  ON `public_plan_internal_relay_deliveries` (`status`, `next_attempt_at`, `created_at`);
--> statement-breakpoint
CREATE TABLE `public_plan_internal_relay_delivery_events` (
  `id` text PRIMARY KEY NOT NULL,
  `delivery_id` text NOT NULL,
  `event_key` text NOT NULL,
  `event_type` text NOT NULL,
  `summary` text NOT NULL,
  `occurred_at` text NOT NULL CHECK (datetime(`occurred_at`) IS NOT NULL),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_plan_internal_relay_events_key_idx`
  ON `public_plan_internal_relay_delivery_events` (`event_key`);
--> statement-breakpoint
CREATE INDEX `public_plan_internal_relay_events_delivery_idx`
  ON `public_plan_internal_relay_delivery_events` (`delivery_id`, `occurred_at`);
