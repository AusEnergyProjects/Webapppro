-- Imported records are historical until the business explicitly starts work in TLink.
-- Retain original dates, source statuses, evidence and immutable audit history.
WITH changed_jobs AS (
  SELECT w.id, w.firebase_uid, w.revision + 1 revision, w.assignee_member_id
  FROM trade_work_orders w
  WHERE w.source_type = 'import' AND w.record_status = 'active' AND (
    w.stage <> 'imported'
    OR EXISTS (SELECT 1 FROM trade_crm_job_details d WHERE d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid AND d.pipeline_stage <> 'imported')
    OR EXISTS (SELECT 1 FROM trade_crm_appointments a WHERE a.id = w.id || ':visit' AND a.work_order_id = w.id AND a.firebase_uid = w.firebase_uid AND a.status <> 'imported')
  )
), audiences AS (
  SELECT id, firebase_uid, revision, '' member_id FROM changed_jobs
  UNION
  SELECT id, firebase_uid, revision, assignee_member_id FROM changed_jobs WHERE assignee_member_id <> ''
  UNION
  SELECT w.id, w.firebase_uid, w.revision, a.assignee_member_id
  FROM changed_jobs w JOIN trade_crm_appointments a ON a.work_order_id = w.id AND a.firebase_uid = w.firebase_uid
  WHERE a.assignee_member_id <> '' AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'completed')
)
INSERT INTO trade_team_sync_changes (owner_uid, audience_member_id, entity_type, entity_id, operation, revision, changed_at)
SELECT firebase_uid, member_id, 'job', id, 'upsert', revision, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM audiences;
--> statement-breakpoint
UPDATE trade_work_orders AS w
SET stage = 'imported', revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE w.source_type = 'import' AND w.record_status = 'active' AND (
  w.stage <> 'imported'
  OR EXISTS (SELECT 1 FROM trade_crm_job_details d WHERE d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid AND d.pipeline_stage <> 'imported')
  OR EXISTS (SELECT 1 FROM trade_crm_appointments a WHERE a.id = w.id || ':visit' AND a.work_order_id = w.id AND a.firebase_uid = w.firebase_uid AND a.status <> 'imported')
);
--> statement-breakpoint
UPDATE trade_crm_job_details AS d
SET pipeline_stage = 'imported', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE d.pipeline_stage <> 'imported' AND EXISTS (
  SELECT 1 FROM trade_work_orders w WHERE w.id = d.work_order_id AND w.firebase_uid = d.firebase_uid
    AND w.source_type = 'import' AND w.record_status = 'active'
);
--> statement-breakpoint
UPDATE trade_crm_appointments AS a
SET status = 'imported', revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE a.id = a.work_order_id || ':visit' AND a.status <> 'imported' AND EXISTS (
  SELECT 1 FROM trade_work_orders w WHERE w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
    AND w.source_type = 'import' AND w.record_status = 'active'
);
