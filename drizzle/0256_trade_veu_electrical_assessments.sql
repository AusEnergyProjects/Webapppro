CREATE TABLE trade_veu_electrical_assessments (
  id TEXT PRIMARY KEY NOT NULL,
  work_order_id TEXT NOT NULL REFERENCES trade_work_orders(id) ON DELETE RESTRICT,
  owner_uid TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  status TEXT NOT NULL CHECK(status IN ('draft','complete')),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  pdf_object_key TEXT NOT NULL DEFAULT '',
  pdf_sha256 TEXT NOT NULL DEFAULT '',
  pdf_size_bytes INTEGER NOT NULL DEFAULT 0,
  actor_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  UNIQUE(owner_uid, work_order_id),
  CHECK(COALESCE(json_extract(payload,'$.id')=id AND json_extract(payload,'$.workOrderId')=work_order_id
    AND json_extract(payload,'$.ownerUid')=owner_uid AND json_extract(payload,'$.revision')=revision
    AND json_extract(payload,'$.status')=status AND json_extract(payload,'$.completedAt')=completed_at,0)),
  CHECK(status='draft' OR (pdf_object_key<>'' AND length(pdf_sha256)=64 AND pdf_size_bytes>4 AND completed_at<>''))
);
--> statement-breakpoint
CREATE TABLE trade_veu_electrical_versions (
  record_id TEXT NOT NULL REFERENCES trade_veu_electrical_assessments(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  actor_uid TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(record_id,revision)
);
--> statement-breakpoint
CREATE TABLE trade_veu_electrical_deliveries (
  record_id TEXT NOT NULL REFERENCES trade_veu_electrical_assessments(id) ON DELETE RESTRICT,
  owner_uid TEXT NOT NULL,
  recipient_role TEXT NOT NULL CHECK(recipient_role IN ('customer','business')),
  recipient_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','failed','blocked','reconciliation_required')),
  error_code TEXT NOT NULL DEFAULT '',
  lease_token TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  accepted_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(record_id,recipient_role)
);
--> statement-breakpoint
CREATE INDEX trade_veu_electrical_delivery_owner ON trade_veu_electrical_deliveries(owner_uid,record_id,status);
--> statement-breakpoint
CREATE TABLE trade_veu_electrical_mutations (
  record_id TEXT NOT NULL REFERENCES trade_veu_electrical_assessments(id) ON DELETE RESTRICT,
  owner_uid TEXT NOT NULL,
  request_key TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('save','attest_initial','sign','upload','complete')),
  base_revision INTEGER NOT NULL,
  result_revision INTEGER NOT NULL,
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
  record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY(record_id,request_key)
);
