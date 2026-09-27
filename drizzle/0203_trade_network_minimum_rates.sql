-- Private, optional minimum advertised prices for automatic work leads only.
-- Existing posts and memberships retain their current state.
ALTER TABLE trade_network_members ADD COLUMN minimum_hour_cents INTEGER
  CHECK (minimum_hour_cents IS NULL OR (typeof(minimum_hour_cents) = 'integer' AND minimum_hour_cents BETWEEN 1 AND 100000000));
ALTER TABLE trade_network_members ADD COLUMN minimum_day_cents INTEGER
  CHECK (minimum_day_cents IS NULL OR (typeof(minimum_day_cents) = 'integer' AND minimum_day_cents BETWEEN 1 AND 100000000));
ALTER TABLE trade_network_members ADD COLUMN minimum_job_cents INTEGER
  CHECK (minimum_job_cents IS NULL OR (typeof(minimum_job_cents) = 'integer' AND minimum_job_cents BETWEEN 1 AND 100000000));

-- Successful work publications consume one allowance per business/Sydney day.
-- Written atomically with the post; retries cannot consume another allowance.
CREATE TABLE trade_network_work_publications (
  owner_uid TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES trade_network_posts(id),
  publication_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_uid, request_hash)
);
CREATE INDEX trade_network_work_publications_day_idx ON trade_network_work_publications(owner_uid, publication_day);
