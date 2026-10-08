import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { normalizeTradeFormAnswers, tradeFormCompletion } from '../../src/lib/trade-form-library.mjs';

const source = fs.readFileSync(new URL('../src/lib/database.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('database.ts', source, ts.ScriptTarget.Latest, true);
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE action_queue (id TEXT PRIMARY KEY, work_order_id TEXT, field_lane TEXT, payload TEXT,
    status TEXT DEFAULT 'queued', dispatched_at TEXT DEFAULT '', attempts INTEGER DEFAULT 0, retry_after TEXT DEFAULT '',
    error_code TEXT DEFAULT '', error_message TEXT DEFAULT '', conflict_json TEXT DEFAULT '', created_at TEXT, updated_at TEXT);
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
    normalizeTradeFormAnswers, tradeFormCompletion,
    getDatabase: async () => db, workOrderFieldLane: async () => 'trade_team', workPackActionPhaseError: () => '',
    mergeQueuedWorkPackCommit: merge, mergeQueuedWorkPackSignatureCapture: merge, mergeQueuedWorkPackCustomerContext: merge,
    saveJob: async (_db, job) => { sql.prepare('INSERT OR REPLACE INTO jobs VALUES (?, ?, ?)').run(job.id, job.fieldLane, JSON.stringify(job)); },
    workPackUploadIds: () => [], Crypto: { randomUUID: () => 'new-retry-id' }, deleteEncryptedBundle: () => {},
  };
  const names = ['persistQueuedAction', 'queueAction', 'queuedActions', 'resolveAction', 'retryConflict', 'discardAction', 'getJobCompletionQueueState', 'applyQueuedForm', 'applyQueuedProjection', 'applyChanges', 'resolvedWorkPackAnswerPatches', 'resolveWorkPackAnswerConflict', 'mergeSectionPatches', 'patchKey'];
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

const branchingTemplate = () => ({ key: 'business-check', version: 3, fields: [
  { key: 'hazard', label: 'Hazard present', type: 'select', required: true, options: ['Yes', 'No'], section: 'Site', phase: 'before' },
  { key: 'control', label: 'Hazard control', type: 'text', required: true, condition: { fieldKey: 'hazard', equals: 'Yes' } },
  { key: 'checked', label: 'Check date', type: 'date', required: true, section: 'Handover', phase: 'after' },
] });

test('offline completion prunes hidden answers and retains the assigned template snapshot and server revision', async (t) => {
  const f = fixture(); t.after(() => f.sql.close());
  const template = branchingTemplate();
  const job = { id: 'job', fieldLane: 'trade_team', forms: [{ id: 'form', revision: 8, template, answers: {} }] };
  f.sql.prepare('INSERT INTO jobs VALUES (?, ?, ?)').run('job', 'trade_team', JSON.stringify(job));
  await f.api.queueAction({ ...formAction('conditional', ''), complete: true,
    answers: { hazard: 'No', control: 'outdated hidden answer', checked: '2026-10-02', injected: 'not a field' } });
  const saved = JSON.parse(f.sql.prepare('SELECT payload FROM jobs').get().payload).forms[0];
  assert.deepEqual(saved.answers, { hazard: 'No', checked: '2026-10-02' });
  assert.equal(saved.status, 'complete'); assert.equal(saved.ready, true); assert.deepEqual(saved.missing, []);
  assert.equal(saved.revision, 8); assert.deepEqual(saved.template, template); assert.ok(saved.completedAt);
});

test('offline completion stays a draft when a branch reveals missing required data or a visible date is invalid', (t) => {
  const f = fixture(); t.after(() => f.sql.close());
  for (const [answers, missing] of [
    [{ hazard: 'Yes', checked: '2026-10-02' }, ['Hazard control']],
    [{ hazard: 'No', checked: '2026-02-30' }, ['Check date']],
    [{ hazard: 'Maybe', checked: '2026-10-02' }, ['Hazard present']],
  ]) {
    const job = { forms: [{ id: 'form', revision: 5, template: branchingTemplate(), answers: {} }] };
    f.api.applyQueuedForm(job, { ...formAction('conditional', ''), complete: true, answers }, 'saved-at');
    assert.deepEqual(job.forms[0].missing, missing); assert.equal(job.forms[0].ready, false);
    assert.equal(job.forms[0].status, 'draft'); assert.equal(job.forms[0].completedAt, '');
    assert.equal(job.forms[0].revision, 5);
  }
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

test('authoritative job deletion removes stuck conflicts and uploads only for that job and lane', async (t) => {
  const f = fixture(); t.after(() => f.sql.close());
  await f.api.queueAction(formAction('conflict', 'deleted job answer'));
  await f.api.resolveAction('conflict', { status: 'conflict', error: 'Old revision' });
  await f.api.queueAction({ ...formAction('other', 'retained'), workOrderId: 'other-job' });
  f.sql.exec("INSERT INTO upload_queue VALUES ('upload', 'retry', 'job', 'trade_team', 'encrypted'); INSERT INTO upload_queue VALUES ('other-upload', 'retry', 'other-job', 'trade_team', 'other-encrypted')");
  await f.api.applyChanges([{ operation: 'delete', entityId: 'job' }], false, 'now', 'trade_team');
  assert.deepEqual(f.rows().map((row) => row.id), ['other']);
  assert.deepEqual(f.sql.prepare('SELECT client_upload_id FROM upload_queue').all().map((row) => row.client_upload_id), ['other-upload']);
});

const sharedJob = () => ({ id:'job',fieldLane:'trade_team',revision:5,stage:'in_progress',lifecycleStatus:'partial',
  appointmentId:'visit-1',appointmentRevision:1,appointmentStatus:'in_progress',completedAt:'',
  collaborativeJob:true,remainingActiveVisits:2,tasks:[{id:'task',status:'pending'}],
  forms:[{id:'form',revision:1,answers:{name:'saved'},template:{fields:[{key:'name',type:'text',required:true,label:'Name'}]}}] });
const sharedFinish = () => ({clientActionId:'visit-finish',type:'advance_field_job',workOrderId:'job',transition:'finish',
  baseRevision:5,appointmentId:'visit-1',baseAppointmentRevision:1});

test('queued finish projects only its own visit and a visit conflict never automatically retries', async t => {
  const f=fixture();t.after(()=>f.sql.close());
  f.sql.prepare('INSERT INTO jobs VALUES (?,?,?)').run('job','trade_team',JSON.stringify(sharedJob()));
  await f.api.queueAction(sharedFinish());
  let job=JSON.parse(f.sql.prepare('SELECT payload FROM jobs').get().payload);
  assert.equal(job.appointmentStatus,'completed');assert.equal(job.appointmentRevision,2);
  assert.equal(job.stage,'in_progress');assert.equal(job.lifecycleStatus,'partial');
  await f.api.resolveAction('visit-finish',{status:'conflict',code:'REVISION_CONFLICT',currentRevision:9});
  assert.equal(f.rows()[0].id,'visit-finish');assert.equal(f.rows()[0].status,'conflict');
  assert.equal(JSON.parse(f.rows()[0].payload).baseRevision,5);
});

test('an unacknowledged no-visit finish cannot complete the parent after rejection and discard', async t => {
  const f = fixture(); t.after(() => f.sql.close());
  const job = { id: 'job', fieldLane: 'trade_team', revision: 5, stage: 'ready', lifecycleStatus: 'unscheduled',
    appointmentId: '', appointmentStatus: '', forms: [], tasks: [] };
  f.sql.prepare('INSERT INTO jobs VALUES (?,?,?)').run('job', 'trade_team', JSON.stringify(job));
  const finish = { clientActionId: 'no-visit-finish', type: 'advance_field_job', workOrderId: 'job', transition: 'finish', baseRevision: 5 };
  const savedJob = () => JSON.parse(f.sql.prepare('SELECT payload FROM jobs').get().payload);
  await f.api.queueAction(finish);
  assert.equal((await f.api.getJobCompletionQueueState('job')).finish.status, 'queued');
  assert.equal(savedJob().stage, 'ready'); assert.equal(savedJob().lifecycleStatus, 'unscheduled');
  await f.api.resolveAction(finish.clientActionId, { status: 'rejected', code: 'JOB_COMPLETION_BLOCKED', error: 'Required form was added.' });
  assert.deepEqual((await f.api.getJobCompletionQueueState('job')).finish,
    { status: 'rejected', errorCode: 'JOB_COMPLETION_BLOCKED', errorMessage: 'Required form was added.' });
  await f.api.discardAction(finish.clientActionId);
  assert.equal((await f.api.getJobCompletionQueueState('job')).finish, null);
  assert.equal(savedJob().stage, 'ready'); assert.equal(savedJob().lifecycleStatus, 'unscheduled');
  await f.api.queueAction({ ...finish, clientActionId: 'acknowledged-finish' });
  await f.api.resolveAction('acknowledged-finish', { status: 'applied', jobState: { revision: 6, stage: 'completed', lifecycleStatus: 'completed' } });
  assert.equal((await f.api.getJobCompletionQueueState('job')).finish, null);
  assert.equal(savedJob().stage, 'completed'); assert.equal(savedJob().lifecycleStatus, 'completed');
  assert.equal(savedJob().revision, 6);
});

test('acknowledgement restores authoritative parent status while preserving pending task and form drafts',async t=>{
  const f=fixture();t.after(()=>f.sql.close());
  f.sql.prepare('INSERT INTO jobs VALUES (?,?,?)').run('job','trade_team',JSON.stringify(sharedJob()));
  await f.api.queueAction(sharedFinish());
  await f.api.queueAction(formAction('form-pending','my unsynced answer'));
  await f.api.queueAction({clientActionId:'task-pending',type:'set_task_status',workOrderId:'job',baseRevision:1,taskId:'task',status:'done'});
  await f.api.resolveAction('visit-finish',{status:'applied',jobState:{revision:6,stage:'in_progress',lifecycleStatus:'partial',
    appointmentId:'visit-1',appointmentRevision:2,appointmentStatus:'completed',completedAt:'server-time',collaborativeJob:true,remainingActiveVisits:1}});
  const job=JSON.parse(f.sql.prepare('SELECT payload FROM jobs').get().payload);
  assert.equal(job.revision,6);assert.equal(job.stage,'in_progress');assert.equal(job.remainingActiveVisits,1);
  assert.equal(job.forms[0].answers.name,'my unsynced answer');assert.equal(job.tasks[0].status,'done');
  assert.deepEqual(f.rows().map(row=>row.id),['form-pending','task-pending']);
});

test('refresh cannot project a queued finish onto a different visit',async t=>{
  const f=fixture();t.after(()=>f.sql.close());await f.api.queueAction(sharedFinish());
  const job={...sharedJob(),appointmentId:'visit-2',appointmentStatus:'scheduled'};
  await f.api.applyChanges([{operation:'upsert',entityId:'job',entity:job}],false,'now','trade_team');
  const saved=JSON.parse(f.sql.prepare('SELECT payload FROM jobs').get().payload);
  assert.equal(saved.appointmentId,'visit-2');assert.equal(saved.appointmentStatus,'scheduled');
});

const answerConflict = () => ({ conflicts:[{sectionKey:'details',promptKey:'size',label:'Size',base:'old',local:'mine',saved:'theirs'}],
  currentInstance:{id:'pack-current',responseSha256:'current-hash'},
  mergedPatches:[{sectionKey:'details',repeatInstanceKey:'',remove:false,answers:{notes:'independent local edit'}}] });
const conflictingAction = () => ({clientActionId:'pack-edit',type:'work_pack_commit',workOrderId:'job',baseRevision:5,
  caseInstanceId:'pack-base',expectedResponseSha256:'base-hash',workPackInstanceKey:'pack-stable',
  sectionPatches:[{sectionKey:'details',repeatInstanceKey:'',remove:false,answers:{size:'mine',notes:'independent local edit',other:'unchanged base'}}]});
const freshPack = () => ({instance:{id:'pack-current',responseSha256:'current-hash',workOrderId:'job'}});

test('answer conflicts preserve original transport bytes and only retry trusted local deltas plus explicit choices',async t=>{
  const f=fixture();t.after(()=>f.sql.close());await f.api.queueAction(conflictingAction());
  const [sent]=await f.api.queuedActions('trade_team');
  const state=answerConflict();
  await f.api.resolveAction('pack-edit',{status:'conflict',code:'WORK_PACK_ANSWER_CONFLICT',...state});
  assert.equal(f.rows()[0].payload,sent.payload);assert.deepEqual(JSON.parse(f.rows()[0].conflict_json),state);
  await assert.rejects(f.api.retryConflict('pack-edit',{...conflictingAction(),clientActionId:'unsafe'}),/Open the job/);
  await f.api.resolveWorkPackAnswerConflict('pack-edit',freshPack(),[{sectionKey:'details',promptKey:'size',use:'local'}]);
  const next=JSON.parse(f.rows()[0].payload);
  assert.equal(next.clientActionId,'act-new-retry-id');assert.equal(next.expectedResponseSha256,'current-hash');
  assert.deepEqual(next.sectionPatches[0].answers,{notes:'independent local edit',size:'mine'});
  assert.equal(f.rows()[0].dispatched_at,'');assert.equal(f.rows()[0].conflict_json,'');
});

test('saved choice never overwrites the disputed value and choices are required for every conflict',async t=>{
  const f=fixture();t.after(()=>f.sql.close());
  assert.throws(()=>f.api.resolvedWorkPackAnswerPatches(answerConflict(),[]),/every changed answer/);
  const patches=f.api.resolvedWorkPackAnswerPatches(answerConflict(),[{sectionKey:'details',promptKey:'size',use:'saved'}]);
  assert.deepEqual(patches[0].answers,{notes:'independent local edit'});
  const removal={...answerConflict(),mergedPatches:[],conflicts:[{sectionKey:'units',repeatInstanceKey:'unit-1',promptKey:'',label:'Unit',base:{serial:'old'},local:null,saved:{serial:'other'}}]};
  assert.deepEqual(f.api.resolvedWorkPackAnswerPatches(removal,[{sectionKey:'units',repeatInstanceKey:'unit-1',promptKey:'',use:'local'}]),
    [{sectionKey:'units',repeatInstanceKey:'unit-1',remove:true,answers:{}}]);
});

test('changed-again conflict reruns original draft without applying obsolete resolution; cross-job snapshot cannot modify queue',async t=>{
  const f=fixture();t.after(()=>f.sql.close());await f.api.queueAction(conflictingAction());
  await f.api.resolveAction('pack-edit',{status:'conflict',code:'WORK_PACK_ANSWER_CONFLICT',...answerConflict()});
  const original=f.rows()[0].payload;
  const choices=[{sectionKey:'details',promptKey:'size',use:'local'}];
  await assert.rejects(f.api.resolveWorkPackAnswerConflict('pack-edit',{instance:{...freshPack().instance,workOrderId:'other-job'}},choices),/does not belong/);
  assert.equal(f.rows()[0].status,'conflict');
  await assert.rejects(f.api.resolveWorkPackAnswerConflict('pack-edit',{instance:{...freshPack().instance,id:'pack-newer',responseSha256:'newer-hash'}},choices),/changed again/);
  assert.equal(f.rows()[0].payload,original);assert.equal(f.rows()[0].status,'queued');
});
