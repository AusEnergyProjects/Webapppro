function alias(value: string) {
  if (!/^[a-z][a-z_]*$/.test(value)) throw new Error("INVALID_LIFECYCLE_SQL_ALIAS");
  return value;
}

/** The entire current completion identity, including drafts that supersede a final. */
export function creditexIntentCompletionSnapshotSql(input = "intent") {
  const i = alias(input);
  return `json_object('intent', ${i}.id, 'intentRevision', ${i}.revision,
    'intentSha256', ${i}.intent_snapshot_sha256,
    'records', json((SELECT COALESCE(json_group_array(json(record)), '[]') FROM (
      SELECT json_object('kind','field','id',f.id,'revision',f.revision,'status',f.status,
        'sha256',f.pdf_sha256,'objectKey',f.pdf_object_key) record, 'field:' || f.id sort_key
      FROM trade_activity_field_records f WHERE f.intent_id=${i}.id
        AND f.work_order_id=${i}.work_order_id AND f.owner_uid=${i}.installer_uid
        AND f.organisation_id=${i}.compliance_organisation_id
        AND NOT EXISTS (SELECT 1 FROM trade_activity_field_records successor WHERE successor.supersedes_record_id=f.id)
      UNION ALL
      SELECT json_object('kind','pack','id',p.id,'revision',p.revision,'status',p.status,
        'finals',json((SELECT COALESCE(json_group_array(json(final)), '[]') FROM (
          SELECT json_object('id',r.id,'sha256',r.pdf_sha256,'objectKey',r.object_key) final
          FROM compliance_activity_work_pack_final_records r
          WHERE r.case_instance_id=p.id AND r.organisation_id=p.organisation_id ORDER BY r.id)))) record,
        'pack:' || p.id sort_key
      FROM compliance_activity_work_pack_instances p
      WHERE p.compliance_intent_id=${i}.id AND p.work_order_id=${i}.work_order_id
        AND p.organisation_id=${i}.compliance_organisation_id
        AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances newer
          WHERE newer.organisation_id=p.organisation_id AND newer.instance_key=p.instance_key AND newer.revision>p.revision)
      ORDER BY sort_key))) )`;
}

export function creditexIntentSubmissionSnapshotSql(input = "intent") {
  const i = alias(input);
  return `(SELECT COALESCE(json_group_array(json(record)), '[]') FROM (
    SELECT json_object('id',p.id,'sha256',p.packet_sha256) record
    FROM compliance_output_action_packets p JOIN compliance_cases c
      ON c.id=p.compliance_case_id AND c.organisation_id=p.organisation_id
    WHERE c.compliance_intent_id=${i}.id AND c.work_order_id=${i}.work_order_id
      AND c.id=${i}.compliance_case_id
      AND c.installer_uid=${i}.installer_uid AND c.organisation_id=${i}.compliance_organisation_id
      AND p.program_code=${i}.program_code AND p.activity_template_id=${i}.activity_template_id AND p.case_revision=c.revision
      AND p.output_code=json_extract(${i}.intent_snapshot,'$.program.claimOutputCode')
      AND NOT EXISTS (SELECT 1 FROM creditex_job_lifecycle_events correction
        WHERE correction.organisation_id=c.organisation_id AND correction.intent_id=${i}.id
          AND correction.work_order_id=${i}.work_order_id AND correction.owner_uid=${i}.installer_uid
          AND correction.action='correction_required' AND correction.created_at>=p.prepared_at)
      AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances pack
        WHERE pack.organisation_id=p.organisation_id AND pack.instance_key=p.work_pack_instance_key AND pack.revision>p.work_pack_revision)
      AND NOT EXISTS (SELECT 1 FROM compliance_output_action_packets newer
        WHERE newer.organisation_id=p.organisation_id AND newer.compliance_case_id=p.compliance_case_id
          AND newer.work_pack_instance_key=p.work_pack_instance_key AND newer.output_code=p.output_code
          AND (newer.work_pack_revision>p.work_pack_revision OR (newer.work_pack_revision=p.work_pack_revision
            AND (newer.case_revision>p.case_revision OR (newer.case_revision=p.case_revision
            AND (newer.prepared_at>p.prepared_at OR (newer.prepared_at=p.prepared_at AND newer.id>p.id)))))))
    ORDER BY p.id))`;
}

export function creditexIntentOpenCorrectionSql(input = "intent") {
  const i=alias(input), snapshot=creditexIntentCompletionSnapshotSql(i);
  return `EXISTS (SELECT 1 FROM creditex_job_lifecycle_events correction
    WHERE correction.organisation_id=${i}.compliance_organisation_id AND correction.work_order_id=${i}.work_order_id
      AND correction.owner_uid=${i}.installer_uid AND correction.intent_id=${i}.id AND correction.action='correction_required'
      AND NOT EXISTS (SELECT 1 FROM creditex_job_lifecycle_events later
        WHERE later.organisation_id=correction.organisation_id AND later.intent_id=correction.intent_id
          AND later.action IN ('reviewed','correction_required')
          AND (later.created_at>correction.created_at OR (later.created_at=correction.created_at AND later.id>correction.id)))
      AND (json_extract(correction.source_snapshot,'$.records')=json_extract(${snapshot},'$.records')
        OR json_array_length(${snapshot},'$.records')=0
        OR EXISTS (SELECT 1 FROM json_each(${snapshot},'$.records') source
          WHERE json_extract(source.value,'$.status') NOT IN ('submitted_for_creditex_review','completed'))))`;
}

/** Includes historical completion so reverting a stage cannot permit cancellation. */
export function creditexJobEverCompletedSql(input = "work") {
  const w = alias(input);
  return `(${w}.stage='completed'
    OR EXISTS (SELECT 1 FROM trade_crm_job_details d WHERE d.work_order_id=${w}.id
      AND d.firebase_uid=${w}.firebase_uid AND d.pipeline_stage IN ('complete','invoiced','paid'))
    OR EXISTS (SELECT 1 FROM trade_activity_field_records f WHERE f.work_order_id=${w}.id
      AND f.owner_uid=${w}.firebase_uid AND (f.status='submitted_for_creditex_review' OR f.submitted_at<>''))
    OR EXISTS (SELECT 1 FROM trade_activity_field_record_versions v JOIN trade_activity_field_records f ON f.id=v.record_id
      WHERE f.work_order_id=${w}.id AND f.owner_uid=${w}.firebase_uid
        AND json_extract(v.payload,'$.status')='submitted_for_creditex_review')
    OR EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances p
      JOIN trade_work_order_compliance_intents i ON i.id=p.compliance_intent_id
        AND i.compliance_organisation_id=p.organisation_id
      WHERE p.work_order_id=${w}.id AND i.installer_uid=${w}.firebase_uid
        AND (p.status='completed' OR EXISTS (SELECT 1 FROM compliance_activity_work_pack_final_records r
          WHERE r.case_instance_id=p.id AND r.organisation_id=p.organisation_id)))
    OR EXISTS (SELECT 1 FROM trade_job_forms f WHERE f.work_order_id=${w}.id AND f.firebase_uid=${w}.firebase_uid AND f.status='complete')
    OR EXISTS (SELECT 1 FROM trade_work_order_events e WHERE e.work_order_id=${w}.id AND e.firebase_uid=${w}.firebase_uid
      AND (e.event_type IN ('completed','job_completed') OR (e.event_type='stage_changed' AND lower(e.summary) LIKE '%completed%'))))`;
}
