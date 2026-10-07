CREATE UNIQUE INDEX council_memberships_council_member_idx ON council_memberships(council_id,id);
--> statement-breakpoint
CREATE TABLE council_team_messages (
  id TEXT PRIMARY KEY NOT NULL,
  council_id TEXT NOT NULL REFERENCES council_organisations(id),
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  CHECK(sender_id<>recipient_id),
  UNIQUE(council_id,id),
  FOREIGN KEY(council_id,sender_id) REFERENCES council_memberships(council_id,id),
  FOREIGN KEY(council_id,recipient_id) REFERENCES council_memberships(council_id,id)
);
--> statement-breakpoint
CREATE INDEX council_team_messages_conversation_idx ON council_team_messages(council_id,sender_id,recipient_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE INDEX council_team_messages_recipient_idx ON council_team_messages(council_id,recipient_id,sender_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE TRIGGER council_team_messages_no_update BEFORE UPDATE ON council_team_messages BEGIN SELECT RAISE(ABORT,'COUNCIL_MESSAGE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER council_team_messages_no_delete BEFORE DELETE ON council_team_messages BEGIN SELECT RAISE(ABORT,'COUNCIL_MESSAGE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TABLE council_team_message_reads (
  council_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  seen_message_id TEXT NOT NULL,
  seen_created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(council_id,member_id,peer_id),
  CHECK(member_id<>peer_id),
  FOREIGN KEY(council_id,member_id) REFERENCES council_memberships(council_id,id),
  FOREIGN KEY(council_id,peer_id) REFERENCES council_memberships(council_id,id),
  FOREIGN KEY(council_id,seen_message_id) REFERENCES council_team_messages(council_id,id)
);
