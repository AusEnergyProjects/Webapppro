CREATE TABLE trade_push_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES trade_team_members(id),
  actor_uid TEXT NOT NULL,
  field_session_id TEXT NOT NULL DEFAULT '',
  endpoint_hash TEXT NOT NULL UNIQUE CHECK (length(endpoint_hash)=64),
  endpoint TEXT NOT NULL CHECK (length(endpoint) BETWEEN 20 AND 2048),
  p256dh TEXT NOT NULL CHECK (length(p256dh)=87),
  auth TEXT NOT NULL CHECK (length(auth)=22),
  messages INTEGER NOT NULL DEFAULT 1 CHECK (messages IN (0,1)),
  calls INTEGER NOT NULL DEFAULT 1 CHECK (calls IN (0,1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX trade_push_subscriptions_member_idx ON trade_push_subscriptions(owner_uid,member_id,enabled,expires_at);
--> statement-breakpoint
CREATE TABLE trade_push_deliveries (
  event_kind TEXT NOT NULL CHECK (event_kind IN ('team-message','team-call')),
  event_id TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL CHECK (length(endpoint_hash)=64),
  owner_uid TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'attempted' CHECK (status IN ('attempted','accepted','failed','expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_kind,event_id,endpoint_hash)
);
--> statement-breakpoint
CREATE INDEX trade_push_deliveries_owner_created_idx ON trade_push_deliveries(owner_uid,created_at);
