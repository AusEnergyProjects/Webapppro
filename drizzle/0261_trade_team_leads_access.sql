ALTER TABLE `trade_team_members` ADD `can_view_leads` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD `can_manage_leads` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Preserve the existing full office administrator grant, never a role label or crew grant.
UPDATE `trade_team_members` SET `can_view_leads` = 1, `can_manage_leads` = 1,
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `member_uid` = `owner_uid` OR (
  `status` IN ('active', 'invited')
  AND `can_manage_team` = 1 AND `can_edit_team_permissions` = 1
  AND `job_scope` = 'team' AND `schedule_scope` = 'team'
  AND `can_manage_jobs` = 1 AND `can_view_customers` = 1
  AND `can_view_quotes` = 1 AND `can_manage_quotes` = 1
  AND NOT EXISTS (SELECT 1 FROM `trade_crew_members` crew
    WHERE crew.owner_uid = trade_team_members.owner_uid AND crew.member_id = trade_team_members.id)
);
--> statement-breakpoint
ALTER TABLE `public_trade_lead_quote_photo_events` ADD `actor_uid` text NOT NULL DEFAULT '';

--> statement-breakpoint
ALTER TABLE `trade_work_order_events` ADD `actor_uid` text NOT NULL DEFAULT '';
