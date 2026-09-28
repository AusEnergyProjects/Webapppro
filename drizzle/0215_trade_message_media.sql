CREATE TABLE trade_message_media (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  uploader_member_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('message', 'avatar')),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
  thread_id TEXT NOT NULL DEFAULT '',
  member_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  state TEXT NOT NULL CHECK (state IN ('pending', 'attached', 'active', 'retired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL DEFAULT '',
  CHECK ((purpose = 'message' AND thread_id <> '' AND member_id = '' AND
    ((state = 'pending' AND message_id = '' AND expires_at <> '') OR (state = 'attached' AND message_id <> '')))
    OR (purpose = 'avatar' AND kind = 'image' AND thread_id = '' AND member_id <> '' AND message_id = '' AND state IN ('active', 'retired')))
);
--> statement-breakpoint
CREATE INDEX trade_message_media_message_idx ON trade_message_media(owner_uid, thread_id, message_id);
--> statement-breakpoint
CREATE INDEX trade_message_media_pending_idx ON trade_message_media(owner_uid, uploader_member_id, state, expires_at);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_message_media_avatar_idx ON trade_message_media(owner_uid, member_id) WHERE purpose = 'avatar' AND state = 'active';
