CREATE TABLE `installer_product_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`product_id` text NOT NULL,
	`supplier_uid` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_cents_ex_gst` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installer_product_list_items_unique_idx` ON `installer_product_list_items` (`list_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `installer_product_list_items_list_idx` ON `installer_product_list_items` (`list_id`);--> statement-breakpoint
CREATE INDEX `installer_product_list_items_supplier_idx` ON `installer_product_list_items` (`supplier_uid`,`updated_at`);--> statement-breakpoint
CREATE TABLE `installer_product_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`name` text NOT NULL,
	`project_postcode` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `installer_product_lists_owner_idx` ON `installer_product_lists` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `supplier_product_enquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`installer_uid` text NOT NULL,
	`supplier_uid` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`supplier_note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_product_enquiries_list_supplier_idx` ON `supplier_product_enquiries` (`list_id`,`supplier_uid`);--> statement-breakpoint
CREATE INDEX `supplier_product_enquiries_supplier_idx` ON `supplier_product_enquiries` (`supplier_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `supplier_product_enquiries_installer_idx` ON `supplier_product_enquiries` (`installer_uid`,`updated_at`);