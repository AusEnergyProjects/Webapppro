import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as trainingSections from '../src/lib/training-service-sections.mjs';

const source = fs.readFileSync(new URL('../src/components/TrainingQuestionnaireEditor.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const endpoint = '/api/creditex-training-questionnaires';
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
function nodes(node, predicate) { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)]; }
const button = (tree, name) => nodes(tree, node => node.type === 'button' && text(node) === name)[0];
const field = (tree, name) => { const caption = node => [node.props.children].flat().filter(child => typeof child === 'string' || typeof child === 'number').join('').trim(); const label = nodes(tree, node => node.type === 'label' && (caption(node) === name || caption(node).startsWith(name + ' ')))[0]; assert.ok(label, `Missing field ${name}`); return nodes(label, node => ['input', 'textarea', 'select'].includes(node.type))[0]; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const original = () => ({ module: { id: 'veu-6', title: 'Activity 6 heating and cooling', programCode: 'VEU', version: 'original-v1', activityTemplateIds: ['veu-6'], estimatedMinutes: 25, passPercent: 100, validityDays: 365, retakeCooldownMinutes: 0, reviewStatus: 'published', scope: 'Check the actual installation.', sourceCoverage: { status: 'source_transcribed', gaps: [] }, lessons: [{ title: 'Keep job evidence', body: 'Keep photos of the actual installation.', sourceIds: ['esc'] }], sources: [{ id: 'esc', title: 'ESC installation guidance', url: 'https://www.esc.vic.gov.au/installers' }], questions: [{ id: 'q1', prompt: 'Which photo should you keep?', options: [{ id: 'a', text: 'A photo of this installation' }, { id: 'b', text: 'A supplier photo' }], correctOptionId: 'a', explanation: 'The photo must show the actual work.', sourceIds: ['esc'], critical: true }] }, assignment: { kind: 'catalogue', serviceCategory: 'heating-cooling', jurisdictions: ['VIC'], activityLabel: 'Activity 6' }, revision: 0, publishedVersion: 'original-v1', publishedAt: '', updatedAt: '', hasDraft: false });
function catalogue(questionnaire = original()) { return { modules: [{ id: questionnaire.module.id, title: questionnaire.module.title, programCode: 'VEU', questionCount: questionnaire.module.questions.length, revision: questionnaire.revision, publishedVersion: questionnaire.publishedVersion, hasDraft: questionnaire.hasDraft, assignment: questionnaire.assignment }], programs: [{ programCode: 'VEU', name: 'Victorian Energy Upgrades', jurisdiction: 'VIC' }, { programCode: 'SRES', name: 'Small-scale Renewable Energy Scheme', jurisdiction: 'AU' }], services: [{ id: 'heating-cooling', label: 'Heating and cooling' }, { id: 'insulation', label: 'Insulation' }] }; }
function responder() { let saved = original(); const versions = []; return async (url, init = {}) => {
  if (init.method === 'POST') { const body = JSON.parse(init.body); if (body.action === 'save_draft') { assert.equal(body.expectedRevision, saved.revision); saved = { ...saved, module: { ...body.module, id: body.moduleId || 'custom-one' }, assignment: body.assignment, revision: saved.revision + 1, hasDraft: true }; } else { assert.equal(body.action, 'publish'); assert.equal(body.expectedRevision, saved.revision); assert.equal(body.sourcesChecked, true); saved = { ...saved, module: { ...saved.module, version: 'published-v2' }, publishedVersion: 'published-v2', hasDraft: false }; versions.push({ version: 'published-v2', publishedAt: '2026-09-19T10:00:00Z' }); } return { questionnaire: structuredClone(saved) }; }
  return url === endpoint ? catalogue(saved) : { questionnaire: structuredClone(saved), versions };
}; }
function harness(respond = responder(), options = {}) {
  const state = []; const effects = []; const timers = new Map(); const requests = []; const dirty = []; const listeners = new Map(); let cursor = 0; let timerId = 0;
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useRef(value) { const i = cursor++; if (!(i in state)) state[i] = { current: value }; return state[i]; },
    useCallback(callback, deps) { const i = cursor++; if (!state[i] || deps.some((dep, n) => dep !== state[i].deps[n])) state[i] = { deps, callback }; return state[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (!state[i] || deps.some((dep, n) => dep !== state[i].deps[n])) { const previous = state[i]; state[i] = { deps }; effects.push(() => { previous?.cleanup?.(); state[i].cleanup = callback(); }); } },
  };
  let allowDiscard = true; const confirmations = [];
  const window = { confirm(message) { confirmations.push(message); return allowDiscard; }, addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); } };
  const api = async (url, init = {}) => { requests.push({ url, ...init }); return respond(url, init); };
  const exports = {}; const require = id => id === 'react' ? hooks : id === 'react/jsx-runtime' ? jsx : id === '@/lib/training-service-sections.mjs' ? trainingSections : id.endsWith('.module.css') ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : (() => { throw Error(`Unexpected runtime import ${id}`); })();
  Function('require', 'exports', 'window', 'setTimeout', 'clearTimeout', compiled)(require, exports, window, callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
  const onDirtyChange = value => dirty.push(value);
  const render = () => { cursor = 0; const tree = exports.TrainingQuestionnaireEditor({ api, canEdit: true, onDirtyChange, ...options }); for (const effect of effects.splice(0)) effect(); return tree; };
  return { render, requests, dirty, listeners, confirmations, refuseDiscard() { allowDiscard = false; }, allowDiscard() { allowDiscard = true; }, expireRequest() { assert.equal(timers.size, 1); [...timers.values()][0](); }, async mount() { render(); await flush(); return render(); } };
}
const moduleAction = (tree, title = original().module.title) => nodes(tree, node => node.type === 'button' && ['Edit training ', 'View training '].some(prefix => node.props['aria-label'] === prefix + title))[0];
async function open(h) { let tree = await h.mount(); moduleAction(tree).props.onClick(); await flush(); return h.render(); }
function edit(h, tree, name, value) { field(tree, name).props.onChange({ target: { value } }); return h.render(); }
function review(h, tree) { field(tree, 'I have checked').props.onChange({ target: { checked: true } }); return h.render(); }

test('editor saves changed questions and publishes the saved revision with the chosen correct answer', async () => {
  const h = harness(); let tree = await open(h);
  assert.equal(button(tree, 'Publish questionnaire').props.disabled, true);
  tree = edit(h, tree, 'Question', 'What photo shows this job was installed correctly?');
  tree = edit(h, tree, 'Answer 2', 'A clear photo taken at this job');
  nodes(tree, node => node.type === 'input' && node.props['aria-label'] === 'Answer 2 is correct')[0].props.onChange(); tree = h.render();
  tree = edit(h, tree, 'Why is this answer correct?', 'The record must show this exact property and installed product.');
  tree = review(h, tree); button(tree, 'Publish questionnaire').props.onClick(); await flush(); tree = h.render();
  const posts = h.requests.filter(request => request.method === 'POST').map(request => JSON.parse(request.body));
  assert.equal(posts.length, 2); assert.equal(posts[0].action, 'save_draft'); assert.equal(posts[1].action, 'publish'); assert.equal(posts[1].expectedRevision, 1);
  assert.equal(posts[0].module.questions[0].correctOptionId, 'b'); assert.equal(posts[0].module.questions[0].explanation, 'The record must show this exact property and installed product.');
  assert.match(text(tree), /Published. Learners will use this version/); assert.match(text(tree), /published-v2/); assert.equal(h.dirty.at(-1), false);
  assert.equal(button(tree, 'Save draft').props.disabled, true); assert.equal(button(tree, 'Publish questionnaire').props.disabled, true);
});

test('a failed save preserves every edit and does not claim success', async () => {
  const read = responder(); const h = harness((url, init) => init.method ? Promise.reject(Error('Someone else edited this form. Reload it before saving.')) : read(url, init));
  let tree = await open(h); tree = edit(h, tree, 'Question', 'Keep this unsaved question'); button(tree, 'Save draft').props.onClick(); await flush(); tree = h.render();
  assert.equal(field(tree, 'Question').props.value, 'Keep this unsaved question'); assert.match(text(tree), /Someone else edited/); assert.doesNotMatch(text(tree), /Draft saved/);
  assert.equal(button(tree, 'Save draft').props.disabled, false); assert.equal(h.dirty.at(-1), true);
});

test('a timed-out save releases controls and preserves edits with an explicit recovery message', async () => {
  const read = responder(); const h = harness((url, init) => init.method ? new Promise(() => {}) : read(url, init));
  let tree = await open(h); tree = edit(h, tree, 'Question', 'Do not lose this question'); button(tree, 'Save draft').props.onClick(); tree = h.render();
  assert.ok(button(tree, 'Saving draft...')); h.expireRequest(); await flush(); tree = h.render();
  assert.equal(field(tree, 'Question').props.value, 'Do not lose this question'); assert.equal(button(tree, 'Save draft').props.disabled, false);
  assert.match(text(tree), /Reload the saved form before retrying/); assert.equal(h.requests.at(-1).signal.aborted, true);
});

test('unsaved changes survive cancelled activity changes and switching to submitted records', async () => {
  const read = responder(); const h = harness((url, init) => url.includes('view=submissions') ? { submissions: [] } : read(url, init));
  let tree = await open(h); tree = edit(h, tree, 'Question', 'Keep my edits'); h.refuseDiscard();
  const before = h.requests.length; button(tree, 'Back to all training').props.onClick(); tree = h.render();
  assert.equal(h.requests.length, before); assert.equal(field(tree, 'Question').props.value, 'Keep my edits'); assert.equal(h.confirmations.length, 1);
  let warned = false; h.listeners.get('beforeunload')({ preventDefault() { warned = true; }, returnValue: undefined }); assert.equal(warned, true);
  button(tree, 'Trade compliance profiles').props.onClick(); await flush(); tree = h.render(); button(tree, 'Questionnaires').props.onClick(); tree = h.render();
  assert.equal(field(tree, 'Question').props.value, 'Keep my edits'); assert.equal(h.dirty.at(-1), true);
});

test('new activity form selects program, service and relevant state without codes or JSON editing', async () => {
  const h = harness(); let tree = await h.mount(); button(tree, 'Create questionnaire').props.onClick(); tree = h.render();
  tree = edit(h, tree, 'Activity name', 'Ceiling insulation checks'); tree = edit(h, tree, 'Program', 'VEU'); tree = edit(h, tree, 'Service category for this training', 'insulation');
  assert.equal(field(tree, 'VIC').props.checked, true); assert.equal(field(tree, 'NSW').props.disabled, true);
  tree = edit(h, tree, 'Activity label', 'New insulation activity');
  button(tree, 'Add question').props.onClick(); tree = h.render(); assert.match(text(tree), /Question\s+2\s+of\s+2/);
  button(tree, 'Move up').props.onClick(); tree = h.render(); assert.match(text(tree), /Question\s+1\s+of\s+2/);
  assert.equal(nodes(tree, node => node.type === 'fieldset' && text(node).includes('Resources for lesson')).length, 1);
  button(tree, 'Remove question').props.onClick(); tree = h.render();
  for (const [name, value] of [['What does this training cover?', 'Check the installation and keep job photos.'], ['Question', 'Whose job photo do you keep?'], ['Answer 1', 'This job'], ['Answer 2', 'A previous job'], ['Answer 3', 'A supplier photo'], ['Answer 4', 'No photo'], ['Why is this answer correct?', 'The photo shows the exact installation.'], ['Lesson 1 title', 'Photograph your work'], ['Lesson content', 'Keep original photos of this installation.'], ['Resource title', 'Official activity guidance'], ['Official webpage or supplied PDF', 'https://www.esc.vic.gov.au/installers']]) tree = edit(h, tree, name, value);
  tree = review(h, tree); button(tree, 'Publish questionnaire').props.onClick(); await flush(); tree = h.render();
  const writes = h.requests.filter(request => request.method === 'POST').map(request => JSON.parse(request.body));
  assert.deepEqual(writes[0].assignment, { kind: 'additional', serviceCategory: 'insulation', jurisdictions: ['VIC'], activityLabel: 'New insulation activity' });
  assert.equal(writes[1].moduleId, 'custom-one'); assert.equal(writes[1].expectedRevision, 1); assert.match(text(tree), /Published. Learners/);

});

test('read-only editors cannot create, alter or publish questionnaires', async () => {
  const h = harness(responder(), { canEdit: false }); const tree = await open(h);
  assert.equal(button(tree, 'Create questionnaire'), undefined); assert.equal(field(tree, 'Question').props.disabled, true);
  assert.equal(button(tree, 'Save draft').props.disabled, true); assert.equal(button(tree, 'Publish questionnaire').props.disabled, true);
});

test('saved trade profile shows exact historical questions, first-try score and corrected choices', async () => {
  const base = original(); const record = { id: 'submission-1', ownerUid: 'business-one', memberId: 'member-one', displayName: 'Alex Installer', businessName: 'Example Trade', moduleId: 'veu-6', version: 'historic-v1', scorePercent: 100, firstTryScorePercent: 0, completedAt: '2026-09-19T11:00:00Z', reference: 'TL-CX-EXAMPLE', snapshot: { title: 'Original questionnaire', programCode: 'VEU', scorePercent: 100, firstTryScorePercent: 0, reference: 'TL-CX-EXAMPLE', questions: base.module.questions.map(question => ({ ...question, selectedOptionId: 'a', incorrectOptionIds: ['b'] })), sources: [...base.module.sources, { id: 'internal', title: 'Do not show internal notes', url: 'https://example.com/internal.md' }] } };
  const read = responder(); const h = harness((url, init) => url.includes('view=submissions') ? { submissions: [record] } : url.includes('submissionId=') ? { submission: record } : read(url, init));
  let tree = await h.mount(); button(tree, 'Trade compliance profiles').props.onClick(); await flush(); tree = h.render();
  nodes(tree, node => node.type === 'button' && text(node).includes('TL-CX-EXAMPLE'))[0].props.onClick(); await flush(); tree = h.render();
  assert.match(text(tree), /historic-v1/); assert.match(text(tree), /Which photo should you keep/); assert.match(text(tree), /First try:\s+0\s*%/);
  assert.match(text(tree), /tried before correcting/); assert.match(text(tree), /submitted answer/); assert.doesNotMatch(text(tree), /Do not show internal notes/);
});

test('a saved draft stays publishable when publication fails, without saving a second revision', async () => {
  const normal = responder(); let failed = false;
  const h = harness((url, init) => { if (init.method && JSON.parse(init.body).action === 'publish' && !failed) { failed = true; return Promise.reject(Error('Publication could not be confirmed. Reload or retry.')); } return normal(url, init); });
  let tree = await open(h); tree = edit(h, tree, 'Question', 'Changed question'); tree = review(h, tree);
  button(tree, 'Publish questionnaire').props.onClick(); await flush(); tree = h.render();
  assert.match(text(tree), /Publication could not be confirmed/); assert.equal(field(tree, 'Question').props.value, 'Changed question');
  assert.equal(button(tree, 'Publish questionnaire').props.disabled, false); button(tree, 'Publish questionnaire').props.onClick(); await flush(); tree = h.render();
  const writes = h.requests.filter(request => request.method === 'POST').map(request => JSON.parse(request.body));
  assert.deepEqual(writes.map(body => body.action), ['save_draft', 'publish', 'publish']); assert.equal(writes[2].expectedRevision, 1); assert.match(text(tree), /Published. Learners/);
});

test('people index finds older learners and loads more submissions within the same person', async () => {
  const olderPerson = { ownerUid: 'older-business', memberId: 'older-member', displayName: 'Older Learner', businessName: 'Earlier Trade', submissionCount: 217 };
  const recent = { id: 'record-new', ownerUid: 'new-business', memberId: 'new-member', displayName: 'Recent Learner', businessName: 'New Trade', moduleId: 'veu-6', completedAt: '2026-09-19T10:00:00Z', scorePercent: 100, reference: 'NEW' };
  const oldRecord = { ...recent, ...olderPerson, id: 'old-first', reference: 'OLD-FIRST' };
  const normal = responder(); const h = harness((url, init) => {
    if (!url.includes('view=submissions')) return normal(url, init);
    if (url.includes('beforeId=')) { assert.match(url, /ownerUid=older-business&memberId=older-member/); assert.match(url, /beforeId=old-first/); return { submissions: [{ ...oldRecord, id: 'old-last', reference: 'OLD-LAST' }], nextCursor: null }; }
    if (url.includes('ownerUid=')) return { submissions: [oldRecord], nextCursor: { completedAt: oldRecord.completedAt, id: oldRecord.id } };
    return { people: [olderPerson, { ...recent, submissionCount: 1 }], submissions: [recent], nextCursor: null };
  });
  let tree = await h.mount(); button(tree, 'Trade compliance profiles').props.onClick(); await flush(); tree = h.render();
  assert.match(text(field(tree, 'Person and business')), /Older Learner/);
  field(tree, 'Person and business').props.onChange({ target: { value: JSON.stringify([olderPerson.ownerUid, olderPerson.memberId]) } }); await flush(); tree = h.render();
  assert.match(text(tree), /OLD-FIRST/); assert.doesNotMatch(text(tree), /NEW\s*$/); assert.ok(button(tree, 'Load older submissions'));
  button(tree, 'Load older submissions').props.onClick(); await flush(); tree = h.render();
  assert.match(text(tree), /OLD-FIRST/); assert.match(text(tree), /OLD-LAST/); assert.equal(button(tree, 'Load older submissions'), undefined);
});


test('editor groups and filters questionnaires by service, then creates in the chosen category', async () => {
  const normal = responder(); const h = harness((url, init) => url === endpoint ? { ...catalogue(), modules: [...catalogue().modules, { ...catalogue().modules[0], id: 'veu-48', title: 'Activity 48 ceiling insulation', assignment: { kind: 'catalogue', serviceCategory: 'insulation', jurisdictions: ['VIC'], activityLabel: 'Activity 48' } }] } : normal(url, init));
  let tree = await h.mount();
  const grouped = nodes(tree, node => node.props?.className === 'libraryGroup');
  assert.deepEqual(grouped.map(node => node.props['aria-label']), ['Heating and cooling', 'Insulation']);
  tree = edit(h, tree, 'Filter by service category', 'insulation');
  assert.match(text(tree), /Activity 48/); assert.doesNotMatch(text(tree), /Activity 6 heating/);
  button(tree, 'Create questionnaire').props.onClick(); tree = h.render();
  assert.equal(field(tree, 'Service category for this training').props.value, 'insulation');
  assert.equal(field(tree, 'Service category for this training').props.disabled, false);
  assert.match(text(tree), /Required training for\s+Insulation/);
});

test('existing questionnaires show the precise service and state assignment', async () => {
  const h = harness(); const tree = await open(h);
  assert.match(text(tree), /Required training for\s+Heating and cooling/);
  assert.match(text(tree), /Activity 6\s+·\s+VIC/);
});

test('Other forms are browsed in specific sections and new custom forms save a chosen section', async () => {
  const normal = responder();
  const pool = { ...catalogue().modules[0], id: 'veu-26', title: 'Pool pump installation', assignment: { kind: 'catalogue', serviceCategory: 'other', jurisdictions: ['VIC'], activityLabel: 'Activity 26' } };
  const fridge = { ...pool, id: 'veu-22', title: 'Fridge installation' };
  const h = harness((url, init) => url === endpoint && !init.method ? { ...catalogue(), modules: [pool, fridge], services: [...catalogue().services, { id: 'other', label: 'Other energy upgrade' }] } : normal(url, init));
  let tree = await h.mount();
  assert.deepEqual(nodes(tree, node => node.props?.className === 'libraryGroup').map(node => node.props['aria-label']), ['Fridges and freezers', 'Pool and spa pumps']);
  tree = edit(h, tree, 'Filter by service category', 'other:pool-pumps');
  assert.doesNotMatch(text(tree), /Fridge installation/);
  button(tree, 'Create questionnaire').props.onClick(); tree = h.render();
  assert.equal(field(tree, 'Service category for this training').props.value, 'other');
  assert.equal(field(tree, 'Training section').props.value, 'pool-pumps');
  tree = edit(h, tree, 'Training section', 'commercial-refrigeration');
  button(tree, 'Save draft').props.onClick(); await flush();
  const body = JSON.parse(h.requests.find(item => item.method === 'POST').body);
  assert.equal(body.assignment.serviceCategory, 'other'); assert.equal(body.assignment.trainingSection, 'commercial-refrigeration');
});

test('training opens as a full visible library, including uncategorised entries, without a module dropdown', async () => {
  const library = catalogue(); library.modules.push({ ...library.modules[0], id: 'custom-draft', title: 'Site briefing', publishedVersion: '', assignment: { kind: 'additional', serviceCategory: '', jurisdictions: ['AU'], activityLabel: 'Briefing' } });
  const h = harness(async () => library); const tree = await h.mount();
  assert.ok(moduleAction(tree)); assert.ok(moduleAction(tree, 'Site briefing'));
  assert.equal(nodes(tree, node => node.type === 'option' && text(node).includes('Activity 6 heating')).length, 0);
  assert.equal(nodes(tree, node => node.type === 'li' && node.props?.className === 'libraryRow').length, 2);
  assert.match(text(tree), /Required programme module/);
  assert.ok(nodes(tree, node => node.props?.title === 'Required activity training cannot be deleted.')[0]);
  assert.equal(button(tree, 'Delete draft'), undefined);
});

test('Back to all training preserves cancelled edits and accepted navigation restores the complete library', async () => {
  const h = harness(); let tree = await open(h);
  tree = edit(h, tree, 'Question', 'Unsaved question'); h.refuseDiscard(); button(tree, 'Back to all training').props.onClick(); tree = h.render();
  assert.equal(field(tree, 'Question').props.value, 'Unsaved question');
  h.allowDiscard(); button(tree, 'Back to all training').props.onClick(); tree = h.render();
  assert.ok(moduleAction(tree)); assert.equal(h.dirty.at(-1), false); assert.equal(button(tree, 'Save draft'), undefined);
  button(tree, 'Create questionnaire').props.onClick(); tree = h.render(); button(tree, 'Discard new questionnaire').props.onClick(); tree = h.render();
  assert.ok(moduleAction(tree)); assert.equal(h.requests.some(request => request.method), false);
});

test('only eligible drafts offer named deletion and cancelled confirmation makes no request', async () => {
  const library = catalogue(); const item = { ...library.modules[0], id: 'custom-draft', title: 'Unused induction', revision: 3, publishedVersion: '', canDelete: true, deleteBlockedReason: '', assignment: { ...library.modules[0].assignment, kind: 'additional' } }; library.modules.push(item);
  const h = harness(async (url, init) => init.method ? { moduleId: item.id, deleted: true } : library);
  let tree = await h.mount(); h.refuseDiscard(); button(tree, 'Delete draft').props.onClick(); tree = h.render();
  assert.equal(h.requests.some(request => request.method), false); assert.match(h.confirmations[0], /Unused induction/);
  h.allowDiscard(); button(tree, 'Delete draft').props.onClick(); await flush(); tree = h.render();
  const write = JSON.parse(h.requests.find(request => request.method).body);
  assert.deepEqual(write, { action: 'delete_draft', moduleId: 'custom-draft', expectedRevision: 3 });
  assert.equal(moduleAction(tree, item.title), undefined); assert.ok(moduleAction(tree)); assert.match(text(tree), /Deleted unused draft/);
  const readOnly = harness(async () => library, { canEdit: false }); const readOnlyTree = await readOnly.mount();
  assert.equal(button(readOnlyTree, 'Delete draft'), undefined); assert.ok(moduleAction(readOnlyTree, item.title));
});

test('unconfirmed deletion retains the draft and offers refresh without claiming success', async () => {
  const library = catalogue(); const item = { ...library.modules[0], id: 'custom-draft', title: 'Unused induction', revision: 3, canDelete: true, assignment: { ...library.modules[0].assignment, kind: 'additional' } }; library.modules = [item];
  const h = harness(async (_url, init) => { if (init.method) throw Error('Revision changed.'); return library; });
  let tree = await h.mount(); button(tree, 'Delete draft').props.onClick(); await flush(); tree = h.render();
  assert.ok(moduleAction(tree, item.title)); assert.match(text(tree), /Deletion could not be confirmed/); assert.match(text(tree), /Revision changed/);
  assert.doesNotMatch(text(tree), /Deleted unused draft/); assert.equal(button(tree, 'Refresh training').props.disabled, false);
});
