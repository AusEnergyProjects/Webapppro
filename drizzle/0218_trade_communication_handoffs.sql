CREATE TABLE trade_communication_handoffs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  member_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  session_hash TEXT NOT NULL DEFAULT '',
  encrypted_auth TEXT NOT NULL,
  thread_id TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  redeem_before TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX trade_communication_handoffs_expiry_idx ON trade_communication_handoffs(expires_at);
--> statement-breakpoint
CREATE INDEX trade_communication_handoffs_member_idx ON trade_communication_handoffs(owner_uid, member_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_communication_handoffs_session_idx ON trade_communication_handoffs(session_hash) WHERE session_hash <> '';
