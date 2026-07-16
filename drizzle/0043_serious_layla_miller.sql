DROP INDEX `supplier_products_marketplace_name_idx`;--> statement-breakpoint
DROP INDEX `supplier_products_marketplace_brand_idx`;--> statement-breakpoint
DROP INDEX `supplier_products_marketplace_price_idx`;--> statement-breakpoint
DROP INDEX `supplier_products_marketplace_lead_idx`;--> statement-breakpoint
DROP INDEX `supplier_products_marketplace_filter_idx`;--> statement-breakpoint
CREATE INDEX `supplier_products_marketplace_model_idx` ON `supplier_products` (`listing_status`,`review_status`,"model_number" COLLATE NOCASE,"name" COLLATE NOCASE,`id`);--> statement-breakpoint
CREATE INDEX `supplier_products_marketplace_name_idx` ON `supplier_products` (`listing_status`,`review_status`,"name" COLLATE NOCASE,"brand" COLLATE NOCASE,"model_number" COLLATE NOCASE,`id`);--> statement-breakpoint
CREATE INDEX `supplier_products_marketplace_brand_idx` ON `supplier_products` (`listing_status`,`review_status`,"brand" COLLATE NOCASE,"name" COLLATE NOCASE,"model_number" COLLATE NOCASE,`id`);--> statement-breakpoint
CREATE INDEX `supplier_products_marketplace_price_idx` ON `supplier_products` (`listing_status`,`review_status`,`unit_price_cents_ex_gst`,"name" COLLATE NOCASE,`id`);--> statement-breakpoint
CREATE INDEX `supplier_products_marketplace_lead_idx` ON `supplier_products` (`listing_status`,`review_status`,`lead_time_days`,"name" COLLATE NOCASE,`id`);--> statement-breakpoint
CREATE INDEX `supplier_products_marketplace_filter_idx` ON `supplier_products` (`listing_status`,`review_status`,`category`,`stock_status`,`unit_price_cents_ex_gst`,`id`);--> statement-breakpoint
DROP INDEX `trade_opportunities_status_idx`;--> statement-breakpoint
DROP INDEX `trade_opportunities_state_idx`;--> statement-breakpoint
CREATE INDEX `trade_opportunities_title_nocase_idx` ON `trade_opportunities` ("title" COLLATE NOCASE,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `trade_opportunities_expiry_idx` ON `trade_opportunities` (`status`,`expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `trade_opportunities_status_idx` ON `trade_opportunities` (`status`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `trade_opportunities_state_idx` ON `trade_opportunities` (`state`,`status`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `trade_accounts_eligibility_idx` ON `trade_accounts` (`partner_type`,`account_status`,`verification_status`,`billing_status`,`firebase_uid`);--> statement-breakpoint
CREATE INDEX `trade_accounts_admin_type_updated_idx` ON `trade_accounts` (`partner_type`,`updated_at`,`firebase_uid`);--> statement-breakpoint
CREATE INDEX `trade_accounts_admin_status_updated_idx` ON `trade_accounts` (`account_status`,`updated_at`,`firebase_uid`);--> statement-breakpoint
CREATE INDEX `trade_accounts_admin_verification_updated_idx` ON `trade_accounts` (`verification_status`,`updated_at`,`firebase_uid`);--> statement-breakpoint
CREATE INDEX `trade_accounts_business_nocase_idx` ON `trade_accounts` ("business_name" COLLATE NOCASE,`firebase_uid`);