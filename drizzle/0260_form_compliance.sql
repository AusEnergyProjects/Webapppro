-- Reviewer questionnaires and reviews are independent of installer submissions and job decisions.
-- Append-only guards are installed using D1 prepared statements because Sites splits migration semicolons.
CREATE TABLE form_compliance_template_versions (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('business','creditex')),
  scope_id TEXT NOT NULL CHECK(trim(scope_id)<>''),
  form_key TEXT NOT NULL CHECK(trim(form_key)<>''),
  title TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  questions_json TEXT NOT NULL CHECK(json_valid(questions_json) AND json_type(questions_json)='array' AND json_array_length(questions_json) BETWEEN 1 AND 60),
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  actor_uid TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(scope,scope_id,form_key,revision)
);
--> statement-breakpoint
CREATE TABLE form_compliance_review_versions (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('business','creditex')),
  scope_id TEXT NOT NULL CHECK(trim(scope_id)<>''),
  form_key TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK(record_kind IN ('field','work_pack','job_form')),
  record_id TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  status TEXT NOT NULL CHECK(status IN ('draft','complete')),
  template_revision INTEGER NOT NULL CHECK(template_revision>=0),
  template_snapshot TEXT NOT NULL CHECK(json_valid(template_snapshot)),
  answers_json TEXT NOT NULL CHECK(json_valid(answers_json) AND json_type(answers_json)='array' AND json_array_length(answers_json) BETWEEN 1 AND 60),
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  source_hash TEXT NOT NULL CHECK(length(source_hash)=64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  actor_uid TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(scope,scope_id,record_kind,record_id,revision)
);
--> statement-breakpoint
CREATE INDEX form_compliance_review_work_idx ON form_compliance_review_versions(scope,scope_id,work_order_id,created_at);

