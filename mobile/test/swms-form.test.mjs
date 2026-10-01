import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const source = readFileSync(new URL('../src/components/field-swms-form.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === 'FieldButton' && text(node).trim() === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const keys = ['workDescription', 'highRiskWork', 'workSteps', 'hazardsControls', 'consultation', 'reviewPlan'];
function payload({ record = true, complete = false, canEdit = true, canSign = true } = {}) {
  const context = { businessName: 'Example Trades', abn: '12345678901', workNumber: 'TLJ-22', jobTitle: 'Roof repair', siteAddress: 'Example site',
    scheduledWorker: { memberId: 'worker-2', name: 'Scheduled Worker', appointmentId: 'visit-1', source: 'appointment' }, signer: { memberId: 'worker-2', name: 'Scheduled Worker' } };
  return { ok: true, jobRevision: 17, context, template: { key: 'tlink-swms-v1', name: 'Safe work method statement', version: 1,
    fields: keys.map(key => ({ key, label: key, hint: `Explain ${key}`, required: true })), declaration: 'Reviewed for this job.' },
    record: record ? { id: 'swms-1', workOrderId: 'job-1', templateName: 'Safe work method statement', templateVersion: 1, status: complete ? 'complete' : 'draft', revision: 4,
      answers: Object.fromEntries(keys.map(key => [key, `${key} answer`])), context,
      signature: complete ? { signerName: 'Scheduled Worker', signerMemberId: 'worker-2', signedAt: '2026-10-02T03:42:10Z',
        strokes: [{ points: [{ x: .1, y: .2, pressure: null, capturedAtOffsetMs: 0 }, { x: .3, y: .4, pressure: .5, capturedAtOffsetMs: 20 }, { x: .5, y: .3, pressure: .5, capturedAtOffsetMs: 40 }] }] } : null,
      completedAt: complete ? '2026-10-02' : '', pdfUrl: '/api/trade-swms?workOrderId=job-1&download=1' } : null,
    capabilities: { canEdit, canSign, ...(!canSign ? { reason: 'Only Scheduled Worker can sign this job.' } : {}) } };
}

function harness({ kind = 'form', initial = payload(), responder = async () => payload(), online = true } = {}) {
  let cursor = 0; const slots = [], effects = [], pendingEffects = [], requests = [], calls = [], alerts = [], exports = {};
  let ownerKey = 'business-a'; let prevent;
  const props = { initial, online, workOrderId: 'job-1', onBack: () => calls.push(['back']), onOpen: value => calls.push(['open', value]), onChanged: async () => calls.push(['changed']) };
  const request = async (path, init = {}) => { requests.push({ path, init }); return responder(path, init, requests.length); };
  const hooks = {
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useEffect(callback, deps) { const index = cursor++; const old = effects[index]; if (!old || !deps || deps.some((value, i) => value !== old.deps[i])) { old?.cleanup?.(); effects[index] = { deps }; pendingEffects.push(() => { effects[index].cleanup = callback(); }); } },
  };
  const dependencies = {
    react: hooks, 'react/jsx-runtime': jsx,
    'react-native': { Alert: { alert: (...args) => alerts.push(args) }, StyleSheet: { create: value => value }, Text: 'Text', TextInput: 'TextInput', View: 'View' },
    'expo-router': { useNavigation: () => ({ dispatch: action => calls.push(['navigate', action]) }) },
    'expo-router/react-navigation': { usePreventRemove: (enabled, handler) => { prevent = { enabled, handler }; } },
    '@/components/SignatureCapture': { SignatureCapture: 'SignatureCapture' }, '@/components/field-button': { FieldButton: 'FieldButton' },
    '@/components/work-time-tracking': { useFormTimeTracking: value => { calls.push(['timing', value]); return { activity() {}, markCompleted() { calls.push(['completed']); } }; }, WorkTimeStatus: 'WorkTimeStatus' },
    '@/lib/theme': { colours: {}, radius: {}, spacing: {} }, '@/lib/use-business-api': { useBusinessApi: () => request },
    '@/providers/app-provider': { useApp: () => ({ user: { localOwnerKey: ownerKey } }) },
  };
  new Function('require', 'exports', code)(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, exports);
  function render() { cursor = 0; const tree = exports[kind === 'files' ? 'FieldSwmsFiles' : 'FieldSwmsForm'](props); for (const effect of pendingEffects.splice(0)) effect(); return tree; }
  return { render, props, calls, requests, alerts, exports, get prevent() { return prevent; }, setOwner(value) { ownerKey = value; },
    async mount() { render(); await flush(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test('Files starts only its optional SWMS after Add, with duplicate tap protection and authoritative revisions', async () => {
  let finish;
  const h = harness({ kind: 'files', responder: async (_path, init) => init.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : payload({ record: false }) });
  let tree = await h.mount(); assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].path, /workOrderId=job-1/);
  const add = button(tree, 'Add SWMS'); add.props.onPress(); add.props.onPress(); await flush();
  assert.equal(h.requests.length, 2); assert.deepEqual(JSON.parse(h.requests[1].init.body), { action: 'start', workOrderId: 'job-1', expectedJobRevision: 17 });
  assert.equal(h.calls.filter(call => call[0] === 'open').length, 0);
  finish(payload()); await flush(); tree = h.render();
  assert.equal(h.calls.filter(call => call[0] === 'open').length, 1); assert.ok(button(tree, 'Continue SWMS')); h.cleanup();
});

test('offline and denied Files never create a SWMS or manufacture owner permissions', async () => {
  const offline = harness({ kind: 'files', online: false }); const tree = await offline.mount();
  assert.equal(offline.requests.length, 0); assert.match(text(tree), /Connect to open/); assert.equal(button(tree, 'Add SWMS'), undefined);
  const denied = harness({ kind: 'files', responder: async () => payload({ record: false, canEdit: false, canSign: false }) });
  assert.equal(button(await denied.mount(), 'Add SWMS'), undefined); offline.cleanup(); denied.cleanup();
});

test('a cancelled Add releases its busy state so reconnecting can reopen the saved draft', async () => {
  const h = harness({ kind: 'files', responder: async (_path, init) => init.method === 'POST'
    ? new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }))
    : payload({ record: false }) });
  let tree = await h.mount(); button(tree, 'Add SWMS').props.onPress(); await flush();
  h.props.online = false; h.render(); await flush(); h.props.online = true; tree = await h.mount();
  assert.equal(button(tree, 'Add SWMS').props.loading, false);
  assert.equal(h.calls.some(call => call[0] === 'open'), false); h.cleanup();
});

test('business changes hide stale Files responses and abort their use', async () => {
  const pending = []; const h = harness({ kind: 'files', responder: () => new Promise(resolve => pending.push(resolve)) });
  h.render(); h.setOwner('business-b'); let tree = h.render();
  pending[0](payload({ complete: true })); await flush(); tree = h.render();
  assert.equal(button(tree, 'View signed SWMS'), undefined); assert.equal(h.requests[0].init.signal.aborted, true);
  pending[1](payload({ record: false })); await flush(); assert.ok(button(h.render(), 'Add SWMS')); h.cleanup();
});

test('completed Files opens its authenticated signed record without another draft or external URL', async () => {
  const h = harness({ kind: 'files', responder: async () => payload({ complete: true, canEdit: false, canSign: false }) });
  const tree = await h.mount(); assert.equal(button(tree, 'Add SWMS'), undefined);
  button(tree, 'View signed SWMS').props.onPress(); await flush();
  const call = h.calls.find(item => item[0] === 'open'); assert.equal(call[1].record.id, 'swms-1');
  assert.equal(call[1].record.status, 'complete'); assert.equal(h.requests.length, 1); h.cleanup();
});

test('signed SWMS displays frozen business context, answers, signature and timestamp without editable controls', async () => {
  const initial = payload({ complete: true, canEdit: false, canSign: false });
  initial.context = { ...initial.context, businessName: 'Renamed current business' };
  const h = harness({ initial }); const tree = await h.mount();
  assert.match(text(tree), /Example Trades/); assert.doesNotMatch(text(tree), /Renamed current business/);
  assert.match(text(tree), /workDescription answer/); assert.match(text(tree), /Signed by\s+Scheduled Worker/);
  assert.match(text(tree), /Template version\s+1/); assert.match(text(tree), /2026/);
  assert.equal(nodes(tree, node => node.type === 'TextInput').length, 0);
  assert.equal(button(tree, 'Save draft'), undefined); assert.equal(button(tree, 'Review and sign'), undefined);
  const signature = nodes(tree, node => node.type === 'SignatureCapture')[0];
  assert.equal(signature.props.displayOnly, true); assert.equal(signature.props.value.signerName, 'Scheduled Worker');
  assert.equal(signature.props.value.capturedAt, initial.record.signature.signedAt);
  assert.deepEqual(signature.props.value.strokes[0].points[1], { x: .3, y: .4, pressure: .5, capturedAtMs: Date.parse(initial.record.signature.signedAt) + 20 });
  assert.equal(h.calls.find(call => call[0] === 'timing')[1].enabled, false); h.cleanup();
});

test('owner can prepare a draft but cannot draw or submit another worker signature', async () => {
  const h = harness({ initial: payload({ canSign: false }) }); const tree = await h.mount();
  assert.match(text(tree), /Example Trades|Scheduled Worker/); assert.ok(button(tree, 'Save draft'));
  assert.equal(button(tree, 'Review and sign'), undefined); assert.equal(nodes(tree, node => node.type === 'SignatureCapture').length, 0);
  assert.ok(h.calls.some(call => call[0] === 'timing' && call[1].formKind === 'swms' && call[1].formId === 'swms-1')); h.cleanup();
});

test('draft saves retain job and record preconditions and never carry signer claims', async () => {
  const h = harness(); let tree = await h.mount();
  nodes(tree, node => node.type === 'TextInput')[0].props.onChangeText('Specific job work'); tree = h.render();
  button(tree, 'Save draft').props.onPress(); await flush();
  const body = JSON.parse(h.requests[0].init.body); assert.equal(h.requests[0].init.method, 'PATCH');
  assert.equal(body.answers.workDescription, 'Specific job work'); assert.equal(body.expectedRevision, 4); assert.equal(body.expectedJobRevision, 17);
  assert.equal(body.finalize, undefined); assert.equal(body.signature, undefined); assert.equal(body.signerName, undefined);
  assert.equal(h.calls.some(call => call[0] === 'completed'), false); h.cleanup();
});

test('conflicts preserve entered answers, invalidate signing and require explicit saved-version reload', async () => {
  const h = harness({ responder: async () => { throw Object.assign(new Error('Job assignment changed.'), { status: 409 }); } });
  let tree = await h.mount(); nodes(tree, node => node.type === 'TextInput')[0].props.onChangeText('Keep my work'); tree = h.render();
  button(tree, 'Save draft').props.onPress(); await flush(); tree = h.render();
  assert.equal(nodes(tree, node => node.type === 'TextInput')[0].props.value, 'Keep my work');
  assert.equal(button(tree, 'Review and sign').props.disabled, true); assert.match(text(tree), /changed elsewhere/);
  button(tree, 'Load saved version').props.onPress(); assert.equal(h.requests.length, 1); assert.equal(h.alerts.at(-1)[0], 'Load saved SWMS?'); h.cleanup();
});

test('signing sends real normalized strokes and records completion only after server completion', async () => {
  const h = harness({ responder: async (_path, init) => payload({ complete: Boolean(JSON.parse(init.body).finalize) }) });
  let tree = await h.mount(); button(tree, 'Review and sign').props.onPress(); await flush(); tree = h.render();
  const pad = nodes(tree, node => node.type === 'SignatureCapture')[0]; assert.equal(pad.props.value.signerName, 'Scheduled Worker');
  pad.props.onChange({ ...pad.props.value, strokes: [{ strokeKey: 'actual', points: [{ x: .1, y: .1, pressure: null, capturedAtMs: 1000 }, { x: .2, y: .3, pressure: .6, capturedAtMs: 1020 }, { x: .4, y: .3, pressure: .5, capturedAtMs: 1040 }] }] });
  tree = h.render(); button(tree, 'Sign and save to Files').props.onPress(); await flush();
  const body = JSON.parse(h.requests.at(-1).init.body);
  assert.equal(body.finalize, true); assert.equal(body.signature[0].points[2].capturedAtOffsetMs, 40); assert.equal(body.signature[0].points[2].capturedAtMs, undefined);
  assert.equal(body.signerName, undefined); assert.equal(body.signerMemberId, undefined);
  assert.equal(h.calls.filter(call => call[0] === 'completed').length, 1); assert.equal(h.calls.filter(call => call[0] === 'back').length, 1); h.cleanup();
});

test('a failed save never marks completion, exits, or discards the captured signature', async () => {
  const h = harness({ responder: async (_path, init) => { if (JSON.parse(init.body).finalize) throw new Error('Save failed.'); return payload(); } });
  let tree = await h.mount(); button(tree, 'Review and sign').props.onPress(); await flush(); tree = h.render();
  const pad = nodes(tree, node => node.type === 'SignatureCapture')[0];
  pad.props.onChange({ ...pad.props.value, strokes: [{ strokeKey: 's', points: [0, 1, 2].map(i => ({ x: i / 3, y: .5, pressure: null, capturedAtMs: 100 + i })) }] });
  tree = h.render(); button(tree, 'Sign and save to Files').props.onPress(); await flush(); tree = h.render();
  assert.match(text(tree), /Save failed/); assert.equal(nodes(tree, node => node.type === 'SignatureCapture')[0].props.value.strokes.length, 1);
  assert.equal(h.calls.some(call => ['completed', 'back'].includes(call[0])), false); h.cleanup();
});

test('offline edits cannot be submitted and unsaved Back requires a discard decision', async () => {
  const h = harness(); let tree = await h.mount(); nodes(tree, node => node.type === 'TextInput')[0].props.onChangeText('Unsaved work');
  h.props.online = false; tree = h.render(); assert.equal(button(tree, 'Save draft').props.disabled, true);
  button(tree, 'Save draft').props.onPress(); await flush(); assert.equal(h.requests.length, 0);
  button(tree, 'Files').props.onPress(); assert.equal(h.alerts.at(-1)[0], 'Unsaved SWMS'); assert.equal(h.calls.some(call => call[0] === 'back'), false); h.cleanup();
});

test('SWMS stays out of native required-form completion and keeps the existing document picker', () => {
  const job = readFileSync(new URL('../src/app/job/[id].tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('job.tsx', job, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'jobFinishLocalBlockers');
  const output = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const blockers = new Function(`${output}; return jobFinishLocalBlockers;`)();
  assert.deepEqual(blockers({ tasks: [], forms: [], openIssues: 0, swms: { status: 'draft' } }), []);
  assert.match(job, /onPress=\{\(\) => void chooseDocument\(\)\}>Add document/);
  assert.match(job, /!creditexManual \? <FieldSwmsFiles/);
});
