CREATE TABLE `stripe_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`partner_type` text NOT NULL,
	`plan_key` text NOT NULL,
	`payment_link_id` text NOT NULL,
	`stripe_customer_id` text DEFAULT '' NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`status` text NOT NULL,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`current_period_end` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_memberships_subscription_idx` ON `stripe_memberships` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `stripe_memberships_owner_idx` ON `stripe_memberships` (`firebase_uid`,`updated_at`);--> statement-breakpoint
CREATE TABLE `stripe_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stripe_webhook_events_created_idx` ON `stripe_webhook_events` (`created_at`);