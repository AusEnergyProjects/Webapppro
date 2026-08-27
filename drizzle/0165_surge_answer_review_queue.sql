CREATE TABLE IF NOT EXISTS surge_answer_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  answer_id TEXT NOT NULL UNIQUE,
  client_key TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  reviewer_uid TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS surge_answer_reviews_status_created_idx
  ON surge_answer_reviews(status, created_at DESC);

CREATE INDEX IF NOT EXISTS surge_answer_reviews_client_created_idx
  ON surge_answer_reviews(client_key, created_at DESC);

ALTER TABLE surge_conversation_quality_daily
  ADD COLUMN directness_pass_count INTEGER NOT NULL DEFAULT 0
  CHECK (directness_pass_count >= 0 AND directness_pass_count <= total_count);

ALTER TABLE surge_conversation_quality_daily
  ADD COLUMN plain_language_pass_count INTEGER NOT NULL DEFAULT 0
  CHECK (plain_language_pass_count >= 0 AND plain_language_pass_count <= total_count);

ALTER TABLE surge_conversation_quality_daily
  ADD COLUMN actionability_expected_count INTEGER NOT NULL DEFAULT 0
  CHECK (actionability_expected_count >= 0 AND actionability_expected_count <= total_count);

ALTER TABLE surge_conversation_quality_daily
  ADD COLUMN actionability_pass_count INTEGER NOT NULL DEFAULT 0
  CHECK (actionability_pass_count >= 0 AND actionability_pass_count <= actionability_expected_count);
