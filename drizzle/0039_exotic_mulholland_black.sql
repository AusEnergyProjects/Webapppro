CREATE TABLE `installer_catalogue_preferences` (
	`firebase_uid` text PRIMARY KEY NOT NULL,
	`search` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`supplier_uid` text DEFAULT '' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`service_state` text DEFAULT '' NOT NULL,
	`stock_status` text DEFAULT '' NOT NULL,
	`minimum_price_cents` integer DEFAULT 0 NOT NULL,
	`maximum_price_cents` integer DEFAULT 0 NOT NULL,
	`maximum_lead_days` integer DEFAULT -1 NOT NULL,
	`minimum_warranty_years` integer DEFAULT 0 NOT NULL,
	`sort_key` text DEFAULT 'name-asc' NOT NULL,
	`page_size` integer DEFAULT 25 NOT NULL,
	`visible_columns` text DEFAULT '["category","price","supply","kit","actions"]' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `installer_catalogue_preferences_updated_idx` ON `installer_catalogue_preferences` (`updated_at`);