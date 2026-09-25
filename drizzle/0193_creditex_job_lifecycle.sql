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
CREATE TRIGGER creditex_job_lifecycle_scope_guard BEFORE INSERT ON creditex_job_lifecycle_events
WHEN NOT EXISTS (SELECT 1 FROM trade_work_orders w JOIN trade_work_order_compliance_intents i
  ON i.work_order_id=w.id AND i.installer_uid=w.firebase_uid
  WHERE w.id=NEW.work_order_id AND w.firebase_uid=NEW.owner_uid
    AND i.compliance_organisation_id=NEW.organisation_id
    AND (NEW.intent_id='' OR i.id=NEW.intent_id))
BEGIN SELECT RAISE(ABORT,'JOB_LIFECYCLE_SCOPE_INVALID'); END;
CREATE TRIGGER creditex_job_lifecycle_no_update BEFORE UPDATE ON creditex_job_lifecycle_events
BEGIN SELECT RAISE(ABORT,'JOB_LIFECYCLE_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER creditex_job_lifecycle_no_delete BEFORE DELETE ON creditex_job_lifecycle_events
BEGIN SELECT RAISE(ABORT,'JOB_LIFECYCLE_HISTORY_RETAINED'); END;

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
CREATE TRIGGER creditex_job_correction_delivery_identity_guard BEFORE UPDATE ON creditex_job_correction_deliveries
WHEN NEW.event_id<>OLD.event_id OR NEW.work_order_id<>OLD.work_order_id OR NEW.owner_uid<>OLD.owner_uid OR NEW.member_id<>OLD.member_id
  OR NEW.recipient_email<>OLD.recipient_email OR NEW.subject<>OLD.subject OR NEW.body<>OLD.body OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'JOB_CORRECTION_DELIVERY_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER creditex_job_correction_delivery_no_delete BEFORE DELETE ON creditex_job_correction_deliveries
BEGIN SELECT RAISE(ABORT,'JOB_CORRECTION_DELIVERY_RETAINED'); END;

CREATE TRIGGER creditex_job_correction_delivery_scope_guard BEFORE INSERT ON creditex_job_correction_deliveries
WHEN NOT EXISTS (SELECT 1 FROM creditex_job_lifecycle_events e WHERE e.id=NEW.event_id AND e.action='correction_required'
  AND e.work_order_id=NEW.work_order_id AND e.owner_uid=NEW.owner_uid)
BEGIN SELECT RAISE(ABORT,'JOB_CORRECTION_DELIVERY_SCOPE_INVALID'); END;

CREATE TRIGGER creditex_completed_workpack_correction_guard BEFORE INSERT ON compliance_activity_work_pack_instances
WHEN EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances prior WHERE prior.id=NEW.supersedes_instance_id AND prior.status='completed')
AND (NEW.status<>'in_progress' OR NOT EXISTS (
  SELECT 1 FROM creditex_job_lifecycle_events e,json_each(e.source_snapshot,'$.records') source
  WHERE e.action='correction_required' AND e.organisation_id=NEW.organisation_id AND e.work_order_id=NEW.work_order_id
    AND e.intent_id=NEW.compliance_intent_id AND e.actor_uid=NEW.created_by_uid AND e.created_at=NEW.created_at
    AND json_extract(source.value,'$.kind')='pack' AND json_extract(source.value,'$.id')=NEW.supersedes_instance_id
    AND json_extract(source.value,'$.revision')=NEW.revision-1))
BEGIN SELECT RAISE(ABORT,'COMPLETED_WORKPACK_CORRECTION_REQUIRED'); END;

CREATE TRIGGER creditex_registry_batch_business_review_guard BEFORE INSERT ON creditex_registry_batch_items
WHEN NOT EXISTS (SELECT 1 FROM compliance_output_action_packets packet
 JOIN compliance_cases c ON c.id=packet.compliance_case_id AND c.organisation_id=packet.organisation_id
 JOIN trade_work_order_compliance_intents intent ON intent.id=c.compliance_intent_id
   AND intent.compliance_organisation_id=c.organisation_id AND intent.work_order_id=c.work_order_id AND intent.installer_uid=c.installer_uid
 JOIN creditex_job_lifecycle_events review ON review.intent_id=intent.id AND review.organisation_id=intent.compliance_organisation_id
   AND review.work_order_id=intent.work_order_id AND review.owner_uid=intent.installer_uid
 WHERE packet.id=NEW.packet_id AND packet.organisation_id=NEW.organisation_id
   AND c.status<>'changes_requested' AND c.evidence_status<>'changes_required'
   AND review.action='reviewed' AND review.actor_kind='trade' AND review.source_snapshot=json_object('intent', intent.id, 'intentRevision', intent.revision,
    'intentSha256', intent.intent_snapshot_sha256,
    'records', json((SELECT COALESCE(json_group_array(json(record)), '[]') FROM (
      SELECT json_object('kind','field','id',f.id,'revision',f.revision,'status',f.status,
        'sha256',f.pdf_sha256,'objectKey',f.pdf_object_key) record, 'field:' || f.id sort_key
      FROM trade_activity_field_records f WHERE f.intent_id=intent.id
        AND f.work_order_id=intent.work_order_id AND f.owner_uid=intent.installer_uid
        AND f.organisation_id=intent.compliance_organisation_id
        AND NOT EXISTS (SELECT 1 FROM trade_activity_field_records successor WHERE successor.supersedes_record_id=f.id)
      UNION ALL
      SELECT json_object('kind','pack','id',p.id,'revision',p.revision,'status',p.status,
        'finals',json((SELECT COALESCE(json_group_array(json(final)), '[]') FROM (
          SELECT json_object('id',r.id,'sha256',r.pdf_sha256,'objectKey',r.object_key) final
          FROM compliance_activity_work_pack_final_records r
          WHERE r.case_instance_id=p.id AND r.organisation_id=p.organisation_id ORDER BY r.id)))) record,
        'pack:' || p.id sort_key
      FROM compliance_activity_work_pack_instances p
      WHERE p.compliance_intent_id=intent.id AND p.work_order_id=intent.work_order_id
        AND p.organisation_id=intent.compliance_organisation_id
        AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances newer
          WHERE newer.organisation_id=p.organisation_id AND newer.instance_key=p.instance_key AND newer.revision>p.revision)
      ORDER BY sort_key))) )
   AND NOT EXISTS (SELECT 1 FROM creditex_job_lifecycle_events newer WHERE newer.organisation_id=review.organisation_id
     AND newer.intent_id=review.intent_id AND newer.work_order_id=review.work_order_id AND newer.owner_uid=review.owner_uid
     AND newer.action IN ('reviewed','correction_required')
     AND (newer.created_at>review.created_at OR (newer.created_at=review.created_at AND newer.id>review.id))))
BEGIN SELECT RAISE(ABORT,'REGISTRY_BATCH_BUSINESS_REVIEW_REQUIRED'); END;

CREATE TRIGGER trade_job_cancel_completion_history_guard BEFORE UPDATE OF stage ON trade_work_orders
WHEN NEW.stage='cancelled' AND OLD.stage<>'cancelled' AND (old.stage='completed'
    OR EXISTS (SELECT 1 FROM trade_crm_job_details d WHERE d.work_order_id=old.id
      AND d.firebase_uid=old.firebase_uid AND d.pipeline_stage IN ('complete','invoiced','paid'))
    OR EXISTS (SELECT 1 FROM trade_activity_field_records f WHERE f.work_order_id=old.id
      AND f.owner_uid=old.firebase_uid AND (f.status='submitted_for_creditex_review' OR f.submitted_at<>''))
    OR EXISTS (SELECT 1 FROM trade_activity_field_record_versions v JOIN trade_activity_field_records f ON f.id=v.record_id
      WHERE f.work_order_id=old.id AND f.owner_uid=old.firebase_uid
        AND json_extract(v.payload,'$.status')='submitted_for_creditex_review')
    OR EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances p
      JOIN trade_work_order_compliance_intents i ON i.id=p.compliance_intent_id
        AND i.compliance_organisation_id=p.organisation_id
      WHERE p.work_order_id=old.id AND i.installer_uid=old.firebase_uid
        AND (p.status='completed' OR EXISTS (SELECT 1 FROM compliance_activity_work_pack_final_records r
          WHERE r.case_instance_id=p.id AND r.organisation_id=p.organisation_id)))
    OR EXISTS (SELECT 1 FROM trade_job_forms f WHERE f.work_order_id=old.id AND f.firebase_uid=old.firebase_uid AND f.status='complete')
    OR EXISTS (SELECT 1 FROM trade_work_order_events e WHERE e.work_order_id=old.id AND e.firebase_uid=old.firebase_uid
      AND (e.event_type IN ('completed','job_completed') OR (e.event_type='stage_changed' AND lower(e.summary) LIKE '%completed%'))))
BEGIN SELECT RAISE(ABORT,'JOB_CANCEL_COMPLETED'); END;
