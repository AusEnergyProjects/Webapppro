import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { ENERGY_SERVICE_IDS } from '../src/lib/energy-service-catalogue.mjs';
import * as boundedJson from '../src/lib/bounded-json-request.ts';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function compile(path, imports) {
  const compiledModule = { exports: {} };
  const output = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', output)(name => { assert.ok(imports[name], `Unexpected import: ${name}`); return imports[name]; }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const contract = compile('src/lib/trade-business-form-ai.ts', {});
const admin = { adminJson: (body, status = 200) => Response.json(body, { status }), mfaErrorResponse: () => null,
  sameOrigin: request => request.headers.get('origin') === 'https://test.invalid',
  cleanAdminText: (value, maximum) => typeof value === 'string' ? value.trim().slice(0, maximum) : '' };
const cleaner = compile('src/lib/trade-form-template-input.ts', { './admin-server': admin, './energy-service-catalogue.mjs': { ENERGY_SERVICE_IDS } });
const generated = () => ({ kind: 'draft', questions: [], form: { name: 'Electrical inspection', description: 'Before-work checklist for technicians.',
  guidance: 'Record the inspection findings. This is a supporting business checklist.', fields: [{ key: 'follow_up', label: 'Describe any follow-up work',
    type: 'textarea', required: false, maxLength: 1200, options: [], section: 'Inspection', phase: 'before' }] } });
const input = () => ({ purpose: 'An electrical inspection checklist for technicians before work, including follow-up notes.', category: 'electrical', requestId: 'form-ai-request-0001' });
class TradeBusinessContextError extends Error {}
function fixture(t, respond = async () => generated()) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,can_manage_forms INTEGER);
    CREATE TABLE trade_field_sessions(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    INSERT INTO trade_team_members VALUES('owner','business','business','active',0),('author','business','author-uid','active',1),
      ('viewer','business','viewer-uid','active',0),('field','business','','active',1),('foreign','other','foreign-uid','active',1);
    INSERT INTO trade_field_sessions VALUES('session','business','field','active','2999-01-01T00:00:00.000Z');`);
  const queries = [], calls = [];
  const db = { prepare(sql) {
    queries.push(sql); assert.match(sql, /^SELECT /, 'generation must only read the database');
    return { bind: (...values) => ({ first: async () => sqlite.prepare(sql).get(...values) || null }) };
  } };
  const server = compile('src/lib/trade-business-form-ai-server.ts', {
    './energy-service-catalogue.mjs': { ENERGY_SERVICE_IDS }, './trade-form-template-input': cleaner, './trade-business-form-ai': contract,
    './workflow-ai-server': { workflowAiSourceHash: async value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      requestWorkflowAi: async options => { calls.push(options); return respond(options, sqlite); } },
  });
  const actor = (memberId = 'author', extra = {}) => ({ ownerUid: 'business', memberId,
    actorUid: memberId === 'owner' ? 'business' : memberId === 'field' ? 'field-member:field' : `${memberId}-uid`,
    isOwner: memberId === 'owner', canManageForms: memberId !== 'viewer', ...(memberId === 'field' ? { fieldSessionId: 'session' } : {}), ...extra });
  const route = (access = actor(), next = access) => {
    let reads = 0;
    return compile('src/app/api/trade-form-templates/assist/route.ts', {
      '../../../../../db': { getD1: () => db }, '@/lib/admin-server': admin,
      '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => reads++ ? next : access },
      '@/lib/trade-business-context-server': { TradeBusinessContextError }, '@/lib/bounded-json-request': boundedJson,
      '@/lib/trade-business-form-ai-server': server,
    });
  };
  const request = (body = input(), origin = 'https://test.invalid') => new Request('https://test.invalid/api/trade-form-templates/assist', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { sqlite, db, queries, calls, actor, route, request, server };
}

test('owner and live authorised staff get a validated draft; no form or answers are written', async t => {
  const f = fixture(t);
  for (const access of [f.actor('owner'), f.actor('author'), f.actor('field')]) {
    const draft = await f.server.createBusinessFormAiDraft(f.db, access, input());
    assert.deepEqual(draft.result, generated()); assert.match(draft.sourceHash, /^[a-f0-9]{64}$/);
  }
  assert.equal(f.queries.length, 6); assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].scopeUid, 'business'); assert.equal(f.calls[0].actorUid, 'business');
  assert.match(f.calls[0].instructions, /Do not fill in answers/); assert.match(f.calls[0].instructions, /existing Save form/);
  assert.equal(f.calls[0].input.answersSupplied, false);
});
test('snapshot permissions cannot grant live, inactive, foreign or mismatched actor access', async t => {
  const f = fixture(t);
  for (const access of [f.actor('viewer', { canManageForms: true }), f.actor('foreign'), f.actor('author', { actorUid: 'foreign-uid' }), f.actor('field', { actorUid: 'author-uid' })]) {
    await assert.rejects(f.server.createBusinessFormAiDraft(f.db, access, input()), /FORM_AUTHOR_REQUIRED/);
  }
  f.sqlite.exec("UPDATE trade_team_members SET status='inactive' WHERE id='author'");
  await assert.rejects(f.server.createBusinessFormAiDraft(f.db, f.actor(), input()), /FORM_AUTHOR_REQUIRED/);
  assert.equal(f.calls.length, 0);
});
for (const [name, mutation] of [
  ['authoring permission revoked', db => db.exec("UPDATE trade_team_members SET can_manage_forms=0 WHERE id='author'")],
  ['actor identity replaced', db => db.exec("UPDATE trade_team_members SET member_uid='replacement' WHERE id='author'")],
  ['member removed', db => db.exec("DELETE FROM trade_team_members WHERE id='author'")],
]) test(`${name} during generation rejects the late draft`, async t => {
  const f = fixture(t, async (_options, db) => { mutation(db); return generated(); });
  await assert.rejects(f.server.createBusinessFormAiDraft(f.db, f.actor(), input()), /FORM_AUTHOR_REQUIRED/);
  assert.equal(f.calls.length, 1);
});
test('field session expiry during generation is checked again', async t => {
  const f = fixture(t, async (_options, db) => { db.exec("UPDATE trade_field_sessions SET expires_at='2000-01-01T00:00:00.000Z'"); return generated(); });
  await assert.rejects(f.server.createBusinessFormAiDraft(f.db, f.actor('field'), input()), /FORM_AUTHOR_REQUIRED/);
});
test('source mutation while generation runs rejects the draft hash', async t => {
  const source = input();
  const f = fixture(t, async () => { source.purpose = 'Changed purpose'; return generated(); });
  await assert.rejects(f.server.createBusinessFormAiDraft(f.db, f.actor(), source), /WORKFLOW_AI_SOURCE_CHANGED/);
});
test('unclear purpose returns useful clarification without a draft or publication', async t => {
  const result = { kind: 'clarify', questions: ['Who will complete the form?', 'What work should they record?'], form: null };
  const f = fixture(t, async () => result);
  const response = await f.route().POST(f.request({ ...input(), purpose: 'Make a form' }));
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).result, result);
  assert.equal(f.queries.length, 2);
});
test('strict generated contract rejects fabricated answers, identity fields, incomplete and ambiguous output', () => {
  const mutations = [
    value => { value.form.fields[0].answer = 'Inspection complete'; }, value => { value.form.id = 'existing-form'; },
    value => { value.form.fields.push({ ...value.form.fields[0] }); }, value => { value.questions = ['Still unclear']; },
    value => { value.form.fields[0].options = ['Unexpected option']; }, value => { value.form.fields[0].maxLength = 2; },
    value => { value.form.fields[0].condition = { fieldKey: 'hidden', equals: true }; }, value => { value.form.name = 'x'.repeat(141); },
    value => { value.form.fields[0].type = 'signature'; }, value => { value.form.fields = []; },
  ];
  for (const mutate of mutations) { const value = generated(); mutate(value); assert.throws(() => contract.parseBusinessFormAiResult(value), /WORKFLOW_AI_INCOMPLETE/); }
  assert.throws(() => contract.parseBusinessFormAiResult({ kind: 'clarify', questions: [], form: null }), /WORKFLOW_AI_INCOMPLETE/);
});
test('API rejects unsupported input and other origins before any provider call', async t => {
  const f = fixture(t);
  for (const body of [{ ...input(), category: 'invented' }, { ...input(), ownerUid: 'other' }, { ...input(), purpose: 'x'.repeat(2001) }, { ...input(), requestId: 'short' }]) {
    assert.equal((await f.route().POST(f.request(body))).status, 400);
  }
  assert.equal((await f.route().POST(f.request(input(), 'https://other.invalid'))).status, 403);
  assert.equal(f.calls.length, 0);
});
test('API rechecks selected actor and business after the server returns', async t => {
  const f = fixture(t);
  for (const next of [f.actor('author', { ownerUid: 'other' }), f.actor('viewer'), f.actor('author', { canManageForms: false })]) {
    assert.equal((await f.route(f.actor(), next).POST(f.request())).status, 403);
  }
});
test('provider failures remain honest and never publish', async t => {
  const f = fixture(t, async () => { throw new Error('WORKFLOW_AI_UNAVAILABLE'); });
  const response = await f.route().POST(f.request()); assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Your forms are unchanged/); assert.equal(f.queries.length, 1);
});
