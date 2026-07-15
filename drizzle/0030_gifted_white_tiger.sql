CREATE TABLE `trade_form_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`template_key` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`jurisdiction` text DEFAULT 'AU' NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`guidance` text DEFAULT '' NOT NULL,
	`fields` text DEFAULT '[]' NOT NULL,
	`source_notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by_uid` text NOT NULL,
	`published_by_uid` text DEFAULT '' NOT NULL,
	`published_at` text DEFAULT '' NOT NULL,
	`withdrawn_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_form_templates_key_version_idx` ON `trade_form_templates` (`template_key`,`version`);--> statement-breakpoint
CREATE INDEX `trade_form_templates_status_idx` ON `trade_form_templates` (`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `trade_job_forms` ADD `revision` integer DEFAULT 1 NOT NULL;