import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { migratedDataforceSqlite } from './helpers/trade-dataforce-database.mjs';
import * as contracts from '../src/lib/creditex-notifications.ts';
import * as permissions from '../src/lib/creditex-permissions.ts';
import * as lifecycleSql from '../src/lib/creditex-job-lifecycle-sql.ts';
import * as projection from '../src/lib/creditex-job-lifecycle-projection.ts';
import * as boundedJson from '../src/lib/bounded-json-request.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/lib/creditex-notification-server.ts');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const dependencies = { './trade-compliance-intent': { CREDITEX_PARTNER_ORGANISATION_CODE: 'CREDITEX-AU' }, './creditex-permissions': permissions,
  './creditex-job-lifecycle-sql': lifecycleSql, './creditex-job-lifecycle-projection': projection, './creditex-notifications': contracts };
const api = {};
new Function('require', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, api);
const schema = migratedDataforceSqlite().sqlite;
const NOW = '2026-10-02T01:00:00.000Z'; const LATER = '2026-10-02T02:00:00.000Z';
const actor = { organisationId: 'org', memberId: 'member', uid: 'member-uid' };

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  // Preserve actual production columns/defaults; vary historical relationship
  // states independently of insert-time integrity constraints.
  for (const { name } of schema.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'creditex_notification_receipts'").all()) {
    const columns = schema.prepare(`PRAGMA table_info(${name})`).all();
    sqlite.exec(`CREATE TABLE ${name} (${columns.map(c => `${c.name} ${c.type}${c.dflt_value === null ? '' : ` DEFAULT (${c.dflt_value})`}`).join(',')})`);
  }
  sqlite.exec(read('drizzle/0242_creditex_notification_receipts.sql'));
  function insert(table, values) {
    const columns = Object.keys(values); sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(values));
  }
  let beforeWrite;
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values); }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
    async run() { if (beforeWrite) { const fn = beforeWrite; beforeWrite = null; fn(); } return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes) } }; }
  }
  const db = { prepare: sql => new Statement(sql) };
  insert('compliance_organisations', { id: 'org', organisation_code: 'CREDITEX-AU', status: 'active' });
  for (const id of ['member', 'peer', 'other']) insert('compliance_users', { id, organisation_id: 'org', firebase_uid: `${id}-uid`, display_name: id, role: 'reviewer', status: 'active' });
  function job(id, options = {}) {
    const org = options.org || 'org'; const caseId = options.noCase ? '' : `case-${id}`;
    insert('trade_work_orders', { id, firebase_uid: 'owner', work_number: `TLJ-${id}`, title: 'Safety check', stage: options.stage || 'completed', record_status: options.recordStatus || 'active', partner_type: 'installer', source_type: 'internal', created_at: NOW, updated_at: NOW });
    insert('trade_work_order_compliance_intents', { id: `intent-${id}`, work_order_id: id, installer_uid: 'owner', compliance_organisation_id: org, status: options.intentStatus || (caseId ? 'case_linked' : 'planned'), compliance_case_id: caseId, program_code: 'VEU', activity_template_id: 'activity', revision: 1, intent_snapshot_sha256: 'a'.repeat(64), intent_snapshot: JSON.stringify({ program: { claimOutputCode: 'VEEC' } }) });
    if (caseId) {
      insert('compliance_cases', { id: caseId, organisation_id: org, installer_uid: 'owner', work_order_id: id, compliance_intent_id: `intent-${id}`, status: options.caseStatus || 'in_review', evidence_status: 'complete', revision: 1, updated_at: NOW });
      insert('compliance_case_assignments', { id: `assignment-${id}`, organisation_id: org, case_id: caseId, compliance_user_id: options.assignee || 'member', status: 'assigned' });
    }
    return id;
  }
  function task(id, options = {}) { insert('portal_team_tasks', { id, workspace: 'creditex', scope_id: options.org || 'org', title: id, assignee_id: options.assignee || 'member', creator_id: 'peer', creator_uid: 'peer-uid', creator_name: 'peer', revision: 1, status: options.status || 'open', created_at: NOW, updated_at: NOW }); }
  function message(id, options = {}) { insert('portal_team_messages', { id, workspace: options.workspace || 'creditex', scope_id: options.org || 'org', sender_id: 'peer', sender_uid: 'peer-uid', sender_name: 'peer', recipient_id: options.recipient || 'member', body: id, created_at: NOW }); }
  const list = (params = {}, identity = actor) => api.listCreditexNotifications(db, identity, new URLSearchParams(params));
  return { sqlite, db, insert, job, task, message, list, beforeWrite(fn) { beforeWrite = fn; } };
}

test('all five notification sources compile against production columns and real completion, correction, task, call and message events', async t => {
  const f = fixture(t); f.job('complete'); f.job('correction', { caseStatus: 'changes_requested' }); f.task('task'); f.message('message');
  f.insert('creditex_audit_calls', { id: 'call', organisation_id: 'org', job_intent_id: 'intent-complete', started_by_member_id: 'member', started_by_uid: 'member-uid', status: 'no_answer', updated_at: LATER });
  const result = await f.list();
  assert.equal(result.total, 5); assert.equal(result.unreadCount, 5);
  assert.deepEqual(result.items.map(item => item.type).sort(), ['call', 'completed', 'correction', 'message', 'task']);
  assert.deepEqual(result.items.find(item => item.type === 'message').target, { kind: 'message', peerId: 'peer' });
  assert.equal(result.items.find(item => item.type === 'call').title, 'Call not answered');
});

test('filters and exact counts apply before pagination across all sources', async t => {
  const f = fixture(t); for (let i = 0; i < 61; i++) f.task(`task-${i.toString().padStart(2, '0')}`);
  const first = await f.list(); const second = await f.list({ page: '2' }); const third = await f.list({ page: '3' });
  assert.equal(first.unreadCount, 61); assert.equal(first.total, 61); assert.equal(first.totalPages, 3);
  assert.equal(first.items.length, 25); assert.equal(second.items.length, 25); assert.equal(third.items.length, 11);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size, 61);
  assert.equal((await f.list({ page: '100' })).page, 3);
});

test('read and dismiss receipts are durable per member and never dismiss future events', async t => {
  const f = fixture(t); f.task('assigned'); f.message('message'); const before = await f.list();
  const task = before.items.find(item => item.type === 'task');
  await api.updateCreditexNotifications(f.db, actor, 'read', [task.id]);
  assert.equal((await f.list()).unreadCount, 1); assert.equal((await f.list({ filter: 'all' })).total, 2);
  await api.updateCreditexNotifications(f.db, actor, 'dismiss', [task.id]);
  assert.equal((await f.list({ filter: 'all' })).total, 1);
  f.sqlite.exec(`UPDATE portal_team_tasks SET revision=2,updated_at='${LATER}' WHERE id='assigned'`);
  assert.equal((await f.list()).unreadCount, 2);
  assert.equal((await f.list()).items.find(item => item.type === 'task').read, false);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM creditex_notification_receipts').get().count, 1);
});

test('editing an already completed job does not manufacture a new completion notification', async t => {
  const f = fixture(t); f.job('job'); const first = (await f.list()).items[0];
  await api.updateCreditexNotifications(f.db, actor, 'read', [first.id]);
  f.sqlite.exec(`UPDATE trade_work_orders SET title='Updated title',updated_at='${LATER}' WHERE id='job'`);
  assert.equal((await f.list()).unreadCount, 0);
  f.insert('trade_work_order_events', { id: 'completion-event', work_order_id: 'job', firebase_uid: 'owner', event_type: 'job_completed', summary: 'Work completed', created_at: LATER });
  const next = await f.list(); assert.equal(next.unreadCount, 1); assert.notEqual(next.items[0].id, first.id);
});

test('current assignments, organisation, job ownership and archive boundaries hold', async t => {
  const f = fixture(t); f.job('visible');
  for (const [id, options] of Object.entries({ otherOrg: { org: 'other' }, otherAssignment: { assignee: 'other' }, archived: { recordStatus: 'archived' }, superseded: { intentStatus: 'superseded' }, cancelled: { stage: 'cancelled' }, imported: { stage: 'imported' } })) f.job(id, options);
  f.job('mismatch'); f.sqlite.exec("UPDATE compliance_cases SET installer_uid='wrong' WHERE id='case-mismatch'");
  assert.equal((await f.list()).total, 1);
  f.sqlite.exec("UPDATE compliance_case_assignments SET status='released' WHERE case_id='case-visible'");
  assert.equal((await f.list()).total, 0);
  f.sqlite.exec("UPDATE compliance_users SET role='admin' WHERE id='member'");
  assert.equal((await f.list()).total, 2);
  f.sqlite.exec("UPDATE compliance_users SET status='revoked' WHERE id='member'");
  await assert.rejects(f.list(), error => error.status === 403);
});

test('permissions suppress source data and stale invitation grants do not leak notifications', async t => {
  const f = fixture(t); f.job('job'); f.task('task'); f.message('message');
  f.sqlite.exec(`UPDATE compliance_users SET permissions_json='["tasks"]' WHERE id='member'`);
  assert.deepEqual((await f.list()).items.map(item => item.type), ['task']);
  f.sqlite.exec(`UPDATE compliance_users SET permissions_json='[]' WHERE id='member'`);
  assert.equal((await f.list()).total, 0);
  f.sqlite.exec(`UPDATE compliance_users SET permissions_json='["unknown"]' WHERE id='member'`);
  assert.equal((await f.list()).total, 0);
});

test('messages, tasks and calls never expose another recipient or operator', async t => {
  const f = fixture(t); f.job('job');
  f.message('mine'); f.message('theirs', { recipient: 'other' }); f.message('foreign', { org: 'foreign' }); f.message('admin', { workspace: 'admin' });
  f.task('theirs', { assignee: 'other' }); f.task('foreign', { org: 'foreign' });
  f.insert('creditex_audit_calls', { id: 'other-call', organisation_id: 'org', job_intent_id: 'intent-job', started_by_member_id: 'other', started_by_uid: 'other-uid', status: 'no_answer', updated_at: NOW });
  assert.equal((await f.list()).total, 2);
  await api.markCreditexConversationRead(f.db, actor, ['mine', 'theirs', 'foreign', 'admin']);
  const receipts = f.sqlite.prepare('SELECT event_key FROM creditex_notification_receipts').all();
  assert.deepEqual(receipts.map(row => row.event_key), ['message:mine']);
  f.message('new'); assert.equal((await f.list()).unreadCount, 2);
});

test('writes recheck permission and membership after an earlier access check', async t => {
  const f = fixture(t); f.message('message');
  f.beforeWrite(() => f.sqlite.exec(`UPDATE compliance_users SET permissions_json='[]' WHERE id='member'`));
  await assert.rejects(api.updateCreditexNotifications(f.db, actor, 'read', ['message:message']), error => error.status === 404);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM creditex_notification_receipts').get().count, 0);
  f.sqlite.exec(`UPDATE compliance_users SET permissions_json=NULL WHERE id='member'`);
  f.beforeWrite(() => f.sqlite.exec(`UPDATE compliance_users SET status='revoked' WHERE id='member'`));
  await api.markCreditexConversationRead(f.db, actor, ['message']);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM creditex_notification_receipts').get().count, 0);
});

test('correction resubmissions leave queue and completed field submissions produce a new receipt identity', async t => {
  const f = fixture(t); f.job('job', { stage: 'in_progress', noCase: true });
  f.insert('trade_activity_field_records', { id: 'field', intent_id: 'intent-job', organisation_id: 'org', owner_uid: 'owner', work_order_id: 'job', activity_template_id: 'activity', revision: 1, status: 'submitted_for_creditex_review', submitted_at: NOW, pdf_object_key: 'private/pdf', pdf_sha256: 'a'.repeat(64), payload: '{}' });
  const complete = (await f.list()).items[0]; assert.equal(complete.type, 'completed');
  await api.updateCreditexNotifications(f.db, actor, 'read', [complete.id]);
  const snapshot = f.sqlite.prepare(`SELECT ${lifecycleSql.creditexIntentCompletionSnapshotSql()} snapshot FROM trade_work_order_compliance_intents intent WHERE intent.id='intent-job'`).get().snapshot;
  f.insert('creditex_job_lifecycle_events', { id: 'correction', organisation_id: 'org', intent_id: 'intent-job', work_order_id: 'job', owner_uid: 'owner', action: 'correction_required', source_snapshot: snapshot, created_at: LATER });
  assert.deepEqual((await f.list()).items.map(item => item.type), ['correction']);
  f.sqlite.exec(`UPDATE trade_activity_field_records SET revision=2,pdf_sha256='${'b'.repeat(64)}',submitted_at='${LATER}' WHERE id='field'`);
  const resubmission = await f.list(); assert.equal(resubmission.total, 1); assert.equal(resubmission.items[0].type, 'completed'); assert.notEqual(resubmission.items[0].id, complete.id);
});

test('notification input is bounded and invalid filters fail before querying events', async t => {
  const f = fixture(t);
  await assert.rejects(f.list({ page: '-1' }), error => error.status === 400);
  await assert.rejects(f.list({ filter: 'everyone' }), error => error.status === 400);
  for (const ids of [[], ['x'.repeat(1201)], Array(51).fill('x'), [1], null]) assert.throws(() => contracts.notificationEventKeys(ids));
  await assert.rejects(api.updateCreditexNotifications(f.db, actor, 'grant_access', ['message:x']), error => error.status === 400);
});

test('notification route enforces origin, actual Creditex membership and bounded writes', async () => {
  const calls = []; let allowedOrigin = true; let organisationCode = 'CREDITEX-AU';
  class AccessError extends Error {}
  const dependencies = {
    '../../../../../db': { getD1: () => 'database' },
    '@/lib/admin-server': { sameOrigin: () => allowedOrigin, mfaErrorResponse: () => null, adminJson: (body, status = 200) => Response.json(body, { status }), adminError: () => Response.json({ ok: false }, { status: 500 }) },
    '@/lib/compliance-access-server': { ComplianceAccessError: AccessError, requireComplianceAccess: async (_request, options) => {
      assert.equal(options.claimPendingInvitation, false); return { organisationId: 'org', membershipId: 'member', uid: 'uid', organisationCode };
    } },
    '@/lib/bounded-json-request': boundedJson,
    '@/lib/trade-compliance-intent': { CREDITEX_PARTNER_ORGANISATION_CODE: 'CREDITEX-AU' },
    '@/lib/creditex-notifications': contracts,
    '@/lib/creditex-notification-server': {
      listCreditexNotifications: async (_db, actor) => { calls.push(actor); return { items: [], unreadCount: 0 }; },
      updateCreditexNotifications: async (...args) => { calls.push(args); },
    },
  };
  const route = {}; const compiled = ts.transpileModule(read('src/app/api/creditex/notifications/route.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'exports', compiled)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, route);
  const request = () => new Request('https://example.test/api/creditex/notifications');
  assert.equal((await route.GET(request())).status, 200); assert.deepEqual(calls[0], { organisationId: 'org', memberId: 'member', uid: 'uid' });
  allowedOrigin = false; assert.equal((await route.GET(request())).status, 403); assert.equal(calls.length, 1);
  allowedOrigin = true; organisationCode = 'OTHER'; assert.equal((await route.GET(request())).status, 403); assert.equal(calls.length, 1);
  organisationCode = 'CREDITEX-AU';
  const invalid = new Request(request(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([]) });
  assert.equal((await route.POST(invalid)).status, 400); assert.equal(calls.length, 1);
  const valid = new Request(request(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', ids: ['message:one'] }) });
  assert.equal((await route.POST(valid)).status, 200); assert.deepEqual(calls[1].slice(1), [{ organisationId: 'org', memberId: 'member', uid: 'uid' }, 'read', ['message:one']]);
});
