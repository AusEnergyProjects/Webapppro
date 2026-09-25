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
CREATE TRIGGER trade_activity_field_record_intent_guard BEFORE INSERT ON trade_activity_field_records
WHEN NOT EXISTS(SELECT 1 FROM trade_work_order_compliance_intents i WHERE i.id=NEW.intent_id AND i.work_order_id=NEW.work_order_id
  AND i.installer_uid=NEW.owner_uid AND i.compliance_organisation_id=NEW.organisation_id AND i.activity_template_id=NEW.activity_template_id
  AND i.status IN ('planned','case_linked'))
BEGIN SELECT RAISE(ABORT,'Activity field record must match its active assigned intent.'); END;
CREATE TRIGGER trade_activity_field_correction_guard BEFORE INSERT ON trade_activity_field_records
WHEN NEW.supersedes_record_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.status<>'draft' OR NEW.revision<>1 OR NEW.pdf_object_key<>'' OR NEW.pdf_sha256<>'' OR NEW.submitted_at<>''
    OR COALESCE(json_type(NEW.payload,'$.signatures')='array' AND json_array_length(NEW.payload,'$.signatures')=0,0)=0
    THEN RAISE(ABORT,'ACTIVITY_CORRECTION_MUST_START_UNSIGNED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM trade_activity_field_records source
    JOIN creditex_job_lifecycle_events event ON event.id=NEW.correction_event_id AND event.action='correction_required'
      AND event.organisation_id=source.organisation_id AND event.owner_uid=source.owner_uid
      AND event.work_order_id=source.work_order_id AND event.intent_id=source.intent_id
    JOIN trade_work_orders work ON work.id=source.work_order_id AND work.firebase_uid=source.owner_uid
    WHERE source.id=NEW.supersedes_record_id AND source.status='submitted_for_creditex_review'
      AND source.intent_id=NEW.intent_id AND source.owner_uid=NEW.owner_uid AND source.work_order_id=NEW.work_order_id
      AND source.organisation_id=NEW.organisation_id AND source.activity_template_id=NEW.activity_template_id
      AND work.record_status='active' AND work.stage<>'cancelled'
      AND json_extract(NEW.payload,'$.correction.sourceRecordId')=source.id
      AND json_extract(NEW.payload,'$.correction.sourceRevision')=source.revision
      AND json_extract(NEW.payload,'$.correction.eventId')=event.id
      AND NOT EXISTS(SELECT 1 FROM creditex_job_lifecycle_events later
        WHERE later.organisation_id=event.organisation_id AND later.owner_uid=event.owner_uid
          AND later.work_order_id=event.work_order_id AND later.intent_id=event.intent_id
          AND later.action IN ('reviewed','correction_required')
          AND (later.created_at>event.created_at OR (later.created_at=event.created_at AND later.id>event.id)))
      AND EXISTS(SELECT 1 FROM json_each(event.source_snapshot,'$.records') retained
        WHERE json_extract(retained.value,'$.kind')='field' AND json_extract(retained.value,'$.id')=source.id
          AND json_extract(retained.value,'$.revision')=source.revision AND json_extract(retained.value,'$.sha256')=source.pdf_sha256
          AND json_extract(retained.value,'$.objectKey')=source.pdf_object_key)
  ) THEN RAISE(ABORT,'ACTIVITY_CORRECTION_SOURCE_CHANGED') END;
END;
CREATE TRIGGER trade_activity_field_record_immutable BEFORE UPDATE ON trade_activity_field_records
WHEN OLD.status='submitted_for_creditex_review' OR NEW.intent_id<>OLD.intent_id OR NEW.owner_uid<>OLD.owner_uid
  OR NEW.organisation_id<>OLD.organisation_id OR NEW.work_order_id<>OLD.work_order_id
  OR NEW.activity_template_id<>OLD.activity_template_id OR NEW.revision<>OLD.revision+1
  OR NEW.supersedes_record_id IS NOT OLD.supersedes_record_id OR NEW.correction_event_id IS NOT OLD.correction_event_id
  OR json_extract(NEW.payload,'$.correction') IS NOT json_extract(OLD.payload,'$.correction')
BEGIN SELECT RAISE(ABORT,'Submitted field records and their scope are immutable.'); END;
CREATE TRIGGER trade_activity_field_record_no_delete BEFORE DELETE ON trade_activity_field_records
BEGIN SELECT RAISE(ABORT, 'Field record history must be retained.'); END;
CREATE TRIGGER trade_activity_field_record_created AFTER INSERT ON trade_activity_field_records
BEGIN INSERT INTO trade_activity_field_record_versions VALUES(NEW.id,NEW.revision,NEW.payload,NEW.actor_uid,NEW.updated_at); END;
CREATE TRIGGER trade_activity_field_record_changed AFTER UPDATE ON trade_activity_field_records
BEGIN INSERT INTO trade_activity_field_record_versions VALUES(NEW.id,NEW.revision,NEW.payload,NEW.actor_uid,NEW.updated_at); END;
