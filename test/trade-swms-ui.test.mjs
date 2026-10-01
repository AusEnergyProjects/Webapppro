import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { SWMS_TEMPLATE, emptySwmsAnswers } from '../src/lib/trade-swms.ts';

const source = name => fs.readFileSync(new URL(`../src/components/${name}`, import.meta.url), 'utf8');
const nodes = (tree, predicate) => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree)
  ? tree.flatMap(child => nodes(child, predicate))
  : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children);
const button = (tree, label) => nodes(tree, node => node.type === 'button' && text(node) === label)[0];
const field = (tree, index = 0) => nodes(tree, node => node.type === 'textarea')[index];
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const strokes = [{ points: [{ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.8 }] }];
const context = { businessName: 'Example Electrical', abn: '12345678901', workNumber: 'TLJ-007', jobTitle: 'Upgrade switchboard', siteAddress: 'Job site',
  scheduledWorker: { memberId: 'scheduled-worker', name: 'Scheduled teammate', appointmentId: 'visit-7', source: 'appointment' },
  signer: { memberId: 'actual-user', name: 'Actual user' } };
const record = (changes = {}) => ({ id: 'swms-7', workOrderId: 'job-7', templateName: SWMS_TEMPLATE.name, templateVersion: 1,
  status: 'draft', revision: 4, answers: emptySwmsAnswers(), context, signature: null, completedAt: '', pdfUrl: '', createdAt: '', updatedAt: '', ...changes });
const payload = (changes = {}) => ({ ok: true, jobRevision: 17, template: SWMS_TEMPLATE, context, record: null,
  capabilities: { canEdit: true, canSign: true }, ...changes });
const signedRecord = () => record({ status: 'complete', completedAt: '2026-10-02T01:00:00.000Z', pdfUrl: '/api/trade-swms?workOrderId=job-7&download=1',
  signature: { strokes, signerName: 'Original signer', signerMemberId: 'scheduled-worker', signedAt: '2026-10-02T01:00:00.000Z' } });

// The production handlers run with isolated hook state and the same authenticated request boundary.
function hookRuntime() {
  let current;
  const instances = [], writes = [];
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial) {
      const instance = current, index = instance.cursor++;
      if (!(index in instance.slots)) instance.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [instance.slots[index].value, next => {
        writes.push({ instance: instance.name, mounted: instance.mounted });
        instance.slots[index].value = typeof next === 'function' ? next(instance.slots[index].value) : next;
      }];
    },
    useRef(initial) { const index = current.cursor++; if (!(index in current.slots)) current.slots[index] = { current: initial }; return current.slots[index]; },
    useCallback(callback, dependencies) {
      const index = current.cursor++;
      if (!same(current.slots[index]?.dependencies, dependencies)) current.slots[index] = { callback, dependencies };
      return current.slots[index].callback;
    },
    useMemo(factory, dependencies) { return hooks.useCallback(factory, dependencies)(); },
    useEffect(effect, dependencies) {
      const instance = current, index = instance.cursor++;
      if (!same(instance.slots[index]?.dependencies, dependencies)) {
        instance.slots[index]?.cleanup?.();
        instance.slots[index] = { dependencies };
        instance.effects.push(() => { instance.slots[index].cleanup = effect(); });
      }
    },
  };
  const create = (name, component) => {
    const instance = { name, slots: [], effects: [], cursor: 0, mounted: true };
    instances.push(instance);
    return { render(props) {
      current = instance; instance.cursor = 0;
      const tree = component(props);
      instance.effects.splice(0).forEach(effect => effect());
      return tree;
    }, cleanup() { instance.slots.forEach(slot => slot?.cleanup?.()); instance.mounted = false; } };
  };
  return { hooks, create, writes, cleanup() { for (const instance of instances) { instance.slots.forEach(slot => slot?.cleanup?.()); instance.mounted = false; } } };
}

function compile(name, dependencies, globals = {}) {
  const compiled = ts.transpileModule(source(name), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  Function('require', 'exports', ...Object.keys(globals), compiled)(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
    return dependencies[specifier];
  }, exports, ...Object.values(globals));
  return exports;
}

function harness(initial = payload(), options = {}) {
  const runtime = hookRuntime(), requests = [], changes = [], timings = [], completions = [];
  const fetch = async (url, init) => {
    requests.push({ url, ...init });
    return options.request ? options.request(url, init) : Response.json(initial);
  };
  const SignaturePad = () => null;
  const panelModule = compile('TradeSwmsPanel.tsx', {
    react: runtime.hooks, 'react/jsx-runtime': jsx,
    './TradeBusinessProvider': { useTradeBusinessFetch: () => fetch },
    'next/dynamic': { default: () => SignaturePad },
    './TradeWorkTimeTracking': { WorkTimeStatus: () => null, useFormTimeTracking: value => {
      timings.push(value); return { bind: {}, markCompleted: () => completions.push(value.formId) };
    } },
    './TradeSwmsPanel.module.css': { default: {} },
  });
  const panel = runtime.create('panel', panelModule.TradeSwmsPanel);
  let editor, editorKey;
  const props = { user: { uid: 'actual-user', getIdToken: options.getIdToken || (async () => 'user-token') }, workOrderId: 'job-7', readOnly: false,
    onChanged: async () => { changes.push('saved'); await options.onChanged?.(); }, ...options.props };
  const render = () => panel.render(props);
  const renderEditor = () => {
    const element = nodes(render(), node => typeof node.type === 'function' && node.type.name === 'SwmsEditor')[0];
    assert.ok(element, 'The production editor is open');
    if (editorKey !== element.key) { editor?.cleanup(); editorKey = element.key; editor = runtime.create('editor', element.type); }
    return editor.render(element.props);
  };
  return { render, editor: renderEditor, requests, changes, timings, completions, writes: runtime.writes, SignaturePad,
    props, cleanup: () => runtime.cleanup() };
}

async function load(h) { h.render(); await flush(); return h.render(); }
async function open(h) { const tree = await load(h); button(tree, 'Continue SWMS')?.props.onClick(); button(tree, 'View SWMS')?.props.onClick(); return h.editor(); }
function submit(tree) {
  let prevented = false;
  nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
}

test('opening Files only reads SWMS; creation requires the optional Add action and exact current job revision', async t => {
  const h = harness(payload(), { request: async (_url, init) => Response.json(init.method === 'GET' ? payload() : payload({ jobRevision: 18, record: record() })) });
  t.after(h.cleanup);
  const tree = await load(h);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, 'GET');
  assert.equal(h.requests[0].url, '/api/trade-swms?workOrderId=job-7');
  assert.equal(h.requests[0].body, undefined); assert.ok(button(tree, 'Add SWMS'));
  button(tree, 'Add SWMS').props.onClick(); await flush();
  assert.deepEqual(JSON.parse(h.requests[1].body), { action: 'start', expectedJobRevision: 17, workOrderId: 'job-7' });
  assert.deepEqual(h.requests[1].headers, { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' });
  assert.deepEqual(h.changes, ['saved']); assert.ok(button(h.render(), 'Close SWMS'));
  assert.match(text(h.editor()), /Assigned team memberScheduled teammate/);
  assert.equal(h.timings.at(-1).formId, 'swms-7'); assert.equal(h.timings.at(-1).formKind, 'swms');
});

for (const mode of ['readOnly', 'server-denied']) test(`${mode} blocks adding, editing, signing and timing without hiding a retained SWMS`, async t => {
  const permissions = mode === 'server-denied' ? { canEdit: false, canSign: false, reason: 'Read access only' } : { canEdit: true, canSign: true };
  const options = { props: { readOnly: mode === 'readOnly' } };
  const absent = harness(payload({ capabilities: permissions }), options); t.after(absent.cleanup);
  assert.equal(button(await load(absent), 'Add SWMS'), undefined);
  const h = harness(payload({ record: record(), capabilities: permissions }), options); t.after(h.cleanup);
  const tree = await open(h);
  assert.ok(nodes(tree, node => node.type === 'textarea').every(node => node.props.disabled));
  assert.equal(button(tree, 'Save draft'), undefined); assert.equal(button(tree, 'Sign and save to Files'), undefined);
  submit(tree); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.timings.at(-1).enabled, false);
});

test('an incomplete draft saves exact job and form revisions once while a request is pending', async t => {
  const pending = deferred();
  const h = harness(undefined, { request: async (_url, init) => init.method === 'GET' ? Response.json(payload({ record: record() })) : pending.promise });
  t.after(h.cleanup);
  let tree = await open(h);
  field(tree).props.onChange({ target: { value: 'Partial work description' } }); tree = h.editor();
  assert.equal(button(tree, 'Save draft').props.type, 'button', 'Draft saving bypasses required-field submission validation');
  button(tree, 'Save draft').props.onClick(); button(tree, 'Save draft').props.onClick(); await flush();
  assert.equal(h.requests.filter(item => item.method === 'PATCH').length, 1);
  assert.deepEqual(JSON.parse(h.requests.at(-1).body), { id: 'swms-7', expectedRevision: 4,
    answers: { ...emptySwmsAnswers(), workDescription: 'Partial work description' }, finalize: false, expectedJobRevision: 17, workOrderId: 'job-7' });
  assert.equal(button(h.render(), 'Close SWMS').props.disabled, true);
  assert.ok(nodes(h.editor(), node => node.type === 'textarea').every(node => node.props.disabled));
  pending.resolve(Response.json(payload({ jobRevision: 18, record: record({ revision: 5, answers: { ...emptySwmsAnswers(), workDescription: 'Partial work description' } }) })));
  await flush();
  assert.deepEqual(h.changes, ['saved']); assert.deepEqual(h.completions, []);
  assert.match(text(h.render()), /SWMS draft saved/); assert.equal(field(h.editor()).props.value, 'Partial work description');
});

test('signing requires real strokes and marks completion only after one acknowledged signed save', async t => {
  const pending = deferred();
  const h = harness(undefined, { request: async (_url, init) => init.method === 'GET' ? Response.json(payload({ record: record() })) : pending.promise });
  t.after(h.cleanup);
  let tree = await open(h);
  submit(tree); await flush(); assert.equal(h.requests.length, 1); assert.match(text(h.editor()), /Add your signature/);
  const answers = Object.fromEntries(SWMS_TEMPLATE.fields.map(item => [item.key, `Reviewed ${item.label}`]));
  tree = h.editor();
  nodes(tree, node => node.type === 'textarea').forEach((node, index) => node.props.onChange({ target: { value: answers[SWMS_TEMPLATE.fields[index].key] } }));
  nodes(tree, node => node.type === h.SignaturePad)[0].props.onChange(strokes); tree = h.editor();
  assert.ok(nodes(tree, node => node.type === 'textarea').every(node => node.props.required));
  submit(tree); submit(tree); await flush();
  assert.equal(h.requests.filter(item => item.method === 'PATCH').length, 1);
  assert.deepEqual(JSON.parse(h.requests.at(-1).body), { id: 'swms-7', expectedRevision: 4, answers, finalize: true,
    signature: strokes, expectedJobRevision: 17, workOrderId: 'job-7' });
  assert.deepEqual(h.completions, []);
  pending.resolve(Response.json(payload({ jobRevision: 18, record: signedRecord() }))); await flush();
  assert.deepEqual(h.completions, ['swms-7']); assert.deepEqual(h.changes, ['saved']);
  assert.match(text(h.render()), /Signed SWMS saved/);
});

test('a worker permitted to edit but not sign can save an incomplete draft without a signature control', async t => {
  const h = harness(payload({ record: record(), capabilities: { canEdit: true, canSign: false, reason: 'The assigned worker must sign.' } }));
  t.after(h.cleanup);
  const tree = await open(h);
  assert.ok(button(tree, 'Save draft')); assert.equal(button(tree, 'Sign and save to Files'), undefined);
  assert.equal(nodes(tree, node => node.type === h.SignaturePad).length, 0);
  submit(tree); await flush(); assert.equal(h.requests.length, 1, 'A direct submit handler still checks signing permission');
  button(tree, 'Save draft').props.onClick(); await flush();
  assert.equal(JSON.parse(h.requests.at(-1).body).finalize, false); assert.deepEqual(h.completions, []);
});

test('server save failure retains draft answers and signature with no false saved or completion callback', async t => {
  const h = harness(undefined, { request: async (_url, init) => init.method === 'GET' ? Response.json(payload({ record: record() }))
    : Response.json({ ok: false, error: 'Assignment changed. Reload the SWMS.' }, { status: 409 }) });
  t.after(h.cleanup);
  let tree = await open(h);
  nodes(tree, node => node.type === 'textarea').forEach(node => node.props.onChange({ target: { value: 'Reviewed for this job' } }));
  field(tree).props.onChange({ target: { value: 'Keep this draft' } }); nodes(tree, node => node.type === h.SignaturePad)[0].props.onChange(strokes);
  submit(h.editor()); await flush(); tree = h.editor();
  assert.equal(field(tree).props.value, 'Keep this draft'); assert.deepEqual(nodes(tree, node => node.type === h.SignaturePad)[0].props.value, strokes);
  assert.match(text(h.render()), /Assignment changed/); assert.deepEqual(h.changes, []); assert.deepEqual(h.completions, []);
  assert.equal(button(tree, 'Save draft').props.disabled, false);
});

test('viewing a signed SWMS uses its immutable worker snapshot and does not enable edits or timing', async t => {
  const h = harness(payload({ context: { ...context, scheduledWorker: { ...context.scheduledWorker, name: 'New assignee' } }, record: signedRecord() }));
  t.after(h.cleanup);
  const closed = await load(h); assert.match(text(closed), /Signed by Original signer/); assert.match(text(closed), /PDF is available/);
  button(closed, 'View SWMS').props.onClick(); const tree = h.editor();
  assert.match(text(tree), /Assigned team memberScheduled teammate/); assert.doesNotMatch(text(tree), /New assignee/);
  assert.ok(nodes(tree, node => node.type === 'textarea').every(node => node.props.disabled));
  assert.equal(button(tree, 'Save draft'), undefined); assert.equal(h.timings.at(-1).enabled, false);
  assert.equal(nodes(tree, node => node.type === h.SignaturePad)[0].props.disabled, true);
});

for (const stage of ['GET', 'PATCH', 'token']) for (const failure of [false, true]) test(`closing or changing job/business during ${stage} prevents late ${failure ? 'failures' : 'responses'} mutating the old view`, async () => {
  const pending = deferred();
  let tokens = 0;
  const h = harness(undefined, { getIdToken: async () => stage === 'token' && ++tokens > 1 ? pending.promise : 'user-token',
    request: async (_url, init) => (stage === 'GET' || (stage === 'PATCH' && init.method === 'PATCH')) ? pending.promise : Response.json(payload({ record: record() })) });
  if (stage === 'GET') h.render();
  else { const tree = await open(h); button(tree, 'Save draft').props.onClick(); }
  await flush(); h.cleanup(); const writes = h.writes.length;
  if (failure) pending.reject(new Error('The old business request failed'));
  else pending.resolve(stage === 'token' ? 'late-token' : Response.json(payload({ jobRevision: 18, record: record({ revision: 5 }) })));
  await flush();
  assert.equal(h.writes.length, writes); assert.deepEqual(h.changes, []); assert.deepEqual(h.completions, []);
  if (stage === 'token') assert.equal(h.requests.length, 1, 'No request is sent after the old job scope closes');
});

test('an unsuccessful parent refresh is reported as a saved draft and does not become a save failure', async t => {
  const h = harness(payload({ record: record() }), { onChanged: async () => { throw new Error('Refresh offline'); } });
  t.after(h.cleanup);
  const tree = await open(h); button(tree, 'Save draft').props.onClick(); await flush();
  assert.match(text(h.render()), /SWMS draft saved\. Reopen Files/);
  assert.equal(nodes(h.render(), node => node.props?.role === 'alert').length, 0);
});

for (const failure of [false, true]) test(`leaving a signed SWMS during parent refresh prevents late ${failure ? 'refresh failure' : 'refresh completion'} from recording activity in a new scope`, async () => {
  const refresh = deferred();
  const h = harness(undefined, { onChanged: () => refresh.promise,
    request: async (_url, init) => Response.json(init.method === 'GET' ? payload({ record: record() })
      : payload({ jobRevision: 18, record: signedRecord() })) });
  let tree = await open(h);
  nodes(tree, node => node.type === 'textarea').forEach(node => node.props.onChange({ target: { value: 'Reviewed for this job' } }));
  nodes(tree, node => node.type === h.SignaturePad)[0].props.onChange(strokes);
  tree = h.editor(); submit(tree); await flush();
  assert.deepEqual(h.changes, ['saved'], 'The server acknowledged the signed save before the refresh waits');
  assert.deepEqual(h.completions, []);
  h.cleanup(); const writes = h.writes.length;
  if (failure) refresh.reject(new Error('The old business refresh failed'));
  else refresh.resolve();
  await flush();
  assert.equal(h.writes.length, writes);
  assert.deepEqual(h.completions, [], 'An old editor cannot emit completion after its job or business scope closes');
});

for (const signed of [false, true]) test(`Files ${signed ? 'projects and previews the signed PDF' : 'does not project an unfinished SWMS as a signed file'}`, async t => {
  const runtime = hookRuntime(), requests = [], frames = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), ...init });
    if (String(url).includes('download=1')) return new Response('%PDF-test', { headers: { 'Content-Type': 'application/pdf' } });
    return Response.json(String(url).includes('/api/trade-swms?') ? payload({ record: signed ? signedRecord() : record() }) : { ok: true, files: [], records: [], instances: [] });
  };
  class LocalURL extends URL { static createObjectURL() { return 'blob:local-swms'; } static revokeObjectURL() {} }
  const filesModule = compile('TradeJobFilesPanel.tsx', { react: runtime.hooks, 'react/jsx-runtime': jsx, './TradeBusinessProvider': { useTradeBusinessFetch: () => fetch } }, {
    window: { location: { origin: 'https://tlink.test' }, requestAnimationFrame: callback => { frames.push(callback); return frames.length; }, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} },
    document: { body: { style: {} } }, URL: LocalURL,
  });
  const panel = runtime.create('files', filesModule.TradeJobFilesPanel), props = { user: { getIdToken: async () => 'scoped-token' }, workOrderId: 'job-7' };
  t.after(() => runtime.cleanup());
  panel.render(props); frames.splice(0).forEach(callback => callback()); await flush();
  const tree = panel.render(props);
  if (!signed) { assert.equal(button(tree, 'Preview'), undefined); return; }
  assert.match(text(tree), /Safe work method statement/); assert.match(text(tree), /TLJ-007-SWMS\.pdf/); assert.match(text(tree), /Original signer/);
  button(tree, 'Preview').props.onClick(); await flush();
  const request = requests.find(item => item.url.includes('download=1'));
  assert.equal(request.url, 'https://tlink.test/api/trade-swms?workOrderId=job-7&download=1');
  assert.equal(request.headers.Authorization, 'Bearer scoped-token');
  assert.equal(nodes(panel.render(props), node => node.type === 'iframe')[0].props.src, 'blob:local-swms');
});
