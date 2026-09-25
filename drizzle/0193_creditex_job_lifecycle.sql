CREATE TABLE creditex_job_lifecycle_events (
  id TEXT PRIMARY KEY NOT NULL,
  organisation_id TEXT NOT NULL,
  work_order_id TEXT NOT NULL REFERENCES trade_work_orders(id) ON DELETE RESTRICT,
  owner_uid TEXT NOT NULL,
  intent_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK(action IN ('reviewed','correction_required','payout_recorded','cancelled','deleted','restored')),
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  reference TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(amount_minor>=0),
  recipient_uid TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('trade','compliance','admin')),
  actor_uid TEXT NOT NULL,
  note TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
  created_at TEXT NOT NULL,
  CHECK((action IN ('reviewed','correction_required','payout_recorded') AND intent_id<>'') OR (action IN ('cancelled','deleted','restored') AND intent_id='')),
  CHECK(action<>'reviewed' OR actor_kind='trade'),
  CHECK(action NOT IN ('payout_recorded','deleted','restored') OR actor_kind IN ('compliance','admin')),
  CHECK((action='payout_recorded' AND amount_minor>0 AND reference<>'' AND recipient_uid=owner_uid) OR
    (action<>'payout_recorded' AND amount_minor=0 AND reference='' AND recipient_uid='')),
  UNIQUE(actor_kind,actor_uid,request_id)
);
CREATE INDEX creditex_job_lifecycle_scope_idx ON creditex_job_lifecycle_events(organisation_id,work_order_id,owner_uid,intent_id,action,created_at);
CREATE UNIQUE INDEX creditex_job_payout_reference_idx ON creditex_job_lifecycle_events(organisation_id,intent_id,reference) WHERE action='payout_recorded';
CREATE UNIQUE INDEX creditex_job_payout_source_idx ON creditex_job_lifecycle_events(organisation_id,intent_id,source_sha256) WHERE action='payout_recorded';

CREATE TABLE creditex_job_correction_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES creditex_job_lifecycle_events(id) ON DELETE RESTRICT,
  work_order_id TEXT NOT NULL REFERENCES trade_work_orders(id) ON DELETE RESTRICT,
  owner_uid TEXT NOT NULL,
  member_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sending','accepted','failed','uncertain')),
  provider_reference TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TEXT NOT NULL DEFAULT '',
  last_attempt_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id,member_id)
);
CREATE INDEX creditex_job_correction_delivery_job_idx ON creditex_job_correction_deliveries(owner_uid,work_order_id,status,created_at);

-- Trigger bodies are installed by ensureCreditexJobLifecycleSchemaGuards through complete D1 prepared statements.
