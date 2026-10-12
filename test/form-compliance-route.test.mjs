import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as contract from '../src/lib/form-compliance.ts';
import * as bounded from '../src/lib/bounded-json-request.ts';

function fixture() {
  const state = { authorisations: 0, serverLoads: 0, requests: [], authError: null };
  const service = {
    async loadFormComplianceTemplate(db, actor, formKey) { state.requests.push({ mode: 'template', actor, formKey }); return { template: { formKey, title: 'Checks', revision: 0, questions: [] }, canManage: true }; },
    async saveFormComplianceTemplate(db, actor, input) { state.requests.push({ mode: 'save_template', actor, input }); return { template: { formKey: input.formKey, title: 'Checks', revision: 1, questions: input.questions }, canManage: true }; },
    async loadFormComplianceQueue(db, actor, options) { state.requests.push({ mode: 'queue', options }); return { items: [], nextCursor: null }; },
    async loadFormComplianceWorkspace(db, actor, context) { state.requests.push({ mode: 'review', actor, context }); return { source: { id: context.formId || context.recordId } }; },
    async saveFormComplianceReview(db, actor, input) { state.requests.push({ mode: 'save_review', actor, input }); return { review: { revision: 1 } }; },
  };
  const imports = { '../../../../db': { getD1: () => ({}) }, '@/lib/form-compliance': contract, '@/lib/bounded-json-request': bounded,
    '@/lib/admin-server': { sameOrigin: request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin, mfaErrorResponse: () => null },
    '@/lib/trade-team-server': { async requireInstallerTeamAccess() { state.authorisations++; if (state.authError) throw state.authError; return { ownerUid: 'authoritative-owner' }; } },
    '@/lib/creditex-job-audit-route-server': { async requireJobAuditActor(request, db, permission) { state.authorisations++; state.permission = permission; if (state.authError) throw state.authError; return { organisationId: 'authoritative-org' }; } },
  };
  const result = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(new URL('../src/app/api/form-compliance/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(key => {
    if (key === '@/lib/form-compliance-server') { state.serverLoads++; return service; }
    assert.ok(key in imports, `Unexpected dependency ${key}`); return imports[key];
  }, result, result.exports);
  const request = (query, body, headers = {}) => new Request(`https://example.test/api/form-compliance?${query}`, {
    ...(body === undefined ? {} : { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), headers: { 'content-type': 'application/json', ...headers },
  });
  return { route: result.exports, state, request };
}
const template = { action: 'save_template', formKey: 'business:form', expectedRevision: 0, questions: [{ key: 'check',label: 'Work checked?',required: true }] };
const review = { action:'save_review',workOrderId:'job',formId:'form',expectedRevision:0,expectedSourceHash:'a'.repeat(64),templateRevision:0,
  answers:[{ key:'check',response:'pass',note:'' }],status:'complete' };
test('origin, repeated/foreign selectors and oversized or malformed bodies are rejected before authentication or backend import', async () => {
  const f = fixture();
  const crossOrigin = await f.route.GET(f.request('scope=business&formKey=business:form',undefined,{ origin:'https://foreign.test' })); assert.equal(crossOrigin.status,403);
  for (const query of ['scope=business&scope=creditex&formKey=business:form', 'scope=business&formKey=business:form&ownerUid=foreign',
    'scope=business&formKey=activity:foreign:', 'scope=business&formId=form&workOrderId=job&intentId=foreign',
    'scope=creditex&actorMode=foreign&formKey=activity:activity:', 'scope=creditex&view=queue']) assert.equal((await f.route.GET(f.request(query))).status,400,query);
  assert.equal((await f.route.POST(f.request('scope=business','{'))).status,400);
  assert.equal((await f.route.POST(f.request('scope=business','x'.repeat(150_001)))).status,413);
  assert.equal(f.state.authorisations,0); assert.equal(f.state.serverLoads,0);
});
test('query scope is authoritative and frontend bodies need no duplicate scope field', async () => {
  const f = fixture(), response = await f.route.POST(f.request('scope=business&formKey=business:form',template));
  assert.equal(response.status,200); assert.equal(f.state.authorisations,1); assert.equal(f.state.serverLoads,1);
  assert.equal(f.state.requests[0].input.scope,'business'); assert.equal(f.state.requests[0].actor.access.ownerUid,'authoritative-owner');
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
});
test('queue search and pagination preserve the response contract and reject malformed bounds before authentication', async () => {
  const f = fixture(), response = await f.route.GET(f.request('scope=business&view=queue&q=%20Hot%20water%20&cursor=opaque_cursor'));
  assert.equal(response.status,200); assert.deepEqual(await response.json(),{ ok:true,items:[],nextCursor:null });
  assert.deepEqual(f.state.requests[0].options,{ q:'Hot water',cursor:'opaque_cursor' });
  const invalid = fixture();
  for (const query of ['scope=business&view=queue&q='+ 'x'.repeat(161),'scope=business&view=queue&cursor='+ 'x'.repeat(513), 'scope=business&view=queue&cursor=%20invalid']) {
    assert.equal((await invalid.route.GET(invalid.request(query))).status,400);
  }
  assert.equal(invalid.state.authorisations,0); assert.equal(invalid.state.serverLoads,0);
});
test('scope/context conflicts and mass-assignment body fields fail before authorization', async () => {
  const f = fixture();
  for (const [query,body] of [['scope=business', { ...template,scope:'creditex' }],['scope=business&formKey=business:other',template],
    ['scope=business&formId=foreign&workOrderId=job',review],['scope=business',{ ...review,ownerUid:'foreign' }],
    ['scope=business',{ ...review,intentId:'foreign' }],['scope=creditex&intentId=intent&recordId=record&recordKind=field',{ ...review,scope:'creditex',intentId:'intent',recordId:'record',recordKind:'field' }]]) {
    assert.equal((await f.route.POST(f.request(query,body))).status,400);
  }
  assert.equal(f.state.authorisations,0); assert.equal(f.state.serverLoads,0);
});
test('Creditex author requests use forms permission and reviews use existing jobs access before the server is loaded', async () => {
  const f = fixture();
  assert.equal((await f.route.GET(f.request('scope=creditex&actorMode=admin&formKey=activity:activity:'))).status,200);
  assert.equal(f.state.permission,'forms');
  assert.equal((await f.route.GET(f.request('scope=creditex&intentId=intent&recordId=record&recordKind=field'))).status,200);
  assert.equal(f.state.permission,'jobs');
  assert.equal(f.state.requests[1].context.recordKind,'field');
  assert.equal(f.state.requests[1].actor.access.organisationId,'authoritative-org');
});
test('unauthenticated and unauthorised requests preserve private error states without loading review source data', async () => {
  const f = fixture(); f.state.authError = new Error('AUTH_REQUIRED');
  assert.equal((await f.route.GET(f.request('scope=business&formKey=business:form'))).status,401);
  assert.equal(f.state.serverLoads,0);
  f.state.authError = new Error('ABN_REVIEW_REQUIRED');
  assert.equal((await f.route.POST(f.request('scope=business',template))).status,403);
  assert.equal(f.state.serverLoads,0);
  f.state.authError = new Error('Provider returned private credential or customer payload');
  const unavailable = await f.route.GET(f.request('scope=business&view=queue'));
  assert.equal(unavailable.status,503); assert.equal((await unavailable.text()).includes('private credential'),false);
});
