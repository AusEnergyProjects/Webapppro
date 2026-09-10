import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const load = (path, dependencies = {}) => {
  const moduleRecord = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL(path, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', source)((name) => dependencies[name] || {}, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
};
const timestamp = '2026-09-10T01:00:00.000Z';

test('file cleanup runs under the worker lifetime without blocking the job action', async () => {
  const pending = []; let finish; let options;
  const drain = new Promise((resolve) => { finish = resolve; });
  const service = load('src/lib/trade-job-deletion-server.ts', {
    'cloudflare:workers': { env: { EVIDENCE: {} }, waitUntil: (promise) => pending.push(promise) },
    './trade-crm-job-media-cleanup': { drainTradeCrmJobMediaCleanup: (input) => { options = input; return drain; } },
  });
  const db = {};
  assert.equal(service.scheduleJobFileCleanup(db), undefined);
  assert.equal(options.db, db); assert.equal(options.limit, 10); assert.equal(pending.length, 1);
  finish(); await pending[0];
});

function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec('PRAGMA foreign_keys = ON');
  for (const name of fs.readdirSync(new URL('drizzle/', root)).filter((name) => /^\d{4}_.+\.sql$/.test(name) && !name.startsWith('0044_')).sort()) {
    sql.exec(fs.readFileSync(new URL(`drizzle/${name}`, root), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  let beforeBatch;
  class Statement {
    constructor(query, values = []) { this.query = query; this.values = values; }
    bind(...values) { return new Statement(this.query, values); }
    async first() { return sql.prepare(this.query).get(...this.values) || null; }
    async all() { return { results: sql.prepare(this.query).all(...this.values) }; }
    runSync() { const result = sql.prepare(this.query).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
    async run() { return this.runSync(); }
  }
  const db = { prepare(query) {
    // Sites D1 limits a compound SELECT to five terms. Desktop SQLite accepts
    // 500, which previously hid the production failure in deletion preflight.
    const terms = 1 + (query.match(/\bUNION(?:\s+ALL)?\s+SELECT\b/gi) || []).length;
    if (terms > 5) throw new Error('D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR');
    return new Statement(query);
  }, async batch(statements) {
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; hook(); }
    sql.exec('BEGIN');
    try { const results = statements.map((statement) => statement.runSync()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  const insert = (table, values) => sql.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values));
  const addJob = (id, owner = 'owner') => {
    insert('trade_work_orders', { id, firebase_uid: owner, partner_type: 'installer', work_number: id, title: id, stage: 'no_show', revision: 4, assignee_member_id: 'worker', created_at: timestamp, updated_at: timestamp });
    insert('trade_crm_job_details', { id: `${id}-details`, work_order_id: id, firebase_uid: owner, crm_customer_id: 'customer', customer_source: 'trade_owned', created_at: timestamp, updated_at: timestamp });
  };
  insert('trade_crm_customers', { id: 'customer', firebase_uid: 'owner', customer_number: 'C1', first_name: 'Keep me', created_at: timestamp, updated_at: timestamp });
  addJob('job'); addJob('other', 'other-owner');
  const access = { ownerUid: 'owner', memberId: 'worker', isOwner: true, canManageJobs: true, jobScope: 'team' };
  const job = () => ({ ...sql.prepare('SELECT * FROM trade_work_orders WHERE id = ?').get('job'), customer_source: 'trade_owned' });
  let calendarFails = false;
  const calendarCalls = [];
  const service = load('src/lib/trade-job-deletion-server.ts', {
    'cloudflare:workers': { env: {} },
    './trade-compliance-intent-replan-server': load('src/lib/trade-compliance-intent-replan-server.ts'),
    './trade-team-sync-server': load('src/lib/trade-team-sync-server.ts'),
    './trade-calendar-sync-server': { async cancelAppointmentInConnectedCalendars(ownerUid, id) {
      calendarCalls.push([ownerUid, id]);
      if (!calendarFails) sql.prepare("UPDATE trade_crm_calendar_events SET status = 'cancelled' WHERE appointment_id = ? AND firebase_uid = ?").run(id, ownerUid);
      return { failed: calendarFails ? 1 : 0 };
    } },
  });
  const teams = load('src/lib/trade-team-server.ts', { '../../db': { getD1: () => db } });
  const route = load('src/app/api/field/appointment-actions/route.ts', {
    '../../../../../db': { getD1: () => db },
    '@/lib/admin-server': { sameOrigin: () => true, cleanAdminText: (value, limit) => String(value || '').trim().slice(0, limit), adminJson: (value, status = 200) => Response.json(value, { status }) },
    '@/lib/trade-team-server': { assignedJob: teams.assignedJob, requireInstallerTeamAccess: async () => access },
    '@/lib/trade-team-permission-policy.mjs': { canRescheduleWithinScope: () => true },
    '@/lib/trade-job-deletion-server': service,
  });
  return { sql, db, insert, access, job, calendarCalls, service, addJob,
    request: (extra = {}) => route.PATCH(new Request('https://example.test/api/field/appointment-actions', { method: 'PATCH', body: JSON.stringify({ action: 'delete', workOrderId: 'job', expectedRevision: 4, confirmDelete: true, ...extra }) })),
    delete: (value = job()) => service.deleteTradeJob(db, access, value),
    race: (hook) => { beforeBatch = hook; }, calendarFails: (value) => { calendarFails = value; } };
}

function addAcceptedQuote(f, jobId = 'job', owner = 'owner') {
  const key = (name) => `${jobId}-${name}`;
  const dated = { firebase_uid: owner, created_at: timestamp, updated_at: timestamp };
  const jobFields = { work_order_id: jobId, firebase_uid: owner };
  const quoteFields = { ...jobFields, quote_id: key('quote'), quote_version_id: key('version') };
  f.insert('trade_crm_quotes', { id: key('quote'), ...dated, work_order_id: jobId, crm_customer_id: 'customer', service_site_id: '', quote_number: key('Q1'), status: 'accepted' });
  f.insert('trade_crm_quote_versions', { id: key('version'), ...dated, quote_id: key('quote'), version_number: 1, status: 'accepted', issued_pdf_object_key: `quotes/${jobId}.pdf` });
  f.insert('trade_crm_quote_choices', { id: key('choice'), firebase_uid: owner, quote_version_id: key('version'), position: 1, choice_key: 'base', choice_kind: 'required', group_key: '', name: 'Agreed work', created_at: timestamp });
  f.insert('trade_crm_quote_items', { id: key('item'), firebase_uid: owner, quote_version_id: key('version'), quote_choice_id: key('choice'), position: 1, line_type: 'service', description: 'Accepted work', quantity_milli: 1000, unit_price_cents: 100, tax_code: 'GST', subtotal_cents: 100, tax_cents: 10, total_cents: 110, created_at: timestamp });
  f.insert('trade_crm_quote_execution_snapshots', { id: key('execution'), firebase_uid: owner, quote_version_id: key('version'), packets_json: '[{"title":"Agreed work"}]', created_at: timestamp });
  f.insert('trade_crm_quote_links', { id: key('link'), ...dated, ...quoteFields, crm_customer_id: 'customer', token_hash: key('token'), expires_at: '2026-10-01T00:00:00Z' });
  f.insert('trade_crm_quote_acceptances', { id: key('acceptance'), ...quoteFields, quote_link_id: key('link'), crm_customer_id: 'customer', customer_firebase_uid: 'customer-user', actor_email: 'customer@example.test', decision: 'accepted', consent_statement: 'I accept this quote.', decided_at: timestamp, created_at: timestamp });
  f.insert('trade_crm_commercial_handovers', { id: key('handover'), ...dated, ...quoteFields, acceptance_id: key('acceptance'), crm_customer_id: 'customer', commercial_reference: key('accepted'), scope_snapshot_json: '[{"description":"Accepted work"}]', subtotal_cents: 100, tax_cents: 10, total_cents: 110, accepted_at: timestamp });
  f.insert('trade_crm_quote_events', { id: key('event'), ...quoteFields, quote_link_id: key('link'), event_type: 'accepted', evidence_key: key('evidence'), occurred_at: timestamp });
  f.insert('trade_crm_quote_questions', { id: key('question'), ...quoteFields, quote_link_id: key('link'), question: 'Can you attend Friday?', asked_at: timestamp });
  f.insert('trade_crm_quote_deliveries', { id: key('delivery'), ...dated, ...jobFields, quote_version_id: key('version'), quote_link_id: key('link'), crm_customer_id: 'customer', channel: 'email', provider: 'resend', status: 'sent', idempotency_key: key('delivery') });
  f.insert('trade_crm_job_plans', { id: key('plan'), ...dated, ...jobFields, commercial_handoff_id: key('handover'), quote_version_id: key('version'), commercial_reference: key('accepted'), accepted_subtotal_cents: 100, accepted_tax_cents: 10, accepted_total_cents: 110 });
  f.insert('trade_crm_job_plan_phases', { id: key('phase'), firebase_uid: owner, job_plan_id: key('plan'), position: 1, title: 'Installation', customer_description: 'Agreed work', created_at: timestamp });
  f.insert('trade_crm_job_plan_requirements', { id: key('requirement'), firebase_uid: owner, job_plan_id: key('plan'), job_plan_phase_id: key('phase'), position: 1, requirement_type: 'labour', description: 'Installer', created_at: timestamp });
  f.insert('trade_crm_job_actuals', { id: key('actual'), ...dated, ...jobFields, job_plan_id: key('plan'), job_plan_phase_id: key('phase'), job_plan_requirement_id: key('requirement'), actual_type: 'labour', recorded_by_uid: owner });
  return key;
}

test('an accepted then cancelled quote job deletes its agreement and execution data, retaining customers and other jobs', async (t) => {
  const f = fixture(t);
  addAcceptedQuote(f);
  addAcceptedQuote(f, 'other', 'other-owner');
  f.addJob('same-owner'); addAcceptedQuote(f, 'same-owner');
  f.sql.prepare("UPDATE trade_work_orders SET stage = 'cancelled' WHERE id = 'job'").run();
  f.sql.prepare("UPDATE trade_crm_job_details SET quote_status = 'accepted' WHERE work_order_id = 'job'").run();
  const response = await f.request();
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  for (const table of ['trade_crm_quotes', 'trade_crm_quote_versions', 'trade_crm_quote_choices', 'trade_crm_quote_items',
    'trade_crm_quote_execution_snapshots', 'trade_crm_quote_links', 'trade_crm_quote_acceptances', 'trade_crm_commercial_handovers',
    'trade_crm_quote_events', 'trade_crm_quote_questions', 'trade_crm_quote_deliveries', 'trade_crm_job_plans',
    'trade_crm_job_plan_phases', 'trade_crm_job_plan_requirements', 'trade_crm_job_actuals']) {
    assert.deepEqual(f.sql.prepare(`SELECT id FROM ${table} ORDER BY id`).all().map((row) => row.id),
      f.sql.prepare(`SELECT id FROM ${table} WHERE id LIKE 'other-%' OR id LIKE 'same-owner-%' ORDER BY id`).all().map((row) => row.id), table);
    assert.equal(f.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 2, table);
  }
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM trade_crm_customers WHERE id = 'customer'").get().n, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM trade_work_orders WHERE id = 'job'").get().n, 0);
  assert.deepEqual(f.sql.prepare('SELECT object_key FROM trade_crm_job_media_cleanup').all().map((row) => row.object_key), ['quotes/job.pdf']);
  assert.equal(f.sql.prepare("SELECT operation FROM trade_team_sync_changes WHERE entity_id = 'job' ORDER BY sequence DESC LIMIT 1").get().operation, 'delete');
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(), []);
});

test('an unscheduled test job deletes within production D1 compound SELECT limits', async (t) => {
  const f = fixture(t);
  assert.throws(() => f.db.prepare('SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6'), /too many terms in compound SELECT/);
  f.sql.prepare("UPDATE trade_work_orders SET stage = 'new', assignee_member_id = '' WHERE id = 'job'").run();
  const response = await f.request();
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM trade_work_orders WHERE id = 'job'").get().n, 0);
  assert.equal(f.sql.prepare("SELECT first_name FROM trade_crm_customers WHERE id = 'customer'").get().first_name, 'Keep me');
});

test('hard delete removes own job forms, quote PDFs, photos and child data; retains customer and other owner', async (t) => {
  const f = fixture(t);
  const common = { work_order_id: 'job', firebase_uid: 'owner', created_at: timestamp, updated_at: timestamp };
  f.insert('trade_crm_job_notes', { id: 'note', ...common, body: 'private job note' });
  f.insert('trade_work_order_tasks', { id: 'task', ...common, title: 'task' });
  f.insert('trade_job_forms', { id: 'form', ...common, template_key: 'custom', template_version: 1, template_name: 'Form', jurisdiction: 'VIC', template_snapshot: '{}', answers: '{"note":"private"}' });
  f.insert('trade_crm_job_media', { id: 'photo', ...common, file_name: 'photo.jpg', content_type: 'image/jpeg', size_bytes: 20, object_key: 'job/photos/test.jpg' });
  f.insert('trade_crm_quotes', { id: 'quote', ...common, crm_customer_id: 'customer', service_site_id: '', quote_number: 'Q1', status: 'sent' });
  f.insert('trade_crm_quote_versions', { id: 'version', quote_id: 'quote', firebase_uid: 'owner', version_number: 1, status: 'issued', issued_pdf_object_key: 'quotes/test.pdf', created_at: timestamp, updated_at: timestamp });
  f.insert('trade_crm_quote_items', { id: 'item', quote_version_id: 'version', firebase_uid: 'owner', position: 1, line_type: 'service', description: 'Work', quantity_milli: 1000, unit_price_cents: 100, tax_code: 'GST', subtotal_cents: 100, tax_cents: 10, total_cents: 110, created_at: timestamp });
  f.insert('trade_mobile_upload_sessions', { id: 'upload', owner_uid: 'owner', actor_uid: 'owner', device_id: 'phone', client_upload_id: 'upload', metadata_hash: 'hash', work_order_id: 'job', object_key: 'job/pending.jpg', upload_id: 'multipart', file_name: 'pending.jpg', content_type: 'image/jpeg', size_bytes: 20, part_size_bytes: 20, expires_at: timestamp, created_at: timestamp, updated_at: timestamp });
  f.insert('trade_mobile_upload_parts', { id: 'part', session_id: 'upload', part_number: 1, etag: 'etag', size_bytes: 20, created_at: timestamp, updated_at: timestamp });
  f.insert('trade_offline_actions', { id: 'action', owner_uid: 'owner', actor_uid: 'owner', client_action_id: 'action', payload_hash: 'hash', action_type: 'save_job_form', entity_type: 'form', entity_id: 'form', created_at: timestamp });
  const result = await f.delete();
  assert.equal(result.deletedJobId, 'job');
  for (const table of ['trade_crm_job_notes', 'trade_work_order_tasks', 'trade_job_forms', 'trade_crm_job_media', 'trade_crm_quotes', 'trade_crm_quote_versions', 'trade_crm_quote_items', 'trade_offline_actions', 'trade_mobile_upload_sessions', 'trade_mobile_upload_parts']) assert.equal(f.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM trade_work_orders WHERE id = 'job'").get().n, 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM trade_work_orders WHERE id = 'other'").get().n, 1);
  assert.equal(f.sql.prepare("SELECT first_name FROM trade_crm_customers WHERE id = 'customer'").get().first_name, 'Keep me');
  assert.deepEqual(f.sql.prepare('SELECT object_key FROM trade_crm_job_media_cleanup ORDER BY object_key').all().map((row) => row.object_key), ['job/pending.jpg', 'job/photos/test.jpg', 'quotes/test.pdf']);
  assert.equal(f.sql.prepare("SELECT upload_id FROM trade_crm_job_media_cleanup WHERE object_key = 'job/pending.jpg'").get().upload_id, 'multipart');
  assert.equal(f.sql.prepare("SELECT operation FROM trade_team_sync_changes WHERE entity_id = 'job' ORDER BY sequence DESC LIMIT 1").get().operation, 'delete');
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(), []);
});

test('draft rental children are removed in foreign-key order', async (t) => {
  const f = fixture(t);
  f.insert('trade_rental_inspections', { id: 'rental', work_order_id: 'job', firebase_uid: 'owner', inspection_number: 'R1', template_key: 'vic-rental-minimum-standards', template_version: 1, rules_effective_from: '2026-09-10', module_selection_snapshot: '["minimum_standards"]', created_by_uid: 'owner', created_at: timestamp, updated_at: timestamp });
  f.insert('trade_rental_inspection_modules', { id: 'module', inspection_id: 'rental', firebase_uid: 'owner', module_key: 'minimum_standards', required: 1, template_version: 1, template_name: 'Minimum standards', required_capability: 'rental-inspection', template_snapshot: '{"key":"minimum_standards"}', created_at: timestamp, updated_at: timestamp });
  f.insert('trade_rental_inspection_items', { id: 'item', inspection_id: 'rental', module_id: 'module', firebase_uid: 'owner', item_key: 'mould', section_key: 'condition', check_key: 'mould', created_at: timestamp, updated_at: timestamp });
  await f.delete();
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_rental_inspections').get().n, 0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_rental_inspection_items').get().n, 0);
});

test('a permission failure and a stale revision retain the job and evidence', async (t) => {
  const f = fixture(t);
  f.access.isOwner = false; f.access.canManageJobs = false;
  await assert.rejects(f.delete(), (error) => error.code === 'JOB_DELETE_NOT_ALLOWED');
  f.access.isOwner = true;
  await assert.rejects(f.delete({ ...f.job(), revision: 3 }), /trade_crm_write_guard_verified_check/);
  assert.equal(f.sql.prepare("SELECT revision FROM trade_work_orders WHERE id = 'job'").get().revision, 4);
});

test('delete API enforces confirmation, owner isolation, assignment scope and revision before deletion', async (t) => {
  const f = fixture(t);
  assert.equal((await f.request({ confirmDelete: false })).status, 400);
  assert.equal((await f.request({ workOrderId: 'other' })).status, 404);
  assert.equal((await f.request({ expectedRevision: 3 })).status, 409);
  f.access.isOwner = false; f.access.jobScope = 'own'; f.access.memberId = 'different-worker';
  assert.equal((await f.request()).status, 403);
  f.access.isOwner = true;
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deletedJobId, 'job');
});

test('planned government program history blocks hard deletion without weakening its immutable contract', async (t) => {
  const f = fixture(t);
  const snapshot = { contract: 'tlink-creditex-job-intent-v1', program: { templateId: 'program', programCode: 'VEU' }, activity: { templateId: 'activity', serviceCategory: 'general' }, siteJurisdiction: 'VIC', catalogueReviewedOn: '2026-09-10' };
  f.insert('trade_work_order_compliance_intents', { id: 'intent', work_order_id: 'job', installer_uid: 'owner', compliance_organisation_id: 'org', program_template_id: 'program', activity_template_id: 'activity', program_code: 'VEU', service_category: 'general', site_jurisdiction: 'VIC', catalogue_reviewed_on: '2026-09-10', intent_snapshot: JSON.stringify(snapshot), intent_snapshot_sha256: 'a'.repeat(64), created_by_uid: 'owner', created_at: timestamp, updated_at: timestamp });
  await assert.rejects(f.delete(), (error) => error.code === 'JOB_DELETE_PROTECTED' && /government-program/.test(error.message));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_work_order_compliance_intents').get().n, 1);
});

test('existing financial history blocks deletion explicitly before any mutation', async (t) => {
  const f = fixture(t);
  addAcceptedQuote(f);
  f.insert('trade_crm_quick_invoices', { id: 'invoice', work_order_id: 'job', firebase_uid: 'owner', crm_customer_id: 'customer', invoice_number: 'I1', line_items_json: '[]', due_at: '2026-10-01', consent_confirmed_at: timestamp, created_by_uid: 'owner', created_at: timestamp, updated_at: timestamp });
  await assert.rejects(f.delete(), (error) => error.code === 'JOB_DELETE_PROTECTED' && /invoice/.test(error.message));
  assert.equal(f.sql.prepare("SELECT revision FROM trade_work_orders WHERE id = 'job'").get().revision, 4);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_crm_commercial_handovers').get().n, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_crm_job_media_cleanup').get().n, 0);
});

test('concurrent protection or customer-source changes roll back all deletion statements', async (t) => {
  const f = fixture(t);
  f.race(() => f.sql.prepare("UPDATE trade_crm_job_details SET customer_source = 'platform_private' WHERE work_order_id = 'job'").run());
  await assert.rejects(f.delete(), /trade_crm_write_guard_verified_check/);
  assert.equal(f.sql.prepare("SELECT revision FROM trade_work_orders WHERE id = 'job'").get().revision, 4);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_crm_job_media_cleanup').get().n, 0);
});

test('a protected record added after preflight is rejected by the atomic deletion guard', async (t) => {
  const f = fixture(t);
  addAcceptedQuote(f);
  f.race(() => f.insert('trade_crm_quick_invoices', { id: 'late-invoice', work_order_id: 'job', firebase_uid: 'owner', crm_customer_id: 'customer', invoice_number: 'I2', line_items_json: '[]', due_at: '2026-10-01', consent_confirmed_at: timestamp, created_by_uid: 'owner', created_at: timestamp, updated_at: timestamp }));
  await assert.rejects(f.delete(), /trade_crm_write_guard_verified_check/);
  assert.equal(f.sql.prepare("SELECT revision FROM trade_work_orders WHERE id = 'job'").get().revision, 4);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM trade_crm_quick_invoices WHERE id = 'late-invoice'").get().n, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_crm_job_media_cleanup').get().n, 0);
});

test('calendar failure keeps the job reachable and mappings available for a retry', async (t) => {
  const f = fixture(t);
  f.insert('trade_crm_appointments', { id: 'appointment', work_order_id: 'job', firebase_uid: 'owner', title: 'Visit', starts_at: timestamp, status: 'no_show', created_at: timestamp, updated_at: timestamp });
  f.insert('trade_crm_calendar_events', { id: 'calendar', firebase_uid: 'owner', appointment_id: 'appointment', provider: 'google_calendar', external_event_id: 'external', created_at: timestamp, updated_at: timestamp });
  f.calendarFails(true);
  await assert.rejects(f.delete(), (error) => error.code === 'JOB_DELETE_CALENDAR_PENDING');
  assert.equal(f.sql.prepare("SELECT stage FROM trade_work_orders WHERE id = 'job'").get().stage, 'no_show');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_crm_calendar_events').get().n, 1);
  f.calendarFails(false);
  await f.delete();
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM trade_crm_calendar_events').get().n, 0);
  assert.equal(f.calendarCalls.length, 2);
});
