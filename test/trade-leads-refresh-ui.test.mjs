import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const source = fs.readFileSync(new URL('../src/components/DirectTradeDashboard.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('DirectTradeDashboard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let found;
  function visit(node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); }
  visit(parsed); assert.ok(found, 'Expected production Leads code'); return found;
}
const declaration = name => find(node => ts.isVariableDeclaration(node) && node.name.getText(parsed) === name).getText(parsed);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect' && node.arguments[0]?.getText(parsed).includes('refreshOpportunities')) effects.push(node.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed); assert.equal(effects.length, 2);
function evaluate(code, bindings = {}) {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  Function('exports', 'require', ...Object.keys(bindings), compiled)(exports, id => { assert.equal(id, 'react/jsx-runtime'); return jsx; }, ...Object.values(bindings));
  return exports;
}
const refreshButton = find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === 'button' && node.getText(parsed).includes('"Refresh leads"')).getText(parsed);
const emptyState = find(node => ts.isConditionalExpression(node) && node.condition.getText(parsed) === 'opportunitiesLoading' && node.getText(parsed).includes('No opportunities assigned')).getText(parsed);
const renderButton = (state, refreshOpportunities) => evaluate(`exports.node = (${refreshButton});`, { ...state, refreshOpportunities }).node;
const renderEmpty = state => evaluate(`exports.node = (${emptyState});`, state).node;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = opportunities => ({ ok: true, json: async () => ({ opportunities }) });
const lead = matchId => ({ matchId, title: matchId });
const profile = { partnerType: 'installer', entitlements: { features: { installer_leads: true } } };

function harness(fetchResult = async () => response([]), props = {}) {
  const state = { opportunities: [], opportunitiesLoading: false, opportunityLoadError: '', leadSearch: 'solar', leadStatusFilter: 'offered', leadServiceFilter: 'solar', leadStateFilter: 'VIC' };
  const user = { uid: 'trade-a', getIdToken: async () => 'token-a' };
  const protectedIdentityUid = { current: user.uid }, protectedIdentityRevision = { current: 1 };
  const opportunityListController = { current: null }, protectedOpportunityRequestControllers = { current: new Set() }, exactOpportunityMatchId = { current: '' };
  const slots = [], queued = [], events = new Map(), requests = [], writes = [];
  const document = { visibilityState: 'visible' };
  let cursor = 0, currentProps = { user, profile, workspace: 'work', activeWorkView: 'today', ...props }, refresh;
  const bindings = { protectedIdentityUid, protectedIdentityRevision, opportunityListController, protectedOpportunityRequestControllers, exactOpportunityMatchId, document,
    window: { addEventListener: (event, callback) => events.set(event, callback), removeEventListener: (event, callback) => { if (events.get(event) === callback) events.delete(event); } },
    fetch: async (url, init) => { requests.push({ url, init }); return fetchResult(url, init); },
    useCallback(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) slots[i] = { callback, deps }; return slots[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) { const previous = slots[i]; slots[i] = { deps }; queued.push(() => { previous?.cleanup?.(); slots[i].cleanup = callback(); }); } },
  };
  for (const key of Object.keys(state)) bindings[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { writes.push(key); state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const component = evaluate(`exports.render = ({user, profile, workspace, activeWorkView}) => { const ${declaration('refreshOpportunities')}; const ${declaration('leadsViewActive')}; ${effects.join(';')} return refreshOpportunities; };`, bindings).render;
  function render(next = {}) { currentProps = { ...currentProps, ...next }; cursor = 0; refresh = component(currentProps); for (const effect of queued.splice(0)) effect(); return renderButton(state, refresh); }
  return { state, requests, writes, events, document, exactOpportunityMatchId, protectedOpportunityRequestControllers, protectedIdentityUid, protectedIdentityRevision,
    render, refresh: () => refresh(), async mount() { render(); await flush(); return render(); },
    async enterLeads() { render({ activeWorkView: 'leads' }); await flush(); return render(); },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('opening Leads and the visible refresh action retrieve new leads while keeping filters', async () => {
  let version = 0;
  const h = harness(async () => response([lead(`lead-${++version}`)]));
  await h.mount(); assert.equal(h.requests.length, 1); assert.equal(h.state.opportunities[0].matchId, 'lead-1');
  let button = await h.enterLeads(); assert.equal(h.requests.length, 2); assert.equal(h.state.opportunities[0].matchId, 'lead-2');
  assert.equal(text(button), 'Refresh leads'); assert.equal(button.props.disabled, false);
  button.props.onClick(); button = h.render(); assert.equal(button.props.disabled, true); assert.equal(text(button), 'Refreshing leads...');
  await flush(); assert.equal(h.state.opportunities[0].matchId, 'lead-3');
  assert.deepEqual([h.state.leadSearch, h.state.leadStatusFilter, h.state.leadServiceFilter, h.state.leadStateFilter], ['solar', 'offered', 'solar', 'VIC']);
  assert.ok(h.requests.every(({ url, init }) => url === '/api/trade-opportunities' && init.cache === 'no-store' && init.headers.Authorization === 'Bearer token-a' && init.signal instanceof AbortSignal));
  h.render({ activeWorkView: 'today' }); await flush(); assert.equal(h.requests.length, 3, 'leaving Leads does not fetch');
  await h.enterLeads(); assert.equal(h.requests.length, 4); h.cleanup();
});

test('active Leads refreshes on visible browser focus and deduplicates overlapping entry, focus and manual reads', async () => {
  const pending = deferred(); let attempt = 0;
  const h = harness(async () => ++attempt === 1 ? pending.promise : response([]), { activeWorkView: 'leads' });
  h.render(); await flush(); assert.equal(h.requests.length, 1, 'initial load and initial Leads entry share one read');
  h.events.get('focus')(); h.events.get('focus')(); void h.refresh(); await flush(); assert.equal(h.requests.length, 1);
  assert.match(text(renderEmpty(h.state)), /Loading leads/); assert.doesNotMatch(text(renderEmpty(h.state)), /No opportunities assigned/);
  pending.resolve(response([lead('first')])); await flush();
  h.document.visibilityState = 'hidden'; h.events.get('focus')(); await flush(); assert.equal(h.requests.length, 1);
  h.document.visibilityState = 'visible'; h.events.get('focus')(); await flush(); assert.equal(h.requests.length, 2);
  h.render({ workspace: 'account' }); assert.equal(h.events.has('focus'), false); h.cleanup();
});

test('failed refresh retains loaded leads, exposes the error and allows manual recovery', async () => {
  let fail = false;
  const h = harness(async () => { if (fail) throw Error('Network unavailable'); return response([lead('retained')]); });
  await h.mount(); fail = true; await h.refresh();
  assert.equal(h.state.opportunities[0].matchId, 'retained'); assert.equal(h.state.opportunityLoadError, 'Network unavailable');
  assert.equal(h.state.opportunitiesLoading, false); assert.equal(h.render().props.disabled, false);
  assert.match(text(renderEmpty(h.state)), /Leads could not be loaded/); assert.doesNotMatch(text(renderEmpty(h.state)), /No opportunities assigned/);
  fail = false; h.render().props.onClick(); await flush(); assert.equal(h.state.opportunityLoadError, ''); h.cleanup();
});

test('refresh retains an explicitly opened match outside the broad inbox and replaces it when returned', async () => {
  let returned = [lead('new')]; const h = harness(async () => response(returned));
  h.exactOpportunityMatchId.current = 'exact'; h.state.opportunities = [lead('exact')]; await h.mount();
  assert.deepEqual(h.state.opportunities.map(item => item.matchId), ['exact', 'new']);
  returned = [{ ...lead('exact'), title: 'Updated exact match' }]; await h.refresh();
  assert.equal(h.state.opportunities.length, 1); assert.equal(h.state.opportunities[0].title, 'Updated exact match'); h.cleanup();
});

test('identity changes abort the old request and ignore late results without clearing the newer loading state', async () => {
  const first = deferred(), second = deferred(); let attempt = 0;
  const h = harness(async () => ++attempt === 1 ? first.promise : second.promise, { activeWorkView: 'leads' });
  h.render(); await flush(); const oldSignal = h.requests[0].init.signal;
  h.protectedIdentityUid.current = 'trade-b'; h.protectedIdentityRevision.current++;
  h.render({ user: { uid: 'trade-b', getIdToken: async () => 'token-b' } }); await flush();
  assert.equal(oldSignal.aborted, true); assert.equal(h.requests.length, 2);
  first.resolve(response([lead('private-trade-a')])); await flush();
  assert.deepEqual(h.state.opportunities, []); assert.equal(h.state.opportunitiesLoading, true);
  second.resolve(response([lead('private-trade-b')])); await flush();
  assert.equal(h.state.opportunities[0].matchId, 'private-trade-b'); assert.equal(h.state.opportunitiesLoading, false); h.cleanup();
});

test('a stale token callback cannot start a request after identity revocation and unmount ignores late failures', async () => {
  const token = deferred(); const h = harness(undefined, { user: { uid: 'trade-a', getIdToken: () => token.promise } });
  h.render(); h.protectedIdentityUid.current = null; h.protectedIdentityRevision.current++; token.resolve('old-token'); await flush();
  assert.equal(h.requests.length, 0); h.cleanup();
  const pending = deferred(); const mounted = harness(async () => pending.promise, { activeWorkView: 'leads' });
  mounted.render(); await flush(); const signal = mounted.requests[0].init.signal; mounted.cleanup(); const writes = mounted.writes.length;
  pending.reject(Error('Late failure')); await flush();
  assert.equal(signal.aborted, true); assert.equal(mounted.writes.length, writes); assert.equal(mounted.events.size, 0); assert.equal(mounted.protectedOpportunityRequestControllers.current.size, 0);
});

test('supplier, unavailable entitlement and mismatched identity cannot fetch protected leads', async () => {
  for (const blocked of [{ ...profile, partnerType: 'supplier' }, { ...profile, entitlements: { features: { installer_leads: false } } }, null]) {
    const h = harness(undefined, { profile: blocked, activeWorkView: 'leads' }); await h.mount(); await h.refresh(); assert.equal(h.requests.length, 0); h.cleanup();
  }
  const h = harness(); h.protectedIdentityUid.current = 'different-account'; await h.mount(); await h.refresh(); assert.equal(h.requests.length, 0); h.cleanup();
});
