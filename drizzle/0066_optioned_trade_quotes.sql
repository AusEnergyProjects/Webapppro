CREATE TABLE `trade_crm_quote_choices` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_version_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`position` integer NOT NULL,
	`choice_key` text NOT NULL,
	`choice_kind` text NOT NULL,
	`group_key` text NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`recommended` integer DEFAULT false NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quote_choices_version_key_idx` ON `trade_crm_quote_choices` (`quote_version_id`,`choice_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_quote_choices_version_position_idx` ON `trade_crm_quote_choices` (`quote_version_id`,`position`);--> statement-breakpoint
CREATE INDEX `trade_crm_quote_choices_owner_version_idx` ON `trade_crm_quote_choices` (`firebase_uid`,`quote_version_id`);--> statement-breakpoint
ALTER TABLE `trade_crm_quote_items` ADD `section_heading` text DEFAULT 'Included work' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_items` ADD `quote_choice_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `selected_choice_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `selected_subtotal_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `selected_tax_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `selected_total_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_acceptances` ADD `selection_summary` text DEFAULT '' NOT NULL;
