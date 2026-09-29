CREATE TABLE trade_team_presence (
  owner_uid TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES trade_team_members(id),
  status TEXT NOT NULL CHECK (status IN ('online','busy','offline')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_uid,member_id)
);
