import { createHash } from 'node:crypto';
import type { TeamAccess } from './trade-team-server';
import { readSelectedTradeJobForm } from './trade-job-forms-server';
import { loadCreditexJobAudit, type CreditexJobAuditActor } from './creditex-job-audit-server';
import { creditexPermissionSql } from './creditex-permissions';
import { CREDITEX_PARTNER_ORGANISATION_CODE } from './trade-compliance-intent';
import { jobMemberSql } from './trade-job-collaboration';
import { verifiedTradeAccountPredicate } from './trade-account-predicates';
import { decodeKeysetCursor, encodeKeysetCursor, keysetAfter } from './keyset-pagination';
import { defaultActivityFieldForm } from './trade-activity-forms-library';
import { FormComplianceError, assertComplianceCompletion, cleanComplianceQuestions, cleanComplianceQueueQuery, cleanComplianceReviewInput,
  cleanComplianceTemplateInput, complianceFormKey, complianceIdentifier, complianceObject, defaultComplianceQuestions,
  type FormComplianceContext, type FormComplianceQueuePage, type FormComplianceReview, type FormComplianceTemplate,
  type FormComplianceWorkspace } from './form-compliance';

export type FormComplianceActor = { scope: 'business'; access: TeamAccess } | { scope: 'creditex'; access: CreditexJobAuditActor };
type Row = Record<string, unknown>;
type Guard = { sql: string; bindings: (string | number)[] };
type FormDefinition = { title: string; fields: { key: string; label: string }[]; snapshot: string; guard: Guard };
type ReviewSource = { formKey: string; recordKind: 'field' | 'work_pack' | 'job_form'; recordId: string; workOrderId: string;
  definition: FormDefinition; source: FormComplianceWorkspace['source']; snapshot: string; guard: Guard; canReview: boolean; sourceComplete: boolean };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, message: string, status = 409): never => { throw new FormComplianceError(code, message, status); };
const scopeId = (actor: FormComplianceActor) => actor.scope === 'business' ? actor.access.ownerUid : actor.access.organisationId;
const actorUid = (actor: FormComplianceActor) => actor.scope === 'business' ? actor.access.actorUid : actor.access.uid;
const actorName = (actor: FormComplianceActor) => actor.scope === 'business' ? actor.access.displayName : actor.access.name;
function stored(value: unknown): Row {
  if (typeof value !== 'string') return fail('COMPLIANCE_SOURCE', 'The saved form could not be read.', 503);
  try { return complianceObject(JSON.parse(value)); } catch { return fail('COMPLIANCE_SOURCE', 'The saved form could not be read.', 503); }
}
function fields(value: unknown): { key: string; label: string }[] {
  if (!Array.isArray(value)) return fail('COMPLIANCE_SOURCE', 'The saved form questions could not be read.', 503);
  return value.map(item => {
    const row = complianceObject(item);
    if (typeof row.key !== 'string' || typeof row.label !== 'string') return fail('COMPLIANCE_SOURCE', 'The saved form questions could not be read.', 503);
    return { key: row.key, label: row.label };
  });
}
function text(value: unknown): string {
  if (typeof value !== 'string') return fail('COMPLIANCE_SOURCE', 'The saved record is incomplete.', 503);
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail('COMPLIANCE_SOURCE', 'The saved record version is invalid.', 503);
  return value;
}
function combine(...guards: Guard[]): Guard { return { sql: guards.map(guard => `(${guard.sql})`).join(' AND '), bindings: guards.flatMap(guard => guard.bindings) }; }
function createdTemplateGuard(ownerUid: string, templateKey: string): Guard {
  return { sql: `EXISTS(SELECT 1 FROM trade_form_templates created WHERE created.scope_owner_uid=? AND created.template_key=?
    AND created.status IN ('draft','published') AND NOT EXISTS(SELECT 1 FROM trade_form_templates newer
      WHERE newer.scope_owner_uid=created.scope_owner_uid AND newer.template_key=created.template_key AND newer.version>created.version))`,
    bindings: [ownerUid, templateKey] };
}

/** Rechecked in every read and atomic insert; browser claims never become SQL permissions. */
function businessGuard(access: TeamAccess, mode: 'read' | 'manage' | 'review', jobAlias?: string): Guard {
  const bindings: (string | number)[] = [access.ownerUid, access.memberId];
  let identity = 'actor.member_uid=?';
  if (access.fieldSessionId) {
    if (access.actorUid !== `field-member:${access.memberId}`) return fail('COMPLIANCE_ACCESS', 'Your team session is no longer valid.', 403);
    identity = `EXISTS(SELECT 1 FROM trade_field_sessions session WHERE session.id=? AND session.owner_uid=actor.owner_uid
      AND session.team_member_id=actor.id AND session.status='active' AND session.expires_at>?)`;
    bindings.push(access.fieldSessionId, new Date().toISOString());
  } else bindings.push(access.actorUid);
  return { sql: `EXISTS(SELECT 1 FROM trade_team_members actor JOIN trade_accounts account ON account.firebase_uid=actor.owner_uid
    WHERE actor.owner_uid=? AND actor.id=? AND actor.status='active' AND account.partner_type='installer' AND ${verifiedTradeAccountPredicate('account')}
    AND ${identity} ${mode === 'read' ? '' : 'AND (actor.member_uid=actor.owner_uid OR actor.can_manage_forms=1)'}
    ${mode === 'review' ? 'AND (actor.member_uid=actor.owner_uid OR actor.can_view_field_evidence=1)' : ''}
    ${jobAlias ? `AND (actor.member_uid=actor.owner_uid OR actor.job_scope='team' OR ${jobMemberSql(jobAlias, 'actor.id')})` : ''})`, bindings };
}
function creditexGuard(access: CreditexJobAuditActor, mode: 'read' | 'manage' | 'review'): Guard {
  if (access.kind === 'admin') return { sql: `EXISTS(SELECT 1 FROM admin_users actor JOIN compliance_organisations organisation
    ON organisation.id=? AND organisation.organisation_code=? AND organisation.status='active'
    WHERE actor.id=? AND actor.firebase_uid=? AND actor.status='active' AND actor.role IN (${mode === 'manage' ? "'owner','admin'" : "'owner','admin','reviewer'"}))`,
    bindings: [access.organisationId, CREDITEX_PARTNER_ORGANISATION_CODE, access.memberId, access.uid] };
  const permission = mode === 'manage' ? 'forms' : mode === 'review' ? 'audit' : 'jobs';
  return { sql: `EXISTS(SELECT 1 FROM compliance_users member JOIN compliance_organisations organisation ON organisation.id=member.organisation_id
    WHERE member.organisation_id=? AND organisation.organisation_code=? AND organisation.status='active'
    AND member.id=? AND member.firebase_uid=? AND member.status='active' AND ${creditexPermissionSql(permission)})`,
    bindings: [access.organisationId, CREDITEX_PARTNER_ORGANISATION_CODE, access.memberId, access.uid] };
}
function actorGuard(actor: FormComplianceActor, mode: 'read' | 'manage' | 'review') {
  return actor.scope === 'business' ? businessGuard(actor.access, mode) : creditexGuard(actor.access, mode);
}
async function authorised(db: D1Database, guard: Guard) {
  if (!await db.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.bindings).first()) return fail('COMPLIANCE_ACCESS', 'You no longer have permission to open or change this compliance record.', 403);
}

// Installed as complete prepared statements, not semicolon-split Sites migrations.
export const FORM_COMPLIANCE_IMMUTABILITY_GUARDS = ['form_compliance_template_versions', 'form_compliance_review_versions'].flatMap(table => ['UPDATE', 'DELETE'].map(operation =>
  `CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'Compliance history is immutable. Save a new revision.'); END`));
async function ensureHistoryGuards(db: D1Database) {
  for (const sql of FORM_COMPLIANCE_IMMUTABILITY_GUARDS) await db.prepare(sql).run();
}

async function definition(db: D1Database, actor: FormComplianceActor, rawKey: string): Promise<FormDefinition> {
  const key = complianceFormKey(rawKey, actor.scope), author = actorGuard(actor, 'manage');
  await authorised(db, actorGuard(actor, actor.scope === 'creditex' ? 'manage' : 'read'));
  if (actor.scope === 'business') {
    const templateKey = key.slice('business:'.length);
    const row = await db.prepare(`SELECT id,name,fields,version,updated_at,status FROM trade_form_templates
      WHERE scope_owner_uid=? AND template_key=? ORDER BY version DESC LIMIT 1`).bind(actor.access.ownerUid, templateKey).first<Row>();
    if (!row || (row.status !== 'draft' && row.status !== 'published')) return fail('COMPLIANCE_FORM_NOT_FOUND', 'This custom form is unavailable in this business.', 404);
    const snapshot = JSON.stringify(row);
    return { title: text(row.name), fields: fields(JSON.parse(text(row.fields))), snapshot,
      guard: combine(author, { sql: `EXISTS(SELECT 1 FROM trade_form_templates t WHERE t.id=? AND t.scope_owner_uid=? AND t.template_key=? AND t.version=?
        AND t.status IN ('draft','published') AND t.updated_at=? AND t.fields=? AND NOT EXISTS(SELECT 1 FROM trade_form_templates n WHERE n.scope_owner_uid=t.scope_owner_uid AND n.template_key=t.template_key AND n.version>t.version))`,
        bindings: [text(row.id), actor.access.ownerUid, templateKey, integer(row.version), text(row.updated_at), text(row.fields)] }) };
  }
  if (key.startsWith('activity:')) {
    const [, templateId, variantId] = key.split(':');
    const row = await db.prepare(`SELECT id,version,form_json FROM trade_activity_field_masters WHERE organisation_id=?
      AND activity_template_id=? AND variant_id=? ORDER BY version DESC LIMIT 1`).bind(actor.access.organisationId, templateId, variantId).first<Row>();
    if (row) {
      const form = stored(row.form_json);
      return { title: text(form.title), fields: fields(form.fields), snapshot: JSON.stringify(row), guard: combine(author,
        { sql: `EXISTS(SELECT 1 FROM trade_activity_field_masters t WHERE t.id=? AND t.organisation_id=? AND t.form_json=?
          AND NOT EXISTS(SELECT 1 FROM trade_activity_field_masters n WHERE n.organisation_id=t.organisation_id AND n.activity_template_id=t.activity_template_id AND n.variant_id=t.variant_id AND n.version>t.version))`,
          bindings: [text(row.id), actor.access.organisationId, text(row.form_json)] }) };
    }
    const form = defaultActivityFieldForm(templateId, variantId);
    return { title: form.title, fields: fields(form.fields), snapshot: JSON.stringify(form), guard: combine(author,
      { sql: 'NOT EXISTS(SELECT 1 FROM trade_activity_field_masters WHERE organisation_id=? AND activity_template_id=? AND variant_id=?)', bindings: [actor.access.organisationId, templateId, variantId] }) };
  }
  if (key.startsWith('work-pack:')) {
    const templateId = key.slice('work-pack:'.length);
    const row = await db.prepare(`SELECT id,title,schema_snapshot FROM compliance_activity_work_pack_versions WHERE organisation_id=?
      AND activity_template_id=? AND publish_state IN ('draft','published') ORDER BY version DESC LIMIT 1`).bind(actor.access.organisationId, templateId).first<Row>();
    if (!row) return fail('COMPLIANCE_FORM_NOT_FOUND', 'This work-pack form is unavailable.', 404);
    const pack = stored(row.schema_snapshot), sections = pack.sections;
    if (!Array.isArray(sections)) return fail('COMPLIANCE_SOURCE', 'The work-pack questions could not be read.', 503);
    const prompts = sections.flatMap(section => { const item = complianceObject(section); return Array.isArray(item.prompts) ? item.prompts.map(prompt => {
      const field = complianceObject(prompt); return { key: text(field.promptKey), label: text(field.label) };
    }) : []; });
    return { title: text(row.title), fields: prompts, snapshot: JSON.stringify(row), guard: combine(author,
      { sql: `EXISTS(SELECT 1 FROM compliance_activity_work_pack_versions t WHERE t.id=? AND t.organisation_id=? AND t.schema_snapshot=?
        AND t.publish_state IN ('draft','published') AND NOT EXISTS(SELECT 1 FROM compliance_activity_work_pack_versions n WHERE n.organisation_id=t.organisation_id AND n.activity_template_id=t.activity_template_id AND n.publish_state IN ('draft','published') AND n.version>t.version))`,
        bindings: [text(row.id), actor.access.organisationId, text(row.schema_snapshot)] }) };
  }
  const templateKey = key.slice('creditex-job-form:'.length);
  // Creditex may own checks for shared supporting forms, never another business's form definition.
  const row = await db.prepare(`SELECT id,name,fields,status,version FROM trade_form_templates WHERE scope_owner_uid='' AND template_key=? ORDER BY version DESC LIMIT 1`)
    .bind(templateKey).first<Row>();
  if (!row) return fail('COMPLIANCE_FORM_NOT_FOUND', 'This shared form is unavailable.', 404);
  if (row.status !== 'draft' && row.status !== 'published') return fail('COMPLIANCE_FORM_NOT_FOUND', 'This shared form has been withdrawn.', 404);
  return { title: text(row.name), fields: fields(JSON.parse(text(row.fields))), snapshot: JSON.stringify(row), guard: combine(author,
    { sql: `EXISTS(SELECT 1 FROM trade_form_templates t WHERE t.id=? AND t.scope_owner_uid='' AND t.fields=? AND t.status IN ('draft','published')
      AND NOT EXISTS(SELECT 1 FROM trade_form_templates n WHERE n.scope_owner_uid='' AND n.template_key=t.template_key AND n.version>t.version))`, bindings: [text(row.id), text(row.fields)] }) };
}

function templateRow(row: Row): FormComplianceTemplate {
  let questions: unknown;
  try { questions = JSON.parse(text(row.questions_json)); } catch { return fail('COMPLIANCE_SOURCE', 'The saved questionnaire could not be read.', 503); }
  return { formKey: text(row.form_key), title: text(row.title), revision: integer(row.revision), questions: cleanComplianceQuestions(questions) };
}
async function latestTemplate(db: D1Database, actor: FormComplianceActor, key: string, source: Pick<FormDefinition, 'title' | 'fields'>): Promise<FormComplianceTemplate> {
  // Form authors are independently checked by the caller; reviewers do not need authoring permission.
  const row = await db.prepare(`SELECT * FROM form_compliance_template_versions WHERE scope=? AND scope_id=? AND form_key=? ORDER BY revision DESC LIMIT 1`)
    .bind(actor.scope, scopeId(actor), key).first<Row>();
  return row ? templateRow(row) : { formKey: key, title: source.title, revision: 0, questions: defaultComplianceQuestions(source.fields) };
}
export async function loadFormComplianceTemplate(db: D1Database, actor: FormComplianceActor, key: string) {
  const form = await definition(db, actor, key);
  const canManage = Boolean(await db.prepare(`SELECT 1 WHERE ${actorGuard(actor, 'manage').sql}`).bind(...actorGuard(actor, 'manage').bindings).first());
  return { template: await latestTemplate(db, actor, key, form), canManage };
}
export async function saveFormComplianceTemplate(db: D1Database, actor: FormComplianceActor, value: unknown) {
  const input = cleanComplianceTemplateInput(value);
  if (input.scope !== actor.scope) return fail('COMPLIANCE_ACCESS', 'Choose the authorised workspace.', 403);
  const form = await definition(db, actor, input.formKey);
  await authorised(db, form.guard);
  const linked = new Set(form.fields.map(field => field.key));
  if (input.questions.some(question => question.sourceFieldKey && !linked.has(question.sourceFieldKey))) return fail('COMPLIANCE_INPUT', 'Linked checks must refer to a question in this form.', 400);
  const current = await latestTemplate(db, actor, input.formKey, form), payload = JSON.stringify(input.questions);
  if (current.revision !== input.expectedRevision) {
    if (current.revision === input.expectedRevision + 1 && JSON.stringify(current.questions) === payload) return { template: current, canManage: true };
    return fail('COMPLIANCE_REVISION_CONFLICT', 'The questionnaire changed. Reload before saving.');
  }
  await ensureHistoryGuards(db);
  const result = await db.prepare(`INSERT INTO form_compliance_template_versions
    (id,scope,scope_id,form_key,title,revision,questions_json,source_snapshot,actor_uid,actor_name,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${form.guard.sql}
    AND COALESCE((SELECT MAX(revision) FROM form_compliance_template_versions WHERE scope=? AND scope_id=? AND form_key=?),0)=?`)
    .bind(crypto.randomUUID(), actor.scope, scopeId(actor), input.formKey, form.title, current.revision + 1, payload, form.snapshot,
      actorUid(actor), actorName(actor), new Date().toISOString(), ...form.guard.bindings, actor.scope, scopeId(actor), input.formKey, input.expectedRevision).run();
  if (Number(result.meta.changes) !== 1) return fail('COMPLIANCE_REVISION_CONFLICT', 'The form or your authoring permission changed. Reload before saving.');
  return { template: await latestTemplate(db, actor, input.formKey, form), canManage: true };
}

function publicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/object_?key|token|secret|credential/i.test(key)).map(([key, item]) => [key, publicValue(item)]));
  return value;
}
function creditexContextGuard(actor: CreditexJobAuditActor, context: Extract<FormComplianceContext, { scope: 'creditex' }>, workOrderId: string): Guard {
  return combine(creditexGuard(actor, 'review'), { sql: `EXISTS(SELECT 1 FROM trade_work_order_compliance_intents i
    JOIN trade_work_orders work ON work.id=i.work_order_id AND work.firebase_uid=i.installer_uid AND work.partner_type='installer'
    LEFT JOIN compliance_cases c ON c.id=i.compliance_case_id AND c.organisation_id=i.compliance_organisation_id
      AND c.compliance_intent_id=i.id AND c.work_order_id=work.id AND c.installer_uid=work.firebase_uid
    WHERE i.id=? AND i.compliance_organisation_id=? AND work.id=? AND work.record_status='active'
    AND work.stage NOT IN ('cancelled','imported') AND i.status IN ('planned','case_linked')
    AND (i.compliance_case_id='' OR (c.id IS NOT NULL ${actor.kind === 'admin' ? '' : `AND EXISTS(SELECT 1 FROM compliance_users member WHERE member.id=? AND member.organisation_id=c.organisation_id
      AND (member.role='admin' OR EXISTS(SELECT 1 FROM compliance_case_assignments a WHERE a.organisation_id=c.organisation_id AND a.case_id=c.id AND a.compliance_user_id=member.id AND a.status='assigned'))) `})))`,
    bindings: [context.intentId, actor.organisationId, workOrderId, ...(actor.kind === 'compliance' ? [actor.memberId] : [])] });
}
async function reviewSource(db: D1Database, actor: FormComplianceActor, context: FormComplianceContext): Promise<ReviewSource> {
  if (context.scope !== actor.scope) return fail('COMPLIANCE_ACCESS', 'Choose the authorised workspace.', 403);
  if (actor.scope === 'business' && context.scope === 'business') {
    await authorised(db, actorGuard(actor, 'review'));
    const selected = await readSelectedTradeJobForm(actor.access, context.workOrderId, context.formId);
    const row = await db.prepare(`SELECT f.id,f.template_key,f.template_name,f.template_snapshot,f.answers,f.revision,f.status,f.updated_at,w.revision job_revision
      FROM trade_job_forms f JOIN trade_work_orders w ON w.id=f.work_order_id AND w.firebase_uid=f.firebase_uid
      WHERE f.id=? AND f.work_order_id=? AND f.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active'`)
      .bind(context.formId, context.workOrderId, actor.access.ownerUid).first<Row>();
    if (!row || row.revision !== selected.form.revision || row.template_snapshot !== JSON.stringify(selected.form.template)
      && JSON.stringify(stored(row.template_snapshot)) !== JSON.stringify(selected.form.template)) return fail('COMPLIANCE_SOURCE_CHANGED', 'The form changed while opening it. Reload before reviewing.');
    const template = stored(row.template_snapshot), formFields = fields(template.fields), answers = stored(row.answers);
    const snapshot = JSON.stringify(row), sourceHash = hash(snapshot), formKey = `business:${text(row.template_key)}`;
    const customTemplate = createdTemplateGuard(actor.access.ownerUid, text(row.template_key));
    if (!await db.prepare(`SELECT 1 WHERE ${customTemplate.sql}`).bind(...customTemplate.bindings).first()) return fail('COMPLIANCE_FORM_NOT_FOUND', 'This custom form is unavailable in this business.', 404);
    const guard = combine(customTemplate, { sql: `EXISTS(SELECT 1 FROM trade_job_forms f JOIN trade_work_orders work ON work.id=f.work_order_id AND work.firebase_uid=f.firebase_uid
      WHERE f.id=? AND f.work_order_id=? AND f.firebase_uid=? AND f.revision=? AND f.template_snapshot=? AND f.answers=? AND f.status=? AND f.updated_at=?
      AND work.revision=? AND work.partner_type='installer' AND work.record_status='active' AND ${businessGuard(actor.access, 'review', 'work').sql})`,
      bindings: [context.formId, context.workOrderId, actor.access.ownerUid, integer(row.revision), text(row.template_snapshot), text(row.answers), text(row.status), text(row.updated_at), integer(row.job_revision), ...businessGuard(actor.access, 'review', 'work').bindings] });
    await authorised(db, guard);
    const definition = { title: text(row.template_name), fields: formFields, snapshot: text(row.template_snapshot), guard };
    return { formKey, recordKind: 'job_form', recordId: context.formId, workOrderId: context.workOrderId, definition, snapshot, guard, canReview: true, sourceComplete: row.status === 'complete',
      source: { id: context.formId, title: definition.title, revision: integer(row.revision), hash: sourceHash,
        answers: formFields.map(field => ({ ...field, value: publicValue(answers[field.key] ?? null) })) } };
  }
  if (actor.scope !== 'creditex' || context.scope !== 'creditex') return fail('COMPLIANCE_ACCESS', 'Choose the authorised workspace.', 403);
  const audit = await loadCreditexJobAudit(db, actor.access, context.intentId);
  const selected = audit.records.find(record => record.id === context.recordId && record.kind === context.recordKind);
  if (!selected) return fail('COMPLIANCE_FORM_NOT_FOUND', 'This form is unavailable in the selected job.', 404);
  const base = creditexContextGuard(actor.access, context, audit.target.workOrderId);
  const contextVersion = { sql: `EXISTS(SELECT 1 FROM trade_work_order_compliance_intents i JOIN trade_work_orders w ON w.id=i.work_order_id AND w.firebase_uid=i.installer_uid
    LEFT JOIN compliance_cases c ON c.id=i.compliance_case_id AND c.organisation_id=i.compliance_organisation_id
    WHERE i.id=? AND i.compliance_organisation_id=? AND w.revision=? AND COALESCE(c.revision,0)=?)`,
    bindings: [context.intentId, actor.access.organisationId, audit.target.jobRevision, audit.target.caseRevision] };
  let row: Row | null, formKey: string, sourceGuard: Guard, formFields: { key: string; label: string }[];
  if (context.recordKind === 'field') {
    row = await db.prepare(`SELECT id,payload,revision,status,updated_at,activity_template_id FROM trade_activity_field_records
      WHERE id=? AND intent_id=? AND organisation_id=? AND owner_uid=? AND work_order_id=?
      AND NOT EXISTS(SELECT 1 FROM trade_activity_field_records n WHERE n.supersedes_record_id=trade_activity_field_records.id AND n.organisation_id=trade_activity_field_records.organisation_id)`)
      .bind(context.recordId, context.intentId, actor.access.organisationId, audit.target.ownerUid, audit.target.workOrderId).first<Row>();
    if (!row) return fail('COMPLIANCE_FORM_NOT_FOUND', 'This field form was replaced or is unavailable.', 404);
    const payload = stored(row.payload), form = complianceObject(payload.form);
    formFields = fields(form.fields); formKey = `activity:${text(row.activity_template_id)}:${text(form.variantId)}`;
    sourceGuard = { sql: `EXISTS(SELECT 1 FROM trade_activity_field_records f WHERE f.id=? AND f.organisation_id=? AND f.intent_id=? AND f.owner_uid=? AND f.work_order_id=? AND f.activity_template_id=? AND f.payload=? AND f.revision=? AND f.status=? AND f.updated_at=?
      AND NOT EXISTS(SELECT 1 FROM trade_activity_field_records n WHERE n.supersedes_record_id=f.id AND n.organisation_id=f.organisation_id))`,
      bindings: [context.recordId, actor.access.organisationId, context.intentId, audit.target.ownerUid, audit.target.workOrderId, text(row.activity_template_id), text(row.payload), integer(row.revision), text(row.status), text(row.updated_at)] };
  } else if (context.recordKind === 'job_form') {
    row = await db.prepare(`SELECT id,template_key,template_snapshot,answers,revision,status,updated_at FROM trade_job_forms WHERE id=? AND work_order_id=? AND firebase_uid=?`)
      .bind(context.recordId, audit.target.workOrderId, audit.target.ownerUid).first<Row>();
    if (!row) return fail('COMPLIANCE_FORM_NOT_FOUND', 'This supporting form is unavailable.', 404);
    formFields = fields(stored(row.template_snapshot).fields); formKey = `creditex-job-form:${text(row.template_key)}`;
    const sharedTemplate = createdTemplateGuard('', text(row.template_key));
    if (!await db.prepare(`SELECT 1 WHERE ${sharedTemplate.sql}`).bind(...sharedTemplate.bindings).first()) return fail('COMPLIANCE_FORM_NOT_FOUND', 'This shared supporting form is unavailable.', 404);
    sourceGuard = combine(sharedTemplate, { sql: `EXISTS(SELECT 1 FROM trade_job_forms f WHERE f.id=? AND f.work_order_id=? AND f.firebase_uid=? AND f.template_snapshot=? AND f.answers=? AND f.revision=? AND f.status=? AND f.updated_at=?)`,
      bindings: [context.recordId, audit.target.workOrderId, audit.target.ownerUid, text(row.template_snapshot), text(row.answers), integer(row.revision), text(row.status), text(row.updated_at)] });
  } else {
    row = await db.prepare(`SELECT p.id,p.instance_key,p.work_order_id,p.compliance_intent_id,p.compliance_case_id,p.revision,p.status,p.response_snapshot,p.response_sha256,
      p.work_pack_version_id,v.schema_snapshot,v.activity_template_id,
      (SELECT COALESCE(json_group_array(json_object('id',a.id,'hash',a.original_sha256,'metadata',a.metadata_snapshot,'supersedes',a.supersedes_artifact_id)), '[]') FROM compliance_activity_work_pack_artifacts a WHERE a.organisation_id=p.organisation_id AND a.instance_key=p.instance_key ORDER BY a.id) artifacts,
      (SELECT COALESCE(json_group_array(json_object('id',s.id,'hash',s.signature_sha256,'payload',s.signature_payload_snapshot,'supersedes',s.supersedes_signature_id)), '[]') FROM compliance_activity_work_pack_signatures s WHERE s.organisation_id=p.organisation_id AND s.instance_key=p.instance_key ORDER BY s.id) signatures
      FROM compliance_activity_work_pack_instances p JOIN compliance_activity_work_pack_versions v ON v.id=p.work_pack_version_id AND v.organisation_id=p.organisation_id
      WHERE p.id=? AND p.organisation_id=? AND p.work_order_id=? AND (p.compliance_intent_id=? OR (p.compliance_intent_id='' AND p.compliance_case_id=?))
      AND NOT EXISTS(SELECT 1 FROM compliance_activity_work_pack_instances n WHERE n.organisation_id=p.organisation_id AND n.instance_key=p.instance_key AND n.revision>p.revision)`)
      .bind(context.recordId, actor.access.organisationId, audit.target.workOrderId, context.intentId, audit.target.caseId).first<Row>();
    if (!row) return fail('COMPLIANCE_FORM_NOT_FOUND', 'This work-pack form was replaced or is unavailable.', 404);
    formKey = `work-pack:${text(row.activity_template_id)}`; formFields = selected.answers.map(answer => ({ key: answer.key, label: answer.label }));
    sourceGuard = { sql: `EXISTS(SELECT 1 FROM compliance_activity_work_pack_instances p JOIN compliance_activity_work_pack_versions v ON v.id=p.work_pack_version_id AND v.organisation_id=p.organisation_id
      WHERE p.id=? AND p.organisation_id=? AND p.work_order_id=? AND p.compliance_intent_id=? AND p.compliance_case_id=? AND p.work_pack_version_id=?
      AND p.response_snapshot=? AND p.revision=? AND p.status=? AND v.schema_snapshot=?
      AND (SELECT COALESCE(json_group_array(json_object('id',a.id,'hash',a.original_sha256,'metadata',a.metadata_snapshot,'supersedes',a.supersedes_artifact_id)), '[]') FROM compliance_activity_work_pack_artifacts a WHERE a.organisation_id=p.organisation_id AND a.instance_key=p.instance_key ORDER BY a.id)=?
      AND (SELECT COALESCE(json_group_array(json_object('id',s.id,'hash',s.signature_sha256,'payload',s.signature_payload_snapshot,'supersedes',s.supersedes_signature_id)), '[]') FROM compliance_activity_work_pack_signatures s WHERE s.organisation_id=p.organisation_id AND s.instance_key=p.instance_key ORDER BY s.id)=?
      AND NOT EXISTS(SELECT 1 FROM compliance_activity_work_pack_instances n WHERE n.organisation_id=p.organisation_id AND n.instance_key=p.instance_key AND n.revision>p.revision))`,
      bindings: [context.recordId, actor.access.organisationId, text(row.work_order_id), text(row.compliance_intent_id), text(row.compliance_case_id), text(row.work_pack_version_id), text(row.response_snapshot), integer(row.revision), text(row.status), text(row.schema_snapshot), text(row.artifacts), text(row.signatures)] };
  }
  if (row.revision !== selected.revision) return fail('COMPLIANCE_SOURCE_CHANGED', 'The form changed while opening it. Reload before reviewing.');
  const snapshot = JSON.stringify({ row, jobRevision: audit.target.jobRevision, caseRevision: audit.target.caseRevision });
  const guard = combine(base, contextVersion, sourceGuard);
  const canReview = audit.capabilities.canSave && Boolean(await db.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.bindings).first());
  return { formKey, recordKind: context.recordKind, recordId: context.recordId, workOrderId: audit.target.workOrderId,
    definition: { title: selected.title, fields: formFields, snapshot: JSON.stringify(formFields), guard }, snapshot, guard, canReview,
    sourceComplete: selected.status === (context.recordKind === 'field' ? 'submitted_for_creditex_review' : context.recordKind === 'work_pack' ? 'completed' : 'complete'),
    source: { id: context.recordId, title: selected.title, revision: selected.revision, hash: hash(snapshot),
      answers: selected.answers.map(answer => ({ key: answer.key, label: answer.label, value: publicValue(answer.value) })) } };
}
function reviewRow(row: Row): FormComplianceReview {
  const answers = cleanComplianceReviewInput({ action: 'save_review', scope: 'business', workOrderId: 'stored', formId: 'stored', expectedRevision: 0,
    expectedSourceHash: text(row.source_hash), templateRevision: integer(row.template_revision), status: text(row.status), answers: JSON.parse(text(row.answers_json)) }).answers;
  const status = row.status;
  if (status !== 'draft' && status !== 'complete') return fail('COMPLIANCE_SOURCE', 'The saved review status is invalid.', 503);
  return { revision: integer(row.revision), status, answers, actorName: text(row.actor_name), createdAt: text(row.created_at), sourceHash: text(row.source_hash), templateRevision: integer(row.template_revision) };
}
async function latestReview(db: D1Database, actor: FormComplianceActor, source: ReviewSource) {
  return db.prepare(`SELECT * FROM form_compliance_review_versions WHERE scope=? AND scope_id=? AND record_kind=? AND record_id=? ORDER BY revision DESC LIMIT 1`)
    .bind(actor.scope, scopeId(actor), source.recordKind, source.recordId).first<Row>();
}
async function workspace(db: D1Database, actor: FormComplianceActor, source: ReviewSource): Promise<FormComplianceWorkspace> {
  const template = await latestTemplate(db, actor, source.formKey, source.definition), row = await latestReview(db, actor, source), review = row ? reviewRow(row) : null;
  return { template, source: source.source, review, canReview: source.canReview,
    stale: Boolean(review && (review.sourceHash !== source.source.hash || review.templateRevision !== template.revision)) };
}
export async function loadFormComplianceWorkspace(db: D1Database, actor: FormComplianceActor, context: FormComplianceContext) {
  const source = await reviewSource(db, actor, context);
  return workspace(db, actor, source);
}
export async function saveFormComplianceReview(db: D1Database, actor: FormComplianceActor, value: unknown) {
  const input = cleanComplianceReviewInput(value), source = await reviewSource(db, actor, input);
  if (!source.canReview) return fail('COMPLIANCE_ACCESS', 'Review permission and an active assigned job are required.', 403);
  if (input.status === 'complete' && !source.sourceComplete) return fail('COMPLIANCE_INCOMPLETE', 'The installer must complete this form before its compliance review can be completed.', 400);
  const current = await workspace(db, actor, source);
  if (input.expectedSourceHash !== source.source.hash || input.templateRevision !== current.template.revision) return fail('COMPLIANCE_SOURCE_CHANGED', 'The installer form, evidence or compliance questions changed. Reload before saving.');
  assertComplianceCompletion(current.template.questions, input.answers, input.status === 'complete');
  const previous = current.review?.revision || 0, payload = JSON.stringify(input.answers);
  if (previous !== input.expectedRevision) {
    const last = await latestReview(db, actor, source);
    if (previous === input.expectedRevision + 1 && last?.actor_uid === actorUid(actor) && current.review?.status === input.status
      && current.review.sourceHash === input.expectedSourceHash && current.review.templateRevision === input.templateRevision && JSON.stringify(current.review.answers) === payload) return current;
    return fail('COMPLIANCE_REVISION_CONFLICT', 'Another reviewer saved this form. Reload before saving.');
  }
  await ensureHistoryGuards(db);
  const result = await db.prepare(`INSERT INTO form_compliance_review_versions
    (id,scope,scope_id,form_key,record_kind,record_id,work_order_id,revision,status,template_revision,template_snapshot,answers_json,source_snapshot,source_hash,actor_uid,actor_name,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${source.guard.sql}
    AND COALESCE((SELECT MAX(revision) FROM form_compliance_review_versions WHERE scope=? AND scope_id=? AND record_kind=? AND record_id=?),0)=?
    AND COALESCE((SELECT MAX(revision) FROM form_compliance_template_versions WHERE scope=? AND scope_id=? AND form_key=?),0)=?`)
    .bind(crypto.randomUUID(), actor.scope, scopeId(actor), source.formKey, source.recordKind, source.recordId, source.workOrderId, previous + 1, input.status,
      input.templateRevision, JSON.stringify(current.template), payload, source.snapshot, source.source.hash, actorUid(actor), actorName(actor), new Date().toISOString(),
      ...source.guard.bindings, actor.scope, scopeId(actor), source.recordKind, source.recordId, previous, actor.scope, scopeId(actor), source.formKey, input.templateRevision).run();
  if (Number(result.meta.changes) !== 1) return fail('COMPLIANCE_REVISION_CONFLICT', 'The review, installer answers, evidence, questions or your access changed. Reload before saving.');
  return workspace(db, actor, source);
}
export async function loadFormComplianceQueue(db: D1Database, actor: FormComplianceActor, options: { q?: string; cursor?: string } = {}): Promise<FormComplianceQueuePage> {
  if (actor.scope !== 'business') return fail('COMPLIANCE_INPUT', 'Open the Creditex job to review its forms.', 400);
  const query = cleanComplianceQueueQuery(options.q, options.cursor), search = query.q.toLowerCase();
  const cursorScope = hash(JSON.stringify(['form-compliance-queue', actor.access.ownerUid, actor.access.actorUid, actor.access.memberId, search]));
  let cursor: (string | number)[] | null;
  try { cursor = decodeKeysetCursor(query.cursor, cursorScope, 2); } catch { return fail('COMPLIANCE_INPUT', 'This review page no longer matches your workspace or search. Start from the first page.', 400); }
  if (cursor && (typeof cursor[0] !== 'string' || cursor[0].length > 64 || !Number.isFinite(Date.parse(cursor[0]))
    || typeof cursor[1] !== 'string' || complianceIdentifier(cursor[1]) !== cursor[1])) return fail('COMPLIANCE_INPUT', 'Choose a valid review page.', 400);
  const after = cursor ? keysetAfter([{ expression: 'form.updated_at', direction: 'desc' }, { expression: 'form.id', direction: 'asc' }], cursor) : null;
  await authorised(db, actorGuard(actor, 'review'));
  const guard = businessGuard(actor.access, 'review', 'work');
  const rows = await db.prepare(`SELECT form.id,form.work_order_id,form.template_name,form.template_key,form.revision,form.template_snapshot,form.answers,form.status,form.updated_at,
    work.work_number,work.revision job_revision,
    (SELECT r.status FROM form_compliance_review_versions r WHERE r.scope='business' AND r.scope_id=form.firebase_uid AND r.record_kind='job_form' AND r.record_id=form.id ORDER BY r.revision DESC LIMIT 1) review_status,
    (SELECT r.source_snapshot FROM form_compliance_review_versions r WHERE r.scope='business' AND r.scope_id=form.firebase_uid AND r.record_kind='job_form' AND r.record_id=form.id ORDER BY r.revision DESC LIMIT 1) reviewed_source,
    (SELECT r.template_revision FROM form_compliance_review_versions r WHERE r.scope='business' AND r.scope_id=form.firebase_uid AND r.record_kind='job_form' AND r.record_id=form.id ORDER BY r.revision DESC LIMIT 1) reviewed_template,
    COALESCE((SELECT MAX(t.revision) FROM form_compliance_template_versions t WHERE t.scope='business' AND t.scope_id=form.firebase_uid AND t.form_key='business:'||form.template_key),0) current_template
    FROM trade_job_forms form JOIN trade_work_orders work ON work.id=form.work_order_id AND work.firebase_uid=form.firebase_uid
    WHERE form.firebase_uid=? AND work.partner_type='installer' AND work.record_status='active' AND form.status='complete' AND ${guard.sql}
    AND EXISTS(SELECT 1 FROM trade_form_templates created WHERE created.scope_owner_uid=form.firebase_uid AND created.template_key=form.template_key
      AND created.status IN ('draft','published') AND NOT EXISTS(SELECT 1 FROM trade_form_templates newer
        WHERE newer.scope_owner_uid=created.scope_owner_uid AND newer.template_key=created.template_key AND newer.version>created.version))
    ${search ? "AND instr(LOWER(COALESCE(form.template_name,'')||' '||COALESCE(work.work_number,'')),?)>0" : ''}
    ${after ? `AND (${after.sql})` : ''}
    ORDER BY form.updated_at DESC,form.id ASC LIMIT 51`).bind(actor.access.ownerUid, ...guard.bindings, ...(search ? [search] : []), ...(after?.bindings || [])).all<Row>();
  const pageRows = rows.results.slice(0, 50);
  const items = pageRows.map((row): FormComplianceQueuePage['items'][number] => {
    const snapshot = JSON.stringify({ id: row.id, template_key: row.template_key, template_name: row.template_name, template_snapshot: row.template_snapshot,
      answers: row.answers, revision: row.revision, status: row.status, updated_at: row.updated_at, job_revision: row.job_revision });
    const status = row.review_status === 'complete' ? 'complete' : row.review_status === 'draft' ? 'draft' : 'not_started';
    return { formId: text(row.id), workOrderId: text(row.work_order_id), title: text(row.template_name), jobNumber: text(row.work_number),
      status: row.reviewed_source && (row.reviewed_source !== snapshot || row.reviewed_template !== row.current_template) ? 'stale' : status };
  });
  const last = pageRows.at(-1);
  return { items, nextCursor: rows.results.length > 50 && last ? encodeKeysetCursor(cursorScope, [text(last.updated_at), text(last.id)]) : null };
}
