CREATE TABLE trade_message_threads (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('dm', 'group')),
  subject TEXT NOT NULL DEFAULT '',
  dm_key TEXT NOT NULL DEFAULT '',
  created_by_member_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  creation_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_message_threads_dm_idx ON trade_message_threads(owner_uid, dm_key) WHERE kind = 'dm';
--> statement-breakpoint
CREATE UNIQUE INDEX trade_message_threads_request_idx ON trade_message_threads(owner_uid, created_by_member_id, request_id);
--> statement-breakpoint
CREATE TABLE trade_message_participants (
  thread_id TEXT NOT NULL REFERENCES trade_message_threads(id),
  owner_uid TEXT NOT NULL,
  member_id TEXT NOT NULL,
  last_read_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
  PRIMARY KEY (thread_id, member_id)
);
--> statement-breakpoint
CREATE INDEX trade_message_participants_member_idx ON trade_message_participants(owner_uid, member_id, thread_id);
--> statement-breakpoint
CREATE TABLE trade_internal_messages (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES trade_message_threads(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  actor_member_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) <= 2000),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_internal_messages_sequence_idx ON trade_internal_messages(thread_id, sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_internal_messages_request_idx ON trade_internal_messages(owner_uid, actor_member_id, request_id);
