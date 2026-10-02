CREATE TABLE portal_workspace_profiles (
  workspace TEXT NOT NULL CHECK (workspace IN ('admin', 'creditex')),
  tenant_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  theme_key TEXT NOT NULL DEFAULT 'emerald_navy',
  colour_mode TEXT NOT NULL DEFAULT 'day' CHECK (colour_mode IN ('day', 'night')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace, tenant_id, member_id)
);
