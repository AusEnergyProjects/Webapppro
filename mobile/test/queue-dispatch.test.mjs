import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/database.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('database.ts', source, ts.ScriptTarget.Latest, true);
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE action_queue (id TEXT PRIMARY KEY, work_order_id TEXT, field_lane TEXT, payload TEXT,
    status TEXT DEFAULT 'queued', dispatched_at TEXT DEFAULT '', attempts INTEGER DEFAULT 0, retry_after TEXT DEFAULT '',
    error_code TEXT DEFAULT '', error_message TEXT DEFAULT '', created_at TEXT, updated_at TEXT);
    CREATE TABLE jobs (id TEXT PRIMARY KEY, field_lane TEXT, payload TEXT);
    CREATE TABLE upload_queue (client_upload_id TEXT, status TEXT, work_order_id TEXT, field_lane TEXT, local_uri TEXT);`);
  let beforeUpdate;
  const db = {
    async getAllAsync(query, ...args) { return sql.prepare(query).all(...args); },
    async getFirstAsync(query, ...args) { return sql.prepare(query).get(...args) || null; },
    async runAsync(query, ...args) {
      if (query.startsWith('UPDATE action_queue SET payload') && beforeUpdate) { const hook = beforeUpdate; beforeUpdate = null; await hook(); }
      return sql.prepare(query).run(...args);
    },
    async withTransactionAsync(work) { sql.exec('BEGIN'); try { await work(); sql.exec('COMMIT'); } catch (error) { sql.exec('ROLLBACK'); throw error; } },
  };
  const merge = (left, right) => ({ ...left, ...right, clientActionId: left.clientActionId });
  const dependencies = {
    getDatabase: async () => db, workOrderFieldLane: async () => 'trade_team', workPackActionPhaseError: () => '',
    mergeQueuedWorkPackCommit: merge, mergeQueuedWorkPackSignatureCapture: merge, mergeQueuedWorkPackCustomerContext: merge,
    saveJob: async (_db, job) => { sql.prepare('INSERT OR REPLACE INTO jobs VALUES (?, ?, ?)').run(job.id, job.fieldLane, JSON.stringify(job)); },
    workPackUploadIds: () => [], Crypto: { randomUUID: () => 'new-retry-id' }, deleteEncryptedBundle: () => {},
  };
  const names = ['persistQueuedAction', 'queueAction', 'queuedActions', 'resolveAction', 'retryConflict', 'applyQueuedForm', 'applyChanges'];
  const functions = names.map((name) => {
    const node = ast.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === name);
    assert.ok(node, name); return node.getText(ast).replace(/^export\s+/, '');
  }).join('\n');
  const code = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const api = new Function(...Object.keys(dependencies), `${code}; return {${names.join(',')}};`)(...Object.values(dependencies));
  return { sql, api, interceptUpdate(hook) { beforeUpdate = hook; }, rows: () => sql.prepare('SELECT * FROM action_queue ORDER BY rowid').all() };
}
const formAction = (id, answer) => ({ clientActionId: id, type: 'save_job_form', workOrderId: 'job', formId: 'form', baseRevision: 1, answers: { name: answer }, complete: false });

test('editing between lookup and dispatch keeps a new immutable action after the old acknowledgement', async (t) => {
  const f = fixture(); t.after(() => f.sql.close());
  await f.api.queueAction(formAction('old', 'before'));
  f.interceptUpdate(async () => { await f.api.queuedActions('trade_team'); });
  await f.api.queueAction(formAction('new', 'after'));
  assert.deepEqual(f.rows().map((row) => [row.id, JSON.parse(row.payload).answers.name]), [['old', 'before'], ['new', 'after']]);
  await f.api.resolveAction('old', { status: 'applied' });
  assert.equal(f.rows().length, 1);
  assert.equal(JSON.parse(f.rows()[0].payload).answers.name, 'after');
});

test('all five merge families freeze sent IDs and preserve their payloads across transport retry', async (t) => {
  for (const type of ['work_pack_commit', 'work_pack_capture_signatures', 'work_pack_update_customer_context', 'work_pack_select_scenario', 'save_job_form']) {
    const f = fixture(); t.after(() => f.sql.close());
    const old = { ...formAction('old', 'before'), type, caseInstanceId: 'case', expectedResponseSha256: 'base', dependencyKey: 'dependency' };
    await f.api.queueAction(old);
    const [sent] = await f.api.queuedActions('trade_team');
    await f.api.resolveAction('old', { status: 'retry', error: 'Connection lost' });
    await f.api.queueAction({ ...old, clientActionId: 'new', answers: { name: 'after' } });
    assert.equal(f.rows()[0].payload, sent.payload, type);
    assert.equal(f.rows()[0].dispatched_at, sent.dispatched_at, type);
    assert.equal(f.rows().length, 2, type);
  }
});

test('frozen work-pack actions still block incompatible signing and setup phases', async (t) => {
  const f = fixture(); t.after(() => f.sql.close());
  await f.api.queueAction({ ...formAction('old', 'before'), type: 'work_pack_commit', caseInstanceId: 'case' });
  await f.api.queuedActions('trade_team');
  await assert.rejects(f.api.queueAction({ ...formAction('signature', ''), type: 'work_pack_capture_signatures', caseInstanceId: 'case' }), /before signing/);
  await assert.rejects(f.api.queueAction({ ...formAction('setup', ''), type: 'work_pack_select_scenario', caseInstanceId: 'case' }), /before choosing another/);
});

test('authoritative refresh keeps newer queued form answers and server revisions, but unassignment removes them', async (t) => {
  const f = fixture(); t.after(() => f.sql.close());
  await f.api.queueAction(formAction('new', 'retained answer'));
  const job = { id: 'job', forms: [{ id: 'form', revision: 8, answers: { name: 'old server answer' }, template: { fields: [{ key: 'name', label: 'Name', required: true, type: 'text' }] } }] };
  await f.api.applyChanges([{ operation: 'upsert', entityId: 'job', entity: job }], false, 'now', 'trade_team');
  const saved = JSON.parse(f.sql.prepare('SELECT payload FROM jobs').get().payload);
  assert.equal(saved.forms[0].answers.name, 'retained answer');
  assert.equal(saved.forms[0].revision, 8);
  assert.equal(saved.forms[0].ready, true);
  await f.api.applyChanges([{ operation: 'delete', entityId: 'job' }], false, 'now', 'trade_team');
  assert.equal(f.rows().length, 0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM jobs').get().count, 0);
});

test('conflict retries clear the dispatch freeze only when minting a new ID', async (t) => {
  const f = fixture(); t.after(() => f.sql.close());
  await f.api.queueAction(formAction('old', 'answer'));
  await f.api.queuedActions('trade_team');
  await f.api.resolveAction('old', { status: 'conflict' });
  await f.api.retryConflict('old', { ...formAction('retry-new', 'answer'), baseRevision: 2 });
  assert.equal(f.rows()[0].id, 'retry-new');
  assert.equal(f.rows()[0].dispatched_at, '');
  await f.api.queueAction({ ...formAction('finish', ''), type: 'advance_field_job', transition: 'finish' });
  await f.api.queuedActions('trade_team');
  await f.api.resolveAction('finish', { status: 'conflict', code: 'REVISION_CONFLICT', currentRevision: 3 });
  const retry = f.rows().find((row) => row.id === 'act-new-retry-id');
  assert.equal(retry.dispatched_at, '');
  assert.equal(JSON.parse(retry.payload).baseRevision, 3);
});
