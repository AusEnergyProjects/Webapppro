DROP INDEX `trade_team_members_owner_email_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_team_members_owner_email_idx` ON `trade_team_members` (`owner_uid`,`email`) WHERE `email` <> '';
--> statement-breakpoint
UPDATE `trade_team_members` SET `status` = 'active' WHERE `status` = 'invited';
