/** Field completion is the trade-to-Creditex handoff, not certificate creation.
 * Match every tenant, intent, organisation and activity before accepting it. */
export function submittedActivityFieldRecordSql(intentAlias: string) {
  if (!["planned_intent", "active_intent", "field_intent"].includes(intentAlias)) throw new Error("INVALID_ACTIVITY_SQL_ALIAS");
  return `SELECT 1 FROM trade_activity_field_records field_record
    WHERE field_record.intent_id = ${intentAlias}.id
      AND field_record.work_order_id = ${intentAlias}.work_order_id
      AND field_record.owner_uid = ${intentAlias}.installer_uid
      AND field_record.organisation_id = ${intentAlias}.compliance_organisation_id
      AND field_record.activity_template_id = ${intentAlias}.activity_template_id
      AND field_record.status = 'submitted_for_creditex_review'
      AND field_record.pdf_object_key <> '' AND length(field_record.pdf_sha256) = 64`;
}

export const UNFINISHED_ACTIVITY_FIELD_INTENTS_SQL = `SELECT 1
  FROM trade_work_order_compliance_intents field_intent
  WHERE field_intent.work_order_id = ? AND field_intent.installer_uid = ?
    AND field_intent.status IN ('planned', 'case_linked')
    AND NOT EXISTS (${submittedActivityFieldRecordSql("field_intent")})
    AND NOT EXISTS (
      SELECT 1 FROM compliance_activity_work_pack_instances current_pack
      JOIN compliance_cases linked_case ON linked_case.id = current_pack.compliance_case_id
        AND linked_case.compliance_intent_id = field_intent.id AND linked_case.installer_uid = field_intent.installer_uid
        AND linked_case.work_order_id = field_intent.work_order_id AND linked_case.organisation_id = field_intent.compliance_organisation_id
        AND linked_case.status NOT IN ('rejected', 'closed')
      WHERE current_pack.compliance_intent_id = field_intent.id
        AND current_pack.work_order_id = field_intent.work_order_id AND current_pack.organisation_id = field_intent.compliance_organisation_id
        AND current_pack.status = 'completed'
        AND EXISTS (SELECT 1 FROM compliance_activity_work_pack_final_records f WHERE f.case_instance_id = current_pack.id
          AND f.organisation_id = current_pack.organisation_id AND f.instance_key = current_pack.instance_key
          AND f.work_pack_version_id = current_pack.work_pack_version_id)
        AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances newer
          WHERE newer.organisation_id = current_pack.organisation_id AND newer.compliance_case_id = current_pack.compliance_case_id
            AND newer.revision > current_pack.revision)
    )`;

export function submittedActivityFieldCaseSql(caseAlias: string) {
  if (!["compliance_case", "governed_case"].includes(caseAlias)) throw new Error("INVALID_ACTIVITY_SQL_ALIAS");
  return `SELECT 1 FROM trade_work_order_compliance_intents field_intent
    WHERE field_intent.id = ${caseAlias}.compliance_intent_id
      AND field_intent.work_order_id = ${caseAlias}.work_order_id
      AND field_intent.installer_uid = ${caseAlias}.installer_uid
      AND field_intent.compliance_organisation_id = ${caseAlias}.organisation_id
      AND field_intent.status IN ('planned', 'case_linked')
      AND EXISTS (${submittedActivityFieldRecordSql("field_intent")})`;
}
