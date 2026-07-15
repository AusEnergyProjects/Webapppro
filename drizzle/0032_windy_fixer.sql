ALTER TABLE `customer_accounts` ADD `is_synthetic` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_projects` ADD `is_synthetic` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `supplier_products` ADD `is_synthetic` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `is_synthetic` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_opportunities` ADD `is_synthetic` integer DEFAULT false NOT NULL;