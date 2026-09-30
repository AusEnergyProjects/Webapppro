CREATE TABLE trade_message_receipts (
  message_id TEXT NOT NULL REFERENCES trade_internal_messages(id),
  owner_uid TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES trade_message_threads(id),
  member_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  delivered_at TEXT NOT NULL DEFAULT '',
  read_at TEXT NOT NULL DEFAULT '',
  legacy_read INTEGER NOT NULL DEFAULT 0 CHECK (legacy_read IN (0, 1)),
  PRIMARY KEY (message_id, member_id),
  CHECK (read_at = '' OR delivered_at <> ''),
  CHECK (legacy_read = 0 OR (delivered_at = '' AND read_at = ''))
);
--> statement-breakpoint
CREATE INDEX trade_message_receipts_recipient_idx ON trade_message_receipts(owner_uid, thread_id, member_id, message_id);
--> statement-breakpoint
-- Preserve existing read knowledge without inventing when it happened.
INSERT INTO trade_message_receipts (message_id, owner_uid, thread_id, member_id, recipient_name, legacy_read)
SELECT message.id, message.owner_uid, message.thread_id, participant.member_id, member.display_name,
  CASE WHEN participant.last_read_sequence >= message.sequence THEN 1 ELSE 0 END
FROM trade_internal_messages message
JOIN trade_message_participants participant ON participant.thread_id = message.thread_id AND participant.owner_uid = message.owner_uid
JOIN trade_team_members member ON member.id = participant.member_id AND member.owner_uid = participant.owner_uid
WHERE participant.member_id <> message.actor_member_id;
--> statement-breakpoint
-- The database remains authoritative while old and new Workers overlap.
CREATE TRIGGER trade_message_receipts_snapshot
AFTER INSERT ON trade_internal_messages
BEGIN
  INSERT INTO trade_message_receipts (message_id, owner_uid, thread_id, member_id, recipient_name)
  SELECT NEW.id, NEW.owner_uid, NEW.thread_id, participant.member_id, member.display_name
  FROM trade_message_participants participant
  JOIN trade_team_members member ON member.id=participant.member_id AND member.owner_uid=participant.owner_uid
  WHERE participant.thread_id=NEW.thread_id AND participant.owner_uid=NEW.owner_uid
    AND participant.member_id<>NEW.actor_member_id;
END;
--> statement-breakpoint
CREATE TRIGGER trade_message_receipts_read
AFTER UPDATE OF last_read_sequence ON trade_message_participants
WHEN NEW.last_read_sequence > OLD.last_read_sequence
BEGIN
  UPDATE trade_message_receipts
  SET delivered_at=CASE WHEN delivered_at='' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE delivered_at END,
    read_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE owner_uid=NEW.owner_uid AND thread_id=NEW.thread_id AND member_id=NEW.member_id
    AND legacy_read=0 AND read_at=''
    AND message_id IN (SELECT id FROM trade_internal_messages
      WHERE owner_uid=NEW.owner_uid AND thread_id=NEW.thread_id
        AND sequence>OLD.last_read_sequence AND sequence<=NEW.last_read_sequence);
END;
