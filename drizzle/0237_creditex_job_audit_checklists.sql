CREATE TABLE creditex_job_audit_versions (
  id TEXT PRIMARY KEY NOT NULL,
  organisation_id TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  owner_uid TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  outcome TEXT NOT NULL CHECK(outcome IN ('draft','audited','correction_required')),
  checklist_version TEXT NOT NULL,
  answers_json TEXT NOT NULL CHECK(json_valid(answers_json)),
  call_outcome TEXT NOT NULL CHECK(call_outcome IN ('completed','unavailable','not_required')),
  call_reason TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256) = 64),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('compliance','admin')),
  actor_uid TEXT NOT NULL,
  actor_member_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(organisation_id,intent_id,revision),
  UNIQUE(actor_kind,actor_uid,request_id)
);
--> statement-breakpoint
CREATE INDEX creditex_job_audit_job_idx ON creditex_job_audit_versions(organisation_id,work_order_id,revision);
--> statement-breakpoint
CREATE TRIGGER creditex_job_audit_no_update BEFORE UPDATE ON creditex_job_audit_versions
BEGIN SELECT RAISE(ABORT, 'Job audit versions are immutable. Save a new revision.'); END;
--> statement-breakpoint
CREATE TRIGGER creditex_job_audit_no_delete BEFORE DELETE ON creditex_job_audit_versions
BEGIN SELECT RAISE(ABORT, 'Job audit history must be retained.'); END;
