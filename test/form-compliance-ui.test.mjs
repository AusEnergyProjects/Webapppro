import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as contract from '../src/lib/form-compliance.ts';

const source = fs.readFileSync(new URL('../src/components/FormCompliancePanel.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === 'button' && text(node) === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const template = () => ({ formKey: 'business:inspection', title: 'Inspection', revision: 3, questions: [
  { key: 'identity', label: 'Does the identity match?', required: true, sourceFieldKey: 'customer' },
  { key: 'photo', label: 'Is the equipment photo clear?', required: false },
] });
const workspace = () => ({ template: template(), source: { id: 'form1', title: 'Inspection', revision: 5, hash: 'a'.repeat(64), answers: [{ key: 'customer', label: 'Customer name', value: 'Synthetic customer' }] }, review: null, canReview: true, stale: false });
function harness(name, props, handler) {
  const slots = [], pending = [], calls = [], dirty = [];
  let cursor = 0, mounted = true, lateWrites = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { if (!mounted) lateWrites++; slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, j) => dep !== slots[i].deps[j])) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, j) => dep !== slots[i].deps[j])) { slots[i]?.cleanup?.(); slots[i] = { deps }; pending.push(() => { slots[i].cleanup = fn(); }); } },
  };
  const api = async (path, init = {}) => { const call = { path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined }; calls.push(call); return handler(call); };
  const scopedFetch = async (path, init) => { const body = await api(path, init); return { ok: body.ok !== false, json: async () => body }; };
  const exports = {};
  const window = { addEventListener() {}, removeEventListener() {}, confirm: () => false };
  Function('require', 'exports', 'window', 'crypto', code)(id => id === 'react' ? hooks : id === 'react/jsx-runtime' ? jsx : id === '@/lib/form-compliance' ? contract : id === './TradeBusinessProvider' ? { useTradeBusinessFetch: () => scopedFetch } : id.endsWith('.module.css') ? { default: {} } : (() => { throw Error(id); })(), exports, window, { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
  const render = () => { cursor = 0; const tree = exports[name]({ ...props, api, onDirtyChange: value => dirty.push(value) }); pending.splice(0).forEach(run => run()); return tree; };
  return { render, calls, dirty, get lateWrites() { return lateWrites; }, async mount() { render(); await flush(); return render(); }, unmount() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); } };
}

test('question editor saves the edited order and requirements using the loaded revision', async () => {
  const h = harness('FormComplianceEditor', { scope: 'business', formKey: 'business:inspection' }, call => call.method === 'GET' ? { ok: true, template: template(), canManage: true } : { ok: true, template: { ...template(), revision: 4, questions: call.body.questions } });
  let tree = await h.mount();
  const question = nodes(tree, node => node.type === 'textarea' && node.props['aria-label'] === 'Compliance check 1')[0];
  assert.equal(question.props.rows, 2, 'Long compliance questions wrap instead of disappearing beyond a single-line field');
  assert.equal(question.props.maxLength, 300);
  question.props.onChange({ target: { value: 'Does the name match the signed document?' } });
  tree = h.render();
  nodes(tree, node => node.type === 'button' && node.props['aria-label'] === 'Move compliance check 1 down')[0].props.onClick();
  tree = h.render();
  const requirement = nodes(tree, node => node.type === 'input' && node.props.type === 'checkbox')[0];
  requirement.props.onChange({ target: { checked: true } });
  tree = h.render(); button(tree, 'Save compliance questions').props.onClick(); await flush(); tree = h.render();
  assert.equal(h.calls[1].body.expectedRevision, 3);
  assert.deepEqual(h.calls[1].body.questions.map(q => [q.key, q.label, q.required]), [['photo', 'Is the equipment photo clear?', true], ['identity', 'Does the name match the signed document?', true]]);
  assert.equal(h.calls[1].body.formKey, 'business:inspection');
  assert.match(text(tree), /Version 4/); assert.match(text(tree), /questionnaire saved/);
  assert.ok(h.dirty.includes(true)); assert.equal(h.dirty.at(-1), false); h.unmount();
});

test('question editor can add and remove checks without writing installer forms', async () => {
  const h = harness('FormComplianceEditor', { scope: 'creditex', formKey: 'activity:veu-6:', actorMode: 'admin' }, call => call.method === 'GET' ? { ok: true, template: { ...template(), formKey: 'activity:veu-6:' }, canManage: true } : { ok: true, template: { ...template(), formKey: 'activity:veu-6:', questions: call.body.questions } });
  let tree = await h.mount(); button(tree, 'Add check').props.onClick(); tree = h.render();
  assert.equal(nodes(tree, node => node.type === 'textarea' && node.props.maxLength === 300).length, 3);
  button(tree, 'Remove').props.onClick(); tree = h.render(); button(tree, 'Save compliance questions').props.onClick(); await flush(); h.render();
  assert.equal(h.calls[1].body.questions.length, 2); assert.ok(h.calls[1].body.questions.some(q => q.key.startsWith('check_')));
  assert.ok(h.calls.every(call => call.path.startsWith('/api/form-compliance?') && call.path.includes('actorMode=admin'))); h.unmount();
});

test('read-only questionnaire has disabled editing and no save controls', async () => {
  const h = harness('FormComplianceEditor', { scope: 'business', formKey: 'business:inspection' }, () => ({ ok: true, template: template(), canManage: false }));
  const tree = await h.mount(); assert.equal(nodes(tree, node => node.type === 'fieldset')[0].props.disabled, true);
  assert.equal(button(tree, 'Save compliance questions'), undefined); assert.equal(button(tree, 'Add check'), undefined); assert.equal(h.calls.length, 1); h.unmount();
});

test('stale reviewed answers reset to unchecked before the changed work is reviewed', async () => {
  const data = workspace(); data.stale = true; data.review = { revision: 2, status: 'complete', actorName: 'Previous reviewer', createdAt: '2026-10-10', sourceHash: 'b'.repeat(64), templateRevision: 2, answers: data.template.questions.map(q => ({ key: q.key, response: 'pass', note: 'Old answer' })) };
  const h = harness('FormComplianceReview', { scope: 'business', target: { workOrderId: 'job1', formId: 'form1' } }, () => ({ ok: true, workspace: data }));
  const tree = await h.mount();
  assert.match(text(tree), /Needs a fresh review/); assert.equal(button(tree, 'Complete compliance review').props.disabled, true);
  assert.equal(nodes(tree, node => node.type === 'button' && text(node) === 'Not checked' && node.props['aria-pressed']).length, 2);
  assert.equal(nodes(tree, node => node.type === 'textarea' && node.props.value === 'Old answer').length, 0); h.unmount();
});

test('completion requires a reason for not applicable and rejects any failed check', async () => {
  const h = harness('FormComplianceReview', { scope: 'business', target: { workOrderId: 'job1', formId: 'form1' } }, call => {
    const data = workspace(); if (call.method === 'POST') data.review = { revision: 1, status: call.body.status, actorName: 'Reviewer', createdAt: '2026-10-12', sourceHash: data.source.hash, templateRevision: 3, answers: call.body.answers }; return { ok: true, workspace: data };
  });
  let tree = await h.mount(); button(tree, 'Not applicable').props.onClick(); tree = h.render(); assert.equal(button(tree, 'Complete compliance review').props.disabled, true);
  nodes(tree, node => node.type === 'textarea')[0].props.onChange({ target: { value: 'Customer declined the optional phone call; evidence was reviewed.' } });
  tree = h.render(); assert.equal(button(tree, 'Complete compliance review').props.disabled, false);
  nodes(tree, node => node.type === 'button' && text(node) === 'Needs fixing')[1].props.onClick(); tree = h.render(); assert.equal(button(tree, 'Complete compliance review').props.disabled, true);
  nodes(tree, node => node.type === 'button' && text(node) === 'Pass')[1].props.onClick(); tree = h.render(); button(tree, 'Complete compliance review').props.onClick(); await flush(); tree = h.render();
  assert.equal(h.calls[1].body.expectedSourceHash, 'a'.repeat(64)); assert.equal(h.calls[1].body.expectedRevision, 0); assert.equal(h.calls[1].body.templateRevision, 3); assert.equal(h.calls[1].body.status, 'complete');
  assert.match(text(tree), /review completed and saved/); assert.equal(h.dirty.at(-1), false); h.unmount();
});

test('save conflict leaves current reviewer answers intact and reports the error', async () => {
  const h = harness('FormComplianceReview', { scope: 'creditex', target: { intentId: 'intent1', recordId: 'record1', recordKind: 'field' } }, call => call.method === 'GET' ? { ok: true, workspace: workspace() } : { ok: false, error: 'The evidence changed. Refresh before saving.' });
  let tree = await h.mount(); button(tree, 'Pass').props.onClick(); tree = h.render(); button(tree, 'Save review draft').props.onClick(); await flush(); tree = h.render();
  assert.match(text(tree), /evidence changed/); assert.equal(button(tree, 'Pass').props['aria-pressed'], true); assert.ok(h.dirty.at(-1));
  assert.equal(h.calls[1].body.recordKind, 'field'); assert.ok(h.calls[1].path.includes('actorMode=compliance')); h.unmount();
});

test('late load and save responses cannot write state after leaving compliance', async () => {
  let resolveLoad;
  const loading = harness('FormComplianceEditor', { scope: 'business', formKey: 'business:inspection' }, () => new Promise(resolve => { resolveLoad = resolve; }));
  loading.render(); loading.unmount(); resolveLoad({ ok: true, template: template(), canManage: true }); await flush(); assert.equal(loading.lateWrites, 0);
  let resolveSave;
  const saving = harness('FormComplianceReview', { scope: 'business', target: { workOrderId: 'job1', formId: 'form1' } }, call => call.method === 'GET' ? { ok: true, workspace: workspace() } : new Promise(resolve => { resolveSave = resolve; }));
  const tree = await saving.mount(); button(tree, 'Save review draft').props.onClick(); saving.render(); saving.unmount(); resolveSave({ ok: true, workspace: workspace() }); await flush(); assert.equal(saving.lateWrites, 0);
});

test('business review pagination preserves search and can return to earlier forms', async () => {
  const h = harness('TradeFormComplianceWorkflow', { user: { getIdToken: async () => 'fixture-token' } }, call => {
    const params = new URL(call.path, 'https://example.test').searchParams;
    const second = params.has('cursor');
    return { ok: true, items: [{ formId: second ? 'old-form' : 'recent-form', workOrderId: 'job1', title: params.get('q') || (second ? 'Older inspection' : 'Recent inspection'), jobNumber: 'TLJ-SYNTHETIC', status: 'not_started' }], nextCursor: second ? null : 'opaque-next-page' };
  });
  let tree = await h.mount(); assert.equal(button(tree, 'Previous').props.disabled, true);
  button(tree, 'Next').props.onClick(); await flush(); tree = h.render();
  assert.match(text(tree), /Older inspection/); assert.match(text(tree), /Page\s+2/); assert.equal(button(tree, 'Next').props.disabled, true);
  assert.equal(new URL(h.calls[1].path, 'https://example.test').searchParams.get('cursor'), 'opaque-next-page');
  button(tree, 'Previous').props.onClick(); await flush(); tree = h.render(); assert.match(text(tree), /Recent inspection/);
  nodes(tree, node => node.type === 'input' && node.props.type === 'search')[0].props.onChange({ target: { value: '  Earlier safety check  ' } }); tree = h.render();
  nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await flush(); tree = h.render();
  const params = new URL(h.calls.at(-1).path, 'https://example.test').searchParams;
  assert.equal(params.get('q'), 'Earlier safety check'); assert.equal(params.has('cursor'), false); assert.match(text(tree), /Page\s+1/); h.unmount();
});

test('leaving a dirty business compliance review needs a deliberate discard', async () => {
  let registered;
  const h = harness('TradeFormComplianceWorkflow', { user: { getIdToken: async () => 'fixture-token' }, onRegisterLeave: check => { registered = check; } }, () => ({ ok: true, items: [{ formId: 'form1', workOrderId: 'job1', title: 'Inspection', jobNumber: 'TLJ-SYNTHETIC', status: 'draft' }], nextCursor: null }));
  let tree = await h.mount(); button(tree, 'Review compliance').props.onClick(); tree = h.render();
  const review = nodes(tree, node => node.type?.name === 'FormComplianceReview')[0];
  assert.deepEqual(review.props.target, { workOrderId: 'job1', formId: 'form1' }); review.props.onDirtyChange(true); tree = h.render();
  await assert.rejects(registered(), /Keep reviewing/); button(tree, 'Back to compliance reviews').props.onClick(); await flush(); tree = h.render();
  assert.ok(button(tree, 'Back to compliance reviews')); assert.equal(h.calls.length, 1); h.unmount();
});
