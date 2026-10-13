CREATE TABLE trade_safety_checks (
  id TEXT PRIMARY KEY NOT NULL,
  work_order_id TEXT NOT NULL REFERENCES trade_work_orders(id) ON DELETE RESTRICT,
  owner_uid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('electrical','gas')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  status TEXT NOT NULL CHECK(status IN ('draft','complete')),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  pdf_object_key TEXT NOT NULL DEFAULT '',
  pdf_sha256 TEXT NOT NULL DEFAULT '',
  pdf_size_bytes INTEGER NOT NULL DEFAULT 0,
  credential_snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(credential_snapshot)),
  actor_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  UNIQUE(owner_uid, work_order_id, kind),
  CHECK(COALESCE(json_extract(payload,'$.id')=id AND json_extract(payload,'$.workOrderId')=work_order_id
    AND json_extract(payload,'$.ownerUid')=owner_uid AND json_extract(payload,'$.kind')=kind
    AND json_extract(payload,'$.revision')=revision AND json_extract(payload,'$.status')=status
    AND json_extract(payload,'$.completedAt')=completed_at,0)),
  CHECK(status='draft' OR (pdf_object_key<>'' AND length(pdf_sha256)=64 AND pdf_size_bytes>4 AND completed_at<>''))
);
--> statement-breakpoint
CREATE TABLE trade_safety_check_versions (
  record_id TEXT NOT NULL REFERENCES trade_safety_checks(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision > 0),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  actor_uid TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(record_id,revision)
);
--> statement-breakpoint
CREATE TABLE trade_safety_check_deliveries (
  record_id TEXT NOT NULL REFERENCES trade_safety_checks(id) ON DELETE RESTRICT,
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
CREATE INDEX trade_safety_check_delivery_owner ON trade_safety_check_deliveries(owner_uid,record_id,status);
--> statement-breakpoint
CREATE TABLE trade_safety_check_mutations (
  record_id TEXT NOT NULL REFERENCES trade_safety_checks(id) ON DELETE RESTRICT,
  owner_uid TEXT NOT NULL,
  request_key TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('save','sign','upload','complete')),
  base_revision INTEGER NOT NULL,
  result_revision INTEGER NOT NULL,
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
  record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY(record_id,request_key)
);
--> statement-breakpoint
CREATE TABLE trade_safety_report_links (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  work_order_id TEXT NOT NULL REFERENCES trade_work_orders(id) ON DELETE RESTRICT,
  record_id TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK(record_kind IN ('piesa','electrical','gas')),
  record_revision INTEGER NOT NULL CHECK(record_revision > 0),
  pdf_sha256 TEXT NOT NULL CHECK(length(pdf_sha256)=64),
  crm_customer_id TEXT NOT NULL,
  customer_email_sha256 TEXT NOT NULL CHECK(length(customer_email_sha256)=64),
  token_hash TEXT NOT NULL CHECK(length(token_hash)=64),
  encrypted_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  expires_at TEXT NOT NULL CHECK(datetime(expires_at) IS NOT NULL),
  created_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT '',
  UNIQUE(owner_uid,record_kind,record_id)
);
--> statement-breakpoint
CREATE INDEX trade_safety_report_link_record ON trade_safety_report_links(owner_uid,record_kind,record_id,status);
