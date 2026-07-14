CREATE TABLE `trade_account_feature_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`feature_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`granted_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_account_feature_grants_owner_key_idx` ON `trade_account_feature_grants` (`firebase_uid`,`feature_key`);--> statement-breakpoint
CREATE INDEX `trade_account_feature_grants_owner_idx` ON `trade_account_feature_grants` (`firebase_uid`,`status`,`expires_at`);