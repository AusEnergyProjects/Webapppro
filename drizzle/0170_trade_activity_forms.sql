CREATE TABLE trade_activity_field_masters (
  id TEXT PRIMARY KEY NOT NULL,
  organisation_id TEXT NOT NULL,
  activity_template_id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL CHECK (version > 0),
  form_json TEXT NOT NULL CHECK (json_valid(form_json)),
  form_sha256 TEXT NOT NULL CHECK (length(form_sha256) = 64),
  published_by_uid TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE (organisation_id, activity_template_id, variant_id, version)
);
CREATE TRIGGER trade_activity_master_no_update BEFORE UPDATE ON trade_activity_field_masters
BEGIN SELECT RAISE(ABORT, 'Published field masters are immutable. Save a new version.'); END;
CREATE TRIGGER trade_activity_master_no_delete BEFORE DELETE ON trade_activity_field_masters
BEGIN SELECT RAISE(ABORT, 'Published field master history must be retained.'); END;

CREATE TABLE trade_activity_field_records (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL UNIQUE,
  work_order_id TEXT NOT NULL,
  owner_uid TEXT NOT NULL,
  organisation_id TEXT NOT NULL,
  activity_template_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted_for_creditex_review')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  pdf_object_key TEXT NOT NULL DEFAULT '',
  pdf_sha256 TEXT NOT NULL DEFAULT '',
  actor_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT '',
  CHECK (COALESCE(json_extract(payload, '$.id') = id AND json_extract(payload, '$.intentId') = intent_id
    AND json_extract(payload, '$.workOrderId') = work_order_id AND json_extract(payload, '$.ownerUid') = owner_uid
    AND json_extract(payload, '$.organisationId') = organisation_id AND json_extract(payload, '$.revision') = revision
    AND json_extract(payload, '$.status') = status AND json_extract(payload, '$.form.activityTemplateId') = activity_template_id, 0)),
  CHECK (status = 'draft' OR (pdf_object_key <> '' AND length(pdf_sha256) = 64 AND submitted_at <> ''))
);
CREATE INDEX trade_activity_field_record_job_idx ON trade_activity_field_records (owner_uid, work_order_id, status);
CREATE INDEX trade_activity_field_record_review_idx ON trade_activity_field_records (organisation_id, status, updated_at);
CREATE TRIGGER trade_activity_field_record_intent_guard BEFORE INSERT ON trade_activity_field_records
WHEN NOT EXISTS (SELECT 1 FROM trade_work_order_compliance_intents i
  WHERE i.id = NEW.intent_id AND i.work_order_id = NEW.work_order_id AND i.installer_uid = NEW.owner_uid
    AND i.compliance_organisation_id = NEW.organisation_id AND i.activity_template_id = NEW.activity_template_id
    AND i.status IN ('planned', 'case_linked'))
BEGIN SELECT RAISE(ABORT, 'Activity field record must match its active assigned intent.'); END;
CREATE TRIGGER trade_activity_field_record_immutable BEFORE UPDATE ON trade_activity_field_records
WHEN OLD.status = 'submitted_for_creditex_review' OR NEW.intent_id <> OLD.intent_id OR NEW.owner_uid <> OLD.owner_uid
  OR NEW.organisation_id <> OLD.organisation_id OR NEW.work_order_id <> OLD.work_order_id
  OR NEW.activity_template_id <> OLD.activity_template_id OR NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'Submitted field records and their scope are immutable.'); END;
CREATE TRIGGER trade_activity_field_record_no_delete BEFORE DELETE ON trade_activity_field_records
BEGIN SELECT RAISE(ABORT, 'Field record history must be retained.'); END;

CREATE TABLE trade_activity_field_record_versions (
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  actor_uid TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (record_id, revision)
);
CREATE TRIGGER trade_activity_field_record_created AFTER INSERT ON trade_activity_field_records
BEGIN INSERT INTO trade_activity_field_record_versions VALUES (NEW.id, NEW.revision, NEW.payload, NEW.actor_uid, NEW.updated_at); END;
CREATE TRIGGER trade_activity_field_record_changed AFTER UPDATE ON trade_activity_field_records
BEGIN INSERT INTO trade_activity_field_record_versions VALUES (NEW.id, NEW.revision, NEW.payload, NEW.actor_uid, NEW.updated_at); END;
CREATE TRIGGER trade_activity_field_record_version_no_update BEFORE UPDATE ON trade_activity_field_record_versions
BEGIN SELECT RAISE(ABORT, 'Field record audit versions are immutable.'); END;
CREATE TRIGGER trade_activity_field_record_version_no_delete BEFORE DELETE ON trade_activity_field_record_versions
BEGIN SELECT RAISE(ABORT, 'Field record audit versions must be retained.'); END;

CREATE TABLE trade_activity_field_report_links (
  id TEXT PRIMARY KEY NOT NULL,
  record_id TEXT NOT NULL REFERENCES trade_activity_field_records(id),
  token_sha256 TEXT NOT NULL UNIQUE CHECK (length(token_sha256) = 64),
  expires_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT '',
  created_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX trade_activity_field_report_link_record_idx ON trade_activity_field_report_links (record_id, revoked_at);
