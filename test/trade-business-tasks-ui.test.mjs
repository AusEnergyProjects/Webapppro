import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as tasks from '../src/lib/trade-business-tasks.ts';

const source = fs.readFileSync(new URL('../src/components/TradeTasksWorkspace.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, draft) {
  let cursor = 0, fail = false, created = 0;
  const state = [], effects = [], pending = [], frames = new Map(), calls = [], exports = {};
  const business = { ownerUid: 'business', memberId: 'staff', role: 'member' };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => state[i] = typeof value === 'function' ? value(state[i]) : value]; },
    useRef(initial) { const i = cursor++; return state[i] ||= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++; if (!state[i] || deps.some((value, n) => value !== state[i].deps[n])) state[i] = { deps, callback }; return state[i].callback; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, n) => value !== old.deps[n])) { old?.cleanup?.(); effects[i] = { deps }; pending.push(() => effects[i].cleanup = callback()); } },
  };
  const response = value => ({ ok: true, json: async () => ({ ok: true, ...value }) });
  const request = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') return fail ? { ok: false, json: async () => ({ error: 'Save failed' }) } : response({});
    return response({ tasks: [], memberId: 'staff', canViewTeam: false, page: 1, total: 0, totalPages: 1 });
  };
  const requestFrame = callback => { const id = frames.size + 1; frames.set(id, callback); return id; };
  const require = id => id === 'react' ? hooks : id === 'react/jsx-runtime' ? jsx : id === './TradeBusinessProvider' ? { useTradeBusiness: () => business, useTradeBusinessFetch: () => request } : id === '@/lib/trade-business-tasks' ? tasks : { default: {} };
  Function('require', 'exports', 'requestAnimationFrame', 'cancelAnimationFrame', 'window', 'document', `${compiled}\nexports.TaskList=TaskList;`)(require, exports, requestFrame, id => frames.delete(id), { setInterval: () => 0, addEventListener() {}, removeEventListener() {} }, { visibilityState: 'visible' });
  const user = { uid: 'staff-user', getIdToken: async () => 'token' };
  const render = () => { cursor = 0; const tree = exports.TaskList({ user, compact: true, draft, onCreated: () => created++ }); for (const effect of pending.splice(0)) effect(); for (const [id, callback] of frames) { frames.delete(id); callback(); } return tree; };
  t.after(() => effects.forEach(effect => effect?.cleanup?.()));
  return { render, calls, created: () => created, fail(value) { fail = value; }, async mount() { render(); await flush(); return render(); } };
}

test('delivery handover preserves task content, retries one task id and uses only the existing task API', async t => {
  const draft = { key: 'delivery:1', title: 'Review invoice email for JOB-1', detail: 'Check Sent mail before retrying.\nJob: /direct-trade/dashboard?workspace=work&jobId=job-1&jobTab=invoice&business=business' };
  const f = fixture(t, draft); let tree = await f.mount();
  assert.equal(nodes(tree, n => n.type === 'input' && n.props.maxLength === 180)[0].props.value, draft.title);
  assert.equal(nodes(tree, n => n.type === 'textarea')[0].props.value, draft.detail);
  f.fail(true); nodes(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await flush(); tree = f.render();
  assert.equal(f.created(), 0);
  f.fail(false); nodes(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await flush(); f.render();
  const writes = f.calls.filter(c => c.options.method === 'POST');
  assert.equal(writes.length, 2); assert.ok(writes.every(c => c.url === '/api/trade-tasks'));
  const first = JSON.parse(writes[0].options.body), retry = JSON.parse(writes[1].options.body);
  assert.deepEqual(first, retry); assert.equal(first.action, 'create'); assert.equal(first.assigneeMemberId, 'staff');
  assert.equal(first.title, draft.title); assert.equal(first.detail, draft.detail); assert.equal(f.created(), 1);
  assert.equal(new Set(f.calls.map(c => c.url)).size, 2, 'only task list and task save endpoints are used');
});
