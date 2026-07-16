CREATE INDEX `supplier_products_marketplace_name_idx` ON `supplier_products` (`listing_status`,`review_status`,`name`);--> statement-breakpoint
CREATE INDEX `supplier_products_marketplace_brand_idx` ON `supplier_products` (`listing_status`,`review_status`,`brand`,`name`);--> statement-breakpoint
CREATE INDEX `supplier_products_marketplace_price_idx` ON `supplier_products` (`listing_status`,`review_status`,`unit_price_cents_ex_gst`,`name`);--> statement-breakpoint
CREATE INDEX `supplier_products_marketplace_lead_idx` ON `supplier_products` (`listing_status`,`review_status`,`lead_time_days`,`name`);--> statement-breakpoint
CREATE INDEX `supplier_products_marketplace_filter_idx` ON `supplier_products` (`listing_status`,`review_status`,`category`,`stock_status`);