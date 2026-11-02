import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as contracts from '../src/lib/trade-job-form-library.ts';
import * as theme from '../mobile/src/lib/theme.ts';

const jsx = { jsx: (type, props, key) => ({ type, props: props || {}, key }), jsxs: (type, props, key) => ({ type, props: props || {}, key }), Fragment: 'Fragment' };
const children = node => Array.isArray(node) ? node : node && typeof node === 'object' ? [node.props?.children] : [];
const nodes = (node, predicate) => node == null || typeof node !== 'object' ? [] : [...(!Array.isArray(node) && predicate(node) ? [node] : []), ...children(node).flatMap(child => nodes(child, predicate))];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ').replace(/\s+/g, ' ') : text(node.props?.children);
const tick = () => new Promise(resolve => setImmediate(resolve));

function compile(path, dependencies, timers = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const record = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', output)(id => {
    assert.ok(id in dependencies, `Unmapped native dependency ${id}`); return dependencies[id];
  }, record, record.exports, timers.setTimeout || setTimeout, timers.clearTimeout || clearTimeout);
  return record.exports;
}

function harness(path, exportName, props = {}, extra = {}) {
  let cursor = 0;
  const state = [], effects = [], pending = [], timers = new Map(); let timerId = 0;
  const changed = (before, after) => !before || !after || before.length !== after.length || before.some((value, index) => value !== after[index]);
  const react = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
    useMemo(callback, dependencies) { const index = cursor++; if (!state[index] || changed(state[index].dependencies, dependencies)) state[index] = { dependencies, value: callback() }; return state[index].value; },
    useEffect(callback, dependencies) { const index = cursor++; if (!effects[index] || changed(effects[index].dependencies, dependencies)) { const previous = effects[index]; effects[index] = { dependencies }; pending.push(() => { previous?.cleanup?.(); effects[index].cleanup = callback(); }); } },
  };
  const native = Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'Modal'].map(name => [name, name]));
  native.StyleSheet = { create: value => value };
  native.PanResponder = { create: () => ({ panHandlers: {} }) };
  native.Alert = { alert() {} };
  const dependencies = { react, 'react/jsx-runtime': jsx, 'react-native': native,
    '@/lib/theme': theme, '../../../src/lib/trade-job-form-library': contracts,
    './field-button': { FieldButton: 'FieldButton' }, '@/components/field-button': { FieldButton: 'FieldButton' },
    './field-select': { FieldSelect: 'FieldSelect' }, ...extra };
  const time = { setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); } };
  dependencies['@/components/job-work-selection'] = compile('mobile/src/components/job-work-selection.tsx', dependencies, time);
  const component = compile(path, dependencies, time)[exportName];
  const render = () => { cursor = 0; const tree = component(props); for (const effect of pending.splice(0)) effect(); return tree; };
  return {
    render, update(next) { props = { ...props, ...next }; },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); timers.clear(); },
    async settle() { let tree; for (let count = 0; count < 6; count++) { tree = render(); for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } await tick(); } return tree; },
  };
}

const rental = { kind: 'rental', moduleKey: 'minimum_standards', name: 'Rental minimum standards assessment' };
const business = { kind: 'business', templateKey: 'solar-handover', templateVersion: 3, name: 'Solar handover' };
const piesa = { kind: 'piesa', name: 'Pre-installation electrical safety assessment' };
const electrical = { kind: 'safety-check', checkKind: 'electrical', name: 'Official electrical safety check' };
const gas = { kind: 'safety-check', checkKind: 'gas', name: 'Official gas safety check' };
const creditex = { kind: 'creditex', programTemplateId: 'vic-veu', activityTemplateId: 'veu-1', variantId: 'veu_1_residential', name: 'Water heating activity' };
const option = (selection, patch = {}) => ({
  id: contracts.tradeJobFormSelectionId(selection), name: selection.name, selection,
  group: selection.kind === 'business' ? 'Business forms' : selection.kind === 'rental' || selection.kind === 'safety-check' ? 'Rental assessments' : 'Creditex forms',
  jurisdiction: 'VIC', categories: selection.kind === 'business' ? ['solar'] : selection.kind === 'rental' ? ['minimum-rental-standards']
    : selection.kind === 'safety-check' ? [selection.checkKind] : selection.kind === 'piesa' ? ['insulation'] : ['hot-water'],
  description: selection.kind === 'piesa' ? 'PIESA with evidence and signatures' : `Complete ${selection.name}`,
  searchText: selection.kind === 'creditex' ? 'VEU activity 1 hot water' : '', unavailableReason: '', ...patch,
});
const allForms = [rental, business, piesa, electrical, gas, creditex].map(selection => option(selection));
const find = (tree, predicate) => nodes(tree, predicate)[0];
const button = (tree, label) => find(tree, node => node.type === 'FieldButton' && text(node) === label);
const picker = tree => find(tree, node => node.type === 'FormPicker');
const select = (tree, label) => find(tree, node => node.type === 'FieldSelect' && node.props.label === label);

test('native all-form search matches every family, names and program codes while keeping unavailable choices visible', async t => {
  const selected = [], removed = [];
  const h = harness('mobile/src/components/field-new-job-form-picker.tsx', 'FieldNewJobFormPicker', {
    options: allForms.map(entry => entry.selection.kind === 'safety-check' && entry.selection.checkKind === 'gas' ? { ...entry, unavailableReason: 'Gas forms cover Victorian properties.' } : entry),
    selections: [], loading: false, error: '', disabled: false,
    onSelect: value => selected.push(value), onRemove: value => removed.push(value), onRetry() {},
  }); t.after(() => h.unmount());
  let tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === 'Pressable').length, 6);
  const search = query => { find(tree, node => node.type === 'TextInput').props.onChangeText(query); tree = h.render(); };
  for (const [query, expected] of [['ReNtAl minimum', rental.name], ['solar', business.name], ['PIESA', piesa.name], ['VEU 1', creditex.name], ['official electrical', electrical.name]]) {
    search(query);
    const rows = nodes(tree, node => node.type === 'Pressable');
    assert.equal(rows.length, 1); assert.match(text(rows[0]), new RegExp(expected));
  }
  search('gas');
  const blocked = find(tree, node => node.type === 'Pressable');
  assert.equal(blocked.props.disabled, true); assert.match(text(blocked), /Victorian/);
  search('rental minimum');
  find(tree, node => node.type === 'Pressable').props.onPress();
  assert.equal(selected[0].id, contracts.tradeJobFormSelectionId(rental));
  h.update({ selections: [rental] }); tree = h.render();
  assert.equal(find(tree, node => node.type === 'Pressable').props.disabled, true);
  button(tree, `Remove ${rental.name}`).props.onPress(); assert.deepEqual(removed, [rental]);
  search('not-a-real-form'); assert.match(text(tree), /No forms match/);
});

function newJob({ canAddForms = true, library = () => Promise.resolve({ options: allForms }), assignees = () => [{ id: 'kris', displayName: 'Kris Chen' }] } = {}) {
  const requests = [], created = []; let syncCalls = 0;
  const api = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.startsWith('/api/field/job-options?')) return {
      permissions: { canCreateJobs: true, canAssignJobs: false, canAddForms }, memberId: 'kris',
      services: [{ id: 'assessment', label: 'Energy assessment' }, { id: 'solar', label: 'Solar' }, { id: 'minimum-rental-standards', label: 'Rental minimum standards' }, { id: 'rental-inspection', label: 'Rental inspections and safety checks' }],
      assignees: assignees(new URL(url, 'https://test').searchParams), moreAssignees: false,
      programs: [{ id: 'vic-veu', code: 'VEU', label: 'VEU' }], activities: [{ id: 'veu-1', programCode: 'VEU', code: '1', title: creditex.name, serviceCategory: 'hot-water' }],
    };
    if (url.startsWith('/api/trade-job-form-library?')) return library(new URL(url, 'https://test').searchParams, init);
    if (url.startsWith('/api/address-localities')) return { localities: [{ suburb: 'Melbourne', state: 'VIC' }] };
    const body = init.body ? JSON.parse(init.body) : {};
    if (url === '/api/trade-address-suggestions') return { configured: false, predictions: [] };
    if (url === '/api/trade-crm' && body.action === 'find_field_customer_by_email') return { duplicateCandidates: [] };
    if (url === '/api/trade-crm' && body.action === 'create_scheduled_job') { created.push(body); return { ok: true, id: 'new-job', workNumber: 'TLJ-NEW' }; }
    throw Error(`Unexpected request ${url}`);
  };
  const h = harness('mobile/src/app/new-job.tsx', 'default', {}, {
    '@/lib/use-business-api': { useBusinessApi: () => api },
    '@expo/vector-icons/MaterialCommunityIcons': 'Icon', 'expo-crypto': { randomUUID: () => 'test-session-id' },
    'expo-router': { router: { replace() {} }, useNavigation: () => ({ dispatch() {}, goBack() {} }) },
    'expo-router/react-navigation': { usePreventRemove() {} },
    '@/components/field-select': { FieldSelect: 'FieldSelect' }, '@/components/field-date-picker': { FieldDatePicker: 'FieldDatePicker' },
    '@/components/field-new-job-form-picker': { FieldNewJobFormPicker: 'FormPicker' },
    '@/components/screen': { Screen: 'Screen' }, '@/lib/api': { ApiError: class extends Error {} },
    '@/providers/app-provider': { useApp: () => ({ syncNow: async () => { syncCalls++; } }) },
  });
  return { ...h, requests, created, get syncCalls() { return syncCalls; } };
}

async function customerAndWork(h) {
  let tree = await h.settle();
  for (const [label, value] of [['First name', 'Sam'], ['Last name', 'Bolton'], ['Email', 'sam@example.test'], ['Mobile', '0412345678'], ['Street address', '18 Test Street'], ['Postcode', '3000']]) {
    find(tree, node => node.props.label === label).props.onChangeText(value);
  }
  tree = await h.settle(); button(tree, 'Next').props.onPress(); tree = await h.settle();
  select(tree, 'Work type').props.onChange('assessment');
  select(tree, 'Premises type').props.onChange('house_townhouse');
  return h.settle();
}

test('native creation attaches all selected form families to ordinary work and preserves Kris self-assignment', async t => {
  const h = newJob(); t.after(() => h.unmount());
  let tree = await customerAndWork(h);
  assert.equal(picker(tree).props.options.length, 6);
  for (const entry of allForms) { picker(tree).props.onSelect(entry); tree = await h.settle(); }
  assert.equal(picker(tree).props.selections.length, 6);
  select(tree, 'Work type').props.onChange('solar'); tree = await h.settle();
  assert.equal(picker(tree).props.selections.length, 6, 'changing primary work must preserve explicit forms');
  button(tree, 'Next').props.onPress(); tree = await h.settle();
  const worker = select(tree, 'Assign to');
  assert.deepEqual(worker.props.options, [{ value: 'kris', label: 'Kris Chen (you)' }]);
  worker.props.onChange('kris'); tree = await h.settle();
  assert.equal(select(tree, 'Assign to').props.value, 'kris');
  button(tree, 'Create scheduled job').props.onPress(); await h.settle();
  assert.equal(h.created.length, 1); const saved = h.created[0];
  assert.equal(saved.serviceCategory, 'solar'); assert.equal(saved.assigneeMemberId, 'kris');
  assert.deepEqual(JSON.parse(saved.rentalInspectionModulesJson), ['minimum_standards']);
  assert.deepEqual(JSON.parse(saved.formSelectionsJson), [{ templateKey: 'solar-handover', templateVersion: 3 }]);
  assert.equal(saved.attachVeuElectricalAssessment, true);
  assert.deepEqual(JSON.parse(saved.safetyCheckKindsJson), ['electrical', 'gas']);
  assert.deepEqual(JSON.parse(saved.complianceActivitiesJson), [{ programTemplateId: 'vic-veu', activityTemplateId: 'veu-1', variantId: 'veu_1_residential' }]);
  assert.equal(h.syncCalls, 1);
  const optionRequest = h.requests.filter(request => request.url.startsWith('/api/field/job-options?')).at(-1);
  assert.deepEqual(JSON.parse(new URL(optionRequest.url, 'https://test').searchParams.get('rentalModules')), ['minimum_standards']);
  assert.deepEqual(JSON.parse(new URL(optionRequest.url, 'https://test').searchParams.get('safetyCheckKinds')), ['electrical', 'gas']);
});

test('legacy rental work requires a form before scheduling and accepts an official safety check alone', async t => {
  const h = newJob(); t.after(() => h.unmount());
  let tree = await customerAndWork(h);
  select(tree, 'Work type').props.onChange('rental-inspection'); tree = await h.settle();
  button(tree, 'Next').props.onPress(); tree = await h.settle();
  assert.match(text(tree), /Choose at least one rental assessment or official safety check/);
  assert.ok(picker(tree));
  picker(tree).props.onSelect(option(gas)); tree = await h.settle();
  button(tree, 'Next').props.onPress(); tree = await h.settle();
  select(tree, 'Assign to').props.onChange('kris'); tree = await h.settle();
  button(tree, 'Create scheduled job').props.onPress(); await h.settle();
  assert.equal(h.created.length, 1);
  assert.deepEqual(JSON.parse(h.created[0].rentalInspectionModulesJson), []);
  assert.deepEqual(JSON.parse(h.created[0].safetyCheckKindsJson), ['gas']);
});

test('native removal updates creation payload and does not silently restore the rental form', async t => {
  const h = newJob(); t.after(() => h.unmount());
  let tree = await customerAndWork(h);
  picker(tree).props.onSelect(option(rental)); tree = await h.settle();
  picker(tree).props.onRemove(rental); tree = await h.settle();
  assert.deepEqual(picker(tree).props.selections, []);
  button(tree, 'Next').props.onPress(); tree = await h.settle();
  select(tree, 'Assign to').props.onChange('kris'); tree = await h.settle();
  button(tree, 'Create scheduled job').props.onPress(); await h.settle();
  assert.deepEqual(JSON.parse(h.created[0].rentalInspectionModulesJson), []);
});

test('native creation blocks chosen forms while metadata is stale and rejects a newly unavailable form', async t => {
  let release;
  const h = newJob({ library: query => query.get('buildingType') === 'commercial_office'
    ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ options: allForms }) }); t.after(() => h.unmount());
  let tree = await customerAndWork(h);
  picker(tree).props.onSelect(option(rental)); tree = await h.settle();
  select(tree, 'Premises type').props.onChange('commercial_office'); tree = await h.settle();
  assert.equal(picker(tree).props.loading, true);
  button(tree, 'Next').props.onPress(); tree = h.render();
  assert.match(text(tree), /Wait for the current form library/); assert.ok(picker(tree));
  release({ options: allForms.map(entry => entry.id === contracts.tradeJobFormSelectionId(rental) ? { ...entry, unavailableReason: 'Rental forms are unavailable for this property.' } : entry) });
  tree = await h.settle(); button(tree, 'Next').props.onPress(); tree = h.render();
  assert.match(text(tree), /Rental forms are unavailable for this property/);
  assert.equal(picker(tree).props.selections.length, 1); assert.equal(h.created.length, 0);
});

test('staff without form permissions can create an ordinary job without loading or attaching forms', async t => {
  const h = newJob({ canAddForms: false }); t.after(() => h.unmount());
  let tree = await customerAndWork(h);
  assert.equal(picker(tree), undefined); assert.match(text(tree), /permissions do not allow adding job forms/);
  button(tree, 'Next').props.onPress(); tree = await h.settle();
  select(tree, 'Assign to').props.onChange('kris'); tree = await h.settle();
  button(tree, 'Create scheduled job').props.onPress(); await h.settle();
  assert.equal(h.created.length, 1); assert.deepEqual(JSON.parse(h.created[0].formSelectionsJson), []);
  assert.equal(h.requests.filter(request => request.url.startsWith('/api/trade-job-form-library?')).length, 0);
});

test('worker eligibility refresh clears a previous self-assignment when selected safety work needs another qualification', async t => {
  const h = newJob({ assignees: query => JSON.parse(query.get('safetyCheckKinds') || '[]').length ? [] : [{ id: 'kris', displayName: 'Kris Chen' }] }); t.after(() => h.unmount());
  let tree = await customerAndWork(h); button(tree, 'Next').props.onPress(); tree = await h.settle();
  select(tree, 'Assign to').props.onChange('kris'); tree = await h.settle();
  button(tree, 'Previous').props.onPress(); tree = await h.settle();
  picker(tree).props.onSelect(option(electrical)); tree = await h.settle();
  button(tree, 'Next').props.onPress(); tree = await h.settle();
  assert.equal(select(tree, 'Assign to').props.value, ''); assert.deepEqual(select(tree, 'Assign to').props.options, []);
  assert.equal(button(tree, 'Create scheduled job').props.disabled, true); assert.equal(h.created.length, 0);
});
