ALTER TABLE trade_team_members ADD COLUMN can_receive_customer_qa_notifications INTEGER NOT NULL DEFAULT 0
  CHECK (can_receive_customer_qa_notifications IN (0, 1));
--> statement-breakpoint
UPDATE trade_team_members SET can_receive_customer_qa_notifications = 1
WHERE member_uid = owner_uid AND member_uid <> '';
