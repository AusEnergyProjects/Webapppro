import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const source = readFileSync(new URL('../src/components/CreditexNotifications.tsx', import.meta.url), 'utf8');
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
  const window = { innerWidth: 390, innerHeight: 740, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const focused = [], properties = new Map();
  const trigger = { focus: () => focused.push('trigger'), getBoundingClientRect: () => ({right:58,bottom:170}) };
  const dialog = { focus: () => focused.push('dialog'), offsetWidth:366, style:{setProperty:(key,value)=>properties.set(key,value)} };
  const fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve: data => resolve(Response.json({ ok: true, ...data })), reject }));
  const exported = {};
  new Function('require', 'exports', 'document', 'window', 'fetch', 'setInterval', 'clearInterval', compiled)(name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return jsx;
    if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(name);
  }, exported, document, window, fetch, fn => { intervals.set(++nextInterval, fn); return nextInterval; }, id => intervals.delete(id));
  const user = { uid: 'one', getIdToken: async () => 'token-one' };
  return { user, requests, intervals, listeners, document, exported, focused, properties,
    render(value = user) { cursor = 0; const result = exported.useCreditexNotifications(value); for (const fn of queued.splice(0)) fn(); return result; },
    renderPopover(onOpen = () => true) { cursor = 0; const tree = exported.CreditexNotifications({user,onOpen}); for (const node of nodes(tree,n=>n.props?.ref)) node.props.ref.current = node.type === 'button' ? trigger : dialog; for (const fn of queued.splice(0)) fn(); return tree; },
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

test('bell toggles a compact non-modal dropdown with Escape, outside close and focus restoration', async () => {
  const h=harness(); let tree=h.renderPopover(); await flush(); h.requests[0].resolve(list(3)); await flush(); tree=h.renderPopover();
  const trigger=()=>nodes(tree,n=>n.props?.['aria-haspopup']==='dialog')[0];
  assert.equal(trigger().props['aria-expanded'],false); assert.equal(nodes(tree,n=>n.props?.role==='dialog').length,0);
  trigger().props.onClick();tree=h.renderPopover();
  const dialog=nodes(tree,n=>n.props?.role==='dialog')[0]; assert.ok(dialog);assert.equal(dialog.props['aria-modal'],'false');
  assert.equal(trigger().props['aria-expanded'],true);assert.equal(h.focused.at(-1),'dialog');
  assert.equal(h.properties.get('--notification-offset'),'320px','popover stays inside a narrow screen');
  assert.equal(h.requests.filter(r=>r.options.method==='POST').length,0);
  h.listeners.get('keydown')({key:'Escape',preventDefault(){}});tree=h.renderPopover();assert.equal(trigger().props['aria-expanded'],false);assert.equal(h.focused.at(-1),'trigger');
  trigger().props.onClick();tree=h.renderPopover();nodes(tree,n=>n.props?.className==='dismiss')[0].props.onClick();tree=h.renderPopover();assert.equal(trigger().props['aria-expanded'],false);
  trigger().props.onClick();tree=h.renderPopover();trigger().props.onClick();tree=h.renderPopover();assert.equal(nodes(tree,n=>n.props?.role==='dialog').length,0);
  h.cleanup();assert.equal(h.listeners.size,0);
});

test('opening updates preserves unread receipts; rejected navigation stays open and accepted navigation marks the exact event', async () => {
  const h = harness(); const opened = []; let allow = false;
  const item = { id: 'message:1', type: 'message', title: 'New team message', detail: 'Peer: hello', createdAt: '2026-10-02T01:00:00.000Z', read: false, target: { kind: 'message', peerId: 'peer' } };
  const render=()=>h.renderPopover(target=>{opened.push(target);return allow;});
  let tree=render();await flush();h.requests[0].resolve({...list(1),items:[item]});await flush();tree=render();
  nodes(tree,n=>n.props?.['aria-haspopup']==='dialog')[0].props.onClick();tree=render();
  nodes(tree,n=>n.props?.className==='item unread')[0].props.onClick();tree=render();await flush();
  assert.deepEqual(opened,[item.target]);assert.equal(h.requests.filter(r=>r.options.method==='POST').length,0);assert.ok(nodes(tree,n=>n.props?.role==='dialog')[0]);
  allow=true;nodes(tree,n=>n.props?.className==='item unread')[0].props.onClick();tree=render();await flush();
  assert.equal(nodes(tree,n=>n.props?.role==='dialog').length,0);
  const write=h.requests.find(r=>r.options.method==='POST');assert.deepEqual(JSON.parse(write.options.body),{action:'read',ids:['message:1']});write.resolve({});await flush();h.cleanup();
});

test('Clear marks only shown unread events and leaves read history available',async()=>{
  const h=harness();let tree=h.renderPopover();await flush();
  const item={id:'job:1',title:'Job completed',detail:'Ready for audit',createdAt:'2026-10-02T01:00:00Z',read:false,target:{kind:'job',intentId:'1'}};
  h.requests[0].resolve({...list(2),items:[item,{...item,id:'job:2',read:true}]});await flush();tree=h.renderPopover();
  assert.match(h.requests[0].url,/filter=all/);nodes(tree,n=>n.props?.['aria-haspopup']==='dialog')[0].props.onClick();tree=h.renderPopover();
  nodes(tree,n=>n.type==='button'&&text(n)==='Clear')[0].props.onClick();await flush();
  const write=h.requests.find(r=>r.options.method==='POST');assert.deepEqual(JSON.parse(write.options.body),{action:'read',ids:['job:1']});write.resolve({});await flush();h.cleanup();
});
