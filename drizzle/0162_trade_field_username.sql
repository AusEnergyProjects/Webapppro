ALTER TABLE `trade_team_members` ADD COLUMN `field_username` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `field_username_normalized` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE UNIQUE INDEX `trade_team_members_owner_field_username_idx`
  ON `trade_team_members` (`owner_uid`,`field_username_normalized`)
  WHERE `field_username_normalized` <> '';
