import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const picker = compile('../src/components/field-veu-electrical-assessment-picker.tsx');
const cataloguePicker = compile('../src/components/field-job-activity-picker.tsx');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const record = { id: 'assessment-one', workOrderId: 'job / one', recordNumber: 'PIESA-TEST', status: 'draft' };

function harness({ code = picker, entry = 'FieldVeuElectricalAssessmentPicker', response = { records: [], canManage: true }, online = true } = {}) {
  const slots = [], effects = [], pending = []; let cursor = 0, tree, unmounted = false;
  const listeners = new Set();
  const state = { response, requests: [], links: [], opened: [], changes: 0, states: [], props: { workOrderId: record.workOrderId, online,
    onOpen: value => state.opened.push(value), onOpenElectricalAssessment: value => state.opened.push(value),
    onStateChange: value => state.states.push(value),
    onChanged: async () => { state.changes++; if (state.changeError) throw state.changeError; } } };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { assert.equal(unmounted, false, 'No state updates after unmount'); slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { fn, deps }; return slots[index].fn; },
    useEffect(fn, deps) { const index = cursor++; if (!effects[index] || !same(effects[index].deps, deps)) {
      const previous = effects[index]; effects[index] = { deps }; pending.push(() => { previous?.cleanup?.(); effects[index].cleanup = fn(); }); } },
  };
  const api = async (path, init = {}) => {
    state.requests.push({ path, init });
    if (init.method === 'POST') { if (state.writeError) throw state.writeError; return state.writeResponse || { record }; }
    if (state.loadError) throw state.loadError;
    return state.response;
  };
  const dependencies = { react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: value => value },
      AppState: { currentState: 'active', addEventListener: (_type, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } },
      Linking: { openURL: async url => { state.links.push(url); if (state.linkError) throw state.linkError; } } },
    './field-button': { FieldButton: 'FieldButton' }, './field-select': { FieldSelect: 'FieldSelect' },
    './field-veu-electrical-assessment-picker': { FieldVeuElectricalAssessmentPicker: 'FieldVeuElectricalAssessmentPicker' },
    './job-work-selection': { fieldActivityPremisesVariantId: () => '', fieldActivityRequiresPremisesVariant: () => false },
    '@/lib/theme': { colours: {}, spacing: {} }, '@/lib/config': { API_BASE_URL: 'https://fixture.invalid' },
    '@/lib/use-business-api': { useBusinessApi: () => api },
  };
  const exports = {};
  new Function('require', 'exports', code)(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, exports);
  function render() { cursor = 0; tree = exports[entry](state.props); while (pending.length) pending.shift()(); return tree; }
  const visit = node => Array.isArray(node) ? node.flatMap(visit) : !node || typeof node !== 'object' ? [] : [node, ...visit(node.props?.children)];
  const nodes = () => visit(tree);
  return { state, render, nodes, button: name => nodes().find(node => node.type === 'FieldButton' && node.props.children === name),
    texts: () => nodes().filter(node => node.type === 'Text').flatMap(node => [node.props.children].flat(3)).join(' '),
    appState: value => { for (const listener of listeners) listener(value); },
    cleanup: () => { for (const effect of effects) effect?.cleanup?.(); unmounted = true; assert.equal(listeners.size, 0); } };
}

test('the same Form or program picker exposes PIESA for each practical search term', async () => {
  const h = harness({ code: cataloguePicker, entry: 'FieldJobActivityPicker', response: {
    revision: 1, buildingType: '', canAdd: true, unavailableReason: '', rentalModules: [], activities: [],
    programs: Array.from({ length: 9 }, (_, i) => ({ id: `program-${i}`, code: 'P', label: `Program ${i}` })),
  } });
  h.render(); await flush(); h.render();
  const select = h.nodes().find(node => node.type === 'FieldSelect' && node.props.label === 'Form or program');
  const option = select.props.options.find(option => option.value === 'veu_electrical');
  assert.equal(option.label, 'Pre-installation electrical safety assessment (Insulation) · PIESA');
  for (const query of ['pre', 'insulation', 'electrical', 'piesa']) assert.ok(select.props.options.filter(option => option.label.toLowerCase().includes(query)).includes(option), query);
  select.props.onChange(option.value); h.render();
  assert.ok(h.nodes().some(node => node.type === 'FieldVeuElectricalAssessmentPicker'));
  assert.equal(h.nodes().filter(node => node.type === 'FieldSelect').length, 1, 'PIESA does not ask for a program activity or create a workpack');
  h.cleanup();
});

test('attaching uses the real assessment start API once and retains the verified record', async () => {
  const h = harness(); h.render(); await flush(); h.render();
  assert.equal(h.state.requests[0].path, '/api/trade-veu-electrical-assessments?workOrderId=job%20%2F%20one');
  const add = h.button('Add to this job'); add.props.onPress(); add.props.onPress(); await flush(); h.render();
  const writes = h.state.requests.filter(request => request.init.method === 'POST'); assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].init.body), { action: 'start', workOrderId: record.workOrderId });
  assert.equal(writes[0].path, '/api/trade-veu-electrical-assessments'); assert.equal(h.state.changes, 1);
  assert.ok(h.button('Open assessment')); assert.equal(h.button('Add to this job'), undefined); assert.match(h.texts(), /PIESA-TEST/);
  h.cleanup();
});

test('an existing form selects the exact native assessment without a browser or another attachment', async () => {
  const h = harness({ response: { records: [record], canManage: true } }); h.render(); await flush(); h.render();
  h.button('Open assessment').props.onPress(); await flush();
  assert.deepEqual(h.state.opened, [record.id]); assert.deepEqual(h.state.links, []);
  assert.equal(h.state.requests.filter(request => request.init.method === 'POST').length, 0);
  h.cleanup();
});

test('denied, offline and failed-load states cannot attach', async () => {
  for (const scenario of ['denied', 'offline', 'failed']) {
    const h = harness({ online: scenario !== 'offline', response: { records: [], canManage: scenario !== 'denied' } });
    if (scenario === 'failed') h.state.loadError = new Error('Assessment access unavailable');
    h.render(); await flush(); h.render(); assert.equal(h.button('Add to this job'), undefined, scenario);
    assert.equal(h.state.requests.filter(request => request.init.method === 'POST').length, 0);
    if (scenario === 'offline') assert.equal(h.state.requests.length, 0);
    if (scenario === 'failed') { assert.match(h.texts(), /Assessment access unavailable/); h.state.loadError = null;
      h.button('Refresh assessment').props.onPress(); h.render(); await flush(); h.render(); assert.ok(h.button('Add to this job')); }
    h.cleanup();
  }
});

test('a foreign assessment returned from load or save never becomes this job form', async () => {
  for (const scenario of ['load', 'save']) {
    const foreign = { ...record, workOrderId: 'foreign-job' };
    const h = harness({ response: { records: scenario === 'load' ? [foreign] : [], canManage: true } });
    h.render(); await flush(); h.render();
    if (scenario === 'save') { h.state.writeResponse = { record: foreign }; h.button('Add to this job').props.onPress(); await flush(); h.render(); }
    assert.equal(h.button('Open assessment'), undefined); assert.match(h.texts(), /could not be verified/); assert.equal(h.state.changes, 0);
    h.cleanup();
  }
});

test('a job refresh failure keeps the successfully attached form and exposes its open button', async () => {
  const h = harness(); h.state.changeError = new Error('Refresh failed'); h.render(); await flush(); h.render();
  h.button('Add to this job').props.onPress(); await flush(); h.render(); assert.ok(h.button('Open assessment')); assert.match(h.texts(), /Assessment added. Refresh the job/);
  assert.equal(h.state.requests.filter(request => request.init.method === 'POST').length, 1); h.cleanup();
});

test('late load and attachment responses after leaving cannot change the screen', async () => {
  const loading = deferred(), h = harness({ response: loading.promise }); h.render(); h.cleanup();
  assert.equal(h.state.requests[0].init.signal.aborted, true); loading.resolve({ records: [record], canManage: true }); await flush();
  const write = deferred(), saving = harness(); saving.render(); await flush(); saving.render(); saving.state.writeResponse = write.promise;
  saving.button('Add to this job').props.onPress(); saving.cleanup(); write.resolve({ record }); await flush(); assert.equal(saving.state.changes, 0);
});

test('the attached-only job summary reveals an existing PIESA and never offers another form', async () => {
  const h = harness({ response: { records: [record], canManage: true } }); h.state.props.mode = 'attached';
  h.render(); await flush(); h.render(); assert.match(h.texts(), /PIESA-TEST/); assert.ok(h.button('Open assessment'));
  assert.equal(h.button('Add to this job'), undefined); assert.deepEqual(h.state.states.at(-1), { workOrderId: record.workOrderId, state: 'attached' });
  h.cleanup();
  const empty = harness(); empty.state.props.mode = 'attached'; empty.render(); await flush();
  assert.equal(empty.render(), null); assert.deepEqual(empty.state.states.at(-1), { workOrderId: record.workOrderId, state: 'empty' }); empty.cleanup();
});

test('returning to the foreground refreshes canonical completion status for the same job', async () => {
  const h = harness({ response: { records: [record], canManage: true } }); h.state.props.mode = 'attached'; h.render(); await flush(); h.render();
  h.appState('background'); h.state.response = { records: [{ ...record, status: 'complete' }], canManage: true };
  h.appState('active'); h.render(); await flush(); h.render();
  assert.equal(h.state.requests.length, 2); assert.match(h.texts(), /Completed/); assert.equal(h.button('Add to this job'), undefined);
  h.appState('active'); h.render(); await flush(); assert.equal(h.state.requests.length, 2, 'Repeated active events do not reload'); h.cleanup();
});

test('Files lists completed assessment records and opens their native PDF summary only', async () => {
  const h = harness({ response: { records: [record, { ...record, id: 'completed-assessment', status: 'complete' }], canManage: true } });
  h.state.props.mode = 'files'; h.render(); await flush(); h.render();
  assert.equal(h.button('Open assessment'), undefined); assert.equal(h.button('Add to this job'), undefined);
  h.button('View completed assessment').props.onPress(); assert.deepEqual(h.state.opened, ['completed-assessment']);
  assert.deepEqual(h.state.links, []); h.cleanup();
});

test('job overview mounts the shared attached-only assessment before the empty state', () => {
  const job = fs.readFileSync(new URL('../src/app/job/[id].tsx', import.meta.url), 'utf8');
  const marker = job.indexOf('mode="attached"'); assert.ok(marker > job.indexOf('Forms to complete'));
  assert.ok(marker < job.indexOf('No forms are attached to this job.'));
  assert.match(job, /electricalAssessmentState\?\.workOrderId === job\.id && electricalAssessmentState\.state === 'empty'/);
});
