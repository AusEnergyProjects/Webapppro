ALTER TABLE trade_team_members ADD COLUMN can_send_sms INTEGER NOT NULL DEFAULT 0 CHECK (can_send_sms IN (0, 1));
--> statement-breakpoint
ALTER TABLE trade_sms_messages ADD COLUMN work_order_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE trade_sms_messages ADD COLUMN actor_uid TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE trade_sms_messages ADD COLUMN actor_name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX trade_sms_messages_job_idx ON trade_sms_messages(firebase_uid, work_order_id, created_at);
