CREATE TABLE `trade_compliance_items` (
	`id` text PRIMARY KEY NOT NULL,
	`handover_pack_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`template_key` text NOT NULL,
	`label` text NOT NULL,
	`guidance` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_compliance_items_pack_key_idx` ON `trade_compliance_items` (`handover_pack_id`,`template_key`);--> statement-breakpoint
CREATE INDEX `trade_compliance_items_owner_idx` ON `trade_compliance_items` (`firebase_uid`,`work_order_id`,`status`);--> statement-breakpoint
CREATE TABLE `trade_handover_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`handover_pack_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`category` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`customer_visible` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_handover_documents_object_key_unique` ON `trade_handover_documents` (`object_key`);--> statement-breakpoint
CREATE INDEX `trade_handover_documents_pack_idx` ON `trade_handover_documents` (`handover_pack_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_handover_documents_owner_idx` ON `trade_handover_documents` (`firebase_uid`,`work_order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_handover_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`customer_project_id` text DEFAULT '' NOT NULL,
	`service_category` text DEFAULT 'other' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` text DEFAULT '' NOT NULL,
	`published_at` text DEFAULT '' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_by_uid` text DEFAULT '' NOT NULL,
	`reviewed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_handover_packs_work_order_idx` ON `trade_handover_packs` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `trade_handover_packs_owner_idx` ON `trade_handover_packs` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_handover_packs_customer_project_idx` ON `trade_handover_packs` (`customer_project_id`,`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `trade_installed_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`handover_pack_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`asset_category` text NOT NULL,
	`brand` text NOT NULL,
	`model_number` text NOT NULL,
	`serial_number` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`installed_at` text DEFAULT '' NOT NULL,
	`warranty_provider` text DEFAULT '' NOT NULL,
	`warranty_reference` text DEFAULT '' NOT NULL,
	`warranty_start` text DEFAULT '' NOT NULL,
	`warranty_end` text DEFAULT '' NOT NULL,
	`supplier_product_id` text DEFAULT '' NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_installed_assets_pack_idx` ON `trade_installed_assets` (`handover_pack_id`,`record_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_installed_assets_owner_idx` ON `trade_installed_assets` (`firebase_uid`,`work_order_id`,`record_status`);--> statement-breakpoint
CREATE INDEX `trade_installed_assets_warranty_idx` ON `trade_installed_assets` (`firebase_uid`,`warranty_end`);