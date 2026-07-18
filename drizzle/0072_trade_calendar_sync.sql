CREATE TABLE `trade_crm_calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`appointment_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_event_id` text DEFAULT '' NOT NULL,
	`external_url` text DEFAULT '' NOT NULL,
	`appointment_revision` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`last_synced_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_calendar_events_owner_appointment_provider_idx` ON `trade_crm_calendar_events` (`firebase_uid`,`appointment_id`,`provider`);
--> statement-breakpoint
CREATE INDEX `trade_crm_calendar_events_owner_status_idx` ON `trade_crm_calendar_events` (`firebase_uid`,`status`,`updated_at`);
