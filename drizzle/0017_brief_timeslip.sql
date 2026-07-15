CREATE TABLE `asset_safety_acknowledgements` (
	`id` text PRIMARY KEY NOT NULL,
	`notice_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`status` text DEFAULT 'acknowledged' NOT NULL,
	`acknowledged_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_safety_acknowledgements_owner_notice_asset_idx` ON `asset_safety_acknowledgements` (`customer_uid`,`notice_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_safety_acknowledgements_notice_idx` ON `asset_safety_acknowledgements` (`notice_id`,`acknowledged_at`);--> statement-breakpoint
CREATE INDEX `asset_safety_acknowledgements_owner_idx` ON `asset_safety_acknowledgements` (`customer_uid`,`updated_at`);--> statement-breakpoint
CREATE TABLE `asset_safety_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by_uid` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`severity` text DEFAULT 'advisory' NOT NULL,
	`asset_category` text DEFAULT '' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`model_number` text DEFAULT '' NOT NULL,
	`source_url` text NOT NULL,
	`source_label` text DEFAULT 'Official safety source' NOT NULL,
	`effective_at` text DEFAULT '' NOT NULL,
	`expires_at` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` text DEFAULT '' NOT NULL,
	`withdrawn_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `asset_safety_notices_status_idx` ON `asset_safety_notices` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `asset_safety_notices_scope_idx` ON `asset_safety_notices` (`asset_category`,`brand`,`model_number`);--> statement-breakpoint
CREATE TABLE `customer_asset_lifecycle_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_uid` text NOT NULL,
	`asset_id` text NOT NULL,
	`reminders_enabled` integer DEFAULT true NOT NULL,
	`reminder_lead_days` integer DEFAULT 30 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_asset_lifecycle_preferences_owner_asset_idx` ON `customer_asset_lifecycle_preferences` (`customer_uid`,`asset_id`);--> statement-breakpoint
CREATE INDEX `customer_asset_lifecycle_preferences_owner_idx` ON `customer_asset_lifecycle_preferences` (`customer_uid`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_asset_service_events` (
	`id` text PRIMARY KEY NOT NULL,
	`service_plan_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`handover_pack_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`event_type` text DEFAULT 'service_completed' NOT NULL,
	`serviced_at` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`provider_reference` text DEFAULT '' NOT NULL,
	`next_due_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_asset_service_events_plan_idx` ON `trade_asset_service_events` (`service_plan_id`,`serviced_at`);--> statement-breakpoint
CREATE INDEX `trade_asset_service_events_asset_idx` ON `trade_asset_service_events` (`asset_id`,`serviced_at`);--> statement-breakpoint
CREATE INDEX `trade_asset_service_events_owner_idx` ON `trade_asset_service_events` (`firebase_uid`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_asset_service_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`handover_pack_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`service_type` text NOT NULL,
	`cadence_months` integer NOT NULL,
	`next_due_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_asset_service_plans_asset_type_idx` ON `trade_asset_service_plans` (`asset_id`,`service_type`);--> statement-breakpoint
CREATE INDEX `trade_asset_service_plans_owner_due_idx` ON `trade_asset_service_plans` (`firebase_uid`,`status`,`next_due_at`);--> statement-breakpoint
CREATE INDEX `trade_asset_service_plans_pack_idx` ON `trade_asset_service_plans` (`handover_pack_id`,`status`,`next_due_at`);