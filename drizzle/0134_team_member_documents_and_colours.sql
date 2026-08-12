ALTER TABLE `trade_team_members` ADD COLUMN `schedule_colour` text NOT NULL DEFAULT 'emerald'
  CHECK (`schedule_colour` IN ('emerald', 'teal', 'blue', 'violet', 'amber', 'rose'));
--> statement-breakpoint
UPDATE `trade_team_members`
SET `schedule_colour` = CASE (rowid % 6)
  WHEN 0 THEN 'emerald'
  WHEN 1 THEN 'teal'
  WHEN 2 THEN 'blue'
  WHEN 3 THEN 'violet'
  WHEN 4 THEN 'amber'
  ELSE 'rose'
END;
--> statement-breakpoint
ALTER TABLE `trade_team_member_files` ADD COLUMN `title` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `trade_team_member_files` ADD COLUMN `expires_at` text NOT NULL DEFAULT ''
  CHECK (`expires_at` = '' OR (date(`expires_at`) = `expires_at` AND length(`expires_at`) = 10));
--> statement-breakpoint
UPDATE `trade_team_member_files`
SET `title` = CASE
  WHEN trim(`description`) <> '' THEN trim(`description`)
  ELSE `file_name`
END
WHERE `title` = '';
--> statement-breakpoint
CREATE INDEX `trade_team_member_files_expiry_idx`
  ON `trade_team_member_files` (`status`, `expires_at`, `owner_uid`, `team_member_id`);
