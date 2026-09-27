CREATE TABLE trade_email_connections (
  owner_uid TEXT PRIMARY KEY NOT NULL,
  id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('connected', 'reconnect_required', 'disconnected')),
  refresh_lock TEXT NOT NULL DEFAULT '',
  refresh_lock_until TEXT NOT NULL DEFAULT '',
  last_test_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE trade_email_oauth_states (
  owner_uid TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  state_hash TEXT NOT NULL UNIQUE,
  browser_hash TEXT NOT NULL,
  encrypted_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE trade_email_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'resend')),
  status TEXT NOT NULL CHECK (status IN ('sending', 'accepted', 'failed', 'uncertain')),
  provider_message_id TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  retry_after TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_uid, request_key)
);
--> statement-breakpoint
CREATE INDEX trade_email_submissions_owner_created ON trade_email_submissions(owner_uid, created_at);
