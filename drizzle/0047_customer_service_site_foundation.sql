CREATE TABLE `trade_crm_customer_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`customer_id` text NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`role_label` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_customer_contacts_owner_customer_idx` ON `trade_crm_customer_contacts` (`firebase_uid`,`customer_id`,`record_status`);--> statement-breakpoint
CREATE INDEX `trade_crm_customer_contacts_owner_email_idx` ON `trade_crm_customer_contacts` (`firebase_uid`,`email`);--> statement-breakpoint
CREATE INDEX `trade_crm_customer_contacts_owner_phone_idx` ON `trade_crm_customer_contacts` (`firebase_uid`,`phone`);--> statement-breakpoint
CREATE TABLE `trade_crm_service_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`customer_id` text NOT NULL,
	`site_label` text DEFAULT 'Primary site' NOT NULL,
	`address_line_1` text DEFAULT '' NOT NULL,
	`address_line_2` text DEFAULT '' NOT NULL,
	`suburb` text DEFAULT '' NOT NULL,
	`address_state` text DEFAULT '' NOT NULL,
	`postcode` text DEFAULT '' NOT NULL,
	`access_instructions` text DEFAULT '' NOT NULL,
	`parking_instructions` text DEFAULT '' NOT NULL,
	`hazard_notes` text DEFAULT '' NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_service_sites_owner_customer_idx` ON `trade_crm_service_sites` (`firebase_uid`,`customer_id`,`record_status`);--> statement-breakpoint
CREATE INDEX `trade_crm_service_sites_owner_postcode_idx` ON `trade_crm_service_sites` (`firebase_uid`,`postcode`);--> statement-breakpoint
CREATE TABLE `trade_crm_site_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`service_site_id` text NOT NULL,
	`customer_contact_id` text NOT NULL,
	`role_label` text DEFAULT 'Service contact' NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_site_contacts_owner_site_contact_idx` ON `trade_crm_site_contacts` (`firebase_uid`,`service_site_id`,`customer_contact_id`);--> statement-breakpoint
CREATE INDEX `trade_crm_site_contacts_owner_contact_idx` ON `trade_crm_site_contacts` (`firebase_uid`,`customer_contact_id`,`record_status`);--> statement-breakpoint
ALTER TABLE `trade_crm_job_details` ADD `service_site_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
INSERT INTO `trade_crm_customer_contacts`
  (`id`, `firebase_uid`, `customer_id`, `first_name`, `last_name`, `role_label`, `email`, `phone`, `is_primary`, `record_status`, `created_at`, `updated_at`)
SELECT 'legacy-contact-' || `id`, `firebase_uid`, `id`, `first_name`, `last_name`, 'Primary contact', `email`, `phone`, 1, 'active', `created_at`, `updated_at`
FROM `trade_crm_customers`
WHERE `record_status` = 'active';
--> statement-breakpoint
INSERT INTO `trade_crm_service_sites`
  (`id`, `firebase_uid`, `customer_id`, `site_label`, `address_line_1`, `address_line_2`, `suburb`, `address_state`, `postcode`, `access_instructions`, `parking_instructions`, `hazard_notes`, `is_primary`, `record_status`, `created_at`, `updated_at`)
SELECT 'legacy-site-' || `id`, `firebase_uid`, `id`, 'Primary site', `address_line_1`, `address_line_2`, `suburb`, `address_state`, `postcode`, '', '', '', 1, 'active', `created_at`, `updated_at`
FROM `trade_crm_customers`
WHERE `record_status` = 'active';
--> statement-breakpoint
INSERT INTO `trade_crm_site_contacts`
  (`id`, `firebase_uid`, `service_site_id`, `customer_contact_id`, `role_label`, `is_primary`, `record_status`, `created_at`, `updated_at`)
SELECT 'legacy-site-contact-' || `id`, `firebase_uid`, 'legacy-site-' || `id`, 'legacy-contact-' || `id`, 'Primary service contact', 1, 'active', `created_at`, `updated_at`
FROM `trade_crm_customers`
WHERE `record_status` = 'active';
--> statement-breakpoint
UPDATE `trade_crm_job_details`
SET `service_site_id` = 'legacy-site-' || `crm_customer_id`
WHERE `customer_source` = 'trade_owned' AND `crm_customer_id` <> '';
