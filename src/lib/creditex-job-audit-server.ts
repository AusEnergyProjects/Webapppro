import { createHash } from 'node:crypto';
import { CREDITEX_PARTNER_ORGANISATION_CODE } from './trade-compliance-intent';
import { CREDITEX_AUDIT_SQL, CREDITEX_CASE_CORRECTION_SQL, SUBMISSION_PACKETS_SQL } from './creditex-job-lifecycle-projection';
import { creditexIntentOpenCorrectionSql } from './creditex-job-lifecycle-sql';
import { loadJobLifecycle, reviewTradeJob, type JobLifecycleActor } from './creditex-job-lifecycle-server';
import { getCreditexCustodyBucket } from './creditex-custody-bucket';
import { CREDITEX_JOB_AUDIT_QUESTIONS, CREDITEX_JOB_AUDIT_VERSION, creditexJobAuditComplete,
  type CreditexJobAuditAnswer, type CreditexJobAuditFile, type CreditexJobAuditFileKind,
  type CreditexJobAuditRecord, type CreditexJobAuditSaved, type CreditexJobAuditSaveInput,
  type CreditexJobAuditWorkspace } from './creditex-job-audit';
import type { ActivityRecord } from './trade-activity-form-types';
import type { CreditexActivityWorkPack, CreditexActivityWorkPackResponse } from './creditex-activity-work-pack';
import { creditexPermissionSql } from './creditex-permissions';

export type CreditexJobAuditActor = { kind: 'compliance' | 'admin'; uid: string; organisationId: string; memberId: string; name: string; role: string };
export class CreditexJobAuditError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
const fail = (code: string, message: string, status = 409): never => { throw new CreditexJobAuditError(code, message, status); };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const identifier = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 180) return fail('AUDIT_INPUT', 'Choose a valid audit job.', 400);
  return value.trim();
};
type StoredFile = { id: string; parentId: string; label: string; contentType: string; sizeBytes: number; sha256: string; objectKey: string; capturedAt: string };
type FieldSource = { id: string; revision: number; status: string; pdfKey: string; pdfHash: string; updatedAt: string; payload: ActivityRecord };
type PackSource = { id: string; revision: number; status: string; updatedAt: string; responseHash: string;
  definition: CreditexActivityWorkPack; response: CreditexActivityWorkPackResponse; finals: StoredFile[];
  artifacts: StoredFile[]; signatures: Array<StoredFile & { signerName: string; signerRole: string; action: string; attestation: unknown }> };
type JobFormSource = { id: string; title: string; revision: number; status: string; updatedAt: string;
  template: { fields: { key: string; label: string; section?: string }[] }; answers: Record<string, unknown> };
type Source = { target: CreditexJobAuditWorkspace['target']; intentRevision: number; intentHash: string;
  fieldRecords: FieldSource[]; workPacks: PackSource[]; jobForms: JobFormSource[]; jobMedia: StoredFile[]; caseEvidence: StoredFile[] };
type Context = { source_snapshot: string; source: Source; role: string; can_audit: number; can_call: number; can_correct: number; active: number; submission_ready: number; correction_scope: number; evidence_access: number };
type AuditRow = { id: string; revision: number; outcome: CreditexJobAuditSaved['outcome']; checklist_version: string;
  answers_json: string; call_outcome: CreditexJobAuditSaved['callOutcome']; call_reason: string; call_id: string; note: string;
  source_sha256: string; actor_uid: string; actor_name: string; created_at: string; request_sha256: string; intent_id: string };

function actorSql(actor: CreditexJobAuditActor) {
  return actor.kind === 'admin' ? `SELECT administrator.role, administrator.id member_id, 1 can_audit, 0 can_call, 1 can_correct FROM admin_users administrator
    JOIN compliance_organisations organisation ON organisation.id = ? AND organisation.status = 'active' AND organisation.organisation_code = ?
    WHERE administrator.id = ? AND administrator.firebase_uid = ? AND administrator.status = 'active' AND administrator.role IN ('owner','admin','reviewer')`
    : `SELECT member.role, member.id member_id, ${creditexPermissionSql('audit')} can_audit, ${creditexPermissionSql('customer_calls')} can_call, ${creditexPermissionSql('corrections')} can_correct FROM compliance_users member JOIN compliance_organisations organisation ON organisation.id = member.organisation_id
    WHERE member.organisation_id = ? AND organisation.organisation_code = ? AND organisation.status = 'active'
      AND member.id = ? AND member.firebase_uid = ? AND member.status = 'active' AND member.role IN ('admin','case_manager','reviewer','auditor') AND ${creditexPermissionSql('jobs')}`;
}
function actorBindings(actor: CreditexJobAuditActor) { return [actor.organisationId, CREDITEX_PARTNER_ORGANISATION_CODE, actor.memberId, actor.uid]; }
const jsonRows = (query: string) => `json((SELECT COALESCE(json_group_array(json(item)), '[]') FROM (${query})))`;

/** One SQL snapshot is both the read identity and the compare-and-swap write guard. */
type SourceScope = 'single' | 'all' | 'selection';
function sourceQuery(actor: CreditexJobAuditActor, scope: SourceScope = 'single') {
  const fields = jsonRows(`SELECT json_object('id',f.id,'revision',f.revision,'status',f.status,'pdfKey',f.pdf_object_key,
    'pdfHash',f.pdf_sha256,'updatedAt',f.updated_at,'payload',json(f.payload)) item FROM trade_activity_field_records f
    WHERE f.intent_id=intent.id AND f.organisation_id=intent.compliance_organisation_id AND f.owner_uid=intent.installer_uid
      AND f.work_order_id=intent.work_order_id AND f.activity_template_id=intent.activity_template_id
      AND NOT EXISTS(SELECT 1 FROM trade_activity_field_records newer WHERE newer.supersedes_record_id=f.id AND newer.organisation_id=f.organisation_id)
    ORDER BY f.id`);
  const finals = jsonRows(`SELECT json_object('id',f.id,'parentId',p.id,'label',f.file_name,'contentType',f.content_type,
    'sizeBytes',f.size_bytes,'sha256',f.pdf_sha256,'objectKey',f.object_key,'capturedAt',f.finalised_at) item
    FROM compliance_activity_work_pack_final_records f WHERE f.organisation_id=p.organisation_id AND f.case_instance_id=p.id AND f.instance_key=p.instance_key AND f.work_pack_version_id=p.work_pack_version_id ORDER BY f.id`);
  const artifacts = jsonRows(`SELECT json_object('id',f.id,'parentId',p.id,'label',f.original_file_name,'contentType',f.content_type,
    'sizeBytes',f.size_bytes,'sha256',f.original_sha256,'objectKey',f.object_key,'capturedAt',f.captured_at,
    'metadata',json(f.metadata_snapshot),'metadataSha256',f.metadata_sha256) item
    FROM compliance_activity_work_pack_artifacts f WHERE f.organisation_id=p.organisation_id AND f.instance_key=p.instance_key
      AND NOT EXISTS(SELECT 1 FROM compliance_activity_work_pack_artifacts successor WHERE successor.organisation_id=f.organisation_id AND successor.instance_key=f.instance_key AND successor.supersedes_artifact_id=f.id) ORDER BY f.id`);
  const signatures = jsonRows(`SELECT json_object('id',f.id,'parentId',p.id,'label',f.signer_name||' signature','contentType',f.signature_content_type,
    'sizeBytes',f.signature_size_bytes,'sha256',f.signature_sha256,'objectKey',f.signature_object_key,'capturedAt',f.signed_at,
    'signerName',f.signer_name,'signerRole',f.signer_role,'action',f.action,'attestation',json(f.attestation_snapshot),
    'payload',json(f.signature_payload_snapshot)) item FROM compliance_activity_work_pack_signatures f
    WHERE f.organisation_id=p.organisation_id AND f.instance_key=p.instance_key
      AND NOT EXISTS(SELECT 1 FROM compliance_activity_work_pack_signatures successor WHERE successor.organisation_id=f.organisation_id AND successor.instance_key=f.instance_key AND successor.supersedes_signature_id=f.id) ORDER BY f.id`);
  const packs = jsonRows(`SELECT json_object('id',p.id,'revision',p.revision,'status',p.status,'updatedAt',p.created_at,
    'responseHash',p.response_sha256,'definition',json(v.schema_snapshot),'response',json(p.response_snapshot),'finals',${finals},'artifacts',${artifacts},'signatures',${signatures}) item
    FROM compliance_activity_work_pack_instances p JOIN compliance_activity_work_pack_versions v ON v.id=p.work_pack_version_id AND v.organisation_id=p.organisation_id
    WHERE p.organisation_id=intent.compliance_organisation_id AND p.work_order_id=intent.work_order_id
      AND (p.compliance_intent_id=intent.id OR (p.compliance_intent_id='' AND p.compliance_case_id=linked_case.id))
      AND NOT EXISTS(SELECT 1 FROM compliance_activity_work_pack_instances newer WHERE newer.organisation_id=p.organisation_id AND newer.instance_key=p.instance_key AND newer.revision>p.revision)
    ORDER BY p.instance_key,p.id`);
  const forms = jsonRows(`SELECT json_object('id',f.id,'title',f.template_name,'revision',f.revision,'status',f.status,
    'updatedAt',f.updated_at,'template',json(f.template_snapshot),'answers',json(f.answers)) item FROM trade_job_forms f
    WHERE f.work_order_id=work.id AND f.firebase_uid=work.firebase_uid ORDER BY f.id`);
  const media = jsonRows(`SELECT json_object('id',f.id,'parentId',work.id,'label',f.file_name,'contentType',f.content_type,
    'sizeBytes',f.size_bytes,'sha256',f.original_sha256,'objectKey',f.object_key,'capturedAt',f.created_at) item
    FROM trade_crm_job_media f WHERE f.work_order_id=work.id AND f.firebase_uid=work.firebase_uid ORDER BY f.id`);
  const evidence = jsonRows(`SELECT json_object('id',f.id,'parentId',linked_case.id,'label',f.file_name,'contentType',f.content_type,
    'sizeBytes',f.size_bytes,'sha256',f.original_sha256,'objectKey',f.object_key,'capturedAt',f.received_at,'status',f.status,'updatedAt',f.updated_at) item
    FROM compliance_case_evidence f WHERE f.case_id=linked_case.id AND f.organisation_id=linked_case.organisation_id ORDER BY f.id`);
  return `WITH actor AS (${actorSql(actor)}) SELECT actor.role, actor.can_audit, actor.can_call, actor.can_correct,
    CASE WHEN work.record_status='active' AND work.stage NOT IN ('cancelled','imported') AND intent.status IN ('planned','case_linked') THEN 1 ELSE 0 END active,
    ${actor.kind === 'admin' ? '1' : `actor.role='admin' OR NOT EXISTS(SELECT 1 FROM trade_work_order_compliance_intents affected
      WHERE affected.work_order_id=work.id AND affected.installer_uid=work.firebase_uid AND affected.compliance_organisation_id=intent.compliance_organisation_id
        AND affected.status IN ('planned','case_linked') AND affected.compliance_case_id<>''
        AND NOT EXISTS(SELECT 1 FROM compliance_cases affected_case JOIN compliance_case_assignments assignment ON assignment.case_id=affected_case.id AND assignment.organisation_id=affected_case.organisation_id
          WHERE affected_case.id=affected.compliance_case_id AND affected_case.compliance_intent_id=affected.id AND affected_case.work_order_id=work.id AND affected_case.installer_uid=work.firebase_uid
            AND affected_case.organisation_id=intent.compliance_organisation_id AND assignment.compliance_user_id=actor.member_id AND assignment.status='assigned'))`} correction_scope,
    ${actor.kind === 'admin' ? '1' : `(actor.role='admin' OR EXISTS(SELECT 1 FROM compliance_case_assignments assignment WHERE assignment.organisation_id=intent.compliance_organisation_id AND assignment.case_id=linked_case.id
      AND assignment.compliance_user_id=actor.member_id AND assignment.status='assigned'
      AND ((actor.role='reviewer' AND assignment.assignment_role IN ('primary_reviewer','secondary_reviewer')) OR (actor.role='auditor' AND assignment.assignment_role='auditor'))))`} evidence_access,
    ${CREDITEX_AUDIT_SQL} submission_ready,
    ${scope === 'single' ? '' : `(${creditexIntentOpenCorrectionSql()} OR ${CREDITEX_CASE_CORRECTION_SQL}) correction_required, ${SUBMISSION_PACKETS_SQL} packets,`}
    json_object('target',json_object('intentId',intent.id,'caseId',COALESCE(linked_case.id,''),'workOrderId',work.id,'ownerUid',work.firebase_uid,
      'jobRevision',work.revision,'caseRevision',COALESCE(linked_case.revision,0),'jobNumber',work.work_number,'jobTitle',work.title,
      'activityDate',COALESCE(linked_case.activity_date,substr(intent.planned_start,1,10)), 'activityTitle',COALESCE(json_extract(intent.intent_snapshot,'$.activity.title'),intent.activity_template_id),
      'customerName',COALESCE(NULLIF(trim(COALESCE(customer.first_name,'')||' '||COALESCE(customer.last_name,'')),''),customer.business_name,''),
      'customerPhone',COALESCE(customer.phone,''),'siteAddress',trim(COALESCE(site.address_line_1,'')||' '||COALESCE(site.address_line_2,'')||' '||COALESCE(site.suburb,'')||' '||COALESCE(site.address_state,'')||' '||COALESCE(site.postcode,'')),
      'assignee',work.assignee_label,'addressReviewRequired',CASE WHEN site.address_entry_mode='provider_selected' AND site.address_provider<>'' AND site.address_provider_reference<>'' AND site.address_formatted<>'' AND site.address_verified_at<>'' THEN json('false') ELSE json('true') END,
      'addressVerificationLabel',CASE WHEN site.address_entry_mode='provider_selected' AND site.address_provider<>'' AND site.address_provider_reference<>'' AND site.address_formatted<>'' AND site.address_verified_at<>'' THEN 'Provider verified address' ELSE 'Manually entered address: review required' END),
      'intentRevision',intent.revision,'intentHash',intent.intent_snapshot_sha256,
      'fieldRecords',${fields},'workPacks',${packs},'jobForms',${forms},'jobMedia',${media},'caseEvidence',${evidence}) source_snapshot
    FROM actor CROSS JOIN trade_work_order_compliance_intents intent
    JOIN trade_work_orders work ON work.id=intent.work_order_id AND work.firebase_uid=intent.installer_uid AND work.partner_type='installer' AND work.source_type='internal'
    LEFT JOIN compliance_cases linked_case ON linked_case.id=intent.compliance_case_id AND linked_case.organisation_id=intent.compliance_organisation_id AND linked_case.work_order_id=work.id AND linked_case.installer_uid=work.firebase_uid AND linked_case.compliance_intent_id=intent.id
    JOIN trade_crm_job_details details ON details.work_order_id=work.id AND details.firebase_uid=work.firebase_uid AND details.customer_source='trade_owned'
    JOIN trade_crm_customers customer ON customer.id=details.crm_customer_id AND customer.firebase_uid=work.firebase_uid
    JOIN trade_crm_service_sites site ON site.id=details.service_site_id AND site.firebase_uid=work.firebase_uid AND site.customer_id=customer.id
    WHERE ${scope === 'single' ? 'intent.id=? AND' : scope === 'selection' ? 'intent.id IN (SELECT value FROM json_each(?)) AND' : ''} intent.compliance_organisation_id=?
      AND (COALESCE(intent.compliance_case_id,'')='' OR (linked_case.id IS NOT NULL AND (${actor.kind === 'admin' ? '1=1' : `actor.role='admin' OR EXISTS(SELECT 1 FROM compliance_case_assignments assignment WHERE assignment.organisation_id=linked_case.organisation_id AND assignment.case_id=linked_case.id AND assignment.compliance_user_id=? AND assignment.status='assigned')`})))`;
}
function sourceBindings(actor: CreditexJobAuditActor, intentId: string, scope: SourceScope = 'single') {
  return [...actorBindings(actor), ...(scope === 'all' ? [] : [intentId]), actor.organisationId, ...(actor.kind === 'compliance' ? [actor.memberId] : [])];
}
function auditProjection(actor: CreditexJobAuditActor, scope: 'all' | 'selection') {
  return `WITH sources AS MATERIALIZED (${sourceQuery(actor, scope)}), projected AS (
    SELECT json_extract(source.source_snapshot,'$.target.intentId') intent_id, source.submission_ready,
      (source.correction_required OR EXISTS(SELECT 1 FROM json_each(source.packets) packet WHERE json_extract(packet.value,'$.status')='rejected' AND json_extract(packet.value,'$.lodged')<>1)) correction_required,
      (json_array_length(source.packets)>0 AND NOT EXISTS(SELECT 1 FROM json_each(source.packets) packet WHERE json_extract(packet.value,'$.lodged')<>1)) submitted,
      COALESCE((SELECT audit.outcome='audited' AND audit.source_snapshot=source.source_snapshot FROM creditex_job_audit_versions audit
        WHERE audit.organisation_id=? AND audit.intent_id=json_extract(source.source_snapshot,'$.target.intentId') ORDER BY audit.revision DESC LIMIT 1),0) audit_completed,
      (json_array_length(source.source_snapshot,'$.fieldRecords')+json_array_length(source.source_snapshot,'$.workPacks')>0
        AND NOT EXISTS(SELECT 1 FROM json_each(source.source_snapshot,'$.fieldRecords') field WHERE json_extract(field.value,'$.status')<>'submitted_for_creditex_review' OR length(json_extract(field.value,'$.pdfHash'))<>64 OR json_extract(field.value,'$.pdfKey')='')
        AND NOT EXISTS(SELECT 1 FROM json_each(source.source_snapshot,'$.workPacks') pack WHERE json_extract(pack.value,'$.status')<>'completed' OR json_array_length(pack.value,'$.finals')=0)) records_complete
    FROM sources source WHERE source.active=1)
  `;
}
export async function loadCreditexAuditDashboard(db: D1Database, actor: CreditexJobAuditActor) {
  const result = await db.prepare(`${auditProjection(actor, 'all')} SELECT COUNT(*) total,
    COALESCE(SUM(records_complete AND NOT audit_completed AND NOT correction_required AND NOT submitted),0) awaitingAudit,
    COALESCE(SUM(correction_required),0) correctionsRequired, COALESCE(SUM(audit_completed),0) auditCompleted,
    COALESCE(SUM(submission_ready AND NOT correction_required AND NOT submitted),0) readyForSubmission,
    COALESCE(SUM(NOT records_complete AND NOT correction_required AND NOT submitted),0) inProgress FROM projected`)
    .bind(...sourceBindings(actor, '', 'all'), actor.organisationId)
    .first<{ total: number; awaitingAudit: number; correctionsRequired: number; auditCompleted: number; readyForSubmission: number; inProgress: number }>();
  if (!result) return fail('AUDIT_UNAVAILABLE', 'The audit workload could not be loaded.', 503);
  return { ...result, countsUnit: 'activities' as const };
}
export async function loadCreditexAuditSummaries(db: D1Database, actor: CreditexJobAuditActor, intentIds: readonly string[]) {
  if (intentIds.length > 100) return fail('AUDIT_INPUT', 'Request at most 100 activity summaries at a time.', 400);
  if (!intentIds.length) return [];
  const result = await db.prepare(`${auditProjection(actor, 'selection')} SELECT intent_id, audit_completed, correction_required FROM projected`)
    .bind(...sourceBindings(actor, JSON.stringify(intentIds.map(identifier)), 'selection'), actor.organisationId)
    .all<{ intent_id: string; audit_completed: number; correction_required: number }>();
  return result.results.map(row => ({ intentId: row.intent_id, auditCompleted: Boolean(row.audit_completed), correctionRequired: Boolean(row.correction_required) }));
}
async function context(db: D1Database, actor: CreditexJobAuditActor, intentId: string): Promise<Context> {
  const row = await db.prepare(sourceQuery(actor)).bind(...sourceBindings(actor, identifier(intentId))).first<Omit<Context, 'source'>>();
  if (!row) return fail('AUDIT_NOT_FOUND', 'This audit job is unavailable or is no longer assigned to you.', 404);
  return { ...row, source: JSON.parse(row.source_snapshot) };
}
function publicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/object_?key|token|secret|credential/i.test(key)).map(([key, item]) => [key, publicValue(item)]));
  return value;
}
function records(source: Source): CreditexJobAuditRecord[] {
  return [
    ...source.fieldRecords.map(row => ({ kind: 'field' as const, id: row.id, title: row.payload.form.title, revision: row.revision, status: row.status, updatedAt: row.updatedAt,
      answers: [...Object.entries(row.payload.answers).map(([key, value]) => { const field = row.payload.form.fields.find(item => item.key === key.replace(/\[\d+\]$/, '')); return { key, label: field?.label || key, section: field?.section || '', value: publicValue(value) }; }),
        ...row.payload.signatures.map(signature => ({ key: `signature:${signature.id}`, label: `${signature.role} declaration`, section: 'Signatures',
          value: { signerName: signature.signerName, signedAt: signature.signedAt, phase: signature.phase, declaration: signature.declarationText, declarationSha256: signature.declarationSha256 } }))] })),
    ...source.workPacks.map(row => ({ kind: 'work_pack' as const, id: row.id, title: row.definition.title, revision: row.revision, status: row.status, updatedAt: row.updatedAt,
      answers: [...Object.entries(row.response.answers).map(([key, value]) => { const section = row.definition.sections.find(item => item.prompts.some(prompt => prompt.promptKey === key)); const prompt = section?.prompts.find(item => item.promptKey === key); return { key, label: prompt?.label || key, section: section?.title || '', value: publicValue(value) }; }),
        ...Object.entries(row.response.repeatableSections).flatMap(([sectionKey, instances]) => instances.flatMap(instance => Object.entries(instance.answers).map(([key, value]) => { const section = row.definition.sections.find(item => item.sectionKey === sectionKey); return { key: `${sectionKey}:${instance.instanceKey}:${key}`, label: section?.prompts.find(item => item.promptKey === key)?.label || key, section: section?.title || sectionKey, value: publicValue(value) }; }))),
        ...row.signatures.map(signature => ({ key: `signature:${signature.id}`, label: `${signature.signerRole} declaration`, section: 'Signatures',
          value: { signerName: signature.signerName, signedAt: signature.capturedAt, status: signature.action, attestation: publicValue(signature.attestation) } })) ] })),
    ...source.jobForms.map(row => ({ kind: 'job_form' as const, id: row.id, title: row.title, revision: row.revision, status: row.status, updatedAt: row.updatedAt,
      answers: Object.entries(row.answers).map(([key, value]) => { const field = row.template.fields.find(item => item.key === key); return { key, label: field?.label || key, section: field?.section || '', value: publicValue(value) }; }) })),
  ];
}
function storedFiles(source: Source): Array<StoredFile & { kind: CreditexJobAuditFileKind }> {
  return [
    ...source.fieldRecords.flatMap(row => [
      ...row.payload.evidence.map(file => ({ kind: 'field_evidence' as const, id: file.id, parentId: row.id, label: file.fileName, contentType: file.contentType, sizeBytes: file.size, sha256: file.sha256, objectKey: file.objectKey, capturedAt: file.capturedAt })),
      ...(row.status === 'submitted_for_creditex_review' && row.pdfKey ? [{ kind: 'field_pdf' as const, id: row.id, parentId: row.id, label: `${row.payload.recordNumber}.pdf`, contentType: 'application/pdf', sizeBytes: 0, sha256: row.pdfHash, objectKey: row.pdfKey, capturedAt: row.payload.submittedAt }] : []),
    ]),
    ...source.workPacks.flatMap(row => row.finals.map(file => ({ ...file, kind: 'work_pack_pdf' as const }))),
    ...source.workPacks.flatMap(row => row.artifacts.map(file => ({ ...file, kind: 'work_pack_evidence' as const }))),
    ...source.workPacks.flatMap(row => row.signatures.filter(file => file.action === 'captured').map(file => ({ ...file, kind: 'work_pack_signature' as const }))),
    ...source.jobMedia.map(file => ({ ...file, kind: 'job_media' as const })),
    ...source.caseEvidence.map(file => ({ ...file, kind: 'case_evidence' as const })),
  ];
}
function fileDto(file: StoredFile & { kind: CreditexJobAuditFileKind }, actor: CreditexJobAuditActor, intentId: string, evidenceAccess: boolean): CreditexJobAuditFile {
  // Compliance evidence keeps its existing receipt-generating viewer and reviewer gates.
  const previewPath = file.kind === 'case_evidence' && actor.kind === 'compliance' ? `/api/creditex/evidence/${encodeURIComponent(file.id)}`
    : `/api/creditex/job-audit/file?intentId=${encodeURIComponent(intentId)}&kind=${file.kind}&id=${encodeURIComponent(file.id)}&parentId=${encodeURIComponent(file.parentId)}${actor.kind === 'admin' ? '&actorMode=admin' : ''}`;
  const restricted = file.kind === 'case_evidence' && !evidenceAccess;
  return { kind: file.kind, id: file.id, parentId: file.parentId, label: file.label, contentType: file.contentType, sizeBytes: file.sizeBytes, sha256: file.sha256, capturedAt: file.capturedAt,
    previewPath: restricted ? '' : previewPath, ...(restricted ? { unavailableReason: 'This evidence requires an assigned reviewer or auditor to open it.' } : {}) };
}
function saved(row: AuditRow): CreditexJobAuditSaved {
  return { id: row.id, revision: row.revision, outcome: row.outcome, checklistVersion: row.checklist_version, answers: JSON.parse(row.answers_json),
    callOutcome: row.call_outcome, callReason: row.call_reason, callId: row.call_id, note: row.note, sourceSha256: row.source_sha256,
    actorUid: row.actor_uid, actorName: row.actor_name, createdAt: row.created_at };
}
function lifecycleActor(actor: CreditexJobAuditActor, role: string): JobLifecycleActor {
  return actor.kind === 'compliance'
    ? { kind: 'compliance', uid: actor.uid, organisationId: actor.organisationId, memberId: actor.memberId, role }
    : { kind: 'admin', uid: actor.uid, organisationId: actor.organisationId, role };
}
async function loadWorkspace(db: D1Database, actor: CreditexJobAuditActor, intentId: string): Promise<CreditexJobAuditWorkspace> {
  const current = await context(db, actor, intentId), sourceSha256 = hash(current.source_snapshot);
  const history = await db.prepare(`SELECT audit.* FROM creditex_job_audit_versions audit
    WHERE audit.organisation_id=? AND audit.intent_id=? AND EXISTS(SELECT 1 FROM (${sourceQuery(actor)}) live)
    ORDER BY audit.revision DESC`).bind(actor.organisationId, intentId, ...sourceBindings(actor, intentId)).all<AuditRow>();
  const latest = history.results[0] ? saved(history.results[0]) : null;
  const lifecycle = await loadJobLifecycle(db, lifecycleActor(actor, current.role), intentId);
  const realRecords = [...current.source.fieldRecords, ...current.source.workPacks];
  const complete = realRecords.length > 0 && current.source.fieldRecords.every(row => row.status === 'submitted_for_creditex_review' && Boolean(row.pdfKey) && row.pdfHash.length === 64)
    && current.source.workPacks.every(row => row.status === 'completed' && row.finals.length > 0);
  return { target: current.source.target, sourceSha256, records: records(current.source), files: storedFiles(current.source).map(file => fileDto(file, actor, intentId, Boolean(current.evidence_access))),
    checklist: latest, history: history.results.map(saved), auditCompleted: latest?.outcome === 'audited' && latest.sourceSha256 === sourceSha256,
    submissionReady: Boolean(current.submission_ready), capabilities: { canSave: Boolean(current.active && current.can_audit), canComplete: Boolean(current.active && current.can_audit && complete), canCall: Boolean(current.can_call),
      canRequestCorrection: Boolean(current.active && current.can_correct && current.correction_scope && lifecycle.capabilities.canRequestCorrection),
      reason: !current.can_audit ? 'Your team access allows viewing this job. Audit permission is required to change its audit.' : !current.active ? 'This job is inactive, imported or superseded.' : !complete ? 'The assigned field forms must be completed before completing the audit.' : '' } };
}
export async function loadCreditexJobAudit(db: D1Database, actor: CreditexJobAuditActor, intentId: string) {
  const workspace = await loadWorkspace(db, actor, intentId);
  const latest = await context(db, actor, intentId);
  if (hash(latest.source_snapshot) !== workspace.sourceSha256) return fail('AUDIT_SOURCE_CHANGED', 'The job changed while opening the audit. Refresh and try again.');
  await accessReceipt(db, actor, latest, 'job.audit_opened', 'creditex_job_audit', intentId);
  return workspace;
}
async function accessReceipt(db: D1Database, actor: CreditexJobAuditActor, current: Context, eventType: string, targetType: string, targetId: string) {
  const result = await db.prepare(`INSERT INTO compliance_audit_events(id,organisation_id,actor_type,actor_uid,event_type,target_type,target_id,summary,metadata,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM (${sourceQuery(actor)}) live WHERE live.source_snapshot=?)`)
    .bind(crypto.randomUUID(), actor.organisationId, actor.kind === 'admin' ? 'platform' : 'compliance', actor.uid, eventType, targetType, targetId,
      'Opened private job audit information.', JSON.stringify({ intentId: current.source.target.intentId, sourceSha256: hash(current.source_snapshot) }), new Date().toISOString(),
      ...sourceBindings(actor, current.source.target.intentId), current.source_snapshot).run();
  if (!result.meta.changes) return fail('AUDIT_ACCESS_CHANGED', 'Your audit access changed before this record could be opened.', 403);
}
function inputValue(value: unknown): CreditexJobAuditSaveInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('AUDIT_INPUT', 'Send a valid audit checklist.', 400);
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if ((raw.action !== 'save' && raw.action !== 'audited' && raw.action !== 'correction_required') || typeof raw.expectedAuditRevision !== 'number' || !Number.isSafeInteger(raw.expectedAuditRevision) || raw.expectedAuditRevision < 0
    || typeof raw.expectedSourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.expectedSourceSha256)
    || typeof raw.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(raw.requestId)
    || (raw.callOutcome !== 'completed' && raw.callOutcome !== 'unavailable' && raw.callOutcome !== 'not_required')) return fail('AUDIT_INPUT', 'Refresh the audit and choose a valid checklist outcome.', 400);
  if (!raw.answers || typeof raw.answers !== 'object' || Array.isArray(raw.answers)) return fail('AUDIT_INPUT', 'Answer each checklist item.', 400);
  const answers: Record<string, unknown> = Object.fromEntries(Object.entries(raw.answers));
  if (Object.keys(answers).length !== CREDITEX_JOB_AUDIT_QUESTIONS.length) return fail('AUDIT_INPUT', 'Answer each checklist item with Yes, No or Not checked.', 400);
  const answer = (value: unknown): CreditexJobAuditAnswer => value === 'yes' || value === 'no' || value === 'not_checked' ? value : fail('AUDIT_INPUT', 'Answer each checklist item with Yes, No or Not checked.', 400);
  if (typeof raw.callReason !== 'string' || raw.callReason.length > 2000 || typeof raw.note !== 'string' || raw.note.length > 2000) return fail('AUDIT_INPUT', 'Keep audit notes within 2,000 characters.', 400);
  if (raw.callId !== undefined && (typeof raw.callId !== 'string' || raw.callId.length > 180)) return fail('AUDIT_INPUT', 'Choose a valid recorded call.', 400);
  return { intentId: identifier(raw.intentId), action: raw.action, expectedAuditRevision: raw.expectedAuditRevision,
    expectedSourceSha256: raw.expectedSourceSha256, requestId: raw.requestId, callOutcome: raw.callOutcome,
    answers: { activityDateConfirmed: answer(answers.activityDateConfirmed), customerDetailsConfirmed: answer(answers.customerDetailsConfirmed),
      workConfirmed: answer(answers.workConfirmed), evidenceReviewed: answer(answers.evidenceReviewed), documentsConfirmed: answer(answers.documentsConfirmed), noUnresolvedIssues: answer(answers.noUnresolvedIssues) },
    callReason: raw.callReason.trim(), note: raw.note.trim(), callId: raw.callId || '' };
}
export async function saveCreditexJobAudit(db: D1Database, actor: CreditexJobAuditActor, value: unknown) {
  const input = inputValue(value), current = await context(db, actor, input.intentId);
  if (!current.can_audit) return fail('AUDIT_PERMISSION_REQUIRED', 'Your team access does not include auditing jobs.', 403);
  const requestHash = hash(JSON.stringify(input));
  const previous = await db.prepare('SELECT * FROM creditex_job_audit_versions WHERE actor_kind=? AND actor_uid=? AND request_id=?')
    .bind(actor.kind, actor.uid, input.requestId).first<AuditRow>();
  if (previous) {
    if (previous.intent_id !== input.intentId || previous.request_sha256 !== requestHash) return fail('AUDIT_REQUEST_CHANGED', 'This request already saved different audit details.');
    return loadWorkspace(db, actor, input.intentId);
  }
  if (!current.active) return fail('AUDIT_INACTIVE', 'Restore an active job before changing its audit.');
  if (hash(current.source_snapshot) !== input.expectedSourceSha256) return fail('AUDIT_SOURCE_CHANGED', 'The job answers or files changed. Refresh and review the current record.');
  const workspace = await loadWorkspace(db, actor, input.intentId);
  if ((workspace.checklist?.revision || 0) !== input.expectedAuditRevision) return fail('AUDIT_REVISION_CHANGED', 'Another person changed this audit. Refresh before saving.');
  if (input.action === 'audited' && (!workspace.capabilities.canComplete || !creditexJobAuditComplete(input.answers, input.callOutcome, input.callReason))) return fail('AUDIT_INCOMPLETE', 'Complete the field forms, confirm every checklist item and record the call outcome before completing the audit.');
  if (input.action === 'correction_required' && (!input.note || !workspace.capabilities.canRequestCorrection)) return fail('AUDIT_CORRECTION_UNAVAILABLE', 'Enter the required corrections. The current job must be eligible for correction.');
  if (input.callOutcome === 'not_required' && !input.callReason) return fail('AUDIT_CALL_REASON_REQUIRED', 'Explain why a customer call is not required.', 400);
  if (input.callId) {
    const call = await db.prepare(`SELECT id FROM creditex_audit_calls WHERE id=? AND organisation_id=?
      AND (job_intent_id=? OR (job_intent_id='' AND case_id=? AND case_id<>'')) AND (?<>'completed' OR status='completed')`)
      .bind(input.callId, actor.organisationId, input.intentId, current.source.target.caseId, input.callOutcome).first();
    if (!call) return fail('AUDIT_CALL_MISMATCH', 'The selected call does not belong to this audit or is not complete.');
  }
  const id = crypto.randomUUID(), now = new Date().toISOString(), outcome = input.action === 'save' ? 'draft' : input.action;
  const auditStatements = [db.prepare(`INSERT INTO creditex_job_audit_versions
    (id,organisation_id,intent_id,work_order_id,owner_uid,revision,outcome,checklist_version,answers_json,call_outcome,call_reason,call_id,note,
     source_snapshot,source_sha256,actor_kind,actor_uid,actor_member_id,actor_name,request_id,request_sha256,created_at)
    VALUES(?,?,?,?,?,(SELECT ?+1 FROM (${sourceQuery(actor)}) live WHERE live.active=1 AND live.can_audit=1 AND (?<>'correction_required' OR (live.can_correct=1 AND live.correction_scope=1)) AND live.source_snapshot=?
      AND COALESCE((SELECT MAX(revision) FROM creditex_job_audit_versions WHERE organisation_id=? AND intent_id=?),0)=?),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, actor.organisationId, input.intentId, current.source.target.workOrderId, current.source.target.ownerUid, input.expectedAuditRevision,
      ...sourceBindings(actor, input.intentId), input.action, current.source_snapshot, actor.organisationId, input.intentId, input.expectedAuditRevision,
      outcome, CREDITEX_JOB_AUDIT_VERSION, JSON.stringify(input.answers), input.callOutcome, input.callReason, input.callId || '', input.note,
      current.source_snapshot, input.expectedSourceSha256, actor.kind, actor.uid, actor.memberId, actor.name, input.requestId, requestHash, now),
    db.prepare(`INSERT INTO compliance_audit_events(id,organisation_id,actor_type,actor_uid,event_type,target_type,target_id,summary,metadata,created_at)
      VALUES(?,?,?,?,?,'creditex_job_audit',?,'Saved a versioned job audit checklist.',?,?)`)
      .bind(crypto.randomUUID(), actor.organisationId, actor.kind === 'admin' ? 'platform' : 'compliance', actor.uid, `job.audit_${outcome}`, id,
        JSON.stringify({ intentId: input.intentId, auditRevision: input.expectedAuditRevision + 1, sourceSha256: input.expectedSourceSha256 }), now)];
  try {
    if (input.action === 'correction_required') {
      const lifecycle = await loadJobLifecycle(db, lifecycleActor(actor, current.role), input.intentId);
      await reviewTradeJob(db, lifecycleActor(actor, current.role), { workOrderId: current.source.target.workOrderId, action: 'correction_required',
        requestId: `audit-${id}`, note: input.note, expectedRevision: current.source.target.jobRevision, expectedSourceSha256: lifecycle.correctionSourceSha256 }, { auditStatements });
    } else await db.batch(auditStatements);
  } catch (error) {
    if (error instanceof Error && /creditex_job_audit_versions\.(revision|actor_kind)|UNIQUE constraint failed.*creditex_job_audit/.test(error.message)) return fail('AUDIT_SOURCE_CHANGED', 'The audit, job or your access changed before saving. Refresh and try again.');
    throw error;
  }
  return loadWorkspace(db, actor, input.intentId);
}

type AuditObject = { arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } };
export async function readCreditexJobAuditFile(db: D1Database, actor: CreditexJobAuditActor, input: { intentId: string; kind: string; id: string; parentId: string },
  storage?: { get(key: string): Promise<AuditObject | null> }) {
  const current = await context(db, actor, input.intentId);
  const file = storedFiles(current.source).find(item => item.kind === input.kind && item.id === input.id && item.parentId === input.parentId);
  if (!file || (file.kind === 'case_evidence' && actor.kind !== 'admin')) return fail('AUDIT_FILE_NOT_FOUND', 'This file is not available in this audit.', 404);
  if (!/^(application\/pdf|image\/(jpeg|png|webp|gif)|audio\/(mpeg|mp4|wav|ogg)|video\/(mp4|webm))$/.test(file.contentType)) return fail('AUDIT_FILE_TYPE', 'This file type cannot be previewed safely.', 415);
  const object = await (storage || getCreditexCustodyBucket()).get(file.objectKey);
  if (!object) return fail('AUDIT_FILE_MISSING', 'The saved file could not be found.', 404);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (file.sha256 && hash(bytes) !== file.sha256.replace(/^sha256:/, '')) return fail('AUDIT_FILE_INTEGRITY', 'This file does not match its saved integrity record.');
  const latest = await context(db, actor, input.intentId);
  if (latest.source_snapshot !== current.source_snapshot) return fail('AUDIT_SOURCE_CHANGED', 'The job or file changed while opening it. Refresh the audit.');
  await accessReceipt(db, actor, current, 'job.audit_file_viewed', file.kind, file.id);
  return { bytes, contentType: file.contentType, fileName: file.label };
}
