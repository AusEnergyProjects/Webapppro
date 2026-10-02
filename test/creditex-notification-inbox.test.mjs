import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const source = readFileSync(new URL('../src/components/CreditexNotificationInbox.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const slots = [], effects = [], queued = [], intervals = new Map(), listeners = new Map(), requests = [];
  let cursor = 0, nextInterval = 0;
  const changed = (a, b) => !a || a.length !== b.length || b.some((v, i) => !Object.is(v, a[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!changed(effects[i]?.deps, deps)) return; effects[i]?.cleanup?.(); effects[i] = { deps }; queued.push(() => { effects[i].cleanup = fn(); }); },
  };
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve: data => resolve(Response.json({ ok: true, ...data })), reject }));
  const exported = {};
  new Function('require', 'exports', 'document', 'window', 'fetch', 'setInterval', 'clearInterval', compiled)(name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return jsx;
    if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(name);
  }, exported, document, window, fetch, fn => { intervals.set(++nextInterval, fn); return nextInterval; }, id => intervals.delete(id));
  const user = { uid: 'one', getIdToken: async () => 'token-one' };
  return { user, requests, intervals, listeners, document, exported,
    render(value = user) { cursor = 0; const result = exported.useCreditexNotifications(value); for (const fn of queued.splice(0)) fn(); return result; },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}
const list = count => ({ unreadCount: count, total: count, items: [], page: 1, totalPages: 1 });
const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);

test('bell loads while inbox is closed, pauses when hidden and cleans up listeners', async () => {
  const h = harness(); let c = h.render(); assert.equal(c.unreadCount, undefined); await flush();
  assert.equal(h.requests.length, 1); h.requests[0].resolve(list(7)); await flush(); c = h.render(); assert.equal(c.unreadCount, 7);
  h.document.visibilityState = 'hidden'; [...h.intervals.values()][0](); await flush(); assert.equal(h.requests.length, 1);
  h.document.visibilityState = 'visible'; h.listeners.get('visibilitychange')(); await flush(); assert.equal(h.requests.length, 2);
  h.requests[1].reject(new Error('Access changed')); await flush(); c = h.render(); assert.equal(c.unreadCount, undefined); assert.equal(c.error, 'Access changed');
  h.cleanup(); assert.equal(h.intervals.size, 0); assert.equal(h.listeners.size, 0);
});

test('stale responses and previous user notifications cannot cross an identity change', async () => {
  const h = harness(); h.render(); await flush();
  const other = { uid: 'two', getIdToken: async () => 'token-two' };
  let c = h.render(other); await flush(); h.requests[0].resolve(list(99)); await flush(); c = h.render(other); assert.equal(c.unreadCount, undefined);
  h.requests[1].resolve(list(2)); await flush(); c = h.render(other); assert.equal(c.unreadCount, 2);
  c = h.render(h.user); assert.equal(c.unreadCount, undefined); h.cleanup();
});

test('duplicate notification writes are blocked and in-flight reads cannot resurrect old badge counts', async () => {
  const h = harness(); h.render(); await flush(); h.requests[0].resolve(list(3)); await flush(); let c = h.render();
  [...h.intervals.values()][0](); await flush(); const stale = h.requests[1];
  const first = c.update('read', ['message:one']); const second = c.update('read', ['message:one']); await flush();
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 1);
  stale.resolve(list(99)); await flush(); h.requests[2].resolve({}); await Promise.all([first, second]);
  c = h.render(); await flush(); assert.equal(c.unreadCount, 3); h.requests[3].resolve(list(2)); await flush(); c = h.render(); assert.equal(c.unreadCount, 2); h.cleanup();
});

test('opening inbox does not mark all read; guarded navigation and explicit dismissal use exact event IDs', () => {
  const h = harness(); const updates = [], opened = [];
  const item = { id: 'message:1', type: 'message', title: 'New team message', detail: 'Peer: hello', createdAt: '2026-10-02T01:00:00.000Z', read: false, target: { kind: 'message', peerId: 'peer' } };
  const controller = { data: { ...list(1), items: [item] }, filter: 'unread', error: '', busy: false, refresh() {}, setFilter() {}, setPage() {}, update: (...args) => { updates.push(args); } };
  let tree = h.exported.CreditexNotificationInbox({ controller, onOpen: target => { opened.push(target); return false; } });
  assert.equal(updates.length, 0);
  const open = nodes(tree, node => node.type === 'button' && node.props.className === 'open')[0]; open.props.onClick();
  assert.deepEqual(opened, [item.target]); assert.equal(updates.length, 0);
  tree = h.exported.CreditexNotificationInbox({ controller, onOpen: () => true });
  nodes(tree, node => node.type === 'button' && node.props.className === 'open')[0].props.onClick();
  nodes(tree, node => node.type === 'button' && text(node) === 'Dismiss')[0].props.onClick();
  assert.deepEqual(updates, [['read', ['message:1']], ['dismiss', ['message:1']]]);
});
