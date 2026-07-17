ALTER TABLE `trade_installed_assets` ADD `crm_customer_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_installed_assets` ADD `service_site_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_installed_assets` ADD `source_type` text DEFAULT 'handover' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_installed_assets` ADD `source_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_installed_assets` ADD `review_status` text DEFAULT 'pending_review' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_installed_assets` ADD `asset_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_installed_assets` ADD `asset_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_installed_assets` ADD `commissioning_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `trade_installed_assets_customer_idx` ON `trade_installed_assets` (`firebase_uid`,`crm_customer_id`,`asset_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_installed_assets_site_idx` ON `trade_installed_assets` (`firebase_uid`,`service_site_id`,`asset_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_installed_assets_review_idx` ON `trade_installed_assets` (`firebase_uid`,`review_status`,`updated_at`);--> statement-breakpoint
UPDATE `trade_installed_assets`
SET `source_type` = 'handover',
    `source_reference` = `handover_pack_id`,
    `review_status` = 'pending_review',
    `asset_status` = 'active'
WHERE `record_status` = 'active';
