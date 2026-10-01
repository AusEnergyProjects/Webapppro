CREATE UNIQUE INDEX trade_team_members_owner_id_idx ON trade_team_members(owner_uid, id);
--> statement-breakpoint
CREATE TABLE trade_crews (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  company_name TEXT NOT NULL DEFAULT '' CHECK (length(company_name) <= 180),
  lead_member_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_uid, lead_member_id) REFERENCES trade_team_members(owner_uid, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_crews_owner_id_idx ON trade_crews(owner_uid, id);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_crews_owner_lead_idx ON trade_crews(owner_uid, lead_member_id);
--> statement-breakpoint
CREATE TABLE trade_crew_members (
  owner_uid TEXT NOT NULL,
  crew_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_uid, crew_id) REFERENCES trade_crews(owner_uid, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_uid, member_id) REFERENCES trade_team_members(owner_uid, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_crew_members_owner_member_idx ON trade_crew_members(owner_uid, member_id);
--> statement-breakpoint
CREATE INDEX trade_crew_members_crew_idx ON trade_crew_members(owner_uid, crew_id, member_id);
