CREATE TABLE trade_business_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 180),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 3000),
  assignee_member_id TEXT NOT NULL,
  created_by_member_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  due_on TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (owner_uid, assignee_member_id) REFERENCES trade_team_members(owner_uid, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_uid, created_by_member_id) REFERENCES trade_team_members(owner_uid, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX trade_business_tasks_assignee_idx ON trade_business_tasks(owner_uid, assignee_member_id, status, due_on);
--> statement-breakpoint
CREATE INDEX trade_business_tasks_creator_idx ON trade_business_tasks(owner_uid, created_by_member_id, status);
