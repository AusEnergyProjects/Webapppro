ALTER TABLE `trade_accounts` ADD `verified_abn` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `verification_review_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `verification_reviewed_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `verification_reviewed_by_uid` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `trade_accounts_verified_access_idx` ON `trade_accounts` (`partner_type`,`account_status`,`verification_status`,`verified_abn`,`firebase_uid`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_accounts_verified_abn_unique_idx` ON `trade_accounts` (`verified_abn`) WHERE `verified_abn` <> '';--> statement-breakpoint
CREATE TABLE `trade_account_verification_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `firebase_uid` text NOT NULL,
  `abn` text NOT NULL,
  `business_name` text NOT NULL,
  `partner_type` text NOT NULL,
  `legal_entity_name` text NOT NULL,
  `decision` text NOT NULL,
  `review_method` text NOT NULL,
  `source_reference` text DEFAULT '' NOT NULL,
  `note` text NOT NULL,
  `reviewed_by_uid` text NOT NULL,
  `reviewed_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `trade_account_verification_reviews_owner_idx` ON `trade_account_verification_reviews` (`firebase_uid`,`reviewed_at`);--> statement-breakpoint
CREATE INDEX `trade_account_verification_reviews_reviewer_idx` ON `trade_account_verification_reviews` (`reviewed_by_uid`,`reviewed_at`);--> statement-breakpoint
CREATE TRIGGER `trade_account_verification_reviews_no_update`
BEFORE UPDATE ON `trade_account_verification_reviews`
BEGIN
  SELECT RAISE(ABORT, 'Trade account verification reviews are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `trade_account_verification_reviews_no_delete`
BEFORE DELETE ON `trade_account_verification_reviews`
BEGIN
  SELECT RAISE(ABORT, 'Trade account verification reviews are append-only');
END;
