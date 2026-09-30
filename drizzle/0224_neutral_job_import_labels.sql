-- Change only unedited, generated copy tied to an owned import source.
-- Source cells, identifiers and immutable audit rows remain unchanged.
UPDATE trade_work_orders AS w
SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE w.record_status = 'active' AND EXISTS (
  SELECT 1 FROM trade_dataforce_sources s
  LEFT JOIN trade_crm_job_details d ON d.work_order_id = s.work_order_id AND d.firebase_uid = s.firebase_uid
  LEFT JOIN trade_crm_appointments a ON a.id = s.work_order_id || ':visit'
    AND a.work_order_id = s.work_order_id AND a.firebase_uid = s.firebase_uid
  WHERE s.work_order_id = w.id AND s.firebase_uid = w.firebase_uid AND (
    d.tags = '["Dataforce import"]'
    OR d.description = 'Imported Dataforce job ' || s.source_job_id || '. Original status: '
      || json_extract(s.raw_json, '$.Status')
      || CASE WHEN json_extract(s.raw_json, '$.SubStatus') <> '' THEN ' / ' || json_extract(s.raw_json, '$.SubStatus') ELSE '' END || '.'
    OR a.notes = 'Imported Dataforce appointment ' || s.source_app_id
      || '. Original time retained; worker assignment needs confirmation in TLink.'
  )
);
--> statement-breakpoint
WITH changed_jobs AS (
  SELECT w.id, w.firebase_uid, w.revision, w.updated_at, w.assignee_member_id
  FROM trade_work_orders w
  JOIN trade_dataforce_sources s ON s.work_order_id = w.id AND s.firebase_uid = w.firebase_uid
  LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
  LEFT JOIN trade_crm_appointments a ON a.id = w.id || ':visit'
    AND a.work_order_id = w.id AND a.firebase_uid = w.firebase_uid
  WHERE w.record_status = 'active' AND (
    d.tags = '["Dataforce import"]'
    OR d.description = 'Imported Dataforce job ' || s.source_job_id || '. Original status: '
      || json_extract(s.raw_json, '$.Status')
      || CASE WHEN json_extract(s.raw_json, '$.SubStatus') <> '' THEN ' / ' || json_extract(s.raw_json, '$.SubStatus') ELSE '' END || '.'
    OR a.notes = 'Imported Dataforce appointment ' || s.source_app_id
      || '. Original time retained; worker assignment needs confirmation in TLink.'
  )
), audiences AS (
  SELECT id, firebase_uid, revision, updated_at, '' member_id FROM changed_jobs
  UNION
  SELECT id, firebase_uid, revision, updated_at, assignee_member_id FROM changed_jobs WHERE assignee_member_id <> ''
  UNION
  SELECT w.id, w.firebase_uid, w.revision, w.updated_at, a.assignee_member_id
  FROM changed_jobs w JOIN trade_crm_appointments a ON a.work_order_id = w.id AND a.firebase_uid = w.firebase_uid
  WHERE a.assignee_member_id <> '' AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'completed')
)
INSERT INTO trade_team_sync_changes (owner_uid, audience_member_id, entity_type, entity_id, operation, revision, changed_at)
SELECT firebase_uid, member_id, 'job', id, 'upsert', revision, updated_at FROM audiences;
--> statement-breakpoint
UPDATE trade_crm_customers AS c
SET tags = '["Job import"]', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE c.tags = '["Dataforce import"]' AND EXISTS (
  SELECT 1 FROM trade_dataforce_sources s WHERE s.customer_id = c.id AND s.firebase_uid = c.firebase_uid
);
--> statement-breakpoint
UPDATE trade_crm_job_details AS d
SET tags = CASE WHEN d.tags = '["Dataforce import"]' THEN '["Job import"]' ELSE d.tags END,
  description = CASE WHEN d.description = 'Imported Dataforce job ' || s.source_job_id || '. Original status: '
    || json_extract(s.raw_json, '$.Status')
    || CASE WHEN json_extract(s.raw_json, '$.SubStatus') <> '' THEN ' / ' || json_extract(s.raw_json, '$.SubStatus') ELSE '' END || '.'
    THEN 'Imported job ' || s.source_job_id || '. Original status: ' || json_extract(s.raw_json, '$.Status')
      || CASE WHEN json_extract(s.raw_json, '$.SubStatus') <> '' THEN ' / ' || json_extract(s.raw_json, '$.SubStatus') ELSE '' END || '.'
    ELSE d.description END,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM trade_dataforce_sources s
WHERE s.work_order_id = d.work_order_id AND s.firebase_uid = d.firebase_uid AND (
  d.tags = '["Dataforce import"]'
  OR d.description = 'Imported Dataforce job ' || s.source_job_id || '. Original status: '
    || json_extract(s.raw_json, '$.Status')
    || CASE WHEN json_extract(s.raw_json, '$.SubStatus') <> '' THEN ' / ' || json_extract(s.raw_json, '$.SubStatus') ELSE '' END || '.'
);
--> statement-breakpoint
UPDATE trade_crm_appointments AS a
SET notes = 'Imported appointment ' || s.source_app_id
    || '. Original time retained; worker assignment needs confirmation in TLink.',
  revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM trade_dataforce_sources s
WHERE a.id = s.work_order_id || ':visit' AND a.work_order_id = s.work_order_id AND a.firebase_uid = s.firebase_uid
  AND a.notes = 'Imported Dataforce appointment ' || s.source_app_id
    || '. Original time retained; worker assignment needs confirmation in TLink.';
