CREATE TABLE `trade_purchase_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_uid` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_purchase_order_events_order_idx` ON `trade_purchase_order_events` (`purchase_order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_purchase_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_id` text NOT NULL,
	`supplier_product_id` text NOT NULL,
	`model_number` text NOT NULL,
	`brand` text NOT NULL,
	`product_name` text NOT NULL,
	`unit_label` text DEFAULT 'each' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`fulfilled_quantity` integer DEFAULT 0 NOT NULL,
	`unit_price_cents_ex_gst` integer NOT NULL,
	`warranty_years` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_purchase_order_items_product_idx` ON `trade_purchase_order_items` (`purchase_order_id`,`supplier_product_id`);--> statement-breakpoint
CREATE INDEX `trade_purchase_order_items_order_idx` ON `trade_purchase_order_items` (`purchase_order_id`);--> statement-breakpoint
CREATE TABLE `trade_purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`enquiry_id` text NOT NULL,
	`list_id` text NOT NULL,
	`installer_uid` text NOT NULL,
	`supplier_uid` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`installer_reference` text DEFAULT '' NOT NULL,
	`supplier_reference` text DEFAULT '' NOT NULL,
	`delivery_method` text DEFAULT 'confirm_with_supplier' NOT NULL,
	`delivery_notes` text DEFAULT '' NOT NULL,
	`supplier_note` text DEFAULT '' NOT NULL,
	`expected_at` text DEFAULT '' NOT NULL,
	`subtotal_cents_ex_gst` integer DEFAULT 0 NOT NULL,
	`gst_cents` integer DEFAULT 0 NOT NULL,
	`total_cents_inc_gst` integer DEFAULT 0 NOT NULL,
	`submitted_at` text NOT NULL,
	`confirmed_at` text DEFAULT '' NOT NULL,
	`fulfilled_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_purchase_orders_number_idx` ON `trade_purchase_orders` (`order_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_purchase_orders_enquiry_idx` ON `trade_purchase_orders` (`enquiry_id`);--> statement-breakpoint
CREATE INDEX `trade_purchase_orders_installer_idx` ON `trade_purchase_orders` (`installer_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_purchase_orders_supplier_idx` ON `trade_purchase_orders` (`supplier_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_warranty_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_number` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`purchase_order_item_id` text NOT NULL,
	`installer_uid` text NOT NULL,
	`supplier_uid` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`issue_category` text NOT NULL,
	`summary` text NOT NULL,
	`serial_number` text DEFAULT '' NOT NULL,
	`supplier_response` text DEFAULT '' NOT NULL,
	`resolution` text DEFAULT '' NOT NULL,
	`submitted_at` text NOT NULL,
	`resolved_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_warranty_claims_number_idx` ON `trade_warranty_claims` (`claim_number`);--> statement-breakpoint
CREATE INDEX `trade_warranty_claims_installer_idx` ON `trade_warranty_claims` (`installer_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_warranty_claims_supplier_idx` ON `trade_warranty_claims` (`supplier_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_warranty_claims_order_idx` ON `trade_warranty_claims` (`purchase_order_id`,`updated_at`);