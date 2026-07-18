CREATE TABLE `trade_crm_photo_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`name` text NOT NULL,
	`service_category` text DEFAULT 'other' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draft_requirements` text DEFAULT '[]' NOT NULL,
	`published_version` integer DEFAULT 0 NOT NULL,
	`created_by_uid` text NOT NULL,
	`updated_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_photo_templates_owner_status_idx` ON `trade_crm_photo_templates` (`firebase_uid`,`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `trade_crm_photo_templates_owner_service_idx` ON `trade_crm_photo_templates` (`firebase_uid`,`service_category`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `trade_crm_photo_template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`service_category` text NOT NULL,
	`requirements` text NOT NULL,
	`requirement_count` integer NOT NULL,
	`published_by_uid` text NOT NULL,
	`published_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_photo_template_versions_template_version_idx` ON `trade_crm_photo_template_versions` (`template_id`,`version`);
--> statement-breakpoint
CREATE INDEX `trade_crm_photo_template_versions_owner_idx` ON `trade_crm_photo_template_versions` (`firebase_uid`,`template_id`,`published_at`);
--> statement-breakpoint
ALTER TABLE `trade_crm_photo_requests` ADD `source_template_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_photo_requests` ADD `source_template_version_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_photo_requests` ADD `source_template_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_photo_requests` ADD `source_template_edited` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_photo_requests` ADD `template_feedback` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_photo_requests` ADD `template_missing_feedback` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `trade_crm_photo_requests_template_version_idx` ON `trade_crm_photo_requests` (`firebase_uid`,`source_template_version_id`,`created_at`);
