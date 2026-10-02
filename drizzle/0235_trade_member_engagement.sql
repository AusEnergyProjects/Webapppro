CREATE TABLE trade_member_engagement (
  owner_uid TEXT NOT NULL, member_id TEXT NOT NULL, encrypted_payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, last_mutation_id TEXT NOT NULL, updated_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_uid,member_id),
  FOREIGN KEY (owner_uid,member_id) REFERENCES trade_team_members(owner_uid,id),
  CONSTRAINT trade_member_engagement_revision_check CHECK(revision>=1),
  CONSTRAINT trade_member_engagement_payload_check CHECK(encrypted_payload LIKE 'v1.%')
);
--> statement-breakpoint
ALTER TABLE trade_team_member_files ADD COLUMN owner_private INTEGER NOT NULL DEFAULT 0 CHECK(owner_private IN (0,1));
