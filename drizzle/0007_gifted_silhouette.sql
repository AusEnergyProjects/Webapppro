CREATE TABLE `trade_membership_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`referral_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`beneficiary_role` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`extension_start` integer DEFAULT 0 NOT NULL,
	`extension_end` integer DEFAULT 0 NOT NULL,
	`stripe_request_id` text DEFAULT '' NOT NULL,
	`failure_code` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_membership_credits_beneficiary_idx` ON `trade_membership_credits` (`referral_id`,`firebase_uid`);--> statement-breakpoint
CREATE INDEX `trade_membership_credits_owner_idx` ON `trade_membership_credits` (`firebase_uid`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_membership_credits_status_idx` ON `trade_membership_credits` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_referral_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_referral_codes_owner_idx` ON `trade_referral_codes` (`firebase_uid`);--> statement-breakpoint
CREATE INDEX `trade_referral_codes_status_idx` ON `trade_referral_codes` (`status`);--> statement-breakpoint
CREATE TABLE `trade_referrals` (
	`id` text PRIMARY KEY NOT NULL,
	`referral_code` text NOT NULL,
	`referrer_uid` text NOT NULL,
	`referred_uid` text NOT NULL,
	`status` text DEFAULT 'registered' NOT NULL,
	`risk_reason` text DEFAULT '' NOT NULL,
	`referred_subscription_id` text DEFAULT '' NOT NULL,
	`registered_at` text NOT NULL,
	`first_paid_at` text DEFAULT '' NOT NULL,
	`rewarded_at` text DEFAULT '' NOT NULL,
	`reviewed_by_uid` text DEFAULT '' NOT NULL,
	`reviewed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_referrals_referred_idx` ON `trade_referrals` (`referred_uid`);--> statement-breakpoint
CREATE INDEX `trade_referrals_referrer_idx` ON `trade_referrals` (`referrer_uid`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_referrals_code_idx` ON `trade_referrals` (`referral_code`);--> statement-breakpoint
CREATE INDEX `trade_referrals_status_idx` ON `trade_referrals` (`status`,`updated_at`);