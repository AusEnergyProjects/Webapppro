CREATE TABLE IF NOT EXISTS surge_account_context (
  firebase_uid TEXT PRIMARY KEY NOT NULL,
  profile_json TEXT NOT NULL CHECK (length(profile_json) <= 32768),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS surge_account_context_updated_idx
  ON surge_account_context(updated_at);
