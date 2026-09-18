import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const screenSource = read('../src/app/(tabs)/training.tsx');
const screenCode = compile(screenSource);
const adapterCode = compile(read('../src/lib/training.ts'));
const text = (node) => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const button = (tree, label) => nodes(tree, node => node.type === 'FieldButton' && text(node) === label)[0];
const role = (tree, value) => nodes(tree, node => node.props.accessibilityRole === value);
const flush = () => new Promise(resolve => setImmediate(resolve));
const course = (overrides = {}) => ({ id: 'veu-6', programCode: 'VEU', version: 'exact-v1', title: 'Activity 6 heating and cooling', activityTemplateIds: ['veu-6'], estimatedMinutes: 25, passPercent: 100, availability: 'active', status: 'required', completion: null,
  lessons: [{ title: 'Exact activity requirements', body: 'Retain actual customer consent.', sourceIds: ['official'] }],
  sources: [{ id: 'official', title: 'Official activity guidance', url: 'https://www.esc.vic.gov.au/activity-guidance' }], ...overrides });
const overview = (modules = [course()]) => ({ ok: true, memberId: 'pin-member', business: { approved: false, status: 'agreement_pending', blockedReasons: ['An executed agreement is required.'] }, modules, unavailableActivities: [] });
const attempt = { id: 'attempt-25', moduleId: 'veu-6', version: 'exact-v1', expiresAt: '2099-01-01T12:00:00Z', questions: Array.from({ length: 25 }, (_, index) => ({ id: `question-${index}`, prompt: `Activity-specific question ${index + 1}`, critical: true, options: [{ id: `opaque-${index}-a`, text: 'First choice' }, { id: `opaque-${index}-b`, text: 'Second choice' }] })) };

function harness({ modules = [course()], marked, startError } = {}) {
  const state = []; const effects = []; const requests = []; const opened = []; const alerts = [];
  const app = { user: { localOwnerKey: 'field:business:pin-member', authMode: 'field_pin' }, sync: { online: true } };
  let cursor = 0; let initial = true;
  const hooks = {
    useState(value) { const index = cursor++; if (!(index in state)) state[index] = typeof value === 'function' ? value() : value; return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; },
    useCallback(callback) { return callback; },
    useEffect(callback) { if (initial) effects.push(callback); },
  };
  const api = { async loadTrainingOverview() { requests.push({ action: 'load' }); return overview(modules); },
    async startTrainingAssessment(moduleId) { requests.push({ action: 'start', moduleId }); if (startError) throw new Error(startError); return structuredClone(attempt); },
    async submitTrainingAssessment(attemptId, answers) { requests.push({ action: 'submit', attemptId, answers: { ...answers } }); return marked || { passed: false, scorePercent: 96, criticalPassed: false, reference: '', expiresAt: '', feedback: [{ questionId: 'question-0', prompt: 'Activity-specific question 1', correct: false, explanation: 'Keep the exact required evidence.', correctAnswer: 'Verified official requirement', sourceIds: ['official'] }] }; } };
  const require = id => ({ react: hooks, 'react/jsx-runtime': jsx, 'react-native': { Alert: { alert: (...args) => alerts.push(args) }, Linking: { openURL: async url => opened.push(url) }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { create: value => value } },
    '@/components/field-button': { FieldButton: 'FieldButton' }, '@/components/screen': { Screen: 'Screen' }, '@/lib/config': { API_BASE_URL: 'https://tlink.energy' }, '@/lib/theme': { colours: {}, radius: {}, spacing: {} }, '@/lib/training': api, '@/providers/app-provider': { useApp: () => app } })[id] || (() => { throw new Error(`Unexpected runtime dependency: ${id}`); })();
  const exports = {}; Function('require', 'exports', screenCode)(require, exports);
  const render = () => { cursor = 0; const wrapper = exports.default(); const tree = typeof wrapper.type === 'function' ? wrapper.type(wrapper.props) : wrapper; initial = false; return tree; };
  return { render, requests, opened, alerts, app, async mount() { render(); for (const effect of effects) effect(); await flush(); return render(); } };
}
async function learn(h) {
  let tree = await h.mount(); button(tree, 'Open learning material').props.onPress(); tree = h.render();
  assert.equal(button(tree, 'Start assessment').props.disabled, true);
  role(tree, 'checkbox')[0].props.onPress(); return h.render();
}
async function start(h) {
  const tree = await learn(h); button(tree, 'Start assessment').props.onPress(); await flush(); return h.render();
}
async function answerAll(h) {
  let tree = await start(h);
  for (let index = 0; index < 25; index++) {
    assert.match(text(tree), new RegExp(`Question ${index + 1} of 25`));
    assert.equal(role(tree, 'radiogroup').length, 1);
    role(tree, 'radio')[0].props.onPress(); tree = h.render();
    if (index < 24) { button(tree, 'Next question').props.onPress(); tree = h.render(); }
  }
  return tree;
}

test('PIN-only learner API uses existing device authentication for list, start and complete payload', async () => {
  const apiCode = compile(read('../src/lib/api.ts'));
  const calls = []; const api = {};
  const fetch = async (url, init) => { calls.push({ url, ...init }); return new Response(JSON.stringify({ ok: true, attempt, result: { passed: true, scorePercent: 100 }, ...overview() }), { headers: { 'content-type': 'application/json' } }); };
  const requireApi = id => ({ 'expo-crypto': {}, 'expo/fetch': { fetch }, '@/lib/config': { API_BASE_URL: 'https://tlink.energy', APP_VERSION: '1.0.1', MOBILE_PLATFORM: 'android' }, '@/lib/device': { getDeviceId: async () => 'test-device' }, '@/lib/auth': { firebaseAuth: { get currentUser() { throw new Error('PIN training must not access Firebase'); } } }, '@/lib/field-session': { getFieldSessionToken: async () => 'test-field-token' } })[id] || (() => { throw new Error(id); })();
  Function('require', 'exports', 'fetch', apiCode)(requireApi, api, fetch);
  const adapter = {}; Function('require', 'exports', adapterCode)(id => { assert.equal(id, '@/lib/api'); return api; }, adapter);
  await adapter.loadTrainingOverview(); await adapter.startTrainingAssessment('veu-6');
  const answers = Object.fromEntries(attempt.questions.map(q => [q.id, q.options[0].id]));
  await adapter.submitTrainingAssessment(attempt.id, answers);
  assert.equal(calls.length, 3); assert.equal(calls[0].cache, 'no-store');
  for (const call of calls) { assert.equal(call.headers.get('Authorization'), 'TLinkField test-field-token'); assert.equal(call.headers.get('x-aea-device-id'), 'test-device'); assert.equal(call.url, 'https://tlink.energy/api/trade-training'); }
  assert.deepEqual(JSON.parse(calls[1].body), { action: 'start', moduleId: 'veu-6' });
  assert.deepEqual(JSON.parse(calls[2].body), { action: 'submit', attemptId: 'attempt-25', answers });
});

test('217 activity catalogue is paged, searchable and filtered by exact programme identity', async () => {
  const h = harness({ modules: Array.from({ length: 217 }, (_, index) => course({ id: `module-${index}`, title: `Specific activity ${index}`, programCode: index < 100 ? 'ACT-SHS' : 'ACT-HES' })) });
  let tree = await h.mount(); const cards = () => nodes(tree, node => node.type === 'FieldButton' && text(node) === 'Open learning material');
  assert.equal(cards().length, 12); button(tree, 'Show 12 more activities').props.onPress(); tree = h.render(); assert.equal(cards().length, 24);
  nodes(tree, node => node.type === 'Pressable' && text(node) === 'ACT-HES')[0].props.onPress(); tree = h.render();
  assert.match(text(tree), /12 of 117 matching activities/); assert.equal(cards().length, 12);
  nodes(tree, node => node.type === 'TextInput')[0].props.onChangeText('activity 120'); tree = h.render();
  assert.equal(cards().length, 1); assert.match(text(tree), /Specific activity 120/);
  assert.match(text(tree), /business owner completes the private Creditex application/);
});

test('lessons show official sources, require reading, and a pending curriculum cannot start', async () => {
  const h = harness({ modules: [course({ availability: 'awaiting_review', status: 'awaiting_review' })] });
  const tree = await learn(h); assert.equal(button(tree, 'Start assessment').props.disabled, true);
  role(tree, 'link')[0].props.onPress(); await flush(); assert.deepEqual(h.opened, ['https://www.esc.vic.gov.au/activity-guidance']);
  assert.match(text(tree), /review and activate this exact curriculum/); assert.equal(h.requests.filter(r => r.action === 'start').length, 0);
});

test('all 25 answers are submitted; navigation and disconnect retain in-memory answers, then immediate retries reset them', async () => {
  const h = harness(); let tree = await answerAll(h);
  button(tree, 'Previous question').props.onPress(); tree = h.render(); assert.equal(role(tree, 'radio')[0].props.accessibilityState.checked, true);
  button(tree, 'Next question').props.onPress(); tree = h.render();
  h.app.sync.online = false; tree = h.render(); assert.equal(button(tree, 'Submit assessment').props.disabled, true);
  assert.equal(role(tree, 'radio')[0].props.accessibilityState.checked, true);
  h.app.sync.online = true; tree = h.render(); button(tree, 'Submit assessment').props.onPress(); await flush(); tree = h.render();
  const submitted = h.requests.find(r => r.action === 'submit'); assert.equal(Object.keys(submitted.answers).length, 25);
  assert.equal(submitted.answers['question-24'], 'opaque-24-a'); assert.equal(submitted.attemptId, 'attempt-25');
  assert.match(text(tree), /96%/); assert.match(text(tree), /need 100% to pass/); assert.doesNotMatch(text(tree), /Assessment passed/);
  button(tree, 'Review answer explanations').props.onPress(); tree = h.render(); assert.match(text(tree), /Keep the exact required evidence/);
  assert.equal(button(tree, 'Try the assessment again').props.disabled, false); button(tree, 'Try the assessment again').props.onPress(); await flush(); tree = h.render();
  assert.match(text(tree), /Question 1 of 25 · 0 answered/); assert.equal(h.requests.filter(r => r.action === 'start').length, 2);
});

test('only a server-confirmed 100% pass displays a personal learning reference', async () => {
  const h = harness({ marked: { passed: true, scorePercent: 100, criticalPassed: true, reference: 'TL-CX-TRAIN-PRIVATE-REF', expiresAt: '2027-09-18', feedback: [] } });
  let tree = await answerAll(h); button(tree, 'Submit assessment').props.onPress(); await flush(); tree = h.render();
  assert.match(text(tree), /100%/); assert.match(text(tree), /Assessment passed/); assert.match(text(tree), /TL-CX-TRAIN-PRIVATE-REF/);
  assert.match(text(tree), /not a government certificate, licence or external accreditation/); assert.equal(button(tree, 'Try the assessment again'), undefined);
});

test('locked or unavailable profiles do not fabricate a pass; expired attempts can be left with confirmation', async () => {
  const empty = await harness({ modules: [] }).mount(); assert.match(text(empty), /empty list does not approve program work/); assert.equal(button(empty, 'Start assessment'), undefined);
  const h = harness(); let tree = await start(h); role(tree, 'radio')[0].props.onPress(); tree = h.render();
  button(tree, 'Leave assessment').props.onPress(); assert.equal(h.alerts.length, 1); assert.match(text(h.render()), /Question 1 of 25/);
  h.alerts[0][2].find(item => item.style === 'destructive').onPress(); tree = h.render();
  assert.ok(button(tree, 'Start assessment')); assert.equal(role(tree, 'radiogroup').length, 0);
});

test('training is reachable in the field tabs without client answer bank or offline persistence', () => {
  assert.match(read('../src/app/(tabs)/_layout.tsx'), /Tabs\.Screen name="training"/);
  assert.doesNotMatch(screenSource + read('../src/lib/training.ts'), /correctOptionId|creditex-training-curriculum|TRAINING_MODULES|AsyncStorage|SecureStore|queueMutation|localStorage/);
});
