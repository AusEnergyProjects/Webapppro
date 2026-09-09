import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { rentalAssessorFields, rentalObservationNumberIsValid, rentalObservationBlockers } from '../../src/lib/rental-quotation.mjs';
import { rentalAssessorEvidenceRequirement, rentalRoomChecks, rentalRoomItemInstance, RENTAL_ROOM_CHECKS } from '../../src/lib/rental-assessor-workflow.mjs';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/rental-inspection.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function('exports', code)(exports);
const { rentalAdjacentQuestion, rentalObservationsComplete, deliverRentalPhoto } = exports;

test('Next and Previous visit every question inside each category, including read-only records', () => {
  const sections = [{ key: 'first', checks: [{ key: 'a' }, { key: 'b' }] }, { key: 'second', checks: [{ key: 'c' }] }];
  assert.deepEqual(rentalAdjacentQuestion(sections, 'first', 0, 1), { section: sections[0], checkIndex: 1 });
  assert.deepEqual(rentalAdjacentQuestion(sections, 'first', 1, 1), { section: sections[1], checkIndex: 0 });
  assert.deepEqual(rentalAdjacentQuestion(sections, 'second', 0, -1), { section: sections[0], checkIndex: 1 });
  assert.equal(rentalAdjacentQuestion(sections, 'second', 0, 1), null);
  assert.equal(rentalAdjacentQuestion(sections, 'unknown', 0, 1), null);
});

test('final declarations require real observation and evidence completion', () => {
  const result = (blockers) => ({ completion: { assessment: { complete: false, blockers } } });
  assert.equal(rentalObservationsComplete({}, 'assessment'), false);
  assert.equal(rentalObservationsComplete(result([{ key: 'check:heating:working', label: 'Missing answer' }]), 'assessment'), false);
  assert.equal(rentalObservationsComplete(result([{ key: 'evidence:heating', label: 'Missing photo' }]), 'assessment'), false);
  assert.equal(rentalObservationsComplete(result([{ key: 'finding:heating', label: 'Missing finding' }]), 'assessment'), false);
  assert.equal(rentalObservationsComplete(result([{ key: 'metadata:assessorDeclaration', label: 'Final declaration' }]), 'assessment'), true);
});

test('a failed photo link retries its durably remembered media file without uploading a duplicate', async () => {
  const calls = [];
  let remembered;
  const upload = async () => { calls.push('upload'); return 'job-photo-1'; };
  const remember = async (id) => { calls.push('remember'); remembered = id; };
  await assert.rejects(() => deliverRentalPhoto({ upload, remember, link: async (id) => {
    calls.push('link'); assert.equal(id, remembered); throw new Error('Connection dropped');
  } }), /Connection dropped/);
  const result = await deliverRentalPhoto({ mediaId: remembered, upload, remember, link: async (id) => { calls.push('retry-link'); return { mediaId: id }; } });
  assert.equal(result.mediaId, 'job-photo-1');
  assert.deepEqual(calls, ['upload', 'remember', 'link', 'retry-link']);
});

test('photo linking cannot run before its upload reference has been saved locally', async () => {
  let linked = false;
  await assert.rejects(() => deliverRentalPhoto({ upload: async () => 'media-1', remember: async () => { throw new Error('Local storage full'); },
    link: async () => { linked = true; } }), /Local storage full/);
  assert.equal(linked, false);
});

const source = readFileSync(new URL('../src/components/rental-inspection-workflow.tsx', import.meta.url), 'utf8');

test('rental metadata inputs remain visible above the device keyboard', () => {
  assert.match(source, /<KeyboardAwareScrollView ref=\{scroll\}/);
  assert.match(source, /keyboardDismissMode="on-drag"/);
  assert.doesNotMatch(source, /scrollResponderScrollNativeHandleToKeyboard/);
});

test('camera is available before an answer exists and metadata mutations use the server revision contract', () => {
  const capture = source.slice(source.indexOf('async function capture()'), source.indexOf('async function updatePhoto'));
  assert.ok(capture.indexOf('await persist(next)') < capture.indexOf('await observeLocation(true)'), 'Photo reference must survive GPS errors');
  assert.doesNotMatch(capture, /if \(!item\.id\)|if \(!draft\.item\.id\)/);
  assert.match(source, /Remove pending photo/);
  assert.match(source, /action: 'save_module_answers', moduleId: active\.id, expectedRevision: active\.revision/);
  assert.match(source, /rentalObservationsComplete\(data, active\.id\) && !activeHasDraft/);
  assert.match(source, /active\.status === 'complete' \|\| !data\.completion/);
  assert.match(source, /else advanceQuestion\(\)/);
});

function mountedSaveAnswer(environment) {
  const implementation = source.slice(source.indexOf('  async function saveAnswer()'), source.indexOf('  async function next()'));
  const compiled = ts.transpileModule(`export ${implementation.trim()}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('environment', `with (environment) { const exports = {}; ${compiled}; return exports.saveAnswer; }`)(environment);
}

function saveEnvironment() {
  const captured = new Date().toISOString();
  const draft = { outcome: 'meets', locationLabel: '', publicNotes: '', internalNotes: '', response: {},
    photos: [1, 2].map((id) => ({ uri: `photo-${id}`, capture: { captureObservedAtUtc: captured },
      location: { location: { state: 'captured', accuracyMetres: 12, mocked: false, observedAtUtc: captured } } })) };
  return {
    active: { id: 'module', revision: 1 }, item: { revision: 0, instanceKey: 'property', sortOrder: 0 }, storedItem: undefined,
    section: { key: 'bathroom' }, check: { key: 'bathroom', repeatBy: 'property', requiredEvidenceCount: 1, prompt: 'Bathroom condition' },
    draft, data: { findings: [] }, evidence: [], RENTAL_ADVERSE_OUTCOMES: new Set(), rentalAssessorFields, rentalObservationNumberIsValid,
    rentalAssessorEvidenceRequirement, rentalObservationBlockers,
    workOrderId: 'job', key: 'draft', cacheRef: { current: { drafts: { draft }, answers: {} } },
    setSaves() {}, setCache() {}, persist: async () => {}, advanced: false,
    onChanged() { throw new Error('Parent network refresh must not block Next'); },
    request() { throw new Error('Network request must not run inside Next'); },
  };
}

test('the actual Next save waits for local durability, then advances with 50 photos still queued', async () => {
  const env = saveEnvironment();
  env.draft.photos = Array.from({ length: 50 }, (_, index) => ({ ...env.draft.photos[0], uri: `photo-${index}` }));
  let releaseStorage;
  let queued;
  const storage = new Promise((resolve) => { releaseStorage = resolve; });
  env.enqueueRentalSave = async (input) => { queued = input; await storage; return { id: 'saved-on-phone' }; };
  env.advanceQuestion = () => { env.advanced = true; };
  const saving = mountedSaveAnswer(env)();
  await Promise.resolve();
  assert.equal(env.advanced, false, 'Never advance before the queue is durable');
  releaseStorage();
  await saving;
  assert.equal(env.advanced, true);
  assert.equal(queued.photos.length, 50);
  assert.equal(queued.draftKey, 'draft');
  assert.equal(env.cacheRef.current.drafts.draft, undefined);
});

test('local storage failure retains the answer and both photos on the current screen', async () => {
  const env = saveEnvironment();
  env.enqueueRentalSave = async () => { throw new Error('Storage full'); };
  env.advanceQuestion = () => { env.advanced = true; };
  await assert.rejects(mountedSaveAnswer(env), /Storage full/);
  assert.equal(env.advanced, false);
  assert.equal(env.cacheRef.current.drafts.draft.photos.length, 2);
});

test('assessor screens use observable fields without requiring a trade specification', () => {
  assert.match(source, /rentalAssessorFields\(check\)/);
  assert.match(source, /rentalFindingDescriptionLabel\(draft\.outcome\)/);
  assert.doesNotMatch(source, /label="Recommended next step"|label="Quantity for the work"|RENTAL_QUOTATION_FIELDS\.map/);
  assert.doesNotMatch(source, /!draft\.scopeSummary\.trim\(\)/);
});

test('editing one property answer retains only dirty fields, without hidden profile blockers', () => {
  const implementation = source.slice(source.indexOf('  function changeAnswer('), source.indexOf('  async function capture()'));
  const compiled = ts.transpileModule(`export ${implementation.trim()}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const environment = { active: { id: 'module' }, answers: { assessorName: 'From Team', address: 'Saved address' },
    cacheRef: { current: { drafts: {}, answers: { module: { areasNotAccessed: 'Garage' } } } }, setCache() {} };
  new Function('environment', `with (environment) { const exports = {}; ${compiled}; exports.changeAnswer('inspectionDate', '2026-09-09'); }`)(environment);
  assert.deepEqual(environment.cacheRef.current.answers.module, { areasNotAccessed: 'Garage', inspectionDate: '2026-09-09' });
});

function mountedNext(environment) {
  const implementation = source.slice(source.indexOf('  async function next()'), source.indexOf('  async function saveMetadata()'));
  const compiled = ts.transpileModule('export ' + implementation.trim(), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('environment', 'with (environment) { const exports = {}; ' + compiled + '; return exports.next; }')(environment);
}
function nextEnvironment() {
  const env = { draft: { outcome: 'meets', response: { applianceType: 'Split system' }, findingDescription: '', severity: 'required' },
    check: { responseType: 'outcome' }, editable: true, page: 'answer', responseFields: [{ key: 'applianceType' }],
    RENTAL_ADVERSE_OUTCOMES: new Set(['does_not_meet', 'specialist_verification_required']), calls: [],
    detailIndex: 0, detailField: undefined };
  env.setPage = (page) => { env.page = page; env.calls.push(page); };
  env.setDetailIndex = (index) => { env.detailIndex = index; };
  env.setError = (error) => env.calls.push(error);
  env.perform = async (_name, action) => action();
  env.saveAnswer = async () => { env.calls.push('saved'); };
  env.advanceQuestion = () => { env.calls.push('advanced'); };
  return env;
}

test('Next saves each ordinary heater check directly without showing the same equipment page again', async () => {
  for (const key of ['main_living_heater', 'heater_operation', 'heater_efficiency', 'heating_2027_readiness']) {
    const env = nextEnvironment(); env.check.key = key;
    await mountedNext(env)();
    assert.deepEqual(env.calls, ['saved'], key);
  }
});

test('an explicitly tapped observation saves inline and immediate danger still requires its safety page', async () => {
  const env = nextEnvironment(); env.draft.outcome = 'specialist_verification_required';
  env.draft.findingDescription = 'Visible condition recorded; specialist verification needed';
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['saved']);
  env.calls.length = 0; env.draft.severity = 'immediate_safety_risk';
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['safety']);
});

test('a missing observation and a missing licensed test result cannot be silently skipped', async () => {
  const env = nextEnvironment(); env.draft.outcome = 'does_not_meet';
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['Add a short note about what you saw or could not check.']);
  env.calls.length = 0; env.draft.outcome = 'meets'; env.check.responseType = 'test_result';
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['details']);
  env.calls.length = 0; env.detailField = { key: 'testResult', required: true };
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['Record this result before continuing.']);
});

test('queued read-only answers advance and compact controls use numeric keyboards rather than giant textareas', async () => {
  const env = nextEnvironment(); env.editable = false;
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['advanced']);
  const control = source.slice(source.indexOf('function RentalObservationInput'), source.indexOf('function findingChoices'));
  assert.match(control, /<FieldSelect/);
  assert.match(control, /keyboardType=\{field.input === 'number' \? 'decimal-pad'/);
  assert.match(control, /multiline=\{field.input === 'textarea'\}/);
});

test('invalid measurements stay editable on the phone instead of creating a queue conflict', async () => {
  const env = saveEnvironment(); env.check.key = 'heating_2027_readiness'; env.draft.response.roomLengthMetres = '4..2';
  env.enqueueRentalSave = () => { throw new Error('Invalid observation must not enter queue'); };
  await assert.rejects(mountedSaveAnswer(env), /Enter a zero or positive number for room length/);
  assert.equal(env.cacheRef.current.drafts.draft.response.roomLengthMetres, '4..2');
});

test('clear mould and visible damage observations advance with no photos; a defect still needs context and detail', async () => {
  for (const key of ['mould_damp_observation', 'structure_weatherproofing']) {
    const env = saveEnvironment(); env.check.key = key; env.draft.photos = [];
    env.enqueueRentalSave = async () => ({ id: 'local' }); env.advanceQuestion = () => { env.advanced = true; };
    await mountedSaveAnswer(env)();
    assert.equal(env.advanced, true, key);
  }
  const env = saveEnvironment(); env.check.key = 'mould_damp_observation'; env.draft.outcome = 'does_not_meet';
  env.draft.photos = []; env.enqueueRentalSave = () => { throw new Error('Missing evidence must not enter queue'); };
  await assert.rejects(mountedSaveAnswer(env), /photo/i);
});

function mountedHandler(name, nextName, environment) {
  const start = source.search(new RegExp('  (?:async )?function ' + name + '\\('));
  const end = source.search(new RegExp('  (?:async )?function ' + nextName + '\\('));
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule('export ' + source.slice(start, end).trim(), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('environment', 'with (environment) { const exports = {}; ' + compiled + '; return exports.' + name + '; }')(environment);
}

test('room navigation visits applicable checks together and never opens another room or repeats a category', () => {
  const room = { id: 'bedroom-2', label: 'Rear bedroom', type: 'bedroom' };
  const sections = RENTAL_ROOM_CHECKS.reduce((all, entry) => {
    let group = all.find((s) => s.key === entry.sectionKey);
    if (!group) { group = { key: entry.sectionKey, checks: [] }; all.push(group); }
    group.checks.push({ key: entry.checkKey }); return all;
  }, []);
  const env = { sections, roomItems: [], rentalRoomChecks, rentalRoomItemInstance, page: 'answer', activeRoom: room,
    setRoomContextId(id) { env.roomId = id; }, setCursor(cursor) { env.cursor = cursor; },
    setGuidanceOpen() {}, setError() {}, setPage(page) { env.page = page; } };
  env.openRoomCheck = mountedHandler('openRoomCheck', 'saveRooms', env);
  env.roomSteps = rentalRoomChecks(room.type).map((step) => ({ section: sections.find((s) => s.key === step.sectionKey) }));
  const advance = mountedHandler('advanceQuestion', 'changeAnswer', env);
  env.openRoomCheck(room);
  for (let index = 0; index < env.roomSteps.length; index++) {
    env.section = sections.find((s) => s.key === env.cursor.sectionKey);
    env.check = env.section.checks[env.cursor.checkIndex]; env.roomCheckIndex = index;
    assert.equal(env.roomId, room.id);
    assert.equal(env.cursor.instanceKey, room.id);
    assert.equal(env.check.key, rentalRoomChecks(room.type)[index].checkKey);
    advance();
  }
  assert.equal(env.page, 'categories');
  assert.equal(env.roomId, '');
});

test('saving a first room preserves an absent roster base, then the next room uses the pending roster base', async () => {
  const first = { id: 'a', label: 'Bedroom 1', type: 'bedroom' };
  const second = { id: 'b', label: 'Bathroom 1', type: 'bathroom' };
  const queued = [];
  const env = { active: { id: 'module', revision: 1, answers: { address: 'Saved address' } }, pendingAnswers: {},
    workOrderId: 'job', Crypto: { randomUUID: () => 'save-' + queued.length }, cacheRef: { current: { drafts: {}, answers: {} } },
    enqueueRentalSave: async (input) => { queued.push(input); return { id: 'local' }; }, setSaves() {} };
  const saveRooms = mountedHandler('saveRooms', 'addRoom', env);
  await saveRooms([first]);
  assert.equal(queued[0].module.answers.roomRoster, undefined);
  env.pendingAnswers.roomRoster = [first];
  await saveRooms([first, second]);
  assert.deepEqual(queued[1].module.answers.roomRoster, [first]);
  assert.deepEqual(queued[1].body.answers.roomRoster, [first, second]);
  assert.equal(queued[1].module.answers.address, 'Saved address');
});

test('room-list conflict recovery keeps a durable copy before retiring superseded saves', async () => {
  const room = { id: 'a', label: 'Bedroom', type: 'bedroom' };
  const calls = [];
  const env = { active: { id: 'module' }, rooms: [room], pendingSaves: [
    { id: 'roster-1', body: { action: 'save_module_answers', moduleId: 'module', answers: { roomRoster: [room] } } },
    { id: 'photo-answer', body: { action: 'save_item', moduleId: 'module' } },
  ], cacheRef: { current: { drafts: { existing: { photo: 'keep' } }, answers: {} } },
    perform: async (_name, action) => action(), persist: async () => calls.push('persist'),
    discardRentalSave: async (id) => calls.push(id), setCache() {}, setSaves() {}, setPage() {}, setError() {} };
  await mountedHandler('reviewQueuedRooms', 'previous', env)(false);
  assert.deepEqual(calls, ['persist', 'roster-1']);
  assert.deepEqual(env.cacheRef.current.answers.module.roomRoster, [room]);
  assert.deepEqual(env.cacheRef.current.drafts.existing, { photo: 'keep' });
  calls.length = 0; env.persist = async () => { throw new Error('Storage full'); };
  await assert.rejects(() => mountedHandler('reviewQueuedRooms', 'previous', env)(false), /Storage full/);
  assert.deepEqual(calls, [], 'Never discard queue records when the durable recovery copy fails');
});
