CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_uid` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`summary` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_log_created_idx` ON `admin_audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_admin_idx` ON `admin_audit_log` (`admin_uid`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_entity_idx` ON `admin_audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'support' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_by_uid` text DEFAULT '' NOT NULL,
	`last_login_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_firebase_uid_idx` ON `admin_users` (`firebase_uid`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_idx` ON `admin_users` (`email`);--> statement-breakpoint
CREATE INDEX `admin_users_status_idx` ON `admin_users` (`status`);--> statement-breakpoint
CREATE TABLE `trade_account_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`note` text NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_account_notes_owner_idx` ON `trade_account_notes` (`firebase_uid`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`project_type` text NOT NULL,
	`postcode` text DEFAULT '' NOT NULL,
	`state` text NOT NULL,
	`service_categories` text DEFAULT '[]' NOT NULL,
	`priority` text DEFAULT 'standard' NOT NULL,
	`timing` text DEFAULT 'planning' NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_opportunities_status_idx` ON `trade_opportunities` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_opportunities_state_idx` ON `trade_opportunities` (`state`);--> statement-breakpoint
CREATE TABLE `trade_opportunity_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`status` text DEFAULT 'offered' NOT NULL,
	`admin_note` text DEFAULT '' NOT NULL,
	`partner_note` text DEFAULT '' NOT NULL,
	`matched_by_uid` text NOT NULL,
	`matched_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_opportunity_matches_unique_idx` ON `trade_opportunity_matches` (`opportunity_id`,`firebase_uid`);--> statement-breakpoint
CREATE INDEX `trade_opportunity_matches_owner_idx` ON `trade_opportunity_matches` (`firebase_uid`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_opportunity_matches_opportunity_idx` ON `trade_opportunity_matches` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `trade_opportunity_matches_status_idx` ON `trade_opportunity_matches` (`status`);