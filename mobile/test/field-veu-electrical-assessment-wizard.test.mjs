import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { electricalFixture } from '../../test/helpers/veu-electrical-fixture.mjs';
import { VEU_ELECTRICAL_SIGNER_FIELDS, veuElectricalCompletion } from '../../src/lib/veu-electrical-safety-form.ts';
import { activityHash, activityMissing, activitySigningScope, normaliseActivityAnswers } from '../../src/lib/trade-activity-forms.ts';
import * as flow from '../../src/lib/trade-activity-form-flow.ts';

const source = fs.readFileSync(new URL('../src/components/FieldVeuElectricalAssessmentWizard.tsx', import.meta.url), 'utf8');
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const signatureFile = ts.createSourceFile('completion.ts', fs.readFileSync(new URL('../src/lib/activity-form-completion.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const inkFunction = signatureFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'activitySignatureStrokesAreValid');
const inkExports = {}; new Function('exports', compile(inkFunction.getText(signatureFile)))(inkExports);
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const clone = value => structuredClone(value);
const strokes = [{ strokeKey: 'actual-touch', points: [{ x: 0.1, y: 0.7 }, { x: 0.3, y: 0.2 }, { x: 0.7, y: 0.6 }], capturedAt: '' }];

function fixture(overrides = {}) {
  const value = electricalFixture(); value.status = 'draft'; value.completedAt = ''; value.answers = {}; delete value.initialAttestation;
  return { ...value, ...overrides };
}
function presentation(value) {
  const completion = veuElectricalCompletion(value);
  return { ...clone(value), ...completion, signerFields: VEU_ELECTRICAL_SIGNER_FIELDS,
    signingScopes: { before: activitySigningScope(value, 'before'), after: activitySigningScope(value, 'after') },
    reportUrl: value.status === 'complete' ? `/api/trade-veu-electrical-assessments?recordId=${value.id}&view=pdf` : '',
    delivery: value.status === 'complete' ? [{ role: 'customer', status: 'accepted', message: 'Provider accepted customer copy.' }, { role: 'business', status: 'failed', message: 'Provider rejected business copy.' }] : [] };
}

function harness({ record = fixture(), canManage = true, online = true } = {}) {
  let cursor = 0, tree, unmounted = false, uuid = 0;
  const slots = [], effects = [], pendingEffects = [];
  const state = { record, requests: [], files: new Map(), links: [], alerts: [], changed: 0, left: 0, canManage, downloadCalls: [],
    props: { workOrderId: record.workOrderId, recordId: record.id, online, onReturnToJob: () => state.left++, onChanged: async () => { state.changed++; if (state.changedError) throw state.changedError; } } };
  const same = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { assert.equal(unmounted, false, 'No updates after leaving'); slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { fn, deps }; return slots[index].fn; },
    useEffect(fn, deps) { const index = cursor++; if (!effects[index] || !same(effects[index].deps, deps)) {
      const previous = effects[index]; effects[index] = { deps }; pendingEffects.push(() => { previous?.cleanup?.(); effects[index].cleanup = fn(); }); } },
  };
  class LocalFile extends Blob {
    constructor(...parts) { super([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' }); this.uri = parts.join('/'); this.name = parts.at(-1); }
    get exists() { return state.files.has(this.uri); } get size() { return state.files.get(this.uri)?.byteLength || 6; } get contentUri() { return `content://fixture/${this.name}`; }
    copy(target) { state.files.set(target.uri, state.files.get(this.uri)); } delete() { state.files.delete(this.uri); }
    write(bytes) { if (state.fileWriteError) throw state.fileWriteError; state.files.set(this.uri, bytes); }
  }
  class TestApiError extends Error { constructor(message, code) { super(message); this.code = code; } }
  const api = async (path, init = {}) => {
    const body = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : init.body ? JSON.parse(init.body) : null;
    state.requests.push({ path, init, body });
    if (!body) { if (state.loadError) throw state.loadError; return state.loadResponse || { record: presentation(state.record), canManage: state.canManage }; }
    if (state.writeError) throw state.writeError;
    if (state.writeResponse) return state.writeResponse;
    assert.equal(body.recordId, state.record.id);
    if (body.action !== 'retry_delivery') assert.equal(Number(body.baseRevision), state.record.revision, 'Every write binds the current saved revision');
    const next = clone(state.record);
    if (init.method === 'PATCH') {
      if (body.answers.initial_correct === true && next.answers.initial_correct !== true) throw new Error('Use the initial attestation control.');
      next.answers = normaliseActivityAnswers(next.form, body.answers);
      if (activitySigningScope(next, 'before') !== activitySigningScope(state.record, 'before')) { delete next.initialAttestation; if (state.record.answers.initial_correct === true) next.answers.initial_correct = false; }
    } else if (body.action === 'attest_initial') {
      assert.equal(body.scopeSha256, activitySigningScope(next, 'before')); assert.equal(body.accepted, true);
      next.answers.initial_correct = true;
      if (activityMissing(next, 'before', false).length) throw new Error('Complete the initial assessment answers and attachments first.');
      next.initialAttestation = { actorUid: 'electrician', confirmedAt: '2026-10-08T03:00:00Z', scopeSha256: activitySigningScope(next, 'before') };
    } else if (body.action === 'upload') {
      next.evidence.push({ id: 'evidence-one', fieldKey: body.fieldKey, fileName: body.file.name, contentType: body.file.type, sha256: activityHash('evidence'), size: body.file.size });
    } else if (body.action === 'sign') {
      assert.equal(veuElectricalCompletion(next).missing.some(item => item.kind !== 'signature'), false, 'Canonical whole-form prerequisites gate genuine signatures');
      const declaration = next.form.declarations.find(item => item.key === body.declarationKey);
      assert.equal(body.signerName, next.answers[VEU_ELECTRICAL_SIGNER_FIELDS[declaration.key]]); assert.equal(body.accepted, true);
      assert.equal(body.scopeSha256, activitySigningScope(next, declaration.phase)); assert.ok(inkExports.activitySignatureStrokesAreValid(body.strokes));
      next.signatures.push({ id: `ink-${declaration.key}`, declarationKey: declaration.key, signerName: body.signerName, role: declaration.role, phase: declaration.phase,
        declarationText: declaration.text, declarationSha256: activityHash(declaration.text), scopeSha256: body.scopeSha256, signedAt: '2026-10-08T03:01:00Z', actorUid: 'signer', strokes: body.strokes });
    } else if (body.action === 'complete') {
      assert.equal(veuElectricalCompletion(next).ready, true, 'Canonical completion rules gate the native finish action'); next.status = 'complete';
    } else assert.equal(body.action, 'retry_delivery');
    next.revision++; state.record = next; return { record: presentation(next), canManage: state.canManage };
  };
  const dependencies = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Text: 'Text', View: 'View', Pressable: 'Pressable', TextInput: 'TextInput', Platform: { OS: 'android' }, StyleSheet: { create: value => value },
      Alert: { alert: (...args) => state.alerts.push(args) }, Linking: { openURL: async uri => state.links.push(uri) } },
    'expo-router': { useNavigation: () => ({ dispatch: () => state.left++ }) },
    'expo-router/react-navigation': { usePreventRemove: (blocked, callback) => { state.leaveGuard = { blocked, callback }; } },
    'expo-crypto': { randomUUID: () => `request-${++uuid}` }, 'expo-file-system': { File: LocalFile, Paths: { cache: 'cache', document: 'document' },
      Directory: { pickDirectoryAsync: async () => { if (state.folderError) throw state.folderError; return { createFile: name => new LocalFile('user-selected-folder', name) }; } } },
    'expo-document-picker': { getDocumentAsync: async () => state.document || { canceled: true, assets: [] } },
    'expo-image-picker': { CameraType: { back: 'back' }, requestCameraPermissionsAsync: async () => ({ granted: state.cameraPermission !== false }),
      launchCameraAsync: async options => { state.cameraOptions = options; return state.photo || { canceled: true, assets: [] }; } },
    '@/lib/theme': { colours: {}, spacing: {}, radius: {} }, '@/lib/use-business-api': { useBusinessApi: () => api },
    '@/providers/app-provider': { useApp: () => ({ user: { localOwnerKey: 'business-test' } }) },
    '@/lib/activity-form-completion': inkExports,
    '@/lib/api': { ApiError: TestApiError, downloadElectricalAssessmentFile: async (...args) => { state.downloadCalls.push(args); return { bytes: new TextEncoder().encode('%PDF-1.7 test'), contentType: 'application/pdf' }; } },
    '../../../src/lib/trade-activity-form-flow': flow,
    './keyboard-aware-scroll-view': { KeyboardAwareScrollView: 'Scroll' }, './field-button': { FieldButton: 'FieldButton' },
    './field-select': { FieldSelect: 'FieldSelect' }, './field-date-picker': { FieldDatePicker: 'FieldDatePicker' }, './SignatureCapture': { SignatureCapture: 'SignatureCapture' },
  };
  const exports = {}; new Function('require', 'exports', compile(source))(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, exports);
  function render() { cursor = 0; tree = exports.FieldVeuElectricalAssessmentWizard(state.props); while (pendingEffects.length) pendingEffects.shift()(); return tree; }
  const visit = node => Array.isArray(node) ? node.flatMap(visit) : !node || typeof node !== 'object' ? [] : [node, ...visit(node.props?.children)];
  const nodes = () => visit(tree);
  const button = text => nodes().find(node => node.type === 'FieldButton' && [node.props.children].flat(5).join('') === text);
  const matchesLabel = (node, label) => node.props.label === label || node.props.label?.startsWith(`${label} *`) || node.props.label?.startsWith(`${label} ·`) || node.props.accessibilityLabel === label;
  const select = label => nodes().find(node => ['FieldSelect', 'FieldDatePicker', 'TextInput'].includes(node.type) && matchesLabel(node, label));
  async function press(text) { const node = button(text); assert.ok(node, text); assert.equal(node.props.disabled, false, `Button enabled: ${text}`); node.props.onPress(); await flush(); render(); }
  async function section(page) { select('Assessment section').props.onChange(page); await flush(); render(); }
  function answer(field, value) { const node = nodes().filter(node => ['FieldSelect', 'FieldDatePicker', 'TextInput'].includes(node.type) && matchesLabel(node, field.label))[field.repeatIndex || 0]; assert.ok(node, field.key); assert.notEqual(node.props.disabled, true, field.key); assert.notEqual(node.props.editable, false, field.key);
    if (node.type === 'TextInput') node.props.onChangeText(String(value)); else node.props.onChange(field.type === 'boolean' ? value ? 'yes' : 'no' : String(value)); render(); }
  return { state, render, nodes, button, select, press, section, answer,
    texts: () => nodes().filter(node => ['Text', 'FieldSelect', 'FieldDatePicker'].includes(node.type)).flatMap(node => node.type === 'Text' ? [node.props.children].flat(4) : node.props.label).join(' '),
    cleanup() { for (const effect of effects) effect?.cleanup?.(); unmounted = true; } };
}
async function load(h) { h.render(); await flush(); h.render(); }

test('an empty native assessment can be answered through all sections, attach evidence, sign both people and complete', async () => {
  const target = electricalFixture({ life_support: true, life_support_consent: true, alternative_supply: true, recessed_luminaires: true, ceiling_appliances: true,
    other_hazards_present: true, assessment_outcome: 'rectification_required', electrical_works_performed: true, work_tps: true,
    rectification_notes: 'Synthetic completed rectification', '$repeat.appliances': 2, '$repeat.other_hazards': 2 });
  const h = harness(); await load(h);
  for (const section of [...new Set(target.form.fields.map(field => field.section))]) {
    await h.section(section);
    for (const field of flow.expandedActivityFields(target.form, target.answers).filter(field => field.section === section)) {
      if (field.key === 'initial_correct') { await h.press('Confirm initial assessment declaration'); continue; }
      if (field.type === 'document') {
        h.state.files.set('synthetic-consent.pdf', new TextEncoder().encode('%PDF-test'));
        h.state.document = { canceled: false, assets: [{ uri: 'synthetic-consent.pdf', name: 'Synthetic consent.pdf' }] }; await h.press('Choose document'); continue;
      }
      if (field.repeatGroup && field.repeatIndex >= flow.activityRepeatCount(target.form, h.state.record.answers, field.repeatGroup)) {
        const repeatedInputs = h.nodes().filter(node => node.type === 'TextInput' && node.props.accessibilityLabel === field.label);
        if (repeatedInputs.length <= field.repeatIndex) await h.press(`Add another ${flow.activityRepeatItemLabel(field.repeatGroup)}`);
      }
      h.answer(field, target.answers[field.key] ?? (field.type === 'boolean' ? false : field.type === 'date' ? '2026-10-08' : 'Synthetic optional observation'));
    }
    await h.press('Next');
    assert.notEqual(h.select('Assessment section').props.value, section, `Complete section advances: ${section}`);
  }
  assert.equal(h.state.record.evidence.length, 1); assert.ok(h.state.record.initialAttestation); assert.equal(h.state.record.answers['$repeat.appliances'], 2);
  assert.ok(h.state.record.answers.coes_number); assert.equal(h.state.record.signatures.length, 0);
  await h.section('signatures');
  for (const declaration of target.form.declarations) {
    const pad = h.nodes().find(node => node.type === 'SignatureCapture' && node.props.signerRole.roleKey === declaration.key);
    assert.ok(pad); const container = h.nodes().find(node => node.type === 'View' && node.props.children?.[0]?.props?.children === declaration.title);
    const flatten = node => Array.isArray(node) ? node.flatMap(flatten) : !node || typeof node !== 'object' ? [] : [node, ...flatten(node.props?.children)];
    const consent = flatten(container).find(node => node.type === 'Pressable'); assert.equal(consent.props.disabled, false); consent.props.onPress(); h.render();
    const enabledPad = h.nodes().find(node => node.type === 'SignatureCapture' && node.props.signerRole.roleKey === declaration.key);
    enabledPad.props.onChange({ ...enabledPad.props.value, strokes }); h.render(); await h.press(`Save ${declaration.role === 'customer' ? 'owner' : 'electrician'} signature`);
  }
  await h.section('review'); await h.press('Complete assessment and email PDF'); assert.equal(h.state.record.status, 'complete');
  assert.equal(h.state.changed, 1); assert.ok(h.button('Save completed assessment PDF on phone')); h.cleanup();
});

test('every official section and conditional question is rendered from the canonical schema', async () => {
  const value = electricalFixture({ life_support: true, life_support_consent: true, alternative_supply: true, recessed_luminaires: true, ceiling_appliances: true,
    other_hazards_present: true, assessment_outcome: 'rectification_required', electrical_works_performed: true, work_tps: true,
    rectification_notes: 'Completed synthetic rectification', '$repeat.appliances': 2, '$repeat.other_hazards': 2 });
  value.evidence.push({ id: 'saved-consent', fieldKey: 'life_support_record', sha256: activityHash('consent'), contentType: 'application/pdf', fileName: 'Consent.pdf', size: 100 });
  value.initialAttestation.scopeSha256 = activitySigningScope(value, 'before');
  value.status = 'draft'; const h = harness({ record: value }); await load(h);
  const sections = [...new Set(value.form.fields.map(field => field.section))]; assert.equal(sections.length, 12); assert.equal(value.form.fields.length, 78);
  assert.deepEqual(h.select('Assessment section').props.options.slice(0, 12).map(item => item.value), sections);
  for (const section of sections) {
    await h.section(section);
    for (const field of flow.expandedActivityFields(value.form, value.answers).filter(field => field.section === section)) assert.ok(h.texts().includes(field.label), field.key);
  }
  await h.section(sections[6]); assert.ok(h.button('Add another appliance')); await h.press('Add another appliance');
  assert.equal(h.nodes().filter(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Appliance').length, 3);
  await h.press('Remove last appliance'); assert.equal(h.nodes().filter(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Appliance').length, 2);
  await h.section('signatures'); assert.equal(h.nodes().filter(node => node.type === 'SignatureCapture').length, 2);
  h.cleanup();
});

test('native answers save the full merge, explicit No and dates, with safe retry identity', async () => {
  const initial = fixture({ answers: { property_address: 'Existing address', owner_name: 'Sam Owner' } });
  const h = harness({ record: initial }); await load(h);
  const field = initial.form.fields.find(item => item.key === 'life_support'); h.answer(field, false);
  const date = initial.form.fields.find(item => item.type === 'date' && item.section === field.section); if (date) h.answer(date, '2026-10-09');
  h.state.writeError = new Error('Synthetic network failure'); await h.press('Next'); assert.match(h.texts(), /Unsaved answers/);
  const first = h.state.requests.at(-1).body; assert.equal(first.answers.life_support, false); assert.equal(first.answers.property_address, 'Existing address'); assert.equal(first.answers.owner_name, 'Sam Owner');
  h.state.writeError = null; await h.press('Next'); assert.equal(h.state.requests.at(-1).body.requestId, first.requestId); assert.equal(h.state.record.answers.life_support, false);
  assert.match(h.texts(), /Complete Job Reference ID/); assert.equal(h.select('Assessment section').props.value, field.section);
  assert.equal(h.button('Save answers'), undefined); h.cleanup();
});

test('refresh merges remote answers while preserving unsaved local answers and conflicts', async () => {
  const h = harness({ record: fixture({ answers: { life_support: true } }) }); await load(h);
  h.answer(h.state.record.form.fields.find(item => item.key === 'life_support'), false);
  h.state.record.answers.owner_name = 'New remote owner'; await h.press('Refresh saved assessment');
  await h.press('Next'); assert.equal(h.state.record.answers.owner_name, 'New remote owner'); assert.equal(h.state.record.answers.life_support, false);
  h.answer(h.state.record.form.fields.find(item => item.key === 'life_support'), true);
  h.state.record.answers.life_support = 'remote conflict'; await h.press('Refresh saved assessment'); assert.match(h.texts(), /also changed elsewhere/);
  h.cleanup();
});

test('wrong-job, malformed records, denied access and offline states never write or claim success', async () => {
  for (const response of [{ record: { id: 'wrong' }, canManage: true }, { record: { ...presentation(fixture()), workOrderId: 'other-job' }, canManage: true }, { record: { ...presentation(fixture()), answers: [] }, canManage: true }]) {
    const h = harness(); h.state.loadResponse = response; await load(h); assert.match(h.texts(), /does not match/); assert.equal(h.select('Assessment section'), undefined); h.cleanup();
  }
  const denied = harness({ canManage: false }); await load(denied); assert.equal(denied.button('Save answers'), undefined); assert.match(denied.texts(), /view only/);
  await denied.section('signatures'); assert.equal(denied.nodes().find(node => node.type === 'SignatureCapture').props.disabled, true);
  assert.equal(denied.state.requests.filter(request => request.init.method).length, 0); denied.cleanup();
  const offline = harness({ online: false }); await load(offline); assert.equal(offline.state.requests.length, 0); assert.match(offline.texts(), /Connect/); offline.cleanup();
});

test('a remotely completed assessment displays immutable canonical answers and explains unapplied local work', async () => {
  const h = harness({ record: fixture({ answers: { life_support: true } }) }); await load(h);
  h.answer(h.state.record.form.fields.find(field => field.key === 'life_support'), false);
  h.state.record.status = 'complete'; await h.press('Refresh saved assessment'); assert.match(h.texts(), /unsaved changes were not applied/);
  await h.section(h.state.record.form.fields[0].section); assert.equal(h.select(h.state.record.form.fields.find(field => field.key === 'life_support').label).props.value, 'yes');
  assert.equal(h.button('Save answers'), undefined); assert.equal(h.state.requests.filter(request => request.init.method).length, 0); h.cleanup();
});

test('initial attestation uses its own saved-scope endpoint and invalidates correctly after editing', async () => {
  const record = electricalFixture(); record.status = 'draft'; delete record.answers.initial_correct; delete record.initialAttestation;
  const h = harness({ record }); await load(h); const section = record.form.fields.find(field => field.key === 'initial_correct').section; await h.section(section);
  assert.equal(h.select(record.form.fields.find(field => field.key === 'initial_correct').label), undefined);
  await h.press('Confirm initial assessment declaration'); assert.equal(h.state.requests.at(-1).body.action, 'attest_initial'); assert.equal(h.state.record.answers.initial_correct, true);
  const electrician = record.form.fields.find(field => field.key === 'initial_electrician_name'); h.answer(electrician, 'Changed actual electrician');
  assert.equal(h.button('Confirm initial assessment declaration').props.disabled, false);
  await h.press('Confirm initial assessment declaration'); assert.equal(h.state.record.answers.initial_correct, true);
  assert.equal(h.state.requests.at(-2).init.method, 'PATCH'); assert.equal(h.state.requests.at(-1).body.action, 'attest_initial');
  assert.equal(h.state.record.initialAttestation.scopeSha256, activitySigningScope(h.state.record, 'before')); h.cleanup();
});

test('a native selected original is retained after failed upload and retries with its bound revision', async () => {
  const record = electricalFixture({ life_support: true, life_support_consent: true }); record.status = 'draft';
  const h = harness({ record }); await load(h); const field = record.form.fields.find(item => item.key === 'life_support_record');
  await h.section(field.section); h.state.files.set('picked.pdf', new Uint8Array([37, 80, 68, 70, 45]));
  h.state.document = { canceled: false, assets: [{ uri: 'picked.pdf', name: 'Consent.pdf' }] }; h.state.writeError = new Error('Upload connection interrupted');
  await h.press('Choose document'); assert.match(h.texts(), /retained on your phone/); assert.equal(h.state.files.size, 2);
  const first = h.state.requests.at(-1).body; assert.equal(first.fieldKey, field.key); assert.equal(first.action, 'upload');
  h.state.writeError = null; await h.press('Retry evidence upload'); assert.equal(h.state.requests.at(-1).body.requestId, first.requestId);
  assert.equal(h.state.record.evidence.length, 1); assert.equal(h.state.files.size, 1, 'Retained copy deleted only after verified upload'); h.cleanup();
});

test('actual owner ink and consent complete the native form and expose real PDF and both delivery states', async () => {
  const value = electricalFixture(); value.status = 'draft'; const h = harness({ record: value }); await load(h);
  await h.section('review'); assert.equal(h.select('Assessment section').props.value, 'signatures'); assert.match(h.texts(), /before continuing/);
  assert.equal(h.nodes().find(node => node.type === 'SignatureCapture').props.disabled, true);
  await h.section('signatures'); const checkbox = h.nodes().find(node => node.type === 'Pressable'); assert.equal(checkbox.props.disabled, false); checkbox.props.onPress(); h.render();
  let pad = h.nodes().find(node => node.type === 'SignatureCapture'); assert.equal(pad.props.disabled, false); assert.equal(pad.props.value.signerName, value.answers.owner_name);
  assert.equal(h.button('Save owner signature').props.disabled, true); pad.props.onChange({ ...pad.props.value, strokes }); h.render(); await h.press('Save owner signature');
  assert.equal(h.state.requests.at(-1).body.signerName, value.answers.owner_name); assert.equal(h.state.requests.at(-1).body.strokes[0].points.length, 3);
  await h.section('review'); h.state.writeError = new Error('PDF generation failed'); await h.press('Complete assessment and email PDF');
  assert.equal(h.state.record.status, 'draft'); assert.equal(h.state.changed, 0); assert.match(h.texts(), /PDF generation failed/); assert.equal(h.button('Save completed assessment PDF on phone'), undefined);
  const first = h.state.requests.at(-1).body; h.state.writeError = null; await h.press('Complete assessment and email PDF'); assert.equal(h.state.requests.at(-1).body.requestId, first.requestId);
  assert.equal(h.state.record.status, 'complete'); assert.equal(h.state.changed, 1); assert.match(h.texts(), /Customer copy.*accepted/); assert.match(h.texts(), /Business copy.*failed/);
  await h.press('Save completed assessment PDF on phone'); assert.deepEqual(h.state.downloadCalls, [[value.id, 'pdf', 'business-test', '']]);
  assert.ok([...h.state.files.keys()].some(uri => uri.startsWith('user-selected-folder/'))); assert.deepEqual(h.state.links, []); assert.match(h.texts(), /folder you selected/);
  await h.press('Retry email delivery'); assert.equal(h.state.requests.at(-1).body.action, 'retry_delivery'); assert.equal(h.state.requests.at(-1).body.baseRevision, undefined);
  assert.equal(h.button('Save answers'), undefined); h.cleanup();
});

test('both conditional electrician and owner signatures are required for a rectified assessment', async () => {
  const value = electricalFixture({ assessment_outcome: 'rectification_required', work_other: true, rectification_notes: 'Non-electrical safety rectification', electrical_works_performed: false });
  value.status = 'draft'; const h = harness({ record: value }); await load(h); await h.section('signatures');
  assert.equal(h.nodes().filter(node => node.type === 'SignatureCapture').length, 2);
  for (const role of ['electrician', 'owner']) {
    const key = role === 'owner' ? 'property_owner' : 'rectification_electrician';
    const box = h.nodes().find(node => node.type === 'View' && node.props.children?.[0]?.props?.children === value.form.declarations.find(item => item.key === key).title);
    const flatten = node => Array.isArray(node) ? node.flatMap(flatten) : !node || typeof node !== 'object' ? [] : [node, ...flatten(node.props?.children)];
    const checkbox = flatten(box).find(node => node.type === 'Pressable'); assert.equal(checkbox.props.disabled, false); checkbox.props.onPress(); h.render();
    const pad = h.nodes().find(node => node.type === 'SignatureCapture' && node.props.signerRole.roleKey === key); pad.props.onChange({ ...pad.props.value, strokes }); h.render(); await h.press(`Save ${role} signature`);
  }
  await h.section('review'); assert.equal(h.button('Complete assessment and email PDF').props.disabled, false); await h.press('Complete assessment and email PDF'); h.cleanup();
});

test('saving a native PDF handles folder cancellation and denied writes without fake success', async () => {
  const value = electricalFixture(); const h = harness({ record: value }); await load(h);
  h.state.folderError = new Error('User cancelled directory picker'); await h.press('Save completed assessment PDF on phone');
  assert.equal(h.state.files.size, 0); assert.doesNotMatch(h.texts(), /folder you selected/);
  h.state.folderError = null; h.state.fileWriteError = new Error('Folder write permission denied'); await h.press('Save completed assessment PDF on phone');
  assert.match(h.texts(), /Folder write permission denied/); assert.equal(h.state.files.size, 0); assert.doesNotMatch(h.texts(), /folder you selected/); h.cleanup();
});

test('native navigation blocks unsaved work and clears abandoned retained evidence only after explicit discard', async () => {
  const h = harness(); await load(h); h.answer(h.state.record.form.fields.find(field => field.key === 'life_support'), false);
  h.button('Back to job').props.onPress(); assert.equal(h.state.left, 0); assert.match(h.state.alerts.at(-1)[0], /Unsaved/);
  h.state.alerts.at(-1)[2][1].onPress(); assert.equal(h.state.left, 1); h.cleanup();
});

test('Next and the section selector cannot bypass empty required fields or invent an answer', async () => {
  const h = harness(); await load(h); const first = h.select('Assessment section').props.value;
  assert.equal(h.button('Save answers'), undefined);
  await h.press('Next'); assert.equal(h.select('Assessment section').props.value, first); assert.match(h.texts(), /Complete Job Reference ID/);
  await h.section('signatures'); assert.equal(h.select('Assessment section').props.value, first);
  assert.equal(h.state.requests.filter(request => request.init.method).length, 0); assert.deepEqual(h.state.record.answers, {});
  h.cleanup();
});

test('whitespace is not a required answer, while an explicit No survives autosave', async () => {
  const h = harness(); await load(h); const field = key => h.state.record.form.fields.find(item => item.key === key);
  h.answer(field('job_reference'), '   '); h.answer(field('property_address'), 'Synthetic address');
  h.answer(field('inspection_date'), '2026-10-08'); h.answer(field('life_support'), false);
  await h.press('Next'); assert.match(h.texts(), /Complete Job Reference ID/); assert.equal(h.state.record.answers.job_reference, undefined);
  assert.equal(h.state.record.answers.life_support, false); assert.equal(h.select('Assessment section').props.value, field('job_reference').section);
  h.answer(field('job_reference'), 'SYNTHETIC-JOB'); await h.press('Next');
  assert.notEqual(h.select('Assessment section').props.value, field('job_reference').section);
  assert.equal(h.state.record.answers.job_reference, 'SYNTHETIC-JOB'); h.cleanup();
});

test('Back persists an incomplete section and a failed save leaves its answers and page intact', async () => {
  const record = electricalFixture(); record.status = 'draft'; const h = harness({ record }); await load(h);
  const owner = record.form.fields.find(field => field.key === 'owner_name'); await h.section(owner.section);
  h.answer(owner, 'Changed owner'); const page = h.select('Assessment section').props.value;
  h.state.writeError = new Error('Synthetic save interrupted'); await h.press('Back');
  assert.equal(h.select('Assessment section').props.value, page); assert.equal(h.select(owner.label).props.value, 'Changed owner');
  assert.equal(h.state.record.answers.owner_name, 'Sam Owner'); const failed = h.state.requests.at(-1).body;
  h.state.writeError = null; await h.press('Back'); assert.equal(h.state.requests.at(-1).body.requestId, failed.requestId);
  assert.equal(h.state.record.answers.owner_name, 'Changed owner'); assert.notEqual(h.select('Assessment section').props.value, page);
  await h.section(owner.section); h.answer(owner, ''); await h.press('Back');
  assert.equal(h.state.record.answers.owner_name, undefined); assert.notEqual(h.select('Assessment section').props.value, page);
  h.cleanup();
});

test('a missing conditional evidence document blocks Next in its own section', async () => {
  const record = electricalFixture({ life_support: true, life_support_consent: true }); record.status = 'draft';
  const h = harness({ record }); await load(h); const evidence = record.form.fields.find(field => field.key === 'life_support_record');
  await h.press('Next'); assert.equal(h.select('Assessment section').props.value, evidence.section); assert.ok(h.texts().includes(evidence.label));
  assert.equal(h.nodes().some(node => node.type === 'SignatureCapture'), false);
  h.state.files.set('consent.pdf', new TextEncoder().encode('%PDF-synthetic-consent'));
  h.state.document = { canceled: false, assets: [{ uri: 'consent.pdf', name: 'Consent.pdf' }] };
  await h.press('Choose document'); await h.press('Next'); assert.notEqual(h.select('Assessment section').props.value, evidence.section);
  h.cleanup();
});

test('initial confirmation never attests after failed autosave or incomplete initial answers', async () => {
  const record = electricalFixture(); record.status = 'draft'; delete record.answers.initial_correct; delete record.initialAttestation;
  const h = harness({ record }); await load(h); const electrician = record.form.fields.find(field => field.key === 'initial_electrician_name');
  await h.section(electrician.section); h.answer(electrician, 'Updated electrician');
  h.state.writeError = new Error('Synthetic connection loss'); await h.press('Confirm initial assessment declaration');
  assert.equal(h.state.requests.some(request => request.body?.action === 'attest_initial'), false);
  assert.equal(h.select(electrician.label).props.value, 'Updated electrician'); assert.equal(h.state.record.answers.initial_correct, undefined);
  h.state.writeError = null; h.answer(electrician, ''); await h.press('Confirm initial assessment declaration');
  assert.match(h.texts(), /Complete the initial assessment answers/); assert.equal(h.state.record.initialAttestation, undefined);
  assert.equal(h.state.record.answers.initial_correct, undefined); h.cleanup();
});

test('an unchanged normalized initial scope keeps its actual attestation without submitting it twice', async () => {
  const record = electricalFixture(); record.status = 'draft'; const h = harness({ record }); await load(h);
  const electrician = record.form.fields.find(field => field.key === 'initial_electrician_name'); await h.section(electrician.section);
  h.answer(electrician, `${record.answers.initial_electrician_name} `); await h.press('Confirm initial assessment declaration');
  assert.equal(h.state.record.answers.initial_correct, true); assert.equal(h.state.record.initialAttestation.scopeSha256, record.initialAttestation.scopeSha256);
  assert.equal(h.state.requests.filter(request => request.body?.action === 'attest_initial').length, 0);
  assert.equal(h.state.requests.filter(request => request.init.method === 'PATCH').length, 1); assert.doesNotMatch(h.texts(), /already been recorded/); h.cleanup();
});

test('a blank no-rectification form completes sequentially through required observations, attestation and genuine owner ink', async () => {
  const target = electricalFixture(); const h = harness(); await load(h);
  for (const section of [...new Set(target.form.fields.map(field => field.section))]) {
    assert.equal(h.select('Assessment section').props.value, section, 'Only the visible current section is answered');
    for (const field of flow.expandedActivityFields(target.form, target.answers).filter(field => field.section === section && field.required)) {
      if (field.key === 'initial_correct') await h.press('Confirm initial assessment declaration');
      else h.answer(field, target.answers[field.key]);
    }
    await h.press('Next'); assert.notEqual(h.select('Assessment section').props.value, section);
  }
  assert.equal(h.select('Assessment section').props.value, 'signatures'); assert.equal(h.state.record.signatures.length, 0);
  assert.equal(h.nodes().filter(node => node.type === 'SignatureCapture').length, 1); assert.ok(h.state.record.initialAttestation);
  await h.press('Next'); assert.equal(h.select('Assessment section').props.value, 'signatures', 'Actual signature cannot be skipped');
  const checkbox = h.nodes().find(node => node.type === 'Pressable'); checkbox.props.onPress(); h.render();
  const pad = h.nodes().find(node => node.type === 'SignatureCapture'); assert.equal(pad.props.disabled, false);
  pad.props.onChange({ ...pad.props.value, strokes }); h.render(); await h.press('Save owner signature'); await h.press('Next');
  assert.equal(h.select('Assessment section').props.value, 'review'); await h.press('Complete assessment and email PDF');
  assert.equal(h.state.record.status, 'complete'); assert.ok(h.button('Save completed assessment PDF on phone')); h.cleanup();
});

test('authoritative blank-only prefills remain editable, save on Next and never return after a local clear', async () => {
  const h = harness(); h.state.loadResponse = { record: { ...presentation(h.state.record), prefillAnswers: {
    job_reference: 'KNOWN-JOB', property_address: 'Known job address', owner_name: 'Known owner', initial_electrician_name: 'Known member',
  } }, canManage: true }; await load(h);
  const field = key => h.state.record.form.fields.find(item => item.key === key);
  assert.equal(h.select(field('job_reference').label).props.value, 'KNOWN-JOB'); assert.equal(h.state.record.answers.job_reference, undefined);
  h.answer(field('job_reference'), ''); await h.press('Refresh saved assessment'); assert.equal(h.select(field('job_reference').label).props.value, '');
  h.answer(field('job_reference'), 'Confirmed job'); h.answer(field('inspection_date'), '2026-10-08'); h.answer(field('life_support'), false);
  h.state.loadResponse = null; await h.press('Next'); assert.equal(h.state.record.answers.job_reference, 'Confirmed job');
  assert.equal(h.state.record.answers.property_address, 'Known job address'); assert.equal(h.state.record.answers.owner_name, 'Known owner'); h.cleanup();
});

test('business contact suggestion requires an explicit action and never fills a REC registration or overwrites a name', async () => {
  const record = electricalFixture(); record.status = 'draft'; delete record.initialAttestation; delete record.answers.initial_correct;
  delete record.answers.initial_rec_phone; record.answers.initial_rec_name = 'Actual REC';
  const h = harness({ record }); h.state.loadResponse = { record: { ...presentation(record), businessContactSuggestion: { name: 'Business suggestion', phone: '0399999999' } }, canManage: true };
  await load(h); const field = key => record.form.fields.find(item => item.key === key); await h.section(field('initial_rec_name').section);
  assert.equal(h.select(field('initial_rec_phone').label).props.value, ''); assert.match(h.texts(), /only if they are the Registered Electrical Contractor/);
  const registration = h.select(field('initial_rec_number').label).props.value; await h.press('Use business contact details');
  assert.equal(h.select(field('initial_rec_name').label).props.value, 'Actual REC'); assert.equal(h.select(field('initial_rec_phone').label).props.value, '0399999999');
  assert.equal(h.select(field('initial_rec_number').label).props.value, registration); assert.equal(h.state.record.answers.initial_rec_phone, undefined); h.cleanup();
});

test('read-only prefills do not create unsaved work or prevent viewing later sections', async () => {
  const h = harness({ canManage: false }); h.state.loadResponse = { record: { ...presentation(h.state.record), prefillAnswers: { job_reference: 'Suggested job' } }, canManage: false };
  await load(h); assert.doesNotMatch(h.texts(), /Unsaved answers/); assert.equal(h.select('Job Reference ID').props.value, '');
  await h.section('review'); assert.equal(h.select('Assessment section').props.value, 'review'); assert.equal(h.state.leaveGuard.blocked, false);
  assert.equal(h.state.requests.filter(request => request.init.method).length, 0); h.cleanup();
});

test('a required true declaration and an unanswered repeated observation block forward navigation', async () => {
  const record = electricalFixture({ ceiling_appliances: true, '$repeat.appliances': 2 }); record.status = 'draft';
  const h = harness({ record }); await load(h); const declaration = record.form.fields.find(field => field.key === 'owner_access');
  await h.section(declaration.section); h.answer(declaration, false); await h.press('Next');
  assert.equal(h.select('Assessment section').props.value, declaration.section); assert.ok(h.texts().includes(declaration.label));
  h.answer(declaration, true); await h.press('Back');
  // Reconfirm the genuine initial declaration if a changed before-phase answer invalidated it.
  const initial = record.form.fields.find(field => field.key === 'initial_correct');
  await h.section(initial.section); if (!h.button('Confirm initial assessment declaration').props.disabled) await h.press('Confirm initial assessment declaration');
  const repeated = flow.expandedActivityFields(record.form, record.answers).find(field => field.repeatGroup === 'appliances' && field.repeatIndex === 1 && field.required && field.type === 'text');
  await h.section(repeated.section); h.answer(repeated, ''); await h.press('Next');
  assert.equal(h.select('Assessment section').props.value, repeated.section); assert.ok(h.texts().includes(repeated.label));
  assert.equal(h.state.record.answers[repeated.key], undefined); h.cleanup();
});

test('native job and picker mount the runner rather than handing completion to a web editor', () => {
  const job = fs.readFileSync(new URL('../src/app/job/[id].tsx', import.meta.url), 'utf8');
  const picker = fs.readFileSync(new URL('../src/components/field-veu-electrical-assessment-picker.tsx', import.meta.url), 'utf8');
  assert.match(job, /<FieldVeuElectricalAssessmentWizard/); assert.match(job, /mode="files"/); assert.match(job, /onOpenElectricalAssessment=\{setElectricalAssessmentId\}/);
  assert.doesNotMatch(picker, /Linking|openURL|direct-trade\/dashboard|WebView/); assert.doesNotMatch(source, /API_BASE_URL|direct-trade\/dashboard|WebView/);
});
