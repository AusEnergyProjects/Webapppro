CREATE TABLE `admin_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`event_key` text NOT NULL,
	`event_type` text NOT NULL,
	`category` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor_type` text DEFAULT 'system' NOT NULL,
	`actor_uid` text DEFAULT '' NOT NULL,
	`requires_action` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`read_at` text DEFAULT '' NOT NULL,
	`read_by_uid` text DEFAULT '' NOT NULL,
	`resolved_at` text DEFAULT '' NOT NULL,
	`resolved_by_uid` text DEFAULT '' NOT NULL,
	`resolution_note` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_notifications_event_key_idx` ON `admin_notifications` (`event_key`);--> statement-breakpoint
CREATE INDEX `admin_notifications_status_idx` ON `admin_notifications` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `admin_notifications_action_idx` ON `admin_notifications` (`requires_action`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `admin_notifications_category_idx` ON `admin_notifications` (`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `admin_notifications_entity_idx` ON `admin_notifications` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `customer_account_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`note` text NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_account_notes_owner_idx` ON `customer_account_notes` (`firebase_uid`,`created_at`);