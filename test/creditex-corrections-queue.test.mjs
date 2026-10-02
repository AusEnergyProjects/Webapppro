import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { migratedDataforceSqlite } from './helpers/trade-dataforce-database.mjs';
import * as filters from '../src/lib/creditex-job-intent-filters.ts';
import * as certificates from '../src/lib/creditex-certificate-types.ts';
import * as lifecycle from '../src/lib/creditex-job-lifecycle.ts';
import * as lifecycleSql from '../src/lib/creditex-job-lifecycle-sql.ts';
import * as projection from '../src/lib/creditex-job-lifecycle-projection.ts';

const routeSource = readFileSync(new URL('../src/app/api/creditex/job-intents/route.ts', import.meta.url), 'utf8');
const routeCode = ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const schema = migratedDataforceSqlite().sqlite;
const NOW = '2026-10-02T01:00:00.000Z';
const SHA = 'a'.repeat(64);

function loadRoute(sqlite, access = {}) {
  const queries = [];
  const database = { prepare(sql) { return { bind(...values) {
    queries.push({ sql, values });
    return { first: async () => sqlite.prepare(sql).get(...values), all: async () => ({ results: sqlite.prepare(sql).all(...values) }) };
  } }; } };
  class AccessError extends Error {}
  const dependencies = {
    '../../../../../db': { getD1: () => database },
    '@/lib/compliance-access-server': { ComplianceAccessError: AccessError, requireComplianceAccess: async () => ({ organisationCode: 'CREDITEX', organisationId: 'org', membershipId: 'member', uid: 'reviewer', role: 'reviewer', displayName: 'Reviewer', ...access }) },
    '@/lib/trade-compliance-intent': { CREDITEX_PARTNER_ORGANISATION_CODE: 'CREDITEX' },
    '@/lib/creditex-job-intent-filters': filters,
    '@/lib/creditex-certificate-types': certificates,
    '@/lib/creditex-job-lifecycle': lifecycle,
    '@/lib/creditex-job-lifecycle-sql': lifecycleSql,
    '@/lib/creditex-job-lifecycle-projection': projection,
    '@/lib/creditex-job-audit-server': { loadCreditexAuditSummaries: async () => [] },
  };
  const exported = {};
  new Function('require', 'exports', routeCode)(key => { assert.ok(key in dependencies, key); return dependencies[key]; }, exported);
  return { queries, async get(params = {}) {
    const response = await exported.GET(new Request(`https://example.test/api/creditex/job-intents?${new URLSearchParams(params)}`));
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  } };
}

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  // Use production column names/defaults. Constraints are exercised separately
  // against the full migrated database; this fixture varies historical states.
  for (const { name } of schema.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    const columns = schema.prepare(`PRAGMA table_info(${name})`).all();
    sqlite.exec(`CREATE TABLE ${name} (${columns.map(column => `${column.name} ${column.type}${column.dflt_value === null ? '' : ` DEFAULT (${column.dflt_value})`}`).join(',')})`);
  }
  function insert(table, values) {
    const columns = Object.keys(values);
    sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(values));
  }
  insert('compliance_organisations', { id: 'org', organisation_code: 'CREDITEX', status: 'active' });
  insert('compliance_users', { id: 'member', organisation_id: 'org', firebase_uid: 'reviewer', role: 'reviewer', status: 'active' });
  function job(id, options = {}) {
    const org = options.org || 'org';
    const caseId = options.noCase ? '' : `case-${id}`;
    insert('trade_work_orders', { id, firebase_uid: 'owner', work_number: `TLJ-${id}`, title: options.title || 'Safety check', stage: options.stage || 'completed', record_status: options.recordStatus || 'active', partner_type: 'installer', source_type: 'internal', created_at: NOW });
    insert('trade_work_order_compliance_intents', { id: `intent-${id}`, work_order_id: id, installer_uid: 'owner', compliance_organisation_id: org, status: options.intentStatus || (caseId ? 'case_linked' : 'planned'), compliance_case_id: caseId, program_code: 'VEU', activity_template_id: 'activity', revision: 1, intent_snapshot_sha256: SHA, intent_snapshot: JSON.stringify({ program: { claimOutputCode: 'VEEC' }, activity: { title: 'Assessment' } }), planned_start: NOW });
    insert('trade_crm_customers', { id: `customer-${id}`, firebase_uid: 'owner', first_name: options.name || 'Laura', last_name: 'Customer' });
    insert('trade_crm_service_sites', { id: `site-${id}`, firebase_uid: 'owner', customer_id: `customer-${id}`, address_line_1: '123 Test Street', suburb: 'Melbourne', address_state: 'VIC', postcode: '3000' });
    insert('trade_crm_job_details', { id: `details-${id}`, work_order_id: id, firebase_uid: 'owner', customer_source: 'trade_owned', crm_customer_id: `customer-${id}`, service_site_id: `site-${id}` });
    if (caseId) {
      insert('compliance_cases', { id: caseId, organisation_id: org, installer_uid: 'owner', work_order_id: id, compliance_intent_id: `intent-${id}`, status: options.caseStatus || 'in_review', evidence_status: options.evidenceStatus || 'complete', revision: 1, updated_at: NOW });
      insert('compliance_case_assignments', { id: `assignment-${id}`, organisation_id: org, case_id: caseId, compliance_user_id: options.assignee || 'member', status: 'assigned' });
    }
    return id;
  }
  function correction(id) {
    const snapshot = sqlite.prepare(`SELECT ${lifecycleSql.creditexIntentCompletionSnapshotSql()} snapshot FROM trade_work_order_compliance_intents intent WHERE intent.id=?`).get(`intent-${id}`).snapshot;
    insert('creditex_job_lifecycle_events', { id: `correction-${id}`, organisation_id: 'org', intent_id: `intent-${id}`, work_order_id: id, owner_uid: 'owner', action: 'correction_required', source_snapshot: snapshot, created_at: NOW });
  }
  function field(id) {
    insert('trade_activity_field_records', { id: `field-${id}`, intent_id: `intent-${id}`, organisation_id: 'org', owner_uid: 'owner', work_order_id: id, activity_template_id: 'activity', revision: 1, status: 'submitted_for_creditex_review', pdf_object_key: 'private/file.pdf', pdf_sha256: SHA, payload: '{}' });
  }
  function packet(id, state = 'rejected') {
    insert('compliance_output_action_packets', { id: `packet-${id}`, organisation_id: 'org', compliance_case_id: `case-${id}`, program_code: 'VEU', output_code: 'VEEC', case_revision: 1, work_pack_instance_key: `pack-${id}`, work_pack_revision: 1, prepared_at: NOW, packet_sha256: SHA, prepared_by_uid: 'preparer' });
    insert('compliance_output_action_events', { id: `event-${id}`, organisation_id: 'org', packet_id: `packet-${id}`, to_status: state, sequence: 1 });
  }
  return { sqlite, insert, job, correction, field, packet, ...loadRoute(sqlite) };
}

test('corrections queries and their access predicates compile against every production migration', async () => {
  const route = loadRoute(schema);
  const result = await route.get({ mode: 'corrections' });
  assert.equal(result.total, 0); assert.deepEqual(result.items, []);
});

test('corrections filter before count and pagination, without changing the normal Jobs view', async t => {
  const f = fixture(t);
  for (let i = 0; i < 120; i++) f.job(`a-${String(i).padStart(3, '0')}`);
  for (let i = 0; i < 61; i++) f.job(`b-${String(i).padStart(3, '0')}`, { caseStatus: 'changes_requested' });
  const all = await f.get({ sort: 'jobNumber' }); assert.equal(all.total, 181);
  const first = await f.get({ mode: 'corrections', sort: 'jobNumber' });
  const second = await f.get({ mode: 'corrections', sort: 'jobNumber', page: '2' });
  assert.equal(first.total, 61); assert.equal(first.totalPages, 2); assert.equal(first.items.length, 50);
  assert.equal(first.items[0].jobId, 'b-000'); assert.equal(second.items.length, 11); assert.equal(second.items[0].jobId, 'b-050');
  assert.equal((await f.get({ mode: 'corrections', search: 'TLJ-b-060' })).total, 1);
  assert.equal((await f.get({ mode: 'corrections', firstName: 'Nobody' })).total, 0);
  const lastQueries = f.queries.slice(-2);
  assert.deepEqual(lastQueries[0].values, lastQueries[1].values.slice(0, -2));
});

test('only current operational and governed corrections appear; resubmissions and reviewed work leave the list', async t => {
  const f = fixture(t);
  f.job('operational', { noCase: true }); f.correction('operational');
  f.job('governed', { evidenceStatus: 'changes_required' });
  f.job('packet'); f.packet('packet');
  f.job('resubmitted', { caseStatus: 'changes_requested' }); f.field('resubmitted'); f.correction('resubmitted');
  f.sqlite.exec("UPDATE trade_activity_field_records SET revision=2,pdf_sha256='" + 'b'.repeat(64) + "' WHERE work_order_id='resubmitted'");
  f.job('draft', { caseStatus: 'changes_requested' }); f.field('draft'); f.correction('draft');
  f.sqlite.exec("UPDATE trade_activity_field_records SET revision=2,status='draft' WHERE work_order_id='draft'");
  f.job('reviewed'); f.correction('reviewed');
  f.insert('creditex_job_lifecycle_events', { id: 'later-review', organisation_id: 'org', intent_id: 'intent-reviewed', work_order_id: 'reviewed', owner_uid: 'owner', action: 'reviewed', source_snapshot: '{}', created_at: '2026-10-03T01:00:00.000Z' });
  f.job('lodged'); f.packet('lodged');
  f.insert('compliance_output_action_events', { id: 'earlier-submitted', organisation_id: 'org', packet_id: 'packet-lodged', to_status: 'submitted', sequence: 0 });
  const result = await f.get({ mode: 'corrections', sort: 'jobNumber' });
  assert.deepEqual(result.items.map(item => item.jobId), ['draft', 'governed', 'operational', 'packet']);
  f.sqlite.exec("UPDATE compliance_cases SET evidence_status='complete' WHERE work_order_id='governed'");
  assert.equal((await f.get({ mode: 'corrections' })).total, 3);
});

test('corrections retain current membership, exact case assignment and tenant graph boundaries', async t => {
  const f = fixture(t);
  f.job('visible', { caseStatus: 'changes_requested' });
  for (const [id, options] of Object.entries({ otherOrg: { org: 'other' }, otherAssignee: { assignee: 'someone-else' }, archived: { recordStatus: 'archived' }, imported: { stage: 'imported' }, cancelled: { stage: 'cancelled' }, superseded: { intentStatus: 'superseded', noCase: true } })) f.job(id, { caseStatus: 'changes_requested', ...options });
  f.job('mismatch', { caseStatus: 'changes_requested' }); f.sqlite.exec("UPDATE compliance_cases SET installer_uid='other-owner' WHERE work_order_id='mismatch'");
  assert.deepEqual((await f.get({ mode: 'corrections' })).items.map(item => item.jobId), ['visible']);
  f.sqlite.exec("UPDATE compliance_case_assignments SET status='released' WHERE case_id='case-visible'");
  assert.equal((await f.get({ mode: 'corrections' })).total, 0);
  f.sqlite.exec("UPDATE compliance_users SET role='admin'");
  assert.deepEqual((await f.get({ mode: 'corrections', sort: 'jobNumber' })).items.map(item => item.jobId), ['otherAssignee', 'visible']);
  f.sqlite.exec("UPDATE compliance_users SET status='revoked'");
  assert.equal((await f.get({ mode: 'corrections' })).total, 0);
});

test('unknown queue modes fail closed', () => {
  assert.throws(() => filters.creditexJobIntentFilters(new URLSearchParams({ mode: 'everything' })), filters.CreditexQueueFilterError);
});

test.after(() => schema.close());
