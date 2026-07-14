CREATE TABLE `supplier_product_links` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`product_id` text NOT NULL,
	`linked_product_id` text NOT NULL,
	`relationship` text DEFAULT 'recommended' NOT NULL,
	`default_qty` integer DEFAULT 1 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_product_links_unique_idx` ON `supplier_product_links` (`product_id`,`linked_product_id`,`relationship`);--> statement-breakpoint
CREATE INDEX `supplier_product_links_owner_idx` ON `supplier_product_links` (`firebase_uid`);--> statement-breakpoint
CREATE INDEX `supplier_product_links_product_idx` ON `supplier_product_links` (`product_id`);--> statement-breakpoint
CREATE TABLE `supplier_products` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`model_number` text NOT NULL,
	`brand` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`unit_price_cents_ex_gst` integer NOT NULL,
	`min_order_qty` integer DEFAULT 1 NOT NULL,
	`order_increment` integer DEFAULT 1 NOT NULL,
	`unit_label` text DEFAULT 'each' NOT NULL,
	`stock_status` text DEFAULT 'order_in' NOT NULL,
	`lead_time_days` integer DEFAULT 0 NOT NULL,
	`warranty_years` integer DEFAULT 0 NOT NULL,
	`datasheet_url` text DEFAULT '' NOT NULL,
	`listing_status` text DEFAULT 'draft' NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_products_owner_model_idx` ON `supplier_products` (`firebase_uid`,`model_number`);--> statement-breakpoint
CREATE INDEX `supplier_products_owner_idx` ON `supplier_products` (`firebase_uid`,`updated_at`);--> statement-breakpoint
CREATE INDEX `supplier_products_listing_idx` ON `supplier_products` (`listing_status`,`review_status`);--> statement-breakpoint
CREATE INDEX `supplier_products_category_idx` ON `supplier_products` (`category`);--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `service_base_postcode` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `service_radius_km` integer DEFAULT 50 NOT NULL;--> statement-breakpoint
UPDATE `trade_accounts` SET `service_base_postcode` = `postcode` WHERE `service_base_postcode` = '';--> statement-breakpoint
ALTER TABLE `trade_opportunities` ADD `source_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunities` ADD `contact_limit` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunities` ADD `maximum_connected_installers` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunities` ADD `expires_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunities` ADD `expired_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `trade_opportunities` SET `expires_at` = datetime(`created_at`, '+30 days') WHERE `expires_at` = '';--> statement-breakpoint
ALTER TABLE `trade_opportunity_matches` ADD `matched_categories` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunity_matches` ADD `distance_metres` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunity_matches` ADD `allocation_rank` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunity_matches` ADD `match_source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunity_matches` ADD `contact_attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunity_matches` ADD `last_contact_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunity_matches` ADD `connected_at` text DEFAULT '' NOT NULL;
