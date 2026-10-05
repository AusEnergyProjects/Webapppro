ALTER TABLE admin_notifications ADD COLUMN binned_at TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE admin_notifications ADD COLUMN binned_by_uid TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX admin_notifications_bin_idx ON admin_notifications (binned_at, status, created_at);
