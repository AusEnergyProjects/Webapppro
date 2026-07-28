DROP INDEX `trade_accounts_eligibility_idx`;--> statement-breakpoint
DROP INDEX `trade_accounts_verified_access_idx`;--> statement-breakpoint
ALTER TABLE `trade_accounts` DROP COLUMN `plan_key`;--> statement-breakpoint
ALTER TABLE `trade_accounts` DROP COLUMN `billing_status`;--> statement-breakpoint
CREATE INDEX `trade_accounts_eligibility_idx` ON `trade_accounts` (`partner_type`,`account_status`,`verification_status`,`verified_abn`,`firebase_uid`);--> statement-breakpoint
DELETE FROM `trade_crm_oauth_states` WHERE `provider` IN ('stripe','square');--> statement-breakpoint
DELETE FROM `trade_crm_integrations` WHERE `provider` IN ('stripe','square');--> statement-breakpoint
DROP TABLE `trade_crm_invoice_payment_allocations`;--> statement-breakpoint
DROP TABLE `trade_crm_payment_events`;--> statement-breakpoint
DROP TABLE `trade_crm_payment_links`;--> statement-breakpoint
DROP TABLE `trade_account_feature_grants`;--> statement-breakpoint
DROP TABLE `trade_membership_credits`;--> statement-breakpoint
DROP TABLE `trade_referrals`;--> statement-breakpoint
DROP TABLE `trade_referral_codes`;--> statement-breakpoint
DROP TABLE `stripe_memberships`;--> statement-breakpoint
DROP TABLE `stripe_webhook_events`;
