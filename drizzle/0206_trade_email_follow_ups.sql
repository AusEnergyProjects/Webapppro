CREATE TABLE trade_email_templates (
  owner_uid TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('general','quote','invoice','appointment','appointment_after')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_uid,id)
);
CREATE TABLE trade_follow_up_settings (
  owner_uid TEXT PRIMARY KEY NOT NULL,
  settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
  invoice_enabled_at TEXT NOT NULL DEFAULT '',
  appointment_enabled_at TEXT NOT NULL DEFAULT '',
  next_scan_at TEXT NOT NULL DEFAULT '',
  scan_cursor TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX trade_follow_up_settings_scan_idx ON trade_follow_up_settings(next_scan_at);
CREATE TABLE trade_follow_up_messages (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  automatic INTEGER NOT NULL DEFAULT 0 CHECK(automatic IN (0,1)),
  context_hash TEXT NOT NULL,
  context_json TEXT NOT NULL CHECK(json_valid(context_json)),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','accepted','failed','uncertain','cancelled')),
  error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX trade_follow_up_messages_event_idx ON trade_follow_up_messages(owner_uid,event_key);
CREATE INDEX trade_follow_up_messages_due_idx ON trade_follow_up_messages(status,next_attempt_at);
CREATE INDEX trade_follow_up_messages_job_idx ON trade_follow_up_messages(owner_uid,work_order_id,created_at);
