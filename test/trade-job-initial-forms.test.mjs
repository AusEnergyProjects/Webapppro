import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as library from '../src/lib/trade-form-library.mjs';
import * as services from '../src/lib/energy-service-catalogue.mjs';
import * as actorGuards from '../src/lib/trade-message-media-access.ts';
import * as crews from '../src/lib/trade-crews.ts';
import * as collaboration from '../src/lib/trade-job-collaboration.ts';
import * as rental from '../src/lib/trade-rental-assessment.mjs';
import * as electricalForm from '../src/lib/veu-electrical-safety-form.ts';
import * as activityForms from '../src/lib/trade-activity-forms.ts';
import * as activityLibrary from '../src/lib/trade-activity-forms-library.ts';
import * as activityFlow from '../src/lib/trade-activity-form-flow.ts';
import * as schemaGuardSql from '../src/lib/tlink-schema-guards.ts';
import * as jobLifecycle from '../src/lib/trade-job-lifecycle.ts';
import * as mapDataset from '../src/lib/trade-map-dataset-server.ts';
import * as mapLocation from '../src/lib/trade-map-location-cache.ts';
import { GnafDirectoryUnavailableError } from '../src/lib/gnaf-directory.ts';
import { canonicalAustralianAddress } from '../src/lib/trade-address-verification.ts';
import { certificateTestDependency, installCreditexTrainingFixture } from './helpers/creditex-training-fixture.mjs';
import { installFieldCorrectionFixture } from './helpers/activity-field-corrections-fixture.mjs';
import { FIELD_CORRECTION_GUARD_NAMES, lifecycleGuardFixture } from './helpers/creditex-lifecycle-guards-fixture.mjs';
import { installEmptyTradeCrews } from './helpers/trade-crews-fixture.mjs';
import { jobSalesOutcomeFixture } from './helpers/trade-job-sales-outcome-fixture.mjs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function load(file, dependencies = {}) {
  const moduleRecord = { exports: {} };
  const source = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', source)(name => dependencies[name]
    || (/trade-job-collaboration(?:\.ts)?$/.test(name) ? collaboration : certificateTestDependency(name)) || {}, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}
const clean = (value, maximum) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const selection = (templateKey = 'pre-start-risk-readiness', templateVersion = 1) => ({ templateKey, templateVersion });
const create = extras => ({ action: 'create_scheduled_job', customerMode: 'new', firstName: 'Test', lastName: 'Customer',
  email: 'test@example.test', phone: '0412 345 678', addressLine1: '12 Main St', suburb: 'Melbourne', addressState: 'VIC',
  postcode: '3000', buildingType: 'house', serviceCategory: 'hot-water', assigneeMemberId: 'member', startsAt: '2099-01-01T10:00',
  durationMinutes: '60', formSelectionsJson: JSON.stringify([selection(), selection('business-check')]), ...extras });

function fixture(t, accessPatch = {}, options = {}) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close()); installEmptyTradeCrews(sql);
  const tables = {
    trade_accounts: 'firebase_uid address_state',
    trade_crm_customers: 'id firebase_uid customer_number customer_type first_name last_name business_name business_number email phone address_line_1 address_line_2 suburb address_state postcode tags private_notes record_status created_at updated_at',
    trade_crm_customer_contacts: 'id firebase_uid customer_id first_name last_name role_label email phone is_primary record_status created_at updated_at',
    trade_crm_service_sites: 'id firebase_uid customer_id site_label address_line_1 address_line_2 suburb address_state postcode address_entry_mode address_provider address_provider_reference address_formatted address_verified_at access_instructions parking_instructions hazard_notes is_primary record_status created_at updated_at',
    trade_crm_site_contacts: 'id firebase_uid service_site_id customer_contact_id role_label is_primary record_status created_at updated_at',
    trade_work_orders: 'id firebase_uid partner_type work_type source_type source_reference work_number title service_category site_area stage priority scheduled_start scheduled_end assignee_member_id assignee_label record_status created_at updated_at',
    trade_crm_job_details: 'id work_order_id firebase_uid crm_customer_id service_site_id customer_source pipeline_stage building_type description customer_reference next_action tags estimated_value_cents quoted_value_cents invoiced_value_cents paid_value_cents quote_status invoice_status payment_due_at created_at updated_at',
    trade_work_order_events: 'id work_order_id firebase_uid event_type summary created_at',
    trade_work_order_tasks: 'id work_order_id firebase_uid title due_at status completed_at revision sort_order created_at updated_at',
    trade_team_members: 'id owner_uid member_uid status display_name capabilities can_view_field_evidence can_manage_field_evidence can_create_jobs',
    trade_crm_appointments: 'id work_order_id firebase_uid appointment_type title starts_at ends_at assignee_member_id assignee_label status notes revision created_at updated_at',
    trade_team_sync_changes: 'owner_uid audience_member_id entity_type entity_id operation revision changed_at',
    trade_mobile_push_outbox: 'id owner_uid audience_member_id event_key event_type entity_type entity_id payload status attempts next_attempt_at created_at updated_at',
    trade_work_order_compliance_intents: 'id work_order_id intent_key installer_uid compliance_organisation_id program_template_id activity_template_id program_code registry_activity_code service_category site_jurisdiction planned_start catalogue_reviewed_on intent_snapshot intent_snapshot_sha256 status compliance_case_id revision created_by_uid created_at updated_at',
    trade_handover_packs: 'id work_order_id firebase_uid status updated_at',
    compliance_cases: 'id work_order_id installer_uid status evidence_status',
    trade_crm_quotes: 'id work_order_id firebase_uid current_version_number',
    trade_crm_quote_versions: 'id quote_id firebase_uid version_number subtotal_cents',
    trade_crm_quote_acceptances: 'id quote_id quote_version_id work_order_id firebase_uid decision selected_subtotal_cents',
    trade_crm_quote_choices: 'id quote_version_id firebase_uid choice_kind group_key recommended position subtotal_cents',
    trade_team_member_credentials: 'id owner_uid team_member_id file_id rental_gate status credential_number jurisdiction credential_type expires_at',
    trade_team_member_files: 'id owner_uid team_member_id status expires_at',
    trade_rental_inspections: 'id work_order_id firebase_uid service_site_id inspection_number jurisdiction status template_key template_version rules_effective_from assessment_scope module_selection_snapshot selected_modules_snapshot property_snapshot assessor_uid assessor_member_id assessor_snapshot revision creation_request_id issued_report_id submitted_at issued_at superseded_at created_by_uid created_at updated_at',
    trade_rental_inspection_modules: 'id inspection_id firebase_uid module_key required selected_required status template_version template_name required_capability template_snapshot answers revision completed_by_uid completed_at created_at updated_at',
    trade_rental_inspection_events: 'id inspection_id report_id report_link_id firebase_uid actor_type actor_uid event_type request_id summary metadata source_ip_sha256 user_agent_sha256 created_at',
  };
  for (const [table, columns] of Object.entries(tables)) sql.exec(`CREATE TABLE ${table} (${columns.split(' ').map(column => `${column} TEXT ${column === 'id' ? 'PRIMARY KEY' : ''} DEFAULT ''`).join(',')})`);
  sql.exec(`ALTER TABLE trade_work_orders ADD revision INTEGER NOT NULL DEFAULT 1;
    CREATE TABLE trade_crm_write_guards(id TEXT PRIMARY KEY,firebase_uid TEXT,operation_id TEXT,step_number INTEGER,verified INTEGER CHECK(verified=1),created_at TEXT);
    CREATE TABLE trade_job_forms(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,template_key TEXT,template_version INTEGER,
      template_name TEXT,jurisdiction TEXT,template_snapshot TEXT,answers TEXT,status TEXT,revision INTEGER,completed_by_uid TEXT,completed_at TEXT,created_at TEXT,updated_at TEXT,
      UNIQUE(work_order_id,template_key,template_version));
    CREATE TABLE trade_form_templates(template_key TEXT,version INTEGER,name TEXT,jurisdiction TEXT,categories TEXT,description TEXT,guidance TEXT,fields TEXT,status TEXT,scope_owner_uid TEXT);
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    INSERT INTO trade_accounts VALUES('owner','VIC');
    INSERT INTO trade_team_members VALUES('member','owner','worker','active','Worker','["hot-water"]','1','1','1');
    INSERT INTO trade_field_sessions VALUES('session','owner','member','active','2999-01-01T00:00:00.000Z');`);
  const publish = (key, scope = 'owner', status = 'published', version = 1, category = 'hot-water') => {
    sql.prepare("INSERT INTO trade_form_templates VALUES(?,?,?,'AU',?,'Purpose','Instructions',?, ?, ?)")
      .run(key, version, key, JSON.stringify([category]), JSON.stringify([{ key: 'checked', label: 'Checked?', type: 'checkbox', required: true }]), status, scope);
  };
  publish('business-check'); publish('foreign-check', 'other'); publish('draft-check', 'owner', 'draft');
  publish('withdrawn-check', 'owner', 'withdrawn'); publish('wrong-category', 'owner', 'published', 1, 'solar');
  let beforeBatch;
  class Statement {
    constructor(query, values = []) { this.query = query; this.values = values; }
    bind(...values) { return new Statement(this.query, values); }
    async first() {
      return sql.prepare(this.query).get(...this.values) || null;
    }
    async all() { return { results: sql.prepare(this.query).all(...this.values) }; }
    async run() {
      if (/^\s*SELECT/i.test(this.query)) return { success: true, results: sql.prepare(this.query).all(...this.values), meta: { changes: 0 } };
      return { success: true, meta: { changes: Number(sql.prepare(this.query).run(...this.values).changes) } };
    }
  }
  const db = { prepare: query => new Statement(query), async batch(statements) {
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; hook(); }
    sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  sql.exec(read('drizzle/0256_trade_veu_electrical_assessments.sql'));
  const piesaGuards = load('src/lib/trade-veu-electrical-schema-guards.ts', { './tlink-schema-guards': schemaGuardSql });
  for (const guard of piesaGuards.PIESA_SCHEMA_GUARDS) sql.exec(guard.sql);
  const piesaDraft = load('src/lib/trade-veu-electrical-draft.ts', { './trade-activity-forms': activityForms, './veu-electrical-safety-form': electricalForm });
  const access = { ownerUid: 'owner', memberId: 'member', actorUid: 'worker', actorEmail: 'worker@example.test', isOwner: false,
    canCreateJobs: true, canManageCustomers: true, canViewFieldEvidence: true, canManageFieldEvidence: true, canRescheduleJobs: true,
    jobScope: 'own', scheduleScope: 'own', ...accessPatch };
  if (options.creditex) {
    sql.exec(`CREATE TABLE compliance_organisations(id TEXT PRIMARY KEY,organisation_code TEXT,status TEXT);
      INSERT INTO compliance_organisations VALUES('creditex','CREDITEX-AU','active');
      ALTER TABLE trade_team_members ADD first_name TEXT NOT NULL DEFAULT 'Test';
      ALTER TABLE trade_team_members ADD last_name TEXT NOT NULL DEFAULT 'Worker';
      ALTER TABLE trade_team_member_credentials ADD name TEXT NOT NULL DEFAULT '';
      ALTER TABLE trade_team_member_credentials ADD updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE trade_accounts ADD address_line_1 TEXT NOT NULL DEFAULT '';
      ALTER TABLE trade_accounts ADD suburb TEXT NOT NULL DEFAULT '';
      ALTER TABLE trade_accounts ADD postcode TEXT NOT NULL DEFAULT '';
      ALTER TABLE trade_accounts ADD document_phone TEXT NOT NULL DEFAULT '';
      ALTER TABLE trade_accounts ADD phone TEXT NOT NULL DEFAULT '';
      ALTER TABLE trade_accounts ADD document_email TEXT NOT NULL DEFAULT '';
      ALTER TABLE trade_accounts ADD email TEXT NOT NULL DEFAULT '';`);
    sql.exec(read('drizzle/0170_trade_activity_forms.sql'));
    installFieldCorrectionFixture(sql);
    installCreditexTrainingFixture(sql);
  }
  const templates = load('src/lib/trade-form-templates-server.ts', { '../../db': { getD1: () => db }, '@/lib/trade-form-library.mjs': library });
  const attachments = load('src/lib/trade-job-form-attachment-server.ts', { './trade-form-templates-server': templates, './trade-message-media-access': actorGuards,
    './trade-rental-assessment.mjs': rental });
  const team = { requireInstallerTeamAccess: async () => access, canCreateJobs: actor => actor.isOwner || actor.canCreateJobs,
    canManageJobs: actor => actor.isOwner || actor.canManageJobs, canAssignJob: () => true,
    assignedJob: async (actor, id) => {
      const job = sql.prepare("SELECT * FROM trade_work_orders WHERE id=? AND firebase_uid=?").get(id, actor.ownerUid);
      if (!job) throw Error('JOB_NOT_FOUND'); return job;
    } };
  const admin = { adminJson: (body, status = 200) => Response.json(body, { status }), mfaErrorResponse: () => null,
    cleanAdminText: clean, sameOrigin: request => request.headers.get('origin') !== 'https://foreign.test' };
  class DomainError extends Error {}
  const sync = load('src/lib/trade-team-sync-server.ts');
  const complianceIntents = options.creditex ? load('src/lib/trade-compliance-intent.ts')
    : { TradeComplianceIntentError: DomainError, resolveTradeComplianceIntents: () => [] };
  const activityOpenCalls = [];
  const activityServer = options.creditex ? load('src/lib/trade-activity-forms-server.ts', {
    '../../db': { getD1: () => db }, 'cloudflare:workers': { env: {} }, './trade-team-server': team,
    './trade-activity-forms-library.ts': activityLibrary, './trade-activity-forms.ts': activityForms,
    './trade-activity-form-flow.ts': activityFlow, './trade-team-sync-server': sync,
    './creditex-job-lifecycle-schema-guards': lifecycleGuardFixture(sql, FIELD_CORRECTION_GUARD_NAMES),
    './scheduled-activity-customer-document-receipt.ts': { parseScheduledActivityCustomerDocumentReceipt: () => null },
  }) : null;
  const activityServerBoundary = activityServer ? {
    async openActivityRecord(...args) {
      activityOpenCalls.push(args); options.beforeActivityOpen?.({ sql, access, args });
      return activityServer.openActivityRecord(...args);
    },
  } : {};
  const complianceServer = { ComplianceDomainError: DomainError,
    async autoOpenReadyPlannedComplianceWorkPacks() {
      options.afterWorkPacks?.({ sql, access });
      return options.workPackResults || [];
    },
  };
  const route = load('src/app/api/trade-crm/route.ts', {
    '../../../../db': { getD1: () => db }, '@/lib/admin-server': admin, '@/lib/trade-team-server': team,
    '@/lib/trade-job-form-attachment-server': attachments, '@/lib/trade-team-sync-server': sync, '@/lib/trade-crews': crews,
    '@/lib/trade-job-sales-outcome-server': jobSalesOutcomeFixture,
    '@/lib/trade-job-lifecycle': jobLifecycle, '@/lib/trade-map-dataset-server': mapDataset,
    '@/lib/trade-map-location-cache': mapLocation, '@/lib/gnaf-directory-server': { GnafDirectoryUnavailableError },
    '@/lib/trade-crm-register-sort-sql': load('src/lib/trade-crm-register-sort-sql.ts'),
    '@/lib/trade-crm-job-register': load('src/lib/trade-crm-job-register.ts', { './trade-job-lifecycle.ts': jobLifecycle }),
    '@/lib/tlink-schema-guards': { ensureTlinkSchemaGuards: async () => {} }, '@/lib/energy-service-catalogue.mjs': services,
    '@/lib/trade-job-number-server': { nextTlinkJobNumber: async () => 'TLJ-TEST-1' },
    '@/lib/trade-address-verification': { canonicalAustralianAddress, TradeAddressVerificationError: DomainError, resolveTradeAddressProvenance: async input => ({ ...input,
      addressEntryMode: 'manual_pending_review', addressProvider: '', addressProviderReference: '', addressFormatted: '', addressVerifiedAt: '' }) },
    '@/lib/trade-integrations-server': { integrationEnvironment: () => ({}) },
    '@/lib/trade-customer-dedup-server': load('src/lib/trade-customer-dedup-server.ts'),
    '@/lib/trade-compliance-intent': complianceIntents,
    '@/lib/creditex-compliance-server': complianceServer,
    '@/lib/trade-activity-forms-server': activityServerBoundary,
    '@/lib/trade-activity-forms-library': activityLibrary,
    '@/lib/scheduled-activity-customer-documents-server': { sendScheduledActivityCustomerDocuments: async () => ({
      requested: true, status: 'failed', canRetry: true, message: 'Synthetic provider failure: no email sent', acceptedAt: '', documentIds: [], documentSha256Set: [],
    }) },
    '@/lib/trade-access-server': { TradeAccessError: DomainError },
    '@/lib/trade-schedule-server': { ...load('src/lib/trade-schedule-server.ts', { '../../db': { getD1: () => db } }),
      tradeJobScheduleEligibilityGuardStatement: async () => db.prepare('SELECT 1') },
    '@/lib/trade-schedule': { assertAppointmentSlot: () => {}, assertFutureAppointment: () => {}, australiaLocalDateTime: () => '2026-10-08T00:00',
      appointmentEndsAt: () => '2099-01-01T11:00:00.000Z' },
    '@/lib/trade-calendar-sync-server': { syncCreatedAppointmentToConnectedCalendars: async () => ({ synced: 0, failed: 0 }) },
    '@/lib/trade-rental-assessment.mjs': rental,
    '@/lib/trade-rental-schema-guards': { ensureTradeRentalSchemaGuards: async () => {} },
    '@/lib/trade-veu-electrical-schema-guards': piesaGuards,
    '@/lib/trade-veu-electrical-draft': piesaDraft,
    '@/lib/trade-rental-credentials': load('src/lib/trade-rental-credentials.ts'),
    '@/lib/trade-rental-assignment-server': { isRentalInspectionAssignmentConflict: () => false },
    '@/lib/trade-compliance-intent-replan-server': { isTradeComplianceIntentScheduleConflict: () => false },
  });
  const formsRoute = load('src/app/api/trade-job-forms/route.ts', { '../../../../db': { getD1: () => db }, '@/lib/admin-server': admin,
    '@/lib/trade-team-server': team, '@/lib/trade-team-sync-server': sync, '@/lib/trade-form-templates-server': templates,
    '@/lib/trade-job-form-attachment-server': attachments,
    '@/lib/energy-service-catalogue.mjs': services, '@/lib/trade-job-forms-server': { TradeJobFormError: DomainError,
      TRADE_JOB_FORM_COLUMNS: '*', tradeJobFormProjection: row => ({ id: row.id, templateKey: row.template_key }) } });
  const send = async (body, headers = {}) => {
    const response = await route.POST(new Request('https://example.test/api/trade-crm', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  const get = async (parameters, headers = {}) => {
    const response = await formsRoute.GET(new Request(`https://example.test/api/trade-job-forms?${new URLSearchParams(parameters)}`, { headers }));
    return { status: response.status, body: await response.json() };
  };
  const state = () => Object.fromEntries(['trade_crm_customers', 'trade_crm_service_sites', 'trade_crm_customer_contacts', 'trade_crm_site_contacts',
    'trade_work_orders', 'trade_crm_job_details', 'trade_crm_appointments', 'trade_job_forms', 'trade_work_order_events', 'trade_team_sync_changes',
    'trade_mobile_push_outbox', 'trade_crm_write_guards', 'trade_rental_inspections', 'trade_rental_inspection_modules', 'trade_rental_inspection_events',
    'trade_veu_electrical_assessments', 'trade_veu_electrical_versions', 'trade_work_order_compliance_intents',
    ...(options.creditex ? ['trade_activity_field_records', 'trade_activity_field_record_versions'] : [])].map(table => [table, sql.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
  return { sql, db, publish, access, send, get, state, activityOpenCalls, activityServer, beforeBatch: hook => { beforeBatch = hook; } };
}

test('pre-create library matches saved-job canonical metadata and exposes only published owner/category choices', async t => {
  const f = fixture(t), before = f.state();
  const initial = await f.get({ mode: 'library', serviceCategory: 'hot-water' }); assert.equal(initial.status, 200);
  assert.deepEqual(f.state(), before); assert.equal(initial.body.serviceCategory, 'hot-water');
  assert.ok(initial.body.templates.some(item => item.key === 'business-check'));
  assert.ok(initial.body.templates.some(item => item.key === 'pre-start-risk-readiness'));
  assert.doesNotMatch(JSON.stringify(initial.body), /foreign-check|draft-check|withdrawn-check|wrong-category|"fields"|"answers"/);
  const created = await f.send(create()); assert.equal(created.status, 201, JSON.stringify(created.body));
  const saved = await f.get({ workOrderId: created.body.id }); assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.templates, initial.body.templates);
});

for (const action of ['create_job', 'create_scheduled_job']) test(`${action} stores selected immutable drafts with job/customer/events in one transaction`, async t => {
  const f = fixture(t), result = await f.send(create({ action })); assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.attachedFormCount, 2);
  const rows = f.sql.prepare('SELECT * FROM trade_job_forms ORDER BY template_key').all(); assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.work_order_id, result.body.id); assert.equal(row.firebase_uid, 'owner'); assert.equal(row.status, 'draft');
    assert.equal(row.answers, '{}'); assert.equal(row.revision, 1); assert.equal(row.completed_at, '');
    const snapshot = JSON.parse(row.template_snapshot); assert.equal(snapshot.key, row.template_key); assert.equal(snapshot.version, row.template_version);
    assert.ok(snapshot.fields.length > 0);
  }
  assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM trade_work_order_events WHERE event_type='field_form_started'").get().count, 2);
  assert.equal(f.sql.prepare('SELECT revision,stage FROM trade_work_orders').get().revision, 1);
  f.sql.exec("UPDATE trade_form_templates SET fields='[]',name='Edited later' WHERE template_key='business-check'");
  assert.equal(JSON.parse(f.sql.prepare("SELECT template_snapshot FROM trade_job_forms WHERE template_key='business-check'").get().template_snapshot).name, 'business-check');
});

for (const [name, value] of [
  ['malformed', '{'], ['not a list', '{}'], ['null', 'null'], ['object payload', []], ['oversized', ' '.repeat(8193)],
  ['too many', JSON.stringify(Array.from({ length: 21 }, (_, i) => selection(`form-${i}`)))],
  ['duplicate', JSON.stringify([selection(), selection()])], ['fractional version', JSON.stringify([selection('business-check', 1.1)])],
  ['string version', JSON.stringify([selection('business-check', '1')])], ['foreign', JSON.stringify([selection('foreign-check')])],
  ['draft', JSON.stringify([selection('draft-check')])], ['withdrawn', JSON.stringify([selection('withdrawn-check')])],
  ['wrong version', JSON.stringify([selection('business-check', 2)])], ['wrong category', JSON.stringify([selection('wrong-category')])],
  ['invalid key', JSON.stringify([selection('business-check ')])], ['partial selection', JSON.stringify([selection(), selection('foreign-check')])],
  ['client snapshot', JSON.stringify([{ ...selection(), templateSnapshot: { fields: [] } }])],
  ['client actor', JSON.stringify([{ ...selection(), actorUid: 'owner' }])],
  ['client tenant', JSON.stringify([{ ...selection(), ownerUid: 'other' }])],
]) test(`invalid ${name} initial selection creates no job/customer/forms/events`, async t => {
  const f = fixture(t), before = f.state(), result = await f.send(create({ formSelectionsJson: value }));
  assert.equal(result.status, 400, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
});

for (const patch of [{ canManageFieldEvidence: false }, { canViewFieldEvidence: false }]) test(`initial attachment denies ${JSON.stringify(patch)} without writes`, async t => {
  const f = fixture(t, patch), before = f.state(), result = await f.send(create());
  assert.equal(result.status, 403, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
  assert.equal((await f.get({ mode: 'library', serviceCategory: 'hot-water' })).status, 403);
});

for (const [name, change] of [
  ['manage permission revoked', "UPDATE trade_team_members SET can_manage_field_evidence=0"],
  ['view permission revoked', "UPDATE trade_team_members SET can_view_field_evidence=0"],
  ['create permission revoked', "UPDATE trade_team_members SET can_create_jobs=0"],
  ['membership suspended', "UPDATE trade_team_members SET status='suspended'"],
  ['actor identity changed', "UPDATE trade_team_members SET member_uid='someone-else'"],
  ['published form withdrawn', "UPDATE trade_form_templates SET status='withdrawn' WHERE template_key='business-check'"],
  ['published snapshot edited', "UPDATE trade_form_templates SET fields='[]' WHERE template_key='business-check'"],
  ['published category changed', "UPDATE trade_form_templates SET categories='[\"solar\"]' WHERE template_key='business-check'"],
]) test(`${name} at create batch boundary rolls back job, forms and all dependent rows`, async t => {
  const f = fixture(t), before = f.state(); f.beforeBatch(() => f.sql.exec(change));
  const result = await f.send(create()); assert.equal(result.status, 409, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
});

test('newer published head or builtin withdrawal during creation invalidates the selected snapshot atomically', async t => {
  for (const builtin of [false, true]) {
    const f = fixture(t), before = f.state(); f.beforeBatch(() => f.publish(builtin ? 'pre-start-risk-readiness' : 'business-check', builtin ? '' : 'owner', builtin ? 'withdrawn' : 'published', 2));
    const result = await f.send(create()); assert.equal(result.status, 409, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
  }
});

test('field-session replay identity requires a live exact owner/member session at commit', async t => {
  const f = fixture(t, { fieldSessionId: 'session', actorUid: 'field-member:member' });
  const libraryResult = await f.get({ mode: 'library', serviceCategory: 'hot-water' }); assert.equal(libraryResult.status, 200);
  const before = f.state(); f.beforeBatch(() => f.sql.exec("UPDATE trade_field_sessions SET status='revoked'"));
  const result = await f.send(create()); assert.equal(result.status, 409, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
});

test('library rejects forged cached access, invalid categories and cross-origin requests without writes', async t => {
  const f = fixture(t), before = f.state();
  assert.equal((await f.get({ mode: 'library', serviceCategory: 'fake' })).status, 400);
  assert.equal((await f.get({ mode: 'library', serviceCategory: 'hot-water' }, { origin: 'https://foreign.test' })).status, 403);
  f.sql.exec("UPDATE trade_team_members SET can_manage_field_evidence=0");
  assert.equal((await f.get({ mode: 'library', serviceCategory: 'hot-water' })).status, 403); assert.deepEqual(f.state(), before);
});

test('omitted and empty form selections retain existing job creation permissions and attach nothing', async t => {
  for (const formSelectionsJson of [undefined, '', '[]']) {
    const f = fixture(t, { canManageFieldEvidence: false, canViewFieldEvidence: false }), result = await f.send(create({ formSelectionsJson }));
    assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.attachedFormCount, 0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_job_forms').get().count, 0);
  }
});

for (const serviceCategory of ['rental-inspection', 'electrical', 'plumbing', 'mounting-hardware', 'controls']) {
  test(`library and create retain exact compatible ${serviceCategory} category for its published form`, async t => {
    const f = fixture(t), key = `check-${serviceCategory}`; f.publish(key, 'owner', 'published', 1, serviceCategory);
    f.sql.prepare('UPDATE trade_team_members SET capabilities=?').run(JSON.stringify([serviceCategory]));
    const before = f.state(), result = await f.get({ mode: 'library', serviceCategory });
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.serviceCategory, serviceCategory);
    assert.ok(result.body.templates.some(item => item.key === key)); assert.deepEqual(f.state(), before);
    const created = await f.send(create({ serviceCategory, formSelectionsJson: JSON.stringify([selection(key)]),
      ...(serviceCategory === 'rental-inspection' ? { rentalInspectionModulesJson: '["minimum_standards"]', rentalAssessmentScope: 'current_minimum_standards' } : {}) }));
    assert.equal(created.status, 201, JSON.stringify(created.body)); assert.equal(created.body.attachedFormCount, 1);
    assert.equal(f.sql.prepare('SELECT service_category FROM trade_work_orders').get().service_category, serviceCategory);
    assert.equal(f.sql.prepare('SELECT template_key FROM trade_job_forms').get().template_key, key);
    if (serviceCategory === 'rental-inspection') {
      assert.equal(created.body.rentalInspectionAttached, true);
      assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_rental_inspection_modules').get().count, 1);
    }
  });
}

for (const action of ['create_job', 'create_scheduled_job']) test(`${action} attaches selected canonical rental assessment on an ordinary Victorian job`, async t => {
  const f = fixture(t);
  f.sql.prepare('UPDATE trade_team_members SET capabilities=?').run('["hot-water","rental-inspection"]');
  const result = await f.send(create({ action, formSelectionsJson: '[]',
    rentalInspectionModulesJson: '["minimum_standards"]', rentalAssessmentScope: 'current_minimum_standards' }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.rentalInspectionAttached, true); assert.equal(result.body.rentalInspectionModuleCount, 1);
  assert.equal(f.sql.prepare('SELECT service_category FROM trade_work_orders').get().service_category, 'hot-water');
  const inspection = f.sql.prepare('SELECT * FROM trade_rental_inspections').get();
  assert.equal(inspection.work_order_id, result.body.id); assert.equal(inspection.firebase_uid, 'owner');
  assert.equal(inspection.assessor_member_id, 'member'); assert.equal(inspection.assessor_uid, 'worker');
  assert.equal(inspection.assessment_scope, 'current_minimum_standards');
  const assessmentModule = f.sql.prepare('SELECT * FROM trade_rental_inspection_modules').get();
  assert.equal(assessmentModule.module_key, 'minimum_standards'); assert.equal(assessmentModule.answers, '{}');
  assert.deepEqual(JSON.parse(assessmentModule.template_snapshot), rental.rentalAssessmentTemplateSnapshot(['minimum_standards'], 'current_minimum_standards').modules.minimum_standards);
  assert.ok(JSON.parse(assessmentModule.template_snapshot).sections.length > 10);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_job_forms').get().count, 0, 'The real assessment is not a generic support checklist');
});

for (const value of [true, 'true']) test(`PIESA ${JSON.stringify(value)} freezes the official form and known defaults in the job transaction`, async t => {
  const f = fixture(t), result = await f.send(create({ formSelectionsJson: '[]', attachVeuElectricalAssessment: value }));
  assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.veuElectricalAssessmentAttached, true);
  const row = f.sql.prepare('SELECT * FROM trade_veu_electrical_assessments').get();
  const record = JSON.parse(row.payload);
  assert.equal(row.work_order_id, result.body.id); assert.equal(row.owner_uid, 'owner'); assert.equal(row.actor_uid, 'worker');
  assert.equal(record.status, 'draft'); assert.equal(record.revision, 1); assert.equal(record.completedAt, '');
  assert.deepEqual(record.form, electricalForm.createVeuElectricalForm());
  assert.equal(record.formSha256, activityForms.activityHash(record.form)); assert.equal(row.payload_sha256, activityForms.activityHash(row.payload));
  assert.deepEqual(record.answers, { job_reference: 'TLJ-TEST-1', owner_name: 'Test Customer', property_address: '12 Main St, Melbourne, VIC, 3000' });
  assert.deepEqual(record.evidence, []); assert.deepEqual(record.signatures, []); assert.equal(record.initialAttestation, undefined);
  assert.equal(record.signerDefaults.customer, 'Test Customer'); assert.equal(record.signerDefaults.technician, '');
  const version = f.sql.prepare('SELECT * FROM trade_veu_electrical_versions').get();
  assert.equal(version.record_id, row.id); assert.equal(version.payload, row.payload); assert.equal(version.payload_sha256, row.payload_sha256);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_job_forms').get().count, 0);
});

for (const value of [false, 'false', undefined]) test(`explicit PIESA choice ${JSON.stringify(value)} leaves ordinary job creation unchanged`, async t => {
  const f = fixture(t, { canManageFieldEvidence: false, canViewFieldEvidence: false });
  const result = await f.send(create({ formSelectionsJson: '[]', attachVeuElectricalAssessment: value }));
  assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.veuElectricalAssessmentAttached, false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_veu_electrical_assessments').get().count, 0);
});

for (const value of [null, 0, 1, '', 'on', 'yes', [], {}, 'TRUE']) test(`invalid PIESA choice ${JSON.stringify(value)} creates no records`, async t => {
  const f = fixture(t), before = f.state();
  const result = await f.send(create({ formSelectionsJson: '[]', attachVeuElectricalAssessment: value }));
  assert.equal(result.status, 400, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
});

for (const value of ['{', 'null', '{}', '["fake"]', '["minimum_standards","minimum_standards"]', []]) {
  test(`invalid rental choice ${JSON.stringify(value)} creates no records on an ordinary job`, async t => {
    const f = fixture(t), before = f.state();
    const result = await f.send(create({ formSelectionsJson: '[]', rentalInspectionModulesJson: value, rentalAssessmentScope: 'current_minimum_standards' }));
    assert.equal(result.status, 400, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
  });
}

for (const assessment of [
  { rentalInspectionModulesJson: '["minimum_standards"]', rentalAssessmentScope: 'current_minimum_standards' },
  { attachVeuElectricalAssessment: true },
]) test(`selected real assessment ${JSON.stringify(assessment)} cannot bypass field access or Victorian scope`, async t => {
  for (const accessPatch of [{ canManageFieldEvidence: false }, { canViewFieldEvidence: false }]) {
    const f = fixture(t, accessPatch), before = f.state();
    const result = await f.send(create({ formSelectionsJson: '[]', ...assessment }));
    assert.equal(result.status, 403, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
  }
  const f = fixture(t), before = f.state();
  const result = await f.send(create({ formSelectionsJson: '[]', addressState: 'NSW', postcode: '2000', suburb: 'Sydney', ...assessment }));
  assert.equal(result.status, 400, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
});

test('ordinary job rental attachment rejects missing worker capability before creating any records', async t => {
  const f = fixture(t), before = f.state();
  const result = await f.send(create({ formSelectionsJson: '[]', rentalInspectionModulesJson: '["minimum_standards"]', rentalAssessmentScope: 'current_minimum_standards' }));
  assert.equal(result.status, 409, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
});

for (const action of ['create_job', 'create_scheduled_job']) test(`${action} rechecks rental worker capability and assessment actor at the atomic boundary`, async t => {
  for (const change of ["UPDATE trade_team_members SET capabilities='[\"hot-water\"]'", 'UPDATE trade_team_members SET can_manage_field_evidence=0']) {
    const f = fixture(t); f.sql.prepare('UPDATE trade_team_members SET capabilities=?').run('["hot-water","rental-inspection"]');
    const before = f.state(); f.beforeBatch(() => f.sql.exec(change));
    const result = await f.send(create({ action, formSelectionsJson: '[]', rentalInspectionModulesJson: '["minimum_standards"]', rentalAssessmentScope: 'current_minimum_standards' }));
    assert.equal(result.status, 409, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
  }
});

test('PIESA actor revocation at atomic boundary rolls back the job and its assessment/version', async t => {
  const f = fixture(t), before = f.state(); f.beforeBatch(() => f.sql.exec('UPDATE trade_team_members SET can_manage_field_evidence=0'));
  const result = await f.send(create({ formSelectionsJson: '[]', attachVeuElectricalAssessment: true }));
  assert.equal(result.status, 409, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
});

test('a later real-rental insert failure rolls back previously inserted PIESA, version, customer and job rows', async t => {
  const f = fixture(t); f.sql.prepare('UPDATE trade_team_members SET capabilities=?').run('["hot-water","rental-inspection"]');
  f.sql.exec("CREATE TRIGGER synthetic_failed_rental_insert BEFORE INSERT ON trade_rental_inspection_modules BEGIN SELECT RAISE(ABORT,'SYNTHETIC_INSERT_FAILURE'); END");
  const before = f.state(), result = await f.send(create({ attachVeuElectricalAssessment: true,
    rentalInspectionModulesJson: '["minimum_standards"]', rentalAssessmentScope: 'current_minimum_standards' }));
  assert.equal(result.status, 500, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
});

for (const action of ['create_job', 'create_scheduled_job']) test(`${action} requires current credential evidence for selected rental electrical safety form`, async t => {
  const f = fixture(t); f.sql.prepare('UPDATE trade_team_members SET capabilities=?').run('["hot-water","rental-inspection"]');
  const request = create({ action, formSelectionsJson: '[]', rentalInspectionModulesJson: '["electrical_safety_check"]',
    rentalAssessmentScope: 'current_minimum_standards' });
  const before = f.state(), missing = await f.send(request);
  assert.equal(missing.status, 400, JSON.stringify(missing.body)); assert.equal(missing.body.code, 'RENTAL_WORKER_CREDENTIAL_REQUIRED');
  assert.deepEqual(f.state(), before);
  f.sql.exec(`INSERT INTO trade_team_member_files VALUES('licence-file','owner','member','active','2999-01-01');
    INSERT INTO trade_team_member_credentials VALUES('licence','owner','member','licence-file','licensed_electrician','active','SYNTHETIC-LICENCE','VIC','licence','2999-01-01');`);
  f.beforeBatch(() => f.sql.exec("UPDATE trade_team_member_credentials SET status='revoked' WHERE id='licence'"));
  const revoked = await f.send(request);
  assert.equal(revoked.status, 409, JSON.stringify(revoked.body)); assert.deepEqual(f.state(), before);
  f.sql.exec("UPDATE trade_team_member_credentials SET status='active' WHERE id='licence'");
  const created = await f.send(request); assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(JSON.parse(f.sql.prepare('SELECT selected_modules_snapshot FROM trade_rental_inspections').get().selected_modules_snapshot), ['electrical_safety_check']);
  assert.equal(f.sql.prepare('SELECT module_key FROM trade_rental_inspection_modules').get().module_key, 'electrical_safety_check');
});

test('cross-origin new-job assessment requests cannot create records', async t => {
  const f = fixture(t), before = f.state();
  const result = await f.send(create({ attachVeuElectricalAssessment: true }), { origin: 'https://foreign.test' });
  assert.equal(result.status, 403); assert.deepEqual(f.state(), before);
});

const creditexSelections = (activityTemplateId = 'veu-1', variantId = 'veu_1_residential') =>
  [{ programTemplateId: 'vic-veu', activityTemplateId, variantId }];
const creditexCreate = extras => create({ buildingType: 'house_townhouse', formSelectionsJson: '[]',
  complianceActivitiesJson: JSON.stringify(creditexSelections()), ...extras });
function publishActivityMaster(f, activityTemplateId, variantId, version, organisationId = 'creditex') {
  const form = structuredClone(activityLibrary.defaultActivityFieldForm(activityTemplateId, variantId));
  form.version = version;
  form.title = `Synthetic published master ${version} ${variantId}`;
  f.sql.prepare(`INSERT INTO trade_activity_field_masters
    (id,organisation_id,activity_template_id,variant_id,version,form_json,form_sha256,published_by_uid,published_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), organisationId, activityTemplateId, variantId, version,
    activityForms.activityCanonical(form), activityForms.activityHash(form), 'synthetic-author', '2026-10-08T00:00:00.000Z');
  return form;
}

for (const action of ['create_job', 'create_scheduled_job']) {
  for (const [buildingType, variantId] of [['house_townhouse', 'veu_1_residential'], ['commercial_office', 'veu_1_business']]) {
    test(`${action} opens the actual selected ${variantId} Creditex worker form with the exact published snapshot`, async t => {
      const f = fixture(t, {}, { creditex: true });
      publishActivityMaster(f, 'veu-1', variantId, 2);
      const selectedMaster = publishActivityMaster(f, 'veu-1', variantId, 7);
      publishActivityMaster(f, 'veu-1', variantId, 20, 'foreign-creditex');
      publishActivityMaster(f, 'veu-1', variantId.endsWith('business') ? 'veu_1_residential' : 'veu_1_business', 12);
      const result = await f.send(creditexCreate({ action, buildingType,
        complianceActivitiesJson: JSON.stringify(creditexSelections('veu-1', variantId)) }));
      assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.ok, true);
      assert.equal(result.body.workPackReady, false); assert.deepEqual(result.body.activityFormBlockers, []);
      const intent = f.sql.prepare('SELECT * FROM trade_work_order_compliance_intents').get();
      const row = f.sql.prepare('SELECT * FROM trade_activity_field_records').get();
      assert.ok(intent.id); assert.ok(row.id); assert.notEqual(row.id, intent.id);
      assert.equal(row.work_order_id, result.body.id); assert.equal(row.intent_id, intent.id);
      assert.equal(row.owner_uid, 'owner'); assert.equal(row.actor_uid, 'worker'); assert.equal(row.organisation_id, 'creditex');
      assert.equal(row.status, 'draft'); assert.equal(row.revision, 1);
      const record = JSON.parse(row.payload), baseline = activityLibrary.defaultActivityFieldForm('veu-1', variantId);
      assert.deepEqual(record.form, activityLibrary.applyDefaultActivityFormPolicy(selectedMaster, baseline));
      assert.equal(record.formSha256, activityForms.activityHash(record.form));
      assert.equal(record.form.variantId, variantId); assert.equal(record.form.version, 7);
      assert.deepEqual(result.body.activityForms, [{ intentId: intent.id, activityTemplateId: 'veu-1',
        recordId: row.id, recordNumber: record.recordNumber, formVersion: 7, variantId }]);
      assert.deepEqual(f.activityOpenCalls.map(([actor, jobId, intentId, variant]) => [actor.ownerUid, jobId, intentId, variant]),
        [['owner', result.body.id, intent.id, variantId]]);
      assert.equal(f.sql.prepare('SELECT payload FROM trade_activity_field_record_versions WHERE record_id=? AND revision=1').get(row.id).payload, row.payload);
      assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_job_forms').get().count, 0);
      assert.equal(record.signatures.length, 0); assert.equal(record.evidence.length, 0);
      assert.deepEqual(record.signerDefaults, { technician: 'Test Worker', customer: 'Test Customer' });
      publishActivityMaster(f, 'veu-1', variantId, 8);
      assert.equal(f.sql.prepare('SELECT payload FROM trade_activity_field_records WHERE id=?').get(row.id).payload, row.payload);
      if (action === 'create_scheduled_job') assert.equal(result.body.customerDocuments.status, 'failed');
    });
  }
}

test('selected multiple Creditex forms open each exact intent and retain governed work-pack blockers', async t => {
  const blockers = [{ code: 'synthetic_governed_setup_missing', message: 'Synthetic governed setup is absent' }];
  const f = fixture(t, {}, { creditex: true, workPackResults: [{ activityTemplateId: 'veu-1', workPackReady: false, blockers }] });
  const result = await f.send(creditexCreate({ complianceActivitiesJson: JSON.stringify([
    ...creditexSelections(), ...creditexSelections('veu-3', 'veu_3_residential'),
  ]) }));
  assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.workPackReady, false);
  assert.deepEqual(result.body.workPackBlockers, blockers); assert.deepEqual(result.body.activityFormBlockers, []);
  assert.equal(result.body.activityForms.length, 2); assert.equal(f.activityOpenCalls.length, 2);
  assert.deepEqual(result.body.activityForms.map(item => item.activityTemplateId), ['veu-1', 'veu-3']);
  const rows = f.sql.prepare('SELECT intent_id,activity_template_id FROM trade_activity_field_records').all();
  assert.equal(new Set(rows.map(row => row.intent_id)).size, 2);
  for (const row of rows) assert.equal(f.sql.prepare('SELECT activity_template_id FROM trade_work_order_compliance_intents WHERE id=?').get(row.intent_id).activity_template_id, row.activity_template_id);
});

test('an intent withdrawn after job creation is not opened and does not falsely fail the saved job', async t => {
  const f = fixture(t, {}, { creditex: true, afterWorkPacks: ({ sql }) => sql.exec("UPDATE trade_work_order_compliance_intents SET status='withdrawn'") });
  const result = await f.send(creditexCreate());
  assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.ok, true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_work_orders').get().count, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_crm_appointments').get().count, 1);
  assert.deepEqual(result.body.activityForms, []); assert.equal(f.activityOpenCalls.length, 0);
  assert.equal(result.body.activityFormBlockers[0].code, 'ACTIVITY_INTENT_NOT_ACTIVE');
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_activity_field_records').get().count, 0);
});

test('revoked field permission at postcommit opening leaves the saved job and exposes the real access blocker', async t => {
  const f = fixture(t, {}, { creditex: true, beforeActivityOpen: ({ access }) => { access.canManageFieldEvidence = false; } });
  const result = await f.send(creditexCreate());
  assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.ok, true);
  assert.equal(result.body.activityFormBlockers[0].code, 'ACTIVITY_ACCESS_REQUIRED');
  assert.deepEqual(result.body.activityForms, []);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_work_orders').get().count, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_activity_field_records').get().count, 0);
});

test('postcommit form storage failure is reported without leaking storage text or failing the saved job', async t => {
  const f = fixture(t, {}, { creditex: true });
  f.sql.exec("CREATE TRIGGER synthetic_form_failure BEFORE INSERT ON trade_activity_field_records BEGIN SELECT RAISE(ABORT,'Synthetic sensitive storage detail'); END");
  const result = await f.send(creditexCreate());
  assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.activityForms, []); assert.equal(result.body.activityFormBlockers[0].code, 'ACTIVITY_FORM_OPEN_FAILED');
  assert.doesNotMatch(JSON.stringify(result.body), /sensitive storage/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_work_orders').get().count, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_work_order_compliance_intents').get().count, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM trade_activity_field_records').get().count, 0);
});

test('training revoked before the create transaction creates no Creditex job or field record', async t => {
  const f = fixture(t, {}, { creditex: true }), before = f.state();
  f.beforeBatch(() => f.sql.exec("UPDATE trade_training_completions SET expires_at='2000-01-01T00:00:00.000Z' WHERE member_id='member'"));
  const result = await f.send(creditexCreate());
  assert.equal(result.status, 409, JSON.stringify(result.body)); assert.deepEqual(f.state(), before);
  assert.equal(f.activityOpenCalls.length, 0);
});

test('Creditex premises mismatch is rejected before any job or selected form is saved', async t => {
  const f = fixture(t, {}, { creditex: true }), before = f.state();
  const result = await f.send(creditexCreate({ buildingType: 'commercial_office' }));
  assert.equal(result.status, 409, JSON.stringify(result.body)); assert.equal(result.body.code, 'ACTIVITY_PREMISES_VARIANT_INVALID');
  assert.deepEqual(f.state(), before); assert.equal(f.activityOpenCalls.length, 0);
});
