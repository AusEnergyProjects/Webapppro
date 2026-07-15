CREATE TABLE `trade_team_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`team_member_id` text NOT NULL,
	`owner_uid` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_team_invites_token_idx` ON `trade_team_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `trade_team_invites_member_idx` ON `trade_team_invites` (`team_member_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `trade_team_invites_owner_idx` ON `trade_team_invites` (`owner_uid`,`expires_at`);--> statement-breakpoint
CREATE TABLE `trade_team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`member_uid` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'technician' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`invited_at` text NOT NULL,
	`accepted_at` text DEFAULT '' NOT NULL,
	`last_active_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_team_members_owner_email_idx` ON `trade_team_members` (`owner_uid`,`email`);--> statement-breakpoint
CREATE INDEX `trade_team_members_owner_member_idx` ON `trade_team_members` (`owner_uid`,`member_uid`);--> statement-breakpoint
CREATE INDEX `trade_team_members_member_status_idx` ON `trade_team_members` (`member_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_team_members_owner_status_idx` ON `trade_team_members` (`owner_uid`,`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `trade_work_orders` ADD `assignee_member_id` text DEFAULT '' NOT NULL;