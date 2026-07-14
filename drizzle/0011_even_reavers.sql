CREATE TABLE `customer_accounts` (
	`firebase_uid` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`postcode` text DEFAULT '' NOT NULL,
	`address_state` text DEFAULT '' NOT NULL,
	`property_type` text DEFAULT 'house' NOT NULL,
	`household_situation` text DEFAULT 'owner' NOT NULL,
	`account_updates` integer DEFAULT false NOT NULL,
	`account_status` text DEFAULT 'active' NOT NULL,
	`consent_version` text NOT NULL,
	`consent_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_accounts_email_idx` ON `customer_accounts` (`email`);--> statement-breakpoint
CREATE INDEX `customer_accounts_status_idx` ON `customer_accounts` (`account_status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `customer_consent_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`purpose` text NOT NULL,
	`notice_version` text NOT NULL,
	`granted_at` text NOT NULL,
	`withdrawn_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_consent_receipts_owner_idx` ON `customer_consent_receipts` (`firebase_uid`,`created_at`);--> statement-breakpoint
CREATE INDEX `customer_consent_receipts_project_idx` ON `customer_consent_receipts` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `customer_project_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`opportunity_match_id` text NOT NULL,
	`installer_uid` text NOT NULL,
	`product_list_id` text DEFAULT '' NOT NULL,
	`inclusions` text DEFAULT '[]' NOT NULL,
	`product_snapshot` text DEFAULT '[]' NOT NULL,
	`product_subtotal_cents_ex_gst` integer DEFAULT 0 NOT NULL,
	`labour_cents_ex_gst` integer DEFAULT 0 NOT NULL,
	`other_cents_ex_gst` integer DEFAULT 0 NOT NULL,
	`total_cents_ex_gst` integer DEFAULT 0 NOT NULL,
	`quote_type` text DEFAULT 'indicative' NOT NULL,
	`start_window` text DEFAULT 'to_confirm' NOT NULL,
	`duration_weeks` integer DEFAULT 0 NOT NULL,
	`workmanship_warranty_years` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`customer_decision` text DEFAULT 'reviewing' NOT NULL,
	`submitted_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_quotes_match_idx` ON `customer_project_quotes` (`opportunity_match_id`);--> statement-breakpoint
CREATE INDEX `customer_project_quotes_project_idx` ON `customer_project_quotes` (`project_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `customer_project_quotes_installer_idx` ON `customer_project_quotes` (`installer_uid`,`updated_at`);--> statement-breakpoint
CREATE TABLE `customer_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`title` text NOT NULL,
	`home_nickname` text DEFAULT 'My home' NOT NULL,
	`postcode` text NOT NULL,
	`address_state` text NOT NULL,
	`property_type` text NOT NULL,
	`household_situation` text NOT NULL,
	`goal` text NOT NULL,
	`pace` text NOT NULL,
	`existing_features` text DEFAULT '[]' NOT NULL,
	`service_categories` text DEFAULT '[]' NOT NULL,
	`priorities` text DEFAULT '[]' NOT NULL,
	`project_stage` text DEFAULT 'exploring' NOT NULL,
	`timing` text DEFAULT 'planning' NOT NULL,
	`budget_range` text DEFAULT 'not_set' NOT NULL,
	`private_notes` text DEFAULT '' NOT NULL,
	`plan_snapshot` text DEFAULT '{}' NOT NULL,
	`completed_plan_items` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`opportunity_id` text DEFAULT '' NOT NULL,
	`submitted_at` text DEFAULT '' NOT NULL,
	`archived_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_projects_owner_idx` ON `customer_projects` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `customer_projects_opportunity_idx` ON `customer_projects` (`opportunity_id`);
