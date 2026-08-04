ALTER TABLE `trade_accounts` ADD `brand_theme_key` text DEFAULT 'emerald_navy' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `brand_border_style` text DEFAULT 'soft' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `logo_object_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `logo_content_type` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `banner_object_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `banner_content_type` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `quote_email_subject_template` text DEFAULT '{business_name} sent quote {quote_number}' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `quote_email_intro` text DEFAULT 'Thank you for the opportunity to quote for your project. Review the scope, choices and total below.' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `quote_default_terms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `account_closed_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_versions` ADD `customer_message` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_versions` ADD `document_snapshot_json` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `recipient_role` text DEFAULT 'acceptance' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `subject_snapshot` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `email_content_sha256` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `attachment_filename` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_deliveries` ADD `attachment_sha256` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TABLE `trade_account_service_areas` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`position` integer NOT NULL,
	`postcode` text NOT NULL,
	`radius_km` integer NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_account_service_areas_owner_position_idx` ON `trade_account_service_areas` (`firebase_uid`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_account_service_areas_owner_postcode_idx` ON `trade_account_service_areas` (`firebase_uid`,`postcode`) WHERE `record_status` = 'active';--> statement-breakpoint
CREATE INDEX `trade_account_service_areas_owner_status_idx` ON `trade_account_service_areas` (`firebase_uid`,`record_status`,`position`);--> statement-breakpoint
INSERT INTO `trade_account_service_areas`
  (`id`,`firebase_uid`,`position`,`postcode`,`radius_km`,`record_status`,`created_at`,`updated_at`)
SELECT
  lower(hex(randomblob(16))),
  `firebase_uid`,
  1,
  CASE WHEN `service_base_postcode` != '' THEN `service_base_postcode` ELSE `postcode` END,
  `service_radius_km`,
  'active',
  CASE WHEN `settings_updated_at` != '' THEN `settings_updated_at` ELSE `created_at` END,
  CASE WHEN `settings_updated_at` != '' THEN `settings_updated_at` ELSE `updated_at` END
FROM `trade_accounts`
WHERE `partner_type` = 'installer'
  AND length(CASE WHEN `service_base_postcode` != '' THEN `service_base_postcode` ELSE `postcode` END) = 4;--> statement-breakpoint
CREATE TABLE `trade_account_closure_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`status` text DEFAULT 'closed' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`retention_notice_version` text NOT NULL,
	`requested_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`recovered_at` text DEFAULT '' NOT NULL,
	`recovered_by_uid` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_account_closure_requests_owner_closed_idx` ON `trade_account_closure_requests` (`firebase_uid`) WHERE `status` = 'closed';--> statement-breakpoint
CREATE INDEX `trade_account_closure_requests_owner_status_idx` ON `trade_account_closure_requests` (`firebase_uid`,`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `trade_account_closure_requests_status_idx` ON `trade_account_closure_requests` (`status`,`requested_at`);
