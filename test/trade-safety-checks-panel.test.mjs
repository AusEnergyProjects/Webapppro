import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as formModel from '../src/lib/official-safety-check-forms.ts';
import * as flow from '../src/lib/trade-activity-form-flow.ts';
import * as activity from '../src/lib/trade-activity-forms.ts';

const nodes = (node, match) => node == null || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(child => nodes(child, match)) : [...(match(node) ? [node] : []), ...nodes(node.props?.children, match)];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : Array.isArray(node) ? node.map(text).join(' ').replace(/\s+/g, ' ') : text(node.props?.children);
const button = (tree, label) => nodes(tree, node => node.type === 'button' && text(node) === label)[0];
const tick = () => new Promise(resolve => setImmediate(resolve));
const user = { uid: 'example-actor', getIdToken: async () => 'example-token' };
const strokes = [{ points: [{ x: .1, y: .2 }, { x: .35, y: .7 }, { x: .85, y: .3 }] }];

function presentation(record) {
  const missing = activity.activityMissing(record);
  return { ...record, missing, ready: missing.length === 0,
    signingScopes: { before: activity.activitySigningScope(record, 'before'), after: activity.activitySigningScope(record, 'after') },
    signerFields: formModel.OFFICIAL_SAFETY_SIGNER_FIELDS[record.kind],
    reportUrl: record.status === 'complete' ? `/api/trade-safety-checks?recordId=${record.id}&view=pdf` : '',
    delivery: record.delivery || [] };
}

function fixtureRecord({ complete = false, missingField = '', ...extra } = {}) {
  const form = formModel.createOfficialSafetyCheckForm('electrical'), answers = {}, evidence = [];
  for (const field of flow.expandedActivityFields(form, answers)) {
    if (field.type === 'photo' || field.type === 'document') {
      if (field.required) evidence.push({ id: `evidence-${evidence.length}`, fieldKey: field.key, fileName: 'Example evidence.png',
        contentType: 'image/png', size: 100, sha256: 'e'.repeat(64), capturedAt: '', uploadedAt: '2026-10-13T00:00:00.000Z',
        latitude: null, longitude: null, accuracy: null, metadataOrigin: 'file_upload' });
    } else answers[field.key] = field.type === 'select' ? field.options[0] : field.type === 'boolean' ? true
      : field.type === 'number' ? 1 : field.type === 'date' ? field.key.includes('next')
        ? field.key.includes('smoke') ? '2027-10-13' : '2028-10-13' : '2026-10-13'
        : field.key === 'inspector_name' ? 'Example Inspector' : field.key === 'inspector_licence' ? 'EXAMPLE-123' : 'Example recorded answer';
  }
  if (missingField) delete answers[missingField];
  const record = { id: 'example-electrical', workOrderId: 'example-job', kind: 'electrical', recordNumber: 'ESC-EXAMPLE',
    revision: 1, status: complete ? 'complete' : 'draft', form, formSha256: activity.activityHash(form), answers, evidence, signatures: [],
    signerDefaults: { customer: 'Example Customer', technician: 'Example Inspector' }, createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z', completedAt: complete ? '2026-10-13T00:05:00.000Z' : '', ...extra };
  if (complete) record.signatures = [savedSignature(record)];
  return presentation(record);
}

function savedSignature(record) {
  const declaration = record.form.declarations[0], declarationText = activity.activityDeclarationText(declaration, record.answers);
  return { id: 'example-signature', declarationKey: declaration.key, signerName: record.answers.inspector_name,
    role: declaration.role, phase: declaration.phase, declarationText, declarationSha256: activity.activityHash(declarationText),
    scopeSha256: activity.activitySigningScope(record, declaration.phase), signedAt: '2026-10-13T00:05:00.000Z', actorUid: user.uid, strokes };
}

/** Executes the real exported wrapper and its actual hook-using child. Only the
 * authenticated HTTP boundary, business context and separately tested pad are
 * replaced. Form fields, conditional flow and signature scopes are production.
 */
function harness({ record = fixtureRecord(), canManage = true, respond, onChanged, ...initial } = {}) {
  let cursor = 0, props = { user, workOrderId: 'example-job', readOnly: false, canManageDelivery: false, refreshKey: 0, ...initial };
  let saved = record, changedCount = 0;
  const values = [], effects = [], layouts = [], pending = [], pendingLayouts = [], requests = [];
  const changed = (before, after) => !before || before.length !== after.length || before.some((value, index) => value !== after[index]);
  function effect(collection, queue, callback, dependencies) {
    const index = cursor++;
    if (!collection[index] || changed(collection[index].dependencies, dependencies)) {
      const previous = collection[index]; collection[index] = { dependencies };
      queue.push(() => { previous?.cleanup?.(); collection[index].cleanup = callback(); });
    }
  }
  const react = {
    useState(initialValue) { const index = cursor++; if (!(index in values)) values[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
    useRef(initialValue) { const index = cursor++; return values[index] ||= { current: initialValue }; },
    useMemo(callback, dependencies) { const index = cursor++; if (!values[index] || changed(values[index].dependencies, dependencies)) values[index] = { dependencies, value: callback() }; return values[index].value; },
    useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) { effect(effects, pending, callback, dependencies); },
    useLayoutEffect(callback, dependencies) { effect(layouts, pendingLayouts, callback, dependencies); },
  };
  const fetch = async (url, init = {}) => {
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    requests.push({ url, init, body });
    if (respond) {
      const response = await respond({ url, init, body, saved, setSaved: next => { saved = next; } });
      if (response) return response;
    }
    if ((init.method || 'GET') === 'GET') return Response.json({ ok: true, ...(url.includes('recordId=') ? { record: saved } : { records: [saved] }), canManage });
    if (body.action === 'save') saved = presentation({ ...saved, answers: body.answers, revision: saved.revision + 1 });
    if (body.action === 'sign') saved = presentation({ ...saved, signatures: [savedSignature(saved)], revision: saved.revision + 1 });
    if (body.action === 'complete') saved = presentation({ ...saved, status: 'complete', completedAt: '2026-10-13T00:05:00.000Z', revision: saved.revision + 1 });
    return Response.json({ ok: true, record: saved });
  };
  const imports = { react, 'react/jsx-runtime': jsx, '@/lib/trade-activity-form-flow': flow,
    './TradeWorkPackSignaturePad': { TradeWorkPackSignaturePad: 'signature-pad' },
    './TradeBusinessProvider': { useTradeBusiness: () => ({ ownerUid: 'example-business' }), useTradeBusinessFetch: () => fetch },
    './TradeSafetyChecksPanel.module.css': { default: new Proxy({}, { get: (_, key) => key }) } };
  const source = fs.readFileSync(new URL('../src/components/TradeSafetyChecksPanel.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  Function('require', 'exports', compiled)(name => { assert.ok(name in imports, `Unmapped import ${name}`); return imports[name]; }, exports);
  props.onChanged = async () => { changedCount++; await onChanged?.(); };
  const render = () => {
    cursor = 0;
    const wrapper = exports.TradeSafetyChecksPanel(props);
    assert.equal(typeof wrapper.type, 'function', 'Run the actual internal component, not a stub');
    const tree = wrapper.type(wrapper.props);
    for (const callback of pendingLayouts.splice(0)) callback();
    for (const callback of pending.splice(0)) callback();
    return tree;
  };
  return { render, requests, update(next) { props = { ...props, ...next }; }, get changedCount() { return changedCount; },
    get saved() { return saved; }, async settle() { let tree; for (let index = 0; index < 4; index++) { tree = render(); await tick(); } return tree; } };
}

async function click(h, tree, label) {
  const target = button(tree, label); assert.ok(target, `Missing button: ${label}`); assert.equal(Boolean(target.props.disabled), false, `${label} is disabled`);
  target.props.onClick(); return h.settle();
}
async function opened(h) {
  const tree = await h.settle(), choice = nodes(tree, node => node.type === 'button' && text(node).startsWith('Electrical safety check'))[0];
  assert.ok(choice && !choice.props.disabled); choice.props.onClick(); return h.settle();
}
const activeSection = tree => nodes(tree, node => node.type === 'button' && node.props['aria-current'] === 'step').map(text);

test('authorised completed-job reader can retry retained email and recover pending job completion', async () => {
  const record = fixtureRecord({ complete: true, delivery: [{ role: 'customer', status: 'failed', message: 'The completed PDF is saved. Email delivery failed and can be retried.', acceptedAt: '' }],
    jobProgress: { blockers: [{ key: 'tasks', label: 'Finish the remaining job task.' }], pending: true } });
  const h = harness({ record, readOnly: true, canManageDelivery: true }); let tree = await opened(h);
  assert.equal(button(tree, 'Complete check and email PDF'), undefined);
  assert.match(text(tree), /Email delivery failed/); assert.match(text(tree), /Finish the remaining job task/);
  tree = await click(h, tree, 'Check or retry email delivery');
  tree = await click(h, tree, 'Refresh job completion');
  assert.deepEqual(h.requests.filter(item => item.body).map(item => item.body.action), ['retry_delivery', 'recover_progress']);
  for (const request of h.requests.filter(item => item.body)) {
    assert.equal(request.body.recordId, record.id); assert.equal(request.body.baseRevision, record.revision);
    assert.equal(request.init.headers.get('Authorization'), 'Bearer example-token');
  }
  assert.equal(h.changedCount, 1); assert.match(text(tree), /Finish the remaining job task/);
});

test('view-only access cannot start, edit, sign or complete, even if a stale delivery flag is present', async () => {
  const h = harness({ canManage: false, readOnly: true, canManageDelivery: true }); let tree = await opened(h);
  assert.ok(nodes(tree, node => node.type === 'input').every(node => node.props.disabled));
  assert.equal(nodes(tree, node => node.type === 'button' && text(node).startsWith('Gas safety check')).length, 0, 'View-only users must not see controls for creating unattached safety checks.');
  tree = await click(h, tree, 'Sign off');
  assert.equal(nodes(tree, node => node.type === 'signature-pad')[0].props.disabled, true);
  assert.equal(button(tree, 'Save signature').props.disabled, true);
  tree = await click(h, tree, 'Finish'); assert.equal(button(tree, 'Complete check and email PDF').props.disabled, true);
  assert.equal(button(tree, 'Check or retry email delivery'), undefined); assert.equal(button(tree, 'Save answers'), undefined);
  assert.equal(h.requests.filter(item => item.body).length, 0);
  const complete = harness({ record: fixtureRecord({ complete: true }), canManage: false, readOnly: true, canManageDelivery: true });
  tree = await opened(complete); assert.equal(button(tree, 'Check or retry email delivery'), undefined); assert.equal(button(tree, 'Refresh job completion'), undefined);
});

test('navigation saves answers first and reuses the exact request key after a lost save acknowledgement', async () => {
  let attempts = 0;
  const h = harness({ respond({ body, saved, setSaved }) {
    if (body?.action !== 'save') return;
    if (++attempts === 1) { setSaved(presentation({ ...saved, answers: body.answers, revision: saved.revision + 1 })); throw new Error('Connection interrupted after saving.'); }
    return Response.json({ ok: true, record: saved });
  } }); let tree = await opened(h);
  const first = h.saved.form.fields[0], input = nodes(tree, node => node.type === 'input' && node.props.id.endsWith(`-${first.key}`))[0];
  input.props.onChange({ target: { value: '2 Example Street, Melbourne VIC 3000' } }); tree = h.render();
  tree = await click(h, tree, 'Sign off');
  assert.deepEqual(activeSection(tree), [first.section]); assert.match(text(tree), /Connection interrupted after saving/);
  assert.equal(button(tree, 'Save answers').props.disabled, false);
  tree = await click(h, tree, 'Sign off');
  assert.deepEqual(activeSection(tree), ['Sign off']);
  const saves = h.requests.filter(item => item.body?.action === 'save'); assert.equal(saves.length, 2);
  assert.deepEqual(saves[1].body, saves[0].body); assert.match(saves[0].body.requestKey, /^[0-9a-f-]{36}$/);
  assert.equal(saves[0].body.answers[first.key], '2 Example Street, Melbourne VIC 3000');
  assert.equal(button(tree, 'Save answers').props.disabled, true); assert.equal(h.saved.revision, 2);
});

test('signing requires saved required fields, the actual named inspector, explicit consent and drawn ink', async () => {
  const h = harness(); let tree = await opened(h); tree = await click(h, tree, 'Sign off');
  assert.equal(button(tree, 'Save signature').props.disabled, true);
  assert.equal(nodes(tree, node => node.type === 'signature-pad')[0].props.disabled, true);
  const consent = nodes(tree, node => node.type === 'input' && node.props.type === 'checkbox')[0];
  consent.props.onChange({ target: { checked: true } }); tree = h.render();
  assert.equal(button(tree, 'Save signature').props.disabled, true);
  const pad = nodes(tree, node => node.type === 'signature-pad')[0]; assert.equal(pad.props.signerName, 'Example Inspector'); assert.equal(pad.props.disabled, false);
  pad.props.onChange(strokes); tree = h.render(); tree = await click(h, tree, 'Save signature');
  const signed = h.requests.find(item => item.body?.action === 'sign').body;
  assert.equal(signed.signerName, 'Example Inspector'); assert.equal(signed.accepted, true); assert.deepEqual(signed.strokes, strokes);
  assert.equal(signed.scopeSha256, activity.activitySigningScope(fixtureRecord(), 'after'));
  assert.match(text(tree), /Signed by Example Inspector/); assert.equal(button(tree, 'Save signature'), undefined);
  for (const missingField of ['inspector_name', 'electrical.inspection_standard']) {
    const incomplete = harness({ record: fixtureRecord({ missingField }) }); let other = await opened(incomplete); other = await click(incomplete, other, 'Sign off');
    const checkbox = nodes(other, node => node.type === 'input' && node.props.type === 'checkbox')[0]; checkbox.props.onChange({ target: { checked: true } }); other = incomplete.render();
    nodes(other, node => node.type === 'signature-pad')[0].props.onChange(strokes); other = incomplete.render();
    assert.equal(button(other, 'Save signature').props.disabled, true); assert.equal(incomplete.requests.filter(item => item.body).length, 0);
  }
});

test('completion sends one explicit mutation and exposes saved PDF, delivery failure and remaining job blockers', async () => {
  const record = fixtureRecord(); record.signatures = [savedSignature(record)];
  const h = harness({ record: presentation(record), respond({ body, saved, setSaved }) {
    if (body?.action !== 'complete') return;
    const completed = presentation({ ...saved, status: 'complete', completedAt: '2026-10-13T00:05:00.000Z', revision: saved.revision + 1,
      delivery: [{ role: 'customer', status: 'failed', message: 'The completed PDF is saved. Email delivery failed and can be retried.', acceptedAt: '' }],
      jobProgress: { blockers: [{ key: 'remaining-form', label: 'Complete the other attached job form.' }], pending: true } });
    setSaved(completed); return Response.json({ ok: true, record: completed });
  } }); let tree = await opened(h); tree = await click(h, tree, 'Finish');
  tree = await click(h, tree, 'Complete check and email PDF');
  assert.equal(h.requests.filter(item => item.body?.action === 'complete').length, 1);
  assert.equal(h.changedCount, 1); assert.match(text(tree), /Your completed record is saved/);
  assert.match(text(tree), /Email delivery failed/); assert.match(text(tree), /Complete the other attached job form/);
  assert.ok(button(tree, 'Download completed PDF')); assert.ok(button(tree, 'Check or retry email delivery'));
  assert.equal(button(tree, 'Complete check and email PDF'), undefined);
});
