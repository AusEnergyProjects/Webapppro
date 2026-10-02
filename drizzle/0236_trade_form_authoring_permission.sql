ALTER TABLE trade_team_members ADD COLUMN can_manage_forms INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_forms IN (0, 1));
--> statement-breakpoint
UPDATE trade_team_members SET can_manage_forms = 1 WHERE member_uid = owner_uid;
