CREATE TABLE creditex_notification_receipts (
  organisation_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  event_key TEXT NOT NULL CHECK(length(event_key) BETWEEN 1 AND 1200),
  read_at TEXT NOT NULL DEFAULT '',
  dismissed_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(organisation_id,member_id,event_key),
  CHECK(read_at<>'' OR dismissed_at<>'')
);
--> statement-breakpoint
CREATE INDEX creditex_notification_receipts_member ON creditex_notification_receipts(member_id,organisation_id);
