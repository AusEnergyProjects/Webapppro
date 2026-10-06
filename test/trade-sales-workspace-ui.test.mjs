import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as sales from '../src/lib/trade-sales.ts';

const source = fs.readFileSync(new URL('../src/components/TradeSalesWorkspace.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, name) => nodes(tree, node => node.type === 'button' && text(node) === name)[0];
const input = (tree, name) => nodes(tree, node => node.type === 'label' && text(node).replace(/\s+/g, ' ').startsWith(name)).flatMap(label => nodes(label, child => child.type === 'input' || child.type === 'select'))[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const item = (id, overrides = {}) => ({ id, workNumber: `JOB-${id}`, title: `Job ${id}`, customerName: 'Customer One', customerProtected: false, serviceCategory: 'electrical', stageId: 'enquiry', stageName: 'New', status: 'open', ownerMemberId: 'member-1', ownerName: 'Sam', estimatedValueCents: 12500, expectedCloseOn: '2026-10-20', lastContactOn: '', nextAction: 'Call about the site visit', nextActionOn: '2026-10-10', revision: 4, jobRevision: 9, canEdit: true, canEditValue: true, ...overrides });
const config = overrides => ({ ok: true, settings: { revision: 3, stages: [{ id: 'enquiry', name: 'New' }, { id: 'quoting', name: 'Quoting' }] }, owners: [{ id: 'member-1', name: 'Sam' }], permissions: { canManage: true, canViewValues: true, canEditValues: true, canConfigure: true }, ...overrides });
const page = (items = [item('one')], overrides = {}) => ({ ok: true, items, stages: [{ id: 'enquiry', name: 'New', count: items.length }], total: items.length, pageSize: 25, hasNext: false, nextCursor: '', ...overrides });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function harness(responder, props = {}, fakeClock = false) {
  let cursor = 0, business = { ownerUid: 'owner-1', memberId: 'member-1', role: 'owner' }, leave, confirms = true;
  const state = [], effects = [], memos = [], pending = [], requests = [], opened = [];
  let created = 0, reviewed = 0;
  const user = { uid: 'owner-1', getIdToken: async () => 'token' };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], next => state[i] = typeof next === 'function' ? next(state[i]) : next]; },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useMemo(callback, deps) { const i = cursor++, old = memos[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) memos[i] = { deps, value: callback() }; return memos[i].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) { old?.cleanup?.(); effects[i] = { deps }; pending.push(() => effects[i].cleanup = callback()); } },
  };
  const fetch = async (url, init) => { requests.push({ url, init, ownerUid: business.ownerUid }); return responder(url, init, business.ownerUid); };
  const require = id => id === 'react' ? hooks : id === 'react/jsx-runtime' ? jsx : id === '@/lib/trade-sales' ? sales : id === './TradeBusinessProvider' ? { useTradeBusinessFetch: () => fetch, useTradeBusiness: () => business } : { default: {} };
  const register = check => leave = check;
  const window = { confirm: () => confirms, addEventListener() {}, removeEventListener() {} };
  const timers = new Map(); let timerId = 0;
  const schedule = fakeClock ? (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; } : setTimeout;
  const cancel = fakeClock ? id => timers.delete(id) : clearTimeout;
  const exports = {};
  Function('require', 'exports', 'window', 'document', 'HTMLElement', 'setTimeout', 'clearTimeout', compiled)(require, exports, window, { activeElement: null }, class {}, schedule, cancel);
  const render = () => {
    cursor = 0;
    const tree = exports.TradeSalesWorkspace({ user, onOpenJob: (id, tab) => opened.push({ id, tab }), onNewQuote: () => created++, onReviewSuppliedLeads: () => reviewed++, onRegisterLeave: register, ...props });
    for (const effect of pending.splice(0)) effect();
    return tree;
  };
  const settle = async () => { for (let i = 0; i < 4; i++) { render(); await flush(); } return render(); };
  return { render, settle, requests, opened, expireTimers(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } }, setBusiness(ownerUid) { business = { ...business, ownerUid }; }, setConfirm(value) { confirms = value; }, get leave() { return leave; }, get created() { return created; }, get reviewed() { return reviewed; }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}
const defaultResponder = async (url, init) => init.method === 'PATCH' ? response({ ok: true }) : response(new URL(url, 'https://tlink.test').searchParams.get('mode') === 'config' ? config() : page(new URL(url, 'https://tlink.test').searchParams.get('stage') === 'quoting' ? [] : [item('one')]));

test('sales shows existing jobs, exact value basis and missing contact without inventing contact history', async t => {
  const h = harness(defaultResponder, { suppliedLeads: [{ id: 'teaser', title: 'Air conditioning enquiry', detail: 'Geelong VIC' }] }); t.after(() => h.cleanup());
  const tree = await h.settle();
  assert.match(text(tree), /JOB-one/); assert.match(text(tree), /Owner Sam/); assert.match(text(tree), /Estimated value excl GST \$125\.00/);
  assert.match(text(tree), /Expected close 20 Oct 2026/); assert.match(text(tree), /Last recorded contact No contact recorded/);
  assert.match(text(tree), /Call about the site visit.*Due 10 Oct 2026/);
  assert.equal(h.requests[0].init.headers.Authorization, 'Bearer token'); assert.equal(h.requests[0].init.cache, 'no-store');
  const stage = nodes(tree, node => node.type === 'select' && node.props['aria-label'] === 'Stage for JOB-one')[0];
  assert.deepEqual(nodes(stage, node => node.type === 'option').map(node => node.props.value), ['enquiry', 'quoting']);
  button(tree, 'Open job').props.onClick(); button(tree, 'Open quote').props.onClick(); button(tree, 'New quote').props.onClick(); button(tree, 'Review supplied leads').props.onClick(); await flush();
  assert.deepEqual(h.opened, [{ id: 'one', tab: 'summary' }, { id: 'one', tab: 'quote' }]); assert.equal(h.created, 1); assert.equal(h.reviewed, 1);
  assert.match(text(tree), /Air conditioning enquiry Geelong VIC/);
});

test('each board stage reaches records beyond 25 using its own continuation cursor', async t => {
  const h = harness(async url => {
    const p = new URL(url, 'https://tlink.test').searchParams;
    if (p.get('mode') === 'config') return response(config());
    if (p.get('stage') === 'quoting') return response(page([]));
    return response(p.get('cursor') ? page([item('last')], { total: 26 }) : page(Array.from({ length: 25 }, (_, i) => item(String(i))), { total: 26, hasNext: true, nextCursor: 'new-stage-cursor' }));
  }); t.after(() => h.cleanup());
  let tree = await h.settle(); assert.equal(nodes(tree, node => node.props?.role === 'listitem').length, 25);
  nodes(tree, node => node.type === 'button' && text(node).startsWith('Load more'))[0].props.onClick(); tree = await h.settle();
  const p = new URL(h.requests.at(-1).url, 'https://tlink.test').searchParams;
  assert.equal(p.get('stage'), 'enquiry'); assert.equal(p.get('cursor'), 'new-stage-cursor'); assert.equal(p.get('pageSize'), '25');
  assert.equal(nodes(tree, node => node.props?.role === 'listitem').length, 26); assert.match(text(tree), /26\s+of\s+26\s+shown/);
});

test('keyboard stage movement sends both saved revisions and a failed write keeps the saved stage', async t => {
  const h = harness(async (url, init) => init.method === 'PATCH' ? response({ ok: false, code: 'REVISION_CONFLICT', error: 'Changed' }, 409) : defaultResponder(url, init)); t.after(() => h.cleanup());
  let tree = await h.settle();
  nodes(tree, node => node.type === 'select' && node.props['aria-label'] === 'Stage for JOB-one')[0].props.onChange({ target: { value: 'quoting' } }); tree = await h.settle();
  const body = JSON.parse(h.requests.find(request => request.init.method === 'PATCH').init.body);
  assert.deepEqual(body, { action: 'update', workOrderId: 'one', expectedRevision: 4, expectedJobRevision: 9, stageId: 'quoting' });
  assert.match(text(tree), /record changed since you opened it/); assert.ok(button(tree, 'Refresh saved records'));
  assert.equal(nodes(tree, node => node.type === 'select' && node.props['aria-label'] === 'Stage for JOB-one')[0].props.value, 'enquiry');
  assert.match(text(tree), /JOB-one/); assert.doesNotMatch(text(tree), /Sales details saved/);
});

test('edit conflict blocks another save, preserves draft and offers explicit refresh', async t => {
  const h = harness(async (url, init) => init.method === 'PATCH' ? response({ ok: false, code: 'REVISION_CONFLICT' }, 409) : defaultResponder(url, init)); t.after(() => h.cleanup());
  let tree = await h.settle(); button(tree, 'Edit sales details').props.onClick(); tree = h.render();
  input(tree, 'Next action date').props.onChange({ target: { value: '2026-11-10' } }); tree = h.render();
  nodes(tree, node => node.type === 'dialog')[0].props.children[1].props.onSubmit({ preventDefault() {} }); tree = await h.settle();
  assert.equal(input(tree, 'Next action date').props.value, '2026-11-10');
  assert.equal(button(tree, 'Save sales details'), undefined); assert.ok(button(tree, 'Refresh saved record'));
  h.setConfirm(false); button(tree, 'Refresh saved record').props.onClick(); await flush(); tree = h.render(); assert.ok(nodes(tree, node => node.type === 'dialog')[0]);
  h.setConfirm(true); button(tree, 'Refresh saved record').props.onClick(); tree = await h.settle(); assert.equal(nodes(tree, node => node.type === 'dialog').length, 0);
});

test('sales drafts register an actual leave guard and preserve recorded contact dates on unrelated edits', async t => {
  const contact = '2026-10-01';
  const h = harness(async (url, init) => init.method === 'PATCH' ? response({ ok: true }) : response(new URL(url, 'https://tlink.test').searchParams.get('mode') === 'config' ? config() : page(new URL(url, 'https://tlink.test').searchParams.get('stage') === 'quoting' ? [] : [item('one', { lastContactOn: contact })]))); t.after(() => h.cleanup());
  let tree = await h.settle(); button(tree, 'Edit sales details').props.onClick(); tree = h.render();
  input(tree, 'Next action date').props.onChange({ target: { value: '2026-11-10' } }); tree = h.render();
  h.setConfirm(false); await assert.rejects(h.leave(), /Keep editing/);
  nodes(tree, node => node.type === 'dialog')[0].props.children[1].props.onSubmit({ preventDefault() {} }); tree = await h.settle();
  const body = JSON.parse(h.requests.find(request => request.init.method === 'PATCH').init.body);
  assert.equal(body.lastContactOn, contact); assert.equal(body.nextActionOn, '2026-11-10'); assert.equal('estimatedValueCents' in body, false);
  assert.match(text(tree), /Sales details saved/);
});

test('protected customers and values remain labelled, outcomes are read only and missing estimates remain explicit', async t => {
  const h = harness(async url => {
    const p = new URL(url, 'https://tlink.test').searchParams;
    return response(p.get('mode') === 'config' ? config({ permissions: { canManage: false, canViewValues: false, canEditValues: false, canConfigure: false } }) : page(p.get('stage') === 'quoting' ? [] : [item('one', { title: 'Protected job', customerName: '', customerProtected: true, estimatedValueCents: null, canEdit: false, canEditValue: false })]));
  }); t.after(() => h.cleanup());
  const tree = await h.settle(); assert.match(text(tree), /Customer details protected/); assert.match(text(tree), /Value protected/); assert.doesNotMatch(text(tree), /\$125|Customer One/);
  assert.equal(button(tree, 'Edit sales details'), undefined); assert.equal(button(tree, 'New quote'), undefined); assert.equal(button(tree, 'Manage stages'), undefined);
});

test('list failures and missing cursors show errors instead of successful empty opportunities', async t => {
  let fail = false;
  const h = harness(async (url, init) => {
    const p = new URL(url, 'https://tlink.test').searchParams;
    if (p.get('mode') === 'config') return response(config());
    if (fail) return response({ ok: false, error: 'Sales unavailable' }, 503);
    return defaultResponder(url, init);
  }); t.after(() => h.cleanup());
  let tree = await h.settle(); fail = true; button(tree, 'List').props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Sales unavailable/); assert.doesNotMatch(text(tree), /No opportunities|JOB-one/); assert.ok(button(tree, 'Try again'));
  fail = false; button(tree, 'Try again').props.onClick(); tree = await h.settle(); assert.match(text(tree), /JOB-one/);
  const broken = harness(async url => response(new URL(url, 'https://tlink.test').searchParams.get('mode') === 'config' ? config() : page([], { total: 26, hasNext: true, nextCursor: '' }))); t.after(() => broken.cleanup());
  tree = await broken.settle(); assert.match(text(tree), /sales list could not be loaded/); assert.doesNotMatch(text(tree), /No opportunities match/);
});

test('business changes abort old reads and immediately hide previous records and unsaved customer drafts', async t => {
  const h = harness(defaultResponder); t.after(() => h.cleanup());
  let tree = await h.settle(); button(tree, 'Edit sales details').props.onClick(); tree = h.render();
  h.setBusiness('owner-2'); tree = h.render(); assert.doesNotMatch(text(tree), /JOB-one|Customer One|\$125/); assert.equal(nodes(tree, node => node.type === 'dialog').length, 0);
  h.setBusiness('owner-1'); tree = h.render(); assert.equal(nodes(tree, node => node.type === 'dialog').length, 0);
  const releases = [];
  const delayed = harness(async (url, init, ownerUid) => new URL(url, 'https://tlink.test').searchParams.get('mode') !== 'config' && ownerUid === 'owner-1' ? new Promise(resolve => releases.push(resolve)) : defaultResponder(url, init)); t.after(() => delayed.cleanup());
  await delayed.settle(); delayed.setBusiness('owner-2'); tree = await delayed.settle();
  for (const old of delayed.requests.filter(request => request.ownerUid === 'owner-1')) assert.equal(old.init.signal.aborted, true);
  for (const release of releases) release(response(page([item('old-response')]))); await flush(); tree = delayed.render();
  assert.doesNotMatch(text(tree), /JOB-old-response/);
});

test('stage management retains stage identities and saves configured ordering with a settings revision', async t => {
  const h = harness(defaultResponder); t.after(() => h.cleanup());
  let tree = await h.settle(); button(tree, 'Manage stages').props.onClick(); tree = h.render();
  nodes(tree, node => node.type === 'button' && node.props['aria-label'] === 'Move Quoting up')[0].props.onClick(); tree = h.render();
  input(tree, 'Stage 1').props.onChange({ target: { value: 'Pricing' } }); tree = h.render();
  nodes(tree, node => node.type === 'dialog')[0].props.children[2].props.onSubmit({ preventDefault() {} }); tree = await h.settle();
  const body = JSON.parse(h.requests.find(request => request.init.method === 'PATCH').init.body);
  assert.deepEqual(body, { action: 'save_stages', expectedRevision: 3, stages: [{ id: 'quoting', name: 'Pricing' }, { id: 'enquiry', name: 'New' }] });
  assert.match(text(tree), /Sales stages saved/);
});

test('supplied-lead loading and failures never become a false no-leads success', async t => {
  for (const props of [{ suppliedLeadsLoading: true }, { suppliedLeadsError: 'Lead list unavailable' }]) {
    const h = harness(defaultResponder, props); t.after(() => h.cleanup()); const tree = await h.settle();
    assert.doesNotMatch(text(tree), /No supplied leads awaiting review/);
    assert.match(text(tree), props.suppliedLeadsLoading ? /Loading supplied leads/ : /Lead list unavailable/);
  }
});

test('a manually recorded contact stays date only and a deliberately cleared estimate saves zero', async t => {
  const h = harness(defaultResponder); t.after(() => h.cleanup());
  let tree = await h.settle(); button(tree, 'Edit sales details').props.onClick(); tree = h.render();
  input(tree, 'Last recorded contact').props.onChange({ target: { value: '2026-10-01' } });
  input(tree, 'Estimated value excl GST (AUD)').props.onChange({ target: { value: '' } }); tree = h.render();
  nodes(tree, node => node.type === 'dialog')[0].props.children[1].props.onSubmit({ preventDefault() {} }); await h.settle();
  const body = JSON.parse(h.requests.find(request => request.init.method === 'PATCH').init.body);
  assert.equal(body.lastContactOn, '2026-10-01'); assert.equal('lastContactAt' in body, false); assert.equal(body.estimatedValueCents, 0);
});

test('quick filters query the complete server list and reset a prior continuation', async t => {
  const h = harness(async url => {
    const p = new URL(url, 'https://tlink.test').searchParams;
    return response(p.get('mode') === 'config' ? config() : page([item('one')], { total: 26, hasNext: true, nextCursor: 'previous-view' }));
  }); t.after(() => h.cleanup());
  let tree = await h.settle(); button(tree, 'List').props.onClick(); tree = await h.settle();
  nodes(tree, node => node.type === 'button' && text(node).startsWith('Load more'))[0].props.onClick(); tree = await h.settle();
  input(tree, 'Owner').props.onChange({ target: { value: 'member-1' } }); tree = await h.settle();
  input(tree, 'Find an opportunity').props.onChange({ target: { value: '  Existing job  ' } }); tree = h.render();
  nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); tree = await h.settle();
  const needs = nodes(tree, node => node.type === 'input' && node.props.type === 'checkbox')[0]; needs.props.onChange({ target: { checked: true } }); await h.settle();
  const p = new URL(h.requests.at(-1).url, 'https://tlink.test').searchParams;
  assert.equal(p.get('owner'), 'member-1'); assert.equal(p.get('search'), 'Existing job'); assert.equal(p.get('needsNextAction'), '1'); assert.equal(p.has('cursor'), false); assert.equal(p.has('stage'), false);
});

test('won and lost views show actual outcomes without an editable stage or a close-deal action', async t => {
  const h = harness(async url => {
    const p = new URL(url, 'https://tlink.test').searchParams;
    if (p.get('mode') === 'config') return response(config());
    const status = p.get('status');
    return response(page([item('outcome', { status, stageId: status, stageName: status === 'won' ? 'Won' : 'Lost', canEdit: false, canEditValue: false })]));
  }); t.after(() => h.cleanup());
  let tree = await h.settle();
  for (const status of ['won', 'lost']) {
    input(tree, 'Show').props.onChange({ target: { value: status } }); tree = await h.settle();
    assert.match(text(tree), /Recorded outcome/); assert.equal(button(tree, 'Edit sales details'), undefined);
    assert.equal(nodes(tree, node => node.type === 'select' && node.props['aria-label'] === 'Stage for JOB-outcome').length, 0);
    const p = new URL(h.requests.at(-1).url, 'https://tlink.test').searchParams; assert.equal(p.get('status'), status); assert.equal(p.get('stage'), status);
  }
});

test('a partial board timeout keeps the completed column and renders the stalled column error without crashing', async t => {
  let release;
  const h = harness(async (url, init) => new URL(url, 'https://tlink.test').searchParams.get('stage') === 'quoting' ? new Promise(resolve => release = resolve) : defaultResponder(url, init), {}, true); t.after(() => h.cleanup());
  let tree = await h.settle(); assert.match(text(tree), /JOB-one/); assert.match(text(tree), /Loading\s+quoting/);
  h.expireTimers(25000); tree = h.render();
  const completed = nodes(tree, node => node.type === 'section' && node.props['aria-label'] === 'New')[0];
  const stalled = nodes(tree, node => node.type === 'section' && node.props['aria-label'] === 'Quoting')[0];
  assert.match(text(completed), /JOB-one/); assert.equal(nodes(completed, node => node.props?.role === 'alert').length, 0);
  assert.match(text(stalled), /Sales took too long to load/); assert.ok(button(stalled, 'Try again')); assert.doesNotMatch(text(stalled), /No opportunities/);
  release(response(page([item('late')]))); await flush(); tree = h.render(); assert.doesNotMatch(text(tree), /JOB-late/);
});

test('a load-more timeout preserves the first page and leaves the same continuation available for retry', async t => {
  const h = harness(async (url, init) => {
    const p = new URL(url, 'https://tlink.test').searchParams;
    if (p.get('mode') === 'config') return response(config());
    if (p.get('stage') === 'quoting') return response(page([]));
    if (p.get('cursor')) return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Request cancelled', 'AbortError')), { once: true }));
    return response(page([item('saved')], { total: 26, hasNext: true, nextCursor: 'still-reachable' }));
  }, {}, true); t.after(() => h.cleanup());
  let tree = await h.settle(); nodes(tree, node => node.type === 'button' && text(node).startsWith('Load more'))[0].props.onClick(); await h.settle();
  h.expireTimers(25000); tree = await h.settle();
  assert.match(text(tree), /JOB-saved/); assert.match(text(tree), /More sales took too long to load/);
  const loadMore = nodes(tree, node => node.type === 'button' && text(node).startsWith('Load more'))[0]; assert.equal(loadMore.props.disabled, false);
  loadMore.props.onClick(); await h.settle(); assert.equal(new URL(h.requests.at(-1).url, 'https://tlink.test').searchParams.get('cursor'), 'still-reachable');
});
