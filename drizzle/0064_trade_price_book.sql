CREATE TABLE `trade_price_book_items` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`item_code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`item_type` text NOT NULL,
	`unit_label` text DEFAULT 'each' NOT NULL,
	`supplier_cost_cents_ex_gst` integer DEFAULT 0 NOT NULL,
	`sell_price_cents_ex_gst` integer NOT NULL,
	`tax_code` text DEFAULT 'gst' NOT NULL,
	`markup_basis_points` integer DEFAULT 0 NOT NULL,
	`margin_basis_points` integer DEFAULT 0 NOT NULL,
	`expected_duration_minutes` integer DEFAULT 0 NOT NULL,
	`required_skill` text DEFAULT '' NOT NULL,
	`supplier_name` text DEFAULT '' NOT NULL,
	`supplier_sku` text DEFAULT '' NOT NULL,
	`supplier_product_id` text DEFAULT '' NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`price_revision` integer DEFAULT 1 NOT NULL,
	`created_by_uid` text NOT NULL,
	`updated_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_price_book_items_owner_code_idx` ON `trade_price_book_items` (`firebase_uid`,`item_code`);--> statement-breakpoint
CREATE INDEX `trade_price_book_items_owner_status_name_idx` ON `trade_price_book_items` (`firebase_uid`,`record_status`,`name`);--> statement-breakpoint
CREATE INDEX `trade_price_book_items_owner_type_idx` ON `trade_price_book_items` (`firebase_uid`,`record_status`,`item_type`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_price_book_items_supplier_product_idx` ON `trade_price_book_items` (`supplier_product_id`,`record_status`);--> statement-breakpoint
CREATE TABLE `trade_price_book_price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`price_book_item_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`price_revision` integer NOT NULL,
	`supplier_cost_cents_ex_gst` integer NOT NULL,
	`sell_price_cents_ex_gst` integer NOT NULL,
	`tax_code` text NOT NULL,
	`markup_basis_points` integer NOT NULL,
	`margin_basis_points` integer NOT NULL,
	`change_type` text NOT NULL,
	`changed_by_uid` text NOT NULL,
	`changed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_price_book_price_history_revision_idx` ON `trade_price_book_price_history` (`price_book_item_id`,`price_revision`);--> statement-breakpoint
CREATE INDEX `trade_price_book_price_history_owner_changed_idx` ON `trade_price_book_price_history` (`firebase_uid`,`changed_at`);--> statement-breakpoint
ALTER TABLE `trade_crm_quote_items` ADD `price_book_item_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_items` ADD `price_book_item_type` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_items` ADD `unit_cost_cents_ex_gst` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_items` ADD `markup_basis_points` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_quote_items` ADD `margin_basis_points` integer DEFAULT 0 NOT NULL;
