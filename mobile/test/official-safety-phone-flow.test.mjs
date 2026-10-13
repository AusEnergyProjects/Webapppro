import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { electricalFixture } from '../../test/helpers/veu-electrical-fixture.mjs';
import { VEU_ELECTRICAL_SIGNER_FIELDS, veuElectricalCompletion } from '../../src/lib/veu-electrical-safety-form.ts';
import { createOfficialSafetyCheckForm, OFFICIAL_SAFETY_SIGNER_FIELDS } from '../../src/lib/official-safety-check-forms.ts';
import { activityHash, activityMissing, activitySigningScope, normaliseActivityAnswers } from '../../src/lib/trade-activity-forms.ts';
import * as flow from '../../src/lib/trade-activity-form-flow.ts';

// Execute production components with real form/scope/ink rules at the native API
// boundary. These synthetic records never contact a business or email provider.
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
const visit = node => Array.isArray(node) ? node.flatMap(visit) : !node || typeof node !== 'object' ? [] : [node, ...visit(node.props?.children)];
function helpers(path, names, dependencies = {}) {
  const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = names.map(name => {
    let found; const find = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; if (!found) ts.forEachChild(node, find); };
    find(file); assert.ok(found, name); return found.getText(file);
  });
  dependencies = { exports: {}, ...dependencies };
  return Function(...Object.keys(dependencies), `${compile(declarations.join('\n'))};return {${names.join(',')}};`)(...Object.values(dependencies));
}
const inkExports = helpers('../src/lib/activity-form-completion.ts', ['activitySignatureStrokesAreValid']);
const wizard = helpers('./field-veu-electrical-assessment-wizard.test.mjs', ['fixture', 'presentation', 'harness', 'load'], {
  assert, electricalFixture, VEU_ELECTRICAL_SIGNER_FIELDS, veuElectricalCompletion, activityHash, activityMissing,
  activitySigningScope, normaliseActivityAnswers, flow, clone: structuredClone, compile, flush, inkExports,
  source: read('../src/components/FieldVeuElectricalAssessmentWizard.tsx'),
});
const pickerHarness = helpers('./field-veu-electrical-assessment-picker.test.mjs', ['harness'], {
  assert, flush, record: { id: 'check-electrical', workOrderId: 'job / one', kind: 'electrical', recordNumber: 'SYNTHETIC-ESC', status: 'draft' },
  picker: compile(read('../src/components/FieldSafetyCheckPicker.tsx')),
}).harness;
const draw = helpers('./signature-capture-gestures.test.mjs', ['fixture'], { assert, visit, compiled: compile(read('../src/components/SignatureCapture.tsx')) }).fixture;
const touch = (x, y, count = 1) => ({ nativeEvent: { locationX: x, locationY: y, force: 0.5, touches: Array.from({ length: count }, () => ({})) } });

function record(kind, answers = {}) {
  const form = createOfficialSafetyCheckForm(kind);
  return { id: `check-${kind}`, ownerUid: 'synthetic-business', workOrderId: 'job / one', kind,
    recordNumber: `SYNTHETIC-${kind}`, revision: 1, status: 'draft', form, formSha256: activityHash(form),
    answers, signatures: [], evidence: [], signerDefaults: { customer: 'Synthetic Customer', technician: 'Synthetic Technician' },
    createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', completedAt: '' };
}
const completion = value => { const missing = activityMissing(value); return { missing, ready: missing.length === 0 }; };
function presentation(value) {
  return { ...structuredClone(value), ...completion(value), signerFields: OFFICIAL_SAFETY_SIGNER_FIELDS[value.kind],
    signingScopes: { before: activitySigningScope(value, 'before'), after: activitySigningScope(value, 'after') },
    reportUrl: value.status === 'complete' ? `/api/trade-safety-checks?recordId=${value.id}&view=pdf` : '',
    delivery: value.status === 'complete' ? [{ role: 'customer', status: 'accepted', message: 'Provider accepted customer copy.' },
      { role: 'business', status: 'failed', message: 'Provider rejected business copy.' }] : [] };
}
const harness = (value, options = {}) => wizard.harness({ record: value,
  adapter: { presentation, completion, signerFields: OFFICIAL_SAFETY_SIGNER_FIELDS[value.kind] }, ...options });
async function loaded(h) { await wizard.load(h); return h; }
async function pressPicker(h, label) { const button = h.button(label); assert.ok(button, label); assert.notEqual(button.props.disabled, true); button.props.onPress(); await flush(); h.render(); }
function filled(kind) {
  const value = record(kind), answers = {};
  for (const field of value.form.fields) if (!['photo', 'document'].includes(field.type) && field.required) {
    answers[field.key] = field.type === 'date' ? field.key.includes('next_') ? '2027-10-13' : '2026-10-13'
      : field.type === 'select' ? field.options[0] : field.type === 'number' ? 1 : `Synthetic ${field.key}`;
  }
  return record(kind, normaliseActivityAnswers(value.form, answers));
}
async function chooseEvidence(h, field) {
  const container = h.nodes().find(node => node.type === 'View' && node.key === field.key);
  const photo = field.type === 'photo', button = visit(container).find(node => node.type === 'FieldButton' && [node.props.children].flat(5).join('') === (photo ? 'Take evidence photo' : 'Choose document'));
  assert.ok(button, field.key); assert.equal(button.props.disabled, false);
  const uri = `source-${field.key}.${photo ? 'jpg' : 'pdf'}`;
  h.state.files.set(uri, photo ? new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) : new TextEncoder().encode('%PDF-1.7 synthetic'));
  if (photo) h.state.photo = { canceled: false, assets: [{ uri, fileName: `Synthetic ${field.key}.jpg` }] };
  else h.state.document = { canceled: false, assets: [{ uri, name: 'Synthetic full servicing record.pdf', mimeType: 'application/pdf' }] };
  button.props.onPress(); await flush(); h.render();
  assert.ok(h.state.record.evidence.some(item => item.fieldKey === field.key));
  assert.equal(h.state.files.has(uri), true, 'Original camera/document file remains');
  assert.ok(![...h.state.files.keys()].some(key => key.startsWith('document/safety-')), 'Verified upload removes its retained local copy');
}
async function signActualInk(h) {
  const key = h.state.record.form.declarations[0].key;
  let node = h.nodes().find(item => item.type === 'SignatureCapture' && item.props.signerRole.roleKey === key);
  assert.ok(node); assert.equal(node.props.disabled, true);
  h.nodes().find(item => item.type === 'Pressable' && item.props.accessibilityRole === 'checkbox').props.onPress(); h.render();
  node = h.nodes().find(item => item.type === 'SignatureCapture'); const pad = draw(node.props), pan = pad.responder();
  pan.onPanResponderGrant(touch(20, 130)); h.render(); pad.update(h.nodes().find(item => item.type === 'SignatureCapture').props);
  assert.equal(h.nodes().find(item => item.type === 'Scroll').props.scrollEnabled, false);
  pan.onPanResponderMove(touch(100, 35)); pad.render(); pan.onPanResponderMove(touch(170, 160)); pad.render();
  pan.onPanResponderRelease(touch(240, 80, 0)); h.render(); pad.update(h.nodes().find(item => item.type === 'SignatureCapture').props);
  assert.equal(h.nodes().find(item => item.type === 'Scroll').props.scrollEnabled, true);
  pad.unmount(); await h.press(`Save ${h.state.record.kind === 'gas' ? 'gasfitter' : 'electrician'} signature`);
  const request = h.state.requests.at(-1).body;
  assert.equal(request.declarationKey, key); assert.equal(request.signerName, h.state.record.answers.inspector_name);
  assert.equal(request.scopeSha256, activitySigningScope(h.state.record, 'after')); assert.equal(request.accepted, true);
  assert.equal(request.strokes[0].points.length, 4);
}

for (const kind of ['electrical', 'gas']) test(`${kind} official phone flow saves answers and required evidence, draws ink, completes and reopens its PDF without duplicate sending`, async t => {
  const value = record(kind), target = filled(kind), h = await loaded(harness(value)); t.after(() => h.cleanup());
  assert.ok(h.texts().includes(value.form.title));
  for (const section of [...new Set(target.form.fields.map(field => field.section))]) {
    assert.equal(h.select('Assessment section').props.value, section);
    for (const field of flow.expandedActivityFields(target.form, target.answers).filter(field => field.section === section && field.required)) {
      if (['photo', 'document'].includes(field.type)) await chooseEvidence(h, field); else h.answer(field, target.answers[field.key]);
    }
    await h.press(section === target.form.fields.at(-1).section ? 'Continue to sign off' : 'Next');
    assert.notEqual(h.select('Assessment section').props.value, section);
  }
  assert.equal(h.select('Assessment section').props.value, 'signatures');
  assert.equal(h.state.record.signatures.length, 0); await h.press('Review & finish');
  assert.equal(h.select('Assessment section').props.value, 'signatures');
  assert.ok(h.state.record.evidence.length >= (kind === 'gas' ? 2 : 2));
  assert.ok(h.state.photoPrepared >= (kind === 'gas' ? 1 : 2));
  await signActualInk(h); await h.press('Review & finish');
  assert.equal(h.select('Assessment section').props.value, 'review');
  assert.equal(h.state.requests.some(item => item.body?.action === 'complete'), false);
  await h.press('Complete assessment and email PDF'); assert.equal(h.state.record.status, 'complete'); assert.equal(h.state.changed, 1);
  assert.match(h.texts(), /Customer copy.*accepted/); assert.match(h.texts(), /Business copy.*failed/);
  await h.press('Save completed assessment PDF on phone'); assert.equal(h.state.safetyDownload, true);
  assert.deepEqual(h.state.downloadCalls, [[value.id, 'pdf', 'business-test', '']]);
  await h.press('Retry email delivery'); assert.equal(h.state.requests.at(-1).body.baseRevision, h.state.record.revision - 1);
  assert.equal(h.state.requests.filter(item => item.body?.action === 'complete').length, 1);
  assert.ok(h.state.requests.every(item => item.path.startsWith('/api/trade-safety-checks')));
  const reopened = await loaded(harness(h.state.record)); t.after(() => reopened.cleanup());
  assert.equal(reopened.select('Assessment section').props.value, 'review'); assert.equal(reopened.button('Complete assessment and email PDF'), undefined);
  assert.equal(reopened.state.requests.some(item => item.body), false);
  const files = pickerHarness({ entry: 'FieldSafetyCheckPicker', response: { records: [h.state.record], canManage: false } });
  t.after(() => files.cleanup()); files.state.props.mode = 'files'; await loaded(files);
  await pressPicker(files, `View completed ${kind} safety check`); assert.deepEqual(files.state.opened, [value.id]);
  assert.equal(files.state.requests.some(item => item.init.method === 'POST'), false, 'Files reopens the retained record without creating or resending it');
});

test('official safety forms remain direct entries when unrelated activity catalogues fail; attaching verifies the exact kind and same job', async t => {
  const outer = pickerHarness({ code: compile(read('../src/components/field-job-activity-picker.tsx')), entry: 'FieldJobActivityPicker' });
  t.after(() => outer.cleanup()); outer.state.loadError = new Error('Unrelated catalogue unavailable'); await loaded(outer);
  const entry = outer.nodes().find(node => node.type === 'FieldSafetyCheckPicker'); assert.ok(entry);
  const h = pickerHarness({ entry: 'FieldSafetyCheckPicker' }); t.after(() => h.cleanup()); Object.assign(h.state.props, entry.props); await loaded(h);
  const button = h.button('Add electrical safety check to this job'); button.props.onPress(); button.props.onPress(); await flush(); h.render();
  assert.equal(h.state.requests.filter(item => item.init.method === 'POST').length, 1);
  assert.deepEqual(outer.state.opened, ['check-electrical']); assert.equal(outer.state.changes, 1);
  assert.deepEqual(JSON.parse(h.state.requests.find(item => item.init.method === 'POST').init.body), { action: 'start', workOrderId: 'job / one', kind: 'electrical' });
  assert.equal(h.button('Add electrical safety check to this job'), undefined); assert.ok(h.button('Add gas safety check to this job'));
});

test('missing photos or full gas consumer records cannot be bypassed by sign-off or finish shortcuts', async t => {
  for (const kind of ['electrical', 'gas']) {
    const h = await loaded(harness(filled(kind))); t.after(() => h.cleanup()); await h.press('Sign off');
    const first = h.state.record.form.fields.find(field => field.required && ['photo', 'document'].includes(field.type));
    assert.equal(h.select('Assessment section').props.value, first.section); assert.match(h.texts(), /before continuing/);
    assert.equal(h.state.requests.some(item => ['sign', 'complete'].includes(item.body?.action)), false);
    await h.press('Finish & email PDF'); assert.equal(h.select('Assessment section').props.value, first.section);
  }
});

test('signed official answers and evidence are immutable, while delivery retry remains available with the exact saved revision', async t => {
  const value = filled('gas');
  for (const field of value.form.fields.filter(field => field.required && ['photo', 'document'].includes(field.type))) value.evidence.push({
    id: `evidence-${field.key}`, fieldKey: field.key, sha256: activityHash(field.key), size: 100,
    contentType: field.type === 'photo' ? 'image/jpeg' : 'application/pdf', fileName: 'Synthetic evidence',
  });
  const h = await loaded(harness(value)); t.after(() => h.cleanup()); await h.press('Sign off'); await signActualInk(h);
  await h.section(value.form.fields[0].section);
  assert.equal(h.select('Date').props.disabled, true); assert.equal(h.select('Licensed/Registered person').props.editable, false);
  const writes = h.state.requests.length;
  await h.press('Finish & email PDF'); await h.press('Complete assessment and email PDF');
  h.state.writeError = new Error('Delivery retry unavailable'); await h.press('Retry email delivery'); const retry = h.state.requests.at(-1).body;
  assert.ok(h.button('Save completed assessment PDF on phone')); assert.equal(h.state.record.status, 'complete');
  h.state.writeError = null; await h.press('Retry email delivery'); assert.equal(h.state.requests.at(-1).body.requestId, retry.requestId);
  assert.ok(h.state.requests.slice(writes).every(item => !['save', 'upload', 'sign'].includes(item.body?.action)));
});

test('unavailable, offline and cross-job safety lists never produce an empty completion signal or an attach write', async t => {
  for (const options of [{ online: false }, { response: { records: [{ ...record('gas'), workOrderId: 'foreign' }], canManage: true } },
    { response: { records: [{ ...record('gas'), kind: 'unrecognised' }], canManage: true } }, { response: { records: [], canManage: false } }]) {
    const h = pickerHarness({ entry: 'FieldSafetyCheckPicker', ...options }); t.after(() => h.cleanup()); await loaded(h);
    assert.equal(h.button('Add gas safety check to this job'), undefined); assert.equal(h.state.requests.some(item => item.init.method === 'POST'), false);
    if (options.online === false || options.response.records.length) assert.equal(h.state.states.at(-1).state, 'unavailable');
  }
});
