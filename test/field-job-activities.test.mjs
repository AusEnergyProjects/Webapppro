import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as catalogue from '../src/lib/australian-government-program-catalogue.ts';
import * as forms from '../src/lib/trade-activity-forms-library.ts';
import * as rental from '../src/lib/trade-rental-assessment.mjs';
import * as rentalGuards from '../src/lib/trade-rental-schema-guards.ts';
import * as credentials from '../src/lib/trade-rental-credentials.ts';
import * as sync from '../src/lib/trade-team-sync-server.ts';
import * as bounded from '../src/lib/bounded-json-request.ts';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function load(path, mocks) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  new Function('require', 'module', 'exports', output)((name) => {
    if (!(name in mocks)) throw new Error(`Unmocked import ${name}`);
    return mocks[name];
  }, record, record.exports);
  return record.exports;
}
const intent = load('src/lib/trade-compliance-intent.ts', { './australian-government-program-catalogue': catalogue });

function fixture(accessOverrides = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE trade_work_orders(id text primary key, firebase_uid text, partner_type text, source_type text,
      source_reference text, work_number text, assignee_member_id text, assignee_label text, stage text, service_category text,
      revision integer, record_status text, scheduled_start text, scheduled_end text, updated_at text);
    CREATE TABLE trade_crm_job_details(work_order_id text, firebase_uid text, crm_customer_id text, service_site_id text, customer_source text, building_type text);
    CREATE TABLE trade_crm_customers(id text primary key, firebase_uid text, first_name text, last_name text, business_name text, email text, phone text, record_status text);
    CREATE TABLE trade_crm_service_sites(id text primary key, firebase_uid text, customer_id text, address_line_1 text, address_line_2 text, suburb text, address_state text, postcode text, record_status text);
    CREATE TABLE trade_team_members(id text primary key, owner_uid text, member_uid text, display_name text, capabilities text, status text);
    CREATE TABLE trade_team_member_credentials(id text primary key, owner_uid text, team_member_id text, file_id text, credential_type text, credential_number text, jurisdiction text, status text, expires_at text);
    CREATE TABLE trade_team_member_files(id text primary key, owner_uid text, team_member_id text, status text, expires_at text);
    CREATE TABLE trade_crm_appointments(id text primary key, work_order_id text, firebase_uid text, status text, starts_at text);
    CREATE TABLE trade_crm_job_media(id text primary key, work_order_id text, firebase_uid text);
    CREATE TABLE trade_work_order_events(id text, work_order_id text, firebase_uid text, event_type text, summary text NOT NULL, created_at text);
    CREATE TABLE trade_team_sync_changes(owner_uid text, audience_member_id text, entity_type text, entity_id text, operation text, revision integer, changed_at text);
    CREATE TABLE trade_mobile_push_outbox(id text, owner_uid text, audience_member_id text, event_key text, event_type text, entity_type text, entity_id text, payload text, status text, attempts integer, next_attempt_at text, created_at text, updated_at text);
    CREATE TABLE compliance_organisations(id text primary key, organisation_code text, status text);
    INSERT INTO trade_work_orders VALUES('job','owner','installer','internal','','TLJ-TEST','worker','Assessor','scheduled','electrical',4,'active','2026-09-10T11:00','2026-09-10T12:00','before');
    INSERT INTO trade_crm_job_details VALUES('job','owner','customer','site','trade_owned','house_townhouse');
    INSERT INTO trade_crm_customers VALUES('customer','owner','Jane','Smith','','jane@example.test','0400000000','active');
    INSERT INTO trade_crm_service_sites VALUES('site','owner','customer','1 Test Road','','Melbourne','VIC','3000','active');
    INSERT INTO trade_team_members VALUES('worker','owner','owner','Assessor','[]','active');
    INSERT INTO trade_crm_appointments VALUES('appointment','job','owner','scheduled','2026-09-10T11:00');
    INSERT INTO compliance_organisations VALUES('creditex','CREDITEX-AU','active');
  `);
  // Execute the actual production rental tables and scope amendments, plus the intent table/key migrations.
  database.exec(read('drizzle/0160_trade_rental_inspections.sql'));
  database.exec(read('drizzle/0161_trade_field_access_and_rental_scope.sql'));
  database.exec(read('drizzle/0171_trade_rental_assessment_scope.sql'));
  database.exec(read('drizzle/0115_trade_creditex_job_intent.sql'));
  database.exec(read('drizzle/0119_trade_multi_activity_jobs.sql').split('ALTER TABLE `compliance_cases`')[0]);
  let beforeBatch = null;
  const db = {
    prepare(sql) {
      const statement = (values = []) => ({
        bind: (...next) => statement(next),
        first: async () => database.prepare(sql).get(...values) || null,
        all: async () => ({ results: database.prepare(sql).all(...values) }),
        run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...values).changes) } }),
      });
      return statement();
    },
    async batch(statements) {
      const callback = beforeBatch; beforeBatch = null; callback?.();
      database.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); database.exec('COMMIT'); return results; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
  const access = { ownerUid: 'owner', actorUid: 'owner', memberId: 'worker', isOwner: true, jobScope: 'own', canManageJobs: true, ...accessOverrides };
  const teams = load('src/lib/trade-team-server.ts', { '../../db': { getD1: () => db }, './trade-team-permission-policy.mjs': {},
    './firebase-server': {}, './trade-access-server': {}, './creditex-schema-guards': {}, './tlink-schema-guards': {}, './trade-field-session-server': {} });
  const route = load('src/app/api/field/job-activities/route.ts', {
    '../../../../../db': { getD1: () => db },
    '@/lib/admin-server': { cleanAdminText: (value, max) => String(value || '').trim().slice(0, max),
      sameOrigin: (request) => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin,
      adminJson: (body, status = 200) => Response.json(body, { status }) },
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => access, canManageJobs: teams.canManageJobs, assignedJob: teams.assignedJob },
    '@/lib/trade-team-sync-server': sync, '@/lib/australian-government-program-catalogue': catalogue,
    '@/lib/trade-activity-forms-library': forms, '@/lib/trade-compliance-intent': intent,
    '@/lib/trade-rental-assessment.mjs': rental, '@/lib/trade-rental-schema-guards': rentalGuards,
    '@/lib/trade-rental-credentials': credentials, '@/lib/bounded-json-request': bounded,
  });
  const get = () => route.GET(new Request('https://example.test/api/field/job-activities?workOrderId=job'));
  const post = (extra, headers = {}) => route.POST(new Request('https://example.test/api/field/job-activities', {
    method: 'POST', headers, body: JSON.stringify({ workOrderId: 'job', expectedRevision: 4, ...extra }),
  }));
  return { database, db, access, get, post, beforeBatch: (callback) => { beforeBatch = callback; } };
}

test('existing electrical job offers real rental, VEU and STC forms with availability reasons', async () => {
  const f = fixture(); const response = await f.get(); assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rentalModules.find((item) => item.id === 'minimum_standards').unavailableReason, '');
  assert.ok(body.activities.some((item) => item.programCode === 'VEU' && !item.unavailableReason));
  assert.ok(body.programs.some((item) => item.label.includes('STC')));
  for (const activity of body.activities.filter((item) => !forms.activityFieldCatalogue().some((form) => form.activityTemplateId === item.id))) {
    assert.match(activity.unavailableReason, /not available/);
  }
});

test('rental attach uses canonical snapshots on the same job and customer and retries without duplicates', async () => {
  const f = fixture(); const result = await f.post({ kind: 'rental', moduleKey: 'minimum_standards' });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  const inspection = f.database.prepare('SELECT * FROM trade_rental_inspections').get();
  assert.equal(inspection.work_order_id, 'job'); assert.equal(inspection.inspection_number, 'RMS-TEST');
  assert.deepEqual(JSON.parse(inspection.selected_modules_snapshot), ['minimum_standards']);
  assert.equal(JSON.parse(inspection.property_snapshot).customer.id, 'customer');
  assert.equal(JSON.parse(inspection.property_snapshot).appointment.id, 'appointment');
  const attachedModule = f.database.prepare('SELECT * FROM trade_rental_inspection_modules').get();
  const attachedTemplate = JSON.parse(attachedModule.template_snapshot);
  assert.deepEqual(attachedTemplate, rental.rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards);
  assert.ok(attachedTemplate.sections.flatMap((section) => section.checks).some((check) => check.assessmentPhase === 'energy_readiness_2027'));
  const completionQuery = read('src/app/api/trade-field-work/route.ts').match(/db\.prepare\(`(SELECT COUNT\(\*\) count FROM trade_rental_inspections\s+WHERE work_order_id = \? AND firebase_uid = \? AND status <> 'issued')`\)/)?.[1];
  assert.ok(completionQuery, 'The authoritative completion gate must include attached rental reports');
  assert.equal(f.database.prepare(completionQuery).get('job', 'owner').count, 1, 'The mixed electrical job cannot finish without its rental report');
  assert.equal(f.database.prepare('SELECT service_category FROM trade_work_orders').get().service_category, 'electrical');
  assert.equal((await f.post({ kind: 'rental', moduleKey: 'minimum_standards' })).status, 200);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_rental_inspections').get().n, 1);
  assert.equal(f.database.prepare('SELECT revision FROM trade_work_orders').get().revision, 5);
  assert.equal(f.database.prepare("SELECT count(*) n FROM trade_team_sync_changes WHERE entity_id='job'").get().n, 2);
});

test('activity attachment persists the controlled variant and hash without manufacturing a regulated case', async () => {
  const f = fixture(); const options = await (await f.get()).json();
  const choice = options.activities.find((item) => item.id === 'veu-1'); assert.ok(choice);
  const result = await f.post({ kind: 'program', activityTemplateId: choice.id, programTemplateId: choice.programTemplateId });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  const stored = f.database.prepare('SELECT * FROM trade_work_order_compliance_intents').get();
  const snapshot = JSON.parse(stored.intent_snapshot);
  assert.equal(snapshot.activity.variantId, 'veu_1_residential');
  assert.equal(stored.status, 'planned'); assert.equal(stored.compliance_case_id, '');
  assert.equal(stored.intent_snapshot_sha256, createHash('sha256').update(stored.intent_snapshot).digest('hex'));
  assert.equal((await f.post({ kind: 'program', activityTemplateId: choice.id, programTemplateId: choice.programTemplateId })).status, 200);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_work_order_compliance_intents').get().n, 1);
});

test('scope, terminal jobs, jurisdiction, stale revision and invalid choices fail without attaching data', async () => {
  for (const scenario of ['permission', 'assignment', 'protected', 'cancelled', 'state', 'revision', 'choice', 'origin']) {
    const f = fixture(scenario === 'permission' ? { isOwner: false, canManageJobs: false } : scenario === 'assignment' ? { isOwner: false, memberId: 'other' } : {});
    if (scenario === 'protected') f.database.exec("UPDATE trade_crm_job_details SET customer_source='platform_private'");
    if (scenario === 'cancelled') f.database.exec("UPDATE trade_work_orders SET stage='cancelled'");
    if (scenario === 'state') f.database.exec("UPDATE trade_crm_service_sites SET address_state='NSW'");
    const result = await f.post({ kind: 'rental', moduleKey: scenario === 'choice' ? 'fake' : 'minimum_standards', ...(scenario === 'revision' ? { expectedRevision: 3 } : {}) }, scenario === 'origin' ? { origin: 'https://other.test' } : {});
    assert.ok(result.status >= 400 && result.status < 500, `${scenario}: ${result.status}`);
    assert.equal(f.database.prepare('SELECT count(*) n FROM trade_rental_inspections').get().n, 0);
  }
});

test('job changed during attach rolls back the module, inspection and sync events', async () => {
  const f = fixture(); await rentalGuards.ensureTradeRentalSchemaGuards(f.db);
  f.beforeBatch(() => f.database.exec('UPDATE trade_work_orders SET revision=7'));
  const result = await f.post({ kind: 'rental', moduleKey: 'minimum_standards' }); assert.equal(result.status, 409);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_rental_inspections').get().n, 0);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_team_sync_changes').get().n, 0);
});

test('worker deactivated during attach cannot gain a new activity through a stale capability check', async () => {
  const f = fixture(); await rentalGuards.ensureTradeRentalSchemaGuards(f.db);
  f.beforeBatch(() => f.database.exec("UPDATE trade_team_members SET status='inactive'"));
  assert.equal((await f.post({ kind: 'rental', moduleKey: 'minimum_standards' })).status, 409);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_rental_inspections').get().n, 0);
  assert.equal(f.database.prepare('SELECT revision FROM trade_work_orders').get().revision, 4);
});

test('licensed rental module requires a current credential and merges without changing existing answers', async () => {
  const f = fixture(); assert.equal((await f.post({ kind: 'rental', moduleKey: 'minimum_standards' })).status, 200);
  assert.equal((await f.post({ kind: 'rental', moduleKey: 'electrical_safety_check', expectedRevision: 5 })).status, 409);
  f.database.exec(`INSERT INTO trade_team_member_files VALUES('file','owner','worker','active','2099-01-01');
    INSERT INTO trade_team_member_credentials VALUES('credential','owner','worker','file','licence','123456789','VIC','active','2099-01-01','licensed_electrician');
    UPDATE trade_rental_inspection_modules SET answers='{"occupancy":"occupied"}';`);
  const result = await f.post({ kind: 'rental', moduleKey: 'electrical_safety_check', expectedRevision: 5 });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_rental_inspection_modules').get().n, 2);
  assert.equal(f.database.prepare("SELECT answers FROM trade_rental_inspection_modules WHERE module_key='minimum_standards'").get().answers, '{"occupancy":"occupied"}');
  assert.deepEqual(JSON.parse(f.database.prepare('SELECT selected_modules_snapshot FROM trade_rental_inspections').get().selected_modules_snapshot), ['minimum_standards', 'electrical_safety_check']);
});

test('native entry exposes activities before supporting forms and uses the existing form runners', () => {
  const library = read('mobile/src/components/field-form-library.tsx');
  assert.ok(library.indexOf('<FieldJobActivityPicker') < library.indexOf('Supporting forms'));
  const job = read('mobile/src/app/job/[id].tsx');
  assert.match(job, /job\.rentalInspection && activeFormId === 'rental'/);
  assert.match(job, /job\.rentalInspection && job\.rentalInspection\.status !== 'issued'/);
  assert.match(job, /Add work or a form/);
});
