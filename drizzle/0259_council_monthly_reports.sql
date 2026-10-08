CREATE TABLE council_monthly_report_settings (
  council_id TEXT PRIMARY KEY NOT NULL REFERENCES council_organisations(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  encrypted_payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  configured_by_uid TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE council_monthly_source_observations (
  source_as_of TEXT PRIMARY KEY NOT NULL CHECK(length(source_as_of)=10),
  first_observed_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64)
);
--> statement-breakpoint
CREATE TABLE council_monthly_reports (
  id TEXT PRIMARY KEY NOT NULL,
  council_id TEXT NOT NULL REFERENCES council_organisations(id),
  source_as_of TEXT NOT NULL REFERENCES council_monthly_source_observations(source_as_of),
  scope_key TEXT NOT NULL,
  settings_revision INTEGER NOT NULL CHECK(settings_revision>0),
  status TEXT NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','ready','failed','cancelled')),
  generation_attempts INTEGER NOT NULL DEFAULT 0 CHECK(generation_attempts BETWEEN 0 AND 4),
  claim_token TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT NOT NULL DEFAULT '',
  encrypted_payload TEXT NOT NULL DEFAULT '',
  pdf_object_key TEXT NOT NULL DEFAULT '',
  pdf_sha256 TEXT NOT NULL DEFAULT '',
  pdf_size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(pdf_size_bytes>=0),
  generated_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(council_id,source_as_of)
);
--> statement-breakpoint
CREATE TABLE council_monthly_report_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  report_id TEXT NOT NULL REFERENCES council_monthly_reports(id),
  recipient_index INTEGER NOT NULL CHECK(recipient_index BETWEEN 0 AND 9),
  recipient_hash TEXT NOT NULL CHECK(length(recipient_hash)=64),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','retry','accepted','failed','unknown','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 4),
  first_attempt_at TEXT NOT NULL DEFAULT '',
  next_attempt_at TEXT NOT NULL DEFAULT '',
  claim_token TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  failure_code TEXT NOT NULL DEFAULT '',
  accepted_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(report_id,recipient_index)
);
--> statement-breakpoint
CREATE INDEX council_monthly_report_queue_idx ON council_monthly_report_deliveries(status,next_attempt_at);
--> statement-breakpoint
CREATE INDEX council_monthly_report_council_idx ON council_monthly_reports(council_id,created_at);
