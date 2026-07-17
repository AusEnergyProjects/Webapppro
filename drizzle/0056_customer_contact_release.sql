CREATE TABLE `customer_project_contact_release_events` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`project_id` text NOT NULL,
	`opportunity_match_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`installer_uid` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_uid` text NOT NULL,
	`event_type` text NOT NULL,
	`notice_version` text NOT NULL,
	`disclosed_fields` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_project_contact_release_events_release_idx` ON `customer_project_contact_release_events` (`release_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `customer_project_contact_release_events_project_idx` ON `customer_project_contact_release_events` (`customer_uid`,`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `customer_project_contact_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`opportunity_match_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`installer_uid` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notice_version` text NOT NULL,
	`disclosed_fields` text DEFAULT '[]' NOT NULL,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`customer_phone` text NOT NULL,
	`address_line_1` text NOT NULL,
	`address_line_2` text DEFAULT '' NOT NULL,
	`suburb` text NOT NULL,
	`address_state` text NOT NULL,
	`postcode` text NOT NULL,
	`granted_at` text NOT NULL,
	`withdrawn_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_contact_releases_match_idx` ON `customer_project_contact_releases` (`opportunity_match_id`);--> statement-breakpoint
CREATE INDEX `customer_project_contact_releases_customer_idx` ON `customer_project_contact_releases` (`customer_uid`,`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `customer_project_contact_releases_installer_idx` ON `customer_project_contact_releases` (`installer_uid`,`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `customer_accounts` ADD `phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_accounts` ADD `address_line_1` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_accounts` ADD `address_line_2` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_accounts` ADD `suburb` text DEFAULT '' NOT NULL;