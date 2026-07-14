CREATE TABLE `admin_notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`channel` text DEFAULT 'webhook' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text DEFAULT '' NOT NULL,
	`last_attempt_at` text DEFAULT '' NOT NULL,
	`delivered_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`response_code` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_notification_deliveries_notification_channel_idx` ON `admin_notification_deliveries` (`notification_id`,`channel`);--> statement-breakpoint
CREATE INDEX `admin_notification_deliveries_status_idx` ON `admin_notification_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `admin_notification_deliveries_notification_idx` ON `admin_notification_deliveries` (`notification_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `admin_notifications_delivery_enqueue`
AFTER INSERT ON `admin_notifications`
WHEN NEW.`event_type` != 'platform.backfill_marker'
  AND (NEW.`requires_action` = 1 OR NEW.`priority` IN ('high', 'urgent'))
BEGIN
  INSERT OR IGNORE INTO `admin_notification_deliveries`
    (`id`, `notification_id`, `channel`, `status`, `attempts`, `next_attempt_at`, `last_attempt_at`,
     `delivered_at`, `last_error`, `response_code`, `created_at`, `updated_at`)
  VALUES
    (lower(hex(randomblob(16))), NEW.`id`, 'webhook', 'pending', 0, '', '', '', '', 0, NEW.`created_at`, NEW.`created_at`);
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `admin_notification_deliveries`
  (`id`, `notification_id`, `channel`, `status`, `attempts`, `next_attempt_at`, `last_attempt_at`,
   `delivered_at`, `last_error`, `response_code`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `id`, 'webhook', 'skipped', 0, '', '', '',
  'Historic notification retained in the operations inbox.', 0, `created_at`, `updated_at`
FROM `admin_notifications`
WHERE `event_type` != 'platform.backfill_marker'
  AND (`requires_action` = 1 OR `priority` IN ('high', 'urgent'));
