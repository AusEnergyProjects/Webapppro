-- Preserve original record IDs and their signed PDFs/report-link foreign keys.
-- D1 runs the migration transaction with foreign keys enabled and deferred.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE trade_activity_field_records_retained_0194 AS SELECT * FROM trade_activity_field_records;
DROP TABLE trade_activity_field_records;
CREATE TABLE trade_activity_field_records (
  id TEXT PRIMARY KEY NOT NULL, intent_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  owner_uid TEXT NOT NULL, organisation_id TEXT NOT NULL, activity_template_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0), status TEXT NOT NULL CHECK(status IN ('draft','submitted_for_creditex_review')),
  payload TEXT NOT NULL CHECK(json_valid(payload)), pdf_object_key TEXT NOT NULL DEFAULT '', pdf_sha256 TEXT NOT NULL DEFAULT '',
  actor_uid TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, submitted_at TEXT NOT NULL DEFAULT '',
  supersedes_record_id TEXT REFERENCES trade_activity_field_records(id),
  correction_event_id TEXT REFERENCES creditex_job_lifecycle_events(id),
  CHECK((supersedes_record_id IS NULL AND correction_event_id IS NULL) OR (supersedes_record_id IS NOT NULL AND correction_event_id IS NOT NULL)),
  CHECK(COALESCE(json_extract(payload,'$.id')=id AND json_extract(payload,'$.intentId')=intent_id
    AND json_extract(payload,'$.workOrderId')=work_order_id AND json_extract(payload,'$.ownerUid')=owner_uid
    AND json_extract(payload,'$.organisationId')=organisation_id AND json_extract(payload,'$.revision')=revision
    AND json_extract(payload,'$.status')=status AND json_extract(payload,'$.form.activityTemplateId')=activity_template_id,0)),
  CHECK(status='draft' OR (pdf_object_key<>'' AND length(pdf_sha256)=64 AND submitted_at<>''))
);
INSERT INTO trade_activity_field_records(id,intent_id,work_order_id,owner_uid,organisation_id,activity_template_id,revision,status,payload,
  pdf_object_key,pdf_sha256,actor_uid,created_at,updated_at,submitted_at)
SELECT id,intent_id,work_order_id,owner_uid,organisation_id,activity_template_id,revision,status,payload,
  pdf_object_key,pdf_sha256,actor_uid,created_at,updated_at,submitted_at FROM trade_activity_field_records_retained_0194;
DROP TABLE trade_activity_field_records_retained_0194;
CREATE UNIQUE INDEX trade_activity_field_record_original_idx ON trade_activity_field_records(intent_id) WHERE supersedes_record_id IS NULL;
CREATE UNIQUE INDEX trade_activity_field_record_successor_idx ON trade_activity_field_records(supersedes_record_id) WHERE supersedes_record_id IS NOT NULL;
CREATE UNIQUE INDEX trade_activity_field_record_correction_idx ON trade_activity_field_records(correction_event_id) WHERE correction_event_id IS NOT NULL;
CREATE INDEX trade_activity_field_record_job_idx ON trade_activity_field_records(owner_uid,work_order_id,status);
CREATE INDEX trade_activity_field_record_review_idx ON trade_activity_field_records(organisation_id,status,updated_at);

-- Trigger bodies are installed by ensureCreditexJobLifecycleSchemaGuards through complete D1 prepared statements.
