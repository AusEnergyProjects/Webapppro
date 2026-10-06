import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as pages from '../src/lib/creditex-form-pages.ts';
import { ENERGY_SERVICE_IDS, ENERGY_SERVICE_LABELS } from '../src/lib/energy-service-catalogue.mjs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function compile(file, imports, window) {
  const compiledModule = { exports: {} };
  const output = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', 'window', output)(name => { assert.ok(imports[name], `Unexpected import: ${name}`); return imports[name]; }, compiledModule, compiledModule.exports, window);
  return compiledModule.exports;
}
const contract = compile('src/lib/trade-business-form-ai.ts', {});
const design = compile('src/lib/trade-business-form-design.ts', {});
const result = { kind: 'draft', questions: [], form: { name: 'Electrical inspection', description: 'Before-work inspection checklist', guidance: 'Record the findings.',
  fields: [{ key: 'notes', label: 'Describe follow-up work', type: 'textarea', required: false, maxLength: 1200, options: [], section: 'Inspection', phase: 'before' }] } };
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const button = (tree, label) => nodes(tree, node => node.type === 'button' && text(node) === label)[0];
const purpose = tree => nodes(tree, node => node.type === 'textarea' && node.props.maxLength === 2000)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ canManage = true, answer = async () => ({ ok: true, result, sourceHash: 'a'.repeat(64) }), confirm = false } = {}) {
  const slots = [], effects = [], calls = []; let cursor = 0, mounted = true, lateWrites = 0, leave, scope;
  let business = { ownerUid: 'business', memberId: 'member' };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { if (!mounted) lateWrites++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, j) => dep !== slots[i].deps[j])) slots[i] = { deps, callback }; return slots[i].callback; },
    useMemo(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, j) => dep !== slots[i].deps[j])) slots[i] = { deps, value: callback() }; return slots[i].value; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, j) => dep !== slots[i].deps[j])) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = callback(); }); } },
  };
  const fetch = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, signal: init.signal });
    const body = path.endsWith('/assist') ? await answer(init) : { canManage, templates: [] };
    return { ok: body.ok !== false, json: async () => body };
  };
  const window = { confirm: () => confirm, addEventListener() {}, removeEventListener() {} };
  const editor = compile('src/components/TradeBusinessFormEditor.tsx', {
    react: hooks, 'react/jsx-runtime': jsx, './TradeBusinessProvider': { useTradeBusinessFetch: () => fetch, useTradeBusiness: () => business },
    './TlinkFormMindMap': { TlinkFormMindMap: 'mind-map' }, './CreditexFormPhonePreview': { CreditexFormPhonePreview: 'phone-preview' },
    '@/lib/trade-business-form-design': design, '@/lib/creditex-form-pages': pages, '@/lib/trade-business-form-ai': contract,
    './TradeFormsWorkspace.module.css': { default: {} }, '@/lib/energy-service-catalogue.mjs': { ENERGY_SERVICE_IDS, ENERGY_SERVICE_LABELS },
  }, window);
  const user = { uid: 'author', getIdToken: async () => 'token' }, register = check => { leave = check; };
  const render = () => {
    cursor = 0; const child = editor.TradeBusinessFormEditor({ user, onRegisterLeave: register });
    if (scope !== undefined && scope !== child.key) { slots.forEach(slot => slot?.cleanup?.()); slots.length = 0; effects.length = 0; }
    scope = child.key; const tree = child.type(child.props); effects.splice(0).forEach(run => run()); return tree;
  };
  return { render, calls, get leave() { return leave; }, get lateWrites() { return lateWrites; }, setBusiness(next) { business = next; }, setConfirm(next) { confirm = next; },
    unmount() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); }, async mount() { render(); await flush(); return render(); } };
}
async function begin(h) {
  let tree = await h.mount(); purpose(tree).props.onChange({ target: { value: 'A before-work electrical inspection for our technicians.' } });
  tree = h.render(); button(tree, 'Generate draft').props.onClick(); await flush(); return h.render();
}

test('generation opens a dirty, reviewable local draft; only the explicit existing Save form publishes', async () => {
  const h = harness(); let tree = await begin(h);
  assert.deepEqual(h.calls.map(call => [call.path, call.method]), [['/api/trade-form-templates', 'GET'], ['/api/trade-form-templates/assist', 'POST']]);
  assert.match(text(tree), /Wattzun draft for review/); assert.match(text(tree), /has not been saved or published/);
  assert.equal(nodes(tree, node => node.type === 'input' && node.props.value === 'Electrical inspection').length, 1);
  await assert.rejects(h.leave(), /Keep editing/);
  button(tree, 'Back to forms').props.onClick(); await flush(); tree = h.render(); assert.ok(button(tree, 'Save form'));
  button(tree, 'Try the form').props.onClick(); tree = h.render(); assert.equal(nodes(tree, node => node.type === 'phone-preview').length, 1);
  assert.equal(h.calls.length, 2);
  button(tree, 'Save form').props.onClick(); await flush(); tree = h.render();
  assert.equal(h.calls[2].path, '/api/trade-form-templates'); assert.equal(h.calls[2].method, 'POST');
  assert.equal(h.calls[2].body.name, 'Electrical inspection'); assert.equal(h.calls[2].body.id, undefined);
  assert.equal(button(tree, 'Save form'), undefined); await h.leave();
});
test('unauthorised readers have no Wattzun drafting entry', async () => {
  const h = harness({ canManage: false }); const tree = await h.mount();
  assert.doesNotMatch(text(tree), /Draft with Wattzun/); assert.equal(button(tree, 'Generate draft'), undefined);
  assert.equal(h.calls.length, 1);
});
test('clarification keeps the brief editable and never opens or saves a form', async () => {
  const h = harness({ answer: async () => ({ ok: true, result: { kind: 'clarify', questions: ['Who will complete this form?'], form: null }, sourceHash: 'a'.repeat(64) }) });
  const tree = await begin(h); assert.match(text(tree), /Who will complete this form/); assert.ok(button(tree, 'Generate again'));
  assert.ok(purpose(tree).props.value); assert.equal(button(tree, 'Save form'), undefined); assert.equal(h.calls.length, 2);
});
test('pending generation blocks navigation and cannot open another draft', async () => {
  let resolve; const h = harness({ answer: () => new Promise(done => { resolve = done; }) });
  let tree = await begin(h); await assert.rejects(h.leave(), /Wait for the form operation/);
  assert.equal(button(tree, 'Create form').props.disabled, true); assert.equal(button(tree, 'Preparing draft...').props.disabled, true);
  resolve({ ok: true, result, sourceHash: 'a'.repeat(64) }); await flush(); tree = h.render(); assert.ok(button(tree, 'Save form'));
});
test('business changes abort pending work and discard the late AI response', async () => {
  let resolve; const h = harness({ answer: () => new Promise(done => { resolve = done; }) });
  await begin(h); const pending = h.calls[1]; h.setBusiness({ ownerUid: 'other', memberId: 'other-member' }); h.render();
  assert.equal(pending.signal.aborted, true); resolve({ ok: true, result, sourceHash: 'a'.repeat(64) }); await flush();
  const tree = h.render(); assert.equal(button(tree, 'Save form'), undefined); assert.doesNotMatch(text(tree), /Electrical inspection/);
});
test('unmount aborts pending generation without late state updates', async () => {
  let resolve; const h = harness({ answer: () => new Promise(done => { resolve = done; }) });
  await begin(h); h.unmount(); resolve({ ok: true, result, sourceHash: 'a'.repeat(64) }); await flush();
  assert.equal(h.calls[1].signal.aborted, true); assert.equal(h.lateWrites, 0);
});
test('failure and malformed generated content keep the supplied purpose and saved forms unchanged', async () => {
  for (const body of [{ ok: false, error: 'Usage limit reached.' }, { ok: true, result: { ...result, form: null }, sourceHash: 'a'.repeat(64) }]) {
    const h = harness({ answer: async () => body }); const tree = await begin(h);
    assert.equal(button(tree, 'Save form'), undefined); assert.ok(purpose(tree).props.value);
    assert.equal(nodes(tree, node => node.props?.role === 'alert').length, 1); assert.equal(h.calls.length, 2);
  }
});
