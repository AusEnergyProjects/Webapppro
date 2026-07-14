ALTER TABLE `trade_accounts` ADD `availability_status` text DEFAULT 'paused' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `email_opportunities` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `email_weekly_summary` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `settings_updated_at` text DEFAULT '' NOT NULL;