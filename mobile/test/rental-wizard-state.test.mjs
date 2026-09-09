import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

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
  assert.match(source, /automaticallyAdjustKeyboardInsets=\{Platform\.OS === 'ios'\}/);
  assert.match(source, /keyboardDismissMode="on-drag"/);
  assert.match(source, /scrollResponderScrollNativeHandleToKeyboard\(event\.target, 96, true\)/);
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
    draft, data: { findings: [] }, evidence: [], RENTAL_ADVERSE_OUTCOMES: new Set(),
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
