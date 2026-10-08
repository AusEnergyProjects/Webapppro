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
import * as jobLifecycle from '../src/lib/trade-job-lifecycle.ts';
import * as mapDataset from '../src/lib/trade-map-dataset-server.ts';
import * as mapLocation from '../src/lib/trade-map-location-cache.ts';
import { GnafDirectoryUnavailableError } from '../src/lib/gnaf-directory.ts';
import { canonicalAustralianAddress } from '../src/lib/trade-address-verification.ts';
import { certificateTestDependency } from './helpers/creditex-training-fixture.mjs';
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

function fixture(t, accessPatch = {}) {
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
    trade_work_order_compliance_intents: 'id work_order_id installer_uid activity_template_id status',
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
  const access = { ownerUid: 'owner', memberId: 'member', actorUid: 'worker', actorEmail: 'worker@example.test', isOwner: false,
    canCreateJobs: true, canManageCustomers: true, canViewFieldEvidence: true, canManageFieldEvidence: true, canRescheduleJobs: true,
    jobScope: 'own', scheduleScope: 'own', ...accessPatch };
  const templates = load('src/lib/trade-form-templates-server.ts', { '../../db': { getD1: () => db }, '@/lib/trade-form-library.mjs': library });
  const attachments = load('src/lib/trade-job-form-attachment-server.ts', { './trade-form-templates-server': templates, './trade-message-media-access': actorGuards });
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
    '@/lib/trade-compliance-intent': { TradeComplianceIntentError: DomainError, resolveTradeComplianceIntents: () => [] },
    '@/lib/creditex-compliance-server': { ComplianceDomainError: DomainError },
    '@/lib/trade-access-server': { TradeAccessError: DomainError },
    '@/lib/trade-schedule-server': { ...load('src/lib/trade-schedule-server.ts', { '../../db': { getD1: () => db } }),
      tradeJobScheduleEligibilityGuardStatement: async () => db.prepare('SELECT 1') },
    '@/lib/trade-schedule': { assertAppointmentSlot: () => {}, assertFutureAppointment: () => {}, australiaLocalDateTime: () => '2026-10-08T00:00',
      appointmentEndsAt: () => '2099-01-01T11:00:00.000Z' },
    '@/lib/trade-calendar-sync-server': { syncCreatedAppointmentToConnectedCalendars: async () => ({ synced: 0, failed: 0 }) },
    '@/lib/trade-rental-assessment.mjs': rental,
    '@/lib/trade-rental-schema-guards': { ensureTradeRentalSchemaGuards: async () => {} },
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
    'trade_mobile_push_outbox', 'trade_crm_write_guards'].map(table => [table, sql.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
  return { sql, db, publish, access, send, get, state, beforeBatch: hook => { beforeBatch = hook; } };
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
