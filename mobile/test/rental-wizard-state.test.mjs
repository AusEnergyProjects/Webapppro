import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { rentalAssessorFields, rentalObservationNumberIsValid, rentalObservationBlockers } from '../../src/lib/rental-quotation.mjs';
import { rentalAssessorEvidenceRequirement, rentalAssessorMetadataField, rentalAssessorOutcomePatch } from '../../src/lib/rental-assessor-workflow.mjs';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/rental-inspection.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function('exports', code)(exports);
const { rentalObservationsComplete, deliverRentalPhoto, rentalCompletionTarget, rentalPendingCompletionBlockers, newRentalItem } = exports;

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
  assert.ok(capture.indexOf('observeLocation(true)') < capture.indexOf('await ImagePicker.launchCameraAsync'), 'GPS starts while the camera is open');
  assert.doesNotMatch(capture, /await locationCapture|await observeLocation/);
  assert.doesNotMatch(capture, /if \(!item\.id\)|if \(!draft\.item\.id\)/);
  assert.match(source, /Remove pending photo/);
  assert.match(source, /action: 'save_module_answers', moduleId: active\.id, expectedRevision: active\.revision/);
  assert.match(source, /rentalObservationsComplete\(data, active\.id\) && !activeHasDraft/);
  assert.match(source, /onPress=\{\(\) => void finishAssessment\(\)\}/);
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

test('Next saves and advances while the retained photo has no GPS fix yet', async () => {
  const env = saveEnvironment();
  env.draft.photos = [{ ...env.draft.photos[0], location: null, locationPending: true }];
  env.enqueueRentalSave = async (input) => { env.queued = input; return { id: 'saved' }; };
  env.advanceQuestion = () => { env.advanced = true; };
  await mountedSaveAnswer(env)();
  assert.equal(env.advanced, true);
  assert.equal(env.queued.photos[0].locationPending, true);
  assert.equal(env.queued.photos[0].location, null, 'A location is never invented to let Next continue');
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
  const end = nextName === '$render' ? source.indexOf('  return <View style={styles.shell}>') : source.search(new RegExp('  (?:async )?function ' + nextName + '\\('));
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule('export ' + source.slice(start, end).trim(), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('environment', 'with (environment) { const exports = {}; ' + compiled + '; return exports.' + name + '; }')(environment);
}

test('the camera releases the form after durable photo storage while GPS remains unresolved', async () => {
  let resolveGps;
  const gps = new Promise((resolve) => { resolveGps = resolve; });
  const files = new Set(['camera.jpg']);
  class Directory { constructor() { this.uri = 'file:///document/rental-original-photos'; } async create() {} }
  class File {
    constructor(...parts) { this.uri = parts.map((part) => part.uri || part).join('/'); }
    get exists() { return files.has(this.uri); }
    async copy(target) { files.add(target.uri); }
    delete() { files.delete(this.uri); }
  }
  const env = { editable: true, draft: { photos: [] }, key: 'first', workOrderId: 'job',
    busy: false, writes: [], cacheRef: { current: { drafts: {}, answers: {} } }, localOwner: { current: { key: 'owner', epoch: 1 } }, mounted: { current: true },
    perform: async (_name, action) => { env.busy = true; try { await action(); } finally { env.busy = false; } },
    observeLocation: () => gps, observedTime: () => ({ captureObservedAtUtc: new Date().toISOString() }),
    ImagePicker: { requestCameraPermissionsAsync: async () => ({ granted: true }), CameraType: { back: 'back' },
      launchCameraAsync: async () => ({ assets: [{ uri: 'camera.jpg', width: 3000, height: 2000, mimeType: 'image/jpeg' }] }) },
    Crypto: { randomUUID: () => 'photo-id' }, Directory, File, Paths: { document: 'file:///document' },
    assertLocalDataOwner() {}, setCache() {}, persist: async (cache) => { env.writes.push(JSON.parse(JSON.stringify(cache))); },
    rememberRentalPhotoLocation: async (...args) => { env.remembered = args; }, setError(message) { env.error = message; } };
  await mountedHandler('capture', 'updatePhoto', env)();
  assert.equal(env.busy, false, 'GPS must not hold the global form busy flag');
  assert.equal(env.writes.length, 1);
  const retained = env.writes[0].drafts.first.photos[0];
  assert.equal(retained.locationPending, true); assert.ok(files.has(retained.uri));
  env.cacheRef.current = { drafts: {}, answers: {} }; // Next has already queued this photo.
  resolveGps({ permission: { granted: true }, location: { state: 'captured' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.remembered[0], 'job'); assert.equal(env.remembered[1], retained.uri);
  assert.deepEqual(env.cacheRef.current.drafts, {}, 'Late GPS must not recreate a submitted draft');
});

test('dwelling checks retain historical dimensions without asking for them again; fixed windows save their reason without typing', async () => {
  const declaration = source.slice(source.indexOf('  const responseFields ='), source.indexOf('  const detailField ='));
  const compiled = ts.transpileModule(declaration + '\nreturn responseFields;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const evaluate = (environment) => new Function('environment', 'with(environment){' + compiled + '}')(environment);
  const draft = { outcome: 'meets', response: { widthMm: '2400', heightMm: '1800' } };
  const env = { draft, active: { key: 'minimum_standards' }, check: { key: 'window_covering' }, showerCheck: false, rentalAssessorFields, sharedObservation: { recordedKeys: [] }, editEquipmentKey: '', key: 'draft' };
  assert.equal(evaluate(env).some((field) => field.key === 'widthMm'), false);
  assert.equal(draft.response.widthMm, '2400');
  draft.outcome = 'does_not_meet'; assert.equal(evaluate(env).some((field) => field.key === 'widthMm'), false);
  const saving = saveEnvironment(); saving.check = { key: 'window_operation_security', repeatBy: 'window' };
  saving.draft.locationLabel = 'Rear bedroom - Window 1'; saving.draft.photos = [];
  Object.assign(saving.draft, rentalAssessorOutcomePatch(saving.check, 'not_applicable', 'Frosted glazing'));
  let queued; saving.enqueueRentalSave = async (input) => { queued = input; return { id: 'fixed' }; };
  saving.advanceQuestion = () => {}; await mountedSaveAnswer(saving)();
  assert.match(queued.body.publicNotes, /Frosted glazing/);
  assert.match(queued.body.publicNotes, /No openable windows at the property; fixed glazing only/);
});



test('dwelling navigation visits all categories without a room roster and never reuses a room answer', () => {
  const sections = [
    { key: 'lighting', checks: [{ key: 'artificial_lighting', repeatBy: 'room' }, { key: 'habitable_daylight', repeatBy: 'room' }] },
    { key: 'draughtproofing', checks: [{ key: 'doors_2027_readiness' }, { key: 'windows_2027_readiness' }, { key: 'vents_2027_readiness' }] },
  ];
  const env = { active: { id: 'module', key: 'minimum_standards' }, data: { items: [{ moduleId: 'module', sectionKey: 'lighting', checkKey: 'artificial_lighting', instanceKey: 'old-room', outcome: 'meets' }] },
    setCursor(cursor) { env.cursor = cursor; env.section = sections.find((section) => section.key === cursor.sectionKey); env.check = env.section.checks[cursor.checkIndex]; },
    setPage(page) { env.page = page; }, setError() {}, setGuidanceOpen() {}, setMetadataIndex() {}, editable: true, metadata: [],
    propertySteps: sections.flatMap((section) => section.checks.map((_check, checkIndex) => ({ section, checkIndex }))) };
  env.openCheck = mountedHandler('openCheck', 'advanceQuestion', env);
  const advance = mountedHandler('advanceQuestion', 'changeAnswer', env);
  env.openCheck(sections[0]);
  const visited = [];
  for (let index = 0; index < 5; index++) {
    visited.push(env.check.key); assert.equal(env.cursor.instanceKey, 'property'); advance();
  }
  assert.deepEqual(visited, ['artificial_lighting', 'habitable_daylight', 'doors_2027_readiness', 'windows_2027_readiness', 'vents_2027_readiness']);
  assert.equal(env.page, 'review');
  assert.equal(env.data.items[0].instanceKey, 'old-room');
  assert.equal(newRentalItem(env.active, sections[0], sections[0].checks[0]).instanceKey, 'property');
  assert.doesNotMatch(source, /Add room|Add window|Room name \(optional\)|label="Location"/);
});

test('missing checks and evidence have direct completion destinations, without authorizing a false pass', () => {
  const assessmentModule = { id: 'module', key: 'minimum_standards', template: { sections: [{ key: 'lighting', checks: [{ key: 'artificial_lighting' }] }] } };
  const item = { moduleId: 'module', instanceKey: 'property', itemKey: 'lighting:artificial_lighting:property', sectionKey: 'lighting', checkKey: 'artificial_lighting' };
  const expected = { kind: 'check', sectionKey: 'lighting', checkIndex: 0 };
  assert.deepEqual(rentalCompletionTarget(assessmentModule, [], 'check:lighting:artificial_lighting'), expected);
  assert.deepEqual(rentalCompletionTarget(assessmentModule, [item], 'evidence:' + item.itemKey), expected);
  assert.deepEqual(rentalCompletionTarget(assessmentModule, [item], 'response:' + item.itemKey + ':measurement'), expected);
  assert.deepEqual(rentalCompletionTarget(assessmentModule, [], 'metadata:coverageConfirmed'), { kind: 'metadata', fieldKey: 'coverageConfirmed' });
  assert.equal(rentalCompletionTarget(assessmentModule, [], 'check:unknown:missing'), null);
  const alarmModule = { id: 'alarm-module', key: 'smoke_alarm_check', template: { sections: [{ key: 'alarms', checks: [{ key: 'operation' }] }] } };
  const alarm = { moduleId: 'alarm-module', instanceKey: 'alarm-2', itemKey: 'alarms:operation:alarm-2', sectionKey: 'alarms', checkKey: 'operation' };
  assert.deepEqual(rentalCompletionTarget(alarmModule, [alarm], 'evidence:' + alarm.itemKey), { kind: 'check', sectionKey: 'alarms', checkIndex: 0, instanceKey: 'alarm-2' });
});

test('old metadata snapshots hide automatic date and profile details and save only the current field', async () => {
  const keys = ['inspectionDate', 'assessorName', 'qualificationType', 'qualificationNumber'];
  for (const key of keys) {
    const field = rentalAssessorMetadataField({ key, type: 'text', required: true });
    assert.ok(field.source === 'automatic' || field.source === 'team_profile', key);
  }
  const sent = [];
  const env = { active: { id: 'module', revision: 3 }, field: { key: 'tenancyStartDate', type: 'date' }, queuedMetadata: undefined,
    answers: { tenancyStartDate: '2026-09-09', assessorDeclaration: false, credentialConfirmed: false },
    metadataIndex: 0, metadata: [{ key: 'tenancyStartDate' }], workOrderId: 'job',
    cacheRef: { current: { drafts: {}, answers: { module: { tenancyStartDate: '2026-09-09' } } } },
    perform: async (_name, action) => action(), enqueueRentalSave: async (input) => { sent.push(input); return { id: 'saved' }; },
    setSaves() {}, setCache() {}, persist: async () => {}, setPage() {}, setMetadataIndex() {} };
  await mountedHandler('saveMetadata', 'reviewQueuedAnswer', env)();
  assert.deepEqual(sent[0].body.answers, { tenancyStartDate: '2026-09-09' });
  assert.equal(env.cacheRef.current.answers.module, undefined);
});

test('finish confirms once, queues delivery without waiting for evidence and stays on the result screen', async () => {
  const env = { active: { id: 'module', status: 'draft', revision: 3 }, pendingSaves: [{ id: 'fifty-photos' }], activeHasDraft: false,
    data: { items: [], completion: { module: { complete: false, blockers: [{ key: 'metadata:assessorDeclaration', label: 'Confirm assessment' }] } } },
    cache: { answers: {} }, completionBlockers: [], rentalCompletionTarget, calls: [], finishRequest: undefined, earlierDrafts: [], sections: [], workOrderId: 'job',
    setError(message) { env.message = message; }, perform: async (_name, action) => action(), persist: async () => {},
    onChanged: async () => {}, onReturnToJob() { env.left = true; }, enqueueRentalFinish: async (value) => { env.queued = value; return { id: 'finish' }; },
    setSaves() {}, setPage(value) { env.page = value; },
    Alert: { alert(_title, message, buttons) { env.message = message; env.confirm = buttons[1].onPress; } },
    openCompletionIssue(key) { env.calls.push(key); }, request() { assert.fail('UI cannot complete while photos are outstanding'); } };
  const finish = mountedHandler('finishAssessment', 'previous', env);
  await finish(); assert.match(env.message, /complete and accurate/); assert.equal(env.queued, undefined);
  await env.confirm(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.queued.module.id, 'module'); assert.equal(env.left, undefined); assert.equal(env.page, 'review'); assert.deepEqual(env.calls, []);
});

test('an older future-shower blocker opens the single visible shower check', () => {
  const assessmentModule = { id: 'module', key: 'minimum_standards', template: { sections: [
    { key: 'bathroom', checks: [{ key: 'bathroom_facilities' }, { key: 'showerhead_rating' }] },
    { key: 'showers', checks: [{ key: 'shower_2027_readiness' }] },
  ] } };
  assert.deepEqual(rentalCompletionTarget(assessmentModule, [], 'check:showers:shower_2027_readiness'), { kind: 'check', sectionKey: 'bathroom', checkIndex: 1 });
});

test('a retained draft on the removed shower page opens recovery before finishing', async () => {
  const env = { active: { id: 'module' }, finishRequest: undefined,
    earlierDrafts: [['module:scope:3:showers:0:property', { photos: [{ uri: 'retained.jpg' }] }]],
    setPage(value) { env.page = value; }, setError(value) { env.message = value; },
    Alert: { alert() { assert.fail('Do not authorise a report while earlier photos need recovery'); } } };
  await mountedHandler('finishAssessment', 'previous', env)();
  assert.equal(env.page, 'earlier'); assert.match(env.message, /photos saved on the earlier shower/);
});

test('an untouched optional metadata field advances without queueing an empty answer', async () => {
  const env = { active: { id: 'module' }, field: { key: 'tenancyStartDate', type: 'date', required: false }, queuedMetadata: undefined,
    answers: {}, metadataIndex: 0, metadata: [{ key: 'tenancyStartDate' }],
    setPage(page) { env.page = page; }, setMetadataIndex() {}, perform() { assert.fail('An unset optional field needs no save'); } };
  await mountedHandler('saveMetadata', 'reviewQueuedAnswer', env)();
  assert.equal(env.page, 'review');
});

test('Finish stays on review and explains missing occupancy instead of moving the assessor elsewhere', async () => {
  const env = { active: { id: 'module' }, finishRequest: undefined, earlierDrafts: [], pendingSaves: [],
    completionBlockers: [{ key: 'metadata:occupancyAtAssessment', label: 'Occupancy during the assessment is required.' }],
    setError(message) { env.message = message; }, setPage() { assert.fail('Missing answer must not eject the assessor'); },
    Alert: { alert() { assert.fail('Incomplete assessment must not be authorised'); } } };
  await mountedHandler('finishAssessment', 'previous', env)();
  assert.match(env.message, /Occupancy during the assessment/);
});

test('review recognises saved offline occupancy but never hides invalid or conflicting answers', () => {
  const assessmentModule = { id: 'module', template: { sections: [], metadataFields: [{ key: 'occupancyAtAssessment', type: 'select',
    options: [{ value: 'vacant', label: 'Vacant' }] }] } };
  const result = { completion: { module: { blockers: [{ key: 'metadata:occupancyAtAssessment', label: 'Occupancy required' }] } } };
  const save = { status: 'queued', body: { action: 'save_module_answers', moduleId: 'module', answers: { occupancyAtAssessment: 'vacant' } } };
  assert.deepEqual(rentalPendingCompletionBlockers(result, assessmentModule, [save]), []);
  assert.equal(rentalPendingCompletionBlockers(result, assessmentModule, [{ ...save, status: 'conflict' }]).length, 1);
  assert.equal(rentalPendingCompletionBlockers(result, assessmentModule, [{ ...save, body: { ...save.body, answers: { occupancyAtAssessment: 'invalid' } } }]).length, 1);
});
