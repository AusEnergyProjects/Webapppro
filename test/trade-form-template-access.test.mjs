import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { ENERGY_SERVICE_IDS } from '../src/lib/energy-service-catalogue.mjs';
import * as boundedJson from '../src/lib/bounded-json-request.ts';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const admin = { adminJson: (body, status = 200) => Response.json(body, { status }),
  mfaErrorResponse: () => null, sameOrigin: () => true,
  cleanAdminText: (value, maximum) => typeof value === 'string' ? value.trim().slice(0, maximum) : '' };
function compile(file, imports) {
  const moduleRecord = { exports: {} };
  const output = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    assert.ok(imports[name], `Unexpected import: ${name}`); return imports[name];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}
const cleaner = compile('src/lib/trade-form-template-input.ts', {
  './admin-server': admin, './energy-service-catalogue.mjs': { ENERGY_SERVICE_IDS },
});
class TradeBusinessContextError extends Error {}

function fixture(t) {
  const database = new DatabaseSync(':memory:'); t.after(() => database.close());
  database.exec(`CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT NOT NULL,member_uid TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE trade_field_sessions(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE trade_job_forms(id TEXT PRIMARY KEY,template_snapshot TEXT);
    INSERT INTO trade_team_members VALUES('owner','business','business','active'),('staff','business','staff-uid','active'),
      ('manager','business','manager-uid','active'),('field','business','','active'),('foreign','other','foreign-uid','active');`);
  database.exec(read('drizzle/0236_trade_form_authoring_permission.sql'));
  const eventSchema = read('drizzle/0131_trade_team_permissions_and_member_files.sql').split('--> statement-breakpoint')
    .find(statement => statement.includes('CREATE TABLE `trade_team_member_events`'));
  assert.ok(eventSchema); database.exec(eventSchema);
  database.exec(read('drizzle/0030_gifted_white_tiger.sql'));
  database.exec(read('drizzle/0168_trade_business_form_scope.sql'));
  database.exec("INSERT INTO trade_field_sessions VALUES('session','business','field','active','2999-01-01T00:00:00.000Z')");
  let beforeBatch;
  class Statement {
    constructor(sql, bindings = []) { this.sql = sql; this.bindings = bindings; }
    bind(...bindings) { return new Statement(this.sql, bindings); }
    async first() { return database.prepare(this.sql).get(...this.bindings) || null; }
    async all() { return { results: database.prepare(this.sql).all(...this.bindings) }; }
    runSync() { return { meta: { changes: Number(database.prepare(this.sql).run(...this.bindings).changes) } }; }
  }
  const db = { prepare: sql => new Statement(sql), async batch(statements) {
    if (beforeBatch) { const change = beforeBatch; beforeBatch = null; change(); }
    database.exec('BEGIN');
    try { const result = statements.map(statement => statement.runSync()); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  } };
  const actor = memberId => ({ memberId, ownerUid: memberId === 'foreign' ? 'other' : 'business',
    actorUid: memberId === 'owner' ? 'business' : memberId === 'field' ? 'field-member:field' : `${memberId}-uid`,
    isOwner: memberId === 'owner', ...(memberId === 'field' ? { fieldSessionId: 'session' } : {}),
    canManageJobs: true, jobScope: 'team', canManageFieldEvidence: true, canViewFieldEvidence: true, canManageForms: true });
  const route = access => compile('src/app/api/trade-form-templates/route.ts', {
    '../../../../db': { getD1: () => db }, '@/lib/admin-server': admin,
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => access },
    '@/lib/trade-business-context-server': { TradeBusinessContextError },
    '@/lib/trade-form-template-input': cleaner, '@/lib/bounded-json-request': boundedJson,
  });
  const input = extras => ({ name: 'Business checklist', description: 'Job checklist', guidance: 'Check the work.', jurisdiction: 'AU', categories: ['electrical'],
    fields: [{ key: 'needed', label: 'Extra work needed?', type: 'select', options: ['Yes', 'No'], required: true, section: 'Inspection', phase: 'before' },
      { key: 'notes', label: 'Describe the extra work', type: 'textarea', required: true, section: 'Inspection', phase: 'before', condition: { fieldKey: 'needed', equals: 'Yes' } }], ...extras });
  const get = access => route(access).GET(new Request('https://example.test/api/trade-form-templates'));
  const post = (access, body = input()) => route(access).POST(new Request('https://example.test/api/trade-form-templates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { database, actor, input, get, post, beforeBatch: change => { beforeBatch = change; } };
}

test('authoring migration grants only owner identity and constrains the independent flag', t => {
  const f = fixture(t);
  assert.deepEqual(f.database.prepare('SELECT id,can_manage_forms enabled FROM trade_team_members ORDER BY id').all().map(row => [row.id, row.enabled]),
    [['field', 0], ['foreign', 0], ['manager', 0], ['owner', 1], ['staff', 0]]);
  assert.throws(() => f.database.exec("UPDATE trade_team_members SET can_manage_forms=2 WHERE id='staff'"), /CHECK/);
});

test('ordinary active members read only their business template catalogue, including workflow metadata', async t => {
  const f = fixture(t);
  const created = await f.post(f.actor('owner')); assert.equal(created.status, 201);
  f.database.exec("UPDATE trade_team_members SET can_manage_forms=1 WHERE id='foreign'");
  assert.equal((await f.post(f.actor('foreign'), f.input({ name: 'Foreign secret template' }))).status, 201);
  const response = await f.get({ ...f.actor('staff'), canViewFieldEvidence: false, canManageForms: false });
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.canManage, false); assert.equal(result.templates.length, 1);
  assert.equal(result.templates[0].fields[1].condition.equals, 'Yes'); assert.equal(result.templates[0].fields[1].section, 'Inspection');
  assert.doesNotMatch(JSON.stringify(result), /Foreign secret|template_snapshot|answers|completed/);
});

test('old broad permissions or forged cached owner access never authorize template creation', async t => {
  const f = fixture(t);
  for (const access of [f.actor('manager'), { ...f.actor('staff'), isOwner: true }]) assert.equal((await f.post(access)).status, 403);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_form_templates').get().n, 0);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_team_member_events').get().n, 0);
});

test('explicit author grant is independent from job and field evidence permissions', async t => {
  const f = fixture(t); f.database.exec("UPDATE trade_team_members SET can_manage_forms=1 WHERE id='staff'");
  const access = { ...f.actor('staff'), canManageJobs: false, jobScope: 'own', canManageFieldEvidence: false, canViewFieldEvidence: false, canManageForms: false };
  const result = await f.post(access); assert.equal(result.status, 201, JSON.stringify(await result.json()));
  assert.equal((await (await f.get(access)).json()).canManage, true);
  const audit = f.database.prepare('SELECT actor_uid,metadata FROM trade_team_member_events').get();
  assert.equal(audit.actor_uid, 'staff-uid'); assert.deepEqual(Object.keys(JSON.parse(audit.metadata)).sort(), ['templateId', 'templateKey', 'version']);
});

test('suspended, wrong-identity and wrong-business actors cannot read template definitions', async t => {
  const f = fixture(t); await f.post(f.actor('owner'));
  f.database.exec("UPDATE trade_team_members SET status='suspended' WHERE id='staff'");
  for (const access of [f.actor('staff'), { ...f.actor('manager'), actorUid: 'other-user' }, { ...f.actor('foreign'), ownerUid: 'business' }]) {
    const result = await f.get(access); assert.equal(result.status, 403); assert.doesNotMatch(await result.text(), /Business checklist/);
  }
});

test('field authoring requires the live scoped session and explicit grant', async t => {
  const f = fixture(t); const access = f.actor('field');
  assert.equal((await f.post(access)).status, 403);
  f.database.exec("UPDATE trade_team_members SET can_manage_forms=1 WHERE id='field'");
  assert.equal((await f.post(access)).status, 201);
  f.database.exec("UPDATE trade_field_sessions SET status='revoked'");
  assert.equal((await f.get(access)).status, 403); assert.equal((await f.post(access)).status, 403);
  f.database.exec("UPDATE trade_field_sessions SET status='active',expires_at='2000-01-01T00:00:00.000Z'");
  assert.equal((await f.post(access)).status, 403);
});

test('revoked authoring, suspended membership or revoked field session inside mutation writes nothing', async t => {
  const f = fixture(t);
  for (const [member, change] of [['staff', "UPDATE trade_team_members SET can_manage_forms=0 WHERE id='staff'"],
    ['staff', "UPDATE trade_team_members SET status='suspended' WHERE id='staff'"], ['field', "UPDATE trade_field_sessions SET status='revoked'"]]) {
    f.database.exec("UPDATE trade_team_members SET status='active',can_manage_forms=1 WHERE id IN ('staff','field'); UPDATE trade_field_sessions SET status='active'");
    f.beforeBatch(() => f.database.exec(change)); assert.equal((await f.post(f.actor(member))).status, 409);
  }
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_form_templates').get().n, 0);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_team_member_events').get().n, 0);
});

test('template edits append an immutable next version and cannot replace job snapshots', async t => {
  const f = fixture(t); const owner = f.actor('owner'); const first = (await (await f.post(owner)).json()).templates[0];
  f.database.prepare('INSERT INTO trade_job_forms(id,template_snapshot) VALUES(?,?)').run('job-form', JSON.stringify(first));
  const edited = f.input({ id: first.id, expectedVersion: first.version, expectedUpdatedAt: first.updatedAt, name: 'Revised checklist' });
  const response = await f.post(owner, edited); assert.equal(response.status, 201);
  const current = (await response.json()).templates[0]; assert.equal(current.version, 2); assert.notEqual(current.id, first.id);
  assert.equal(f.database.prepare('SELECT name FROM trade_form_templates WHERE id=?').get(first.id).name, first.name);
  assert.equal(JSON.parse(f.database.prepare('SELECT template_snapshot FROM trade_job_forms').get().template_snapshot).id, first.id);
  assert.equal((await f.post(owner, edited)).status, 409);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_team_member_events').get().n, 2);
});

test('concurrent version publication is checked inside SQL and leaves no extra audit', async t => {
  const f = fixture(t); const owner = f.actor('owner'); const first = (await (await f.post(owner)).json()).templates[0];
  f.beforeBatch(() => f.database.prepare(`INSERT INTO trade_form_templates(id,scope_owner_uid,template_key,version,name,created_by_uid,created_at,updated_at)
    SELECT 'concurrent',scope_owner_uid,template_key,2,name,created_by_uid,created_at,updated_at FROM trade_form_templates WHERE id=?`).run(first.id));
  assert.equal((await f.post(owner, f.input({ id: first.id, expectedVersion: first.version, expectedUpdatedAt: first.updatedAt }))).status, 409);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_form_templates').get().n, 2);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_team_member_events').get().n, 1);
});

test('foreign and platform template IDs cannot be edited or copied into the business namespace', async t => {
  const f = fixture(t); f.database.exec("UPDATE trade_team_members SET can_manage_forms=1 WHERE id='foreign'");
  const foreign = (await (await f.post(f.actor('foreign'))).json()).templates[0];
  f.database.exec("INSERT INTO trade_form_templates(id,template_key,version,name,created_by_uid,created_at,updated_at) VALUES('platform','platform',1,'Governed','admin','now','now')");
  for (const id of [foreign.id, 'platform']) assert.equal((await f.post(f.actor('owner'), f.input({ id, expectedVersion: 1, expectedUpdatedAt: foreign.updatedAt }))).status, 404);
  const created = await f.post(f.actor('owner'), f.input({ scope_owner_uid: 'other', scopeOwnerUid: 'other', templateKey: foreign.templateKey }));
  assert.equal(created.status, 201); const result = (await created.json()).templates[0]; assert.notEqual(result.templateKey, foreign.templateKey);
});

test('invalid routing metadata and malformed payloads are rejected without writes', async t => {
  const f = fixture(t);
  const invalid = await f.post(f.actor('owner'), f.input({ fields: [{ key: 'a', label: 'A', type: 'text', condition: { fieldKey: 'missing', equals: true } }] }));
  assert.equal(invalid.status, 400);
  const result = await invalid.json();
  assert.equal(result.code, 'INVALID_CONDITION'); assert.match(result.error, /earlier select or checkbox question/);
  for (const body of [null, [], 'bad']) assert.equal((await f.post(f.actor('owner'), body)).status, 400);
  assert.equal(f.database.prepare('SELECT count(*) n FROM trade_form_templates').get().n, 0);
});
