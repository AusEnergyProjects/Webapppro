import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { rentalAssessorMetadataField } from '../../src/lib/rental-assessor-workflow.mjs';

const source = readFileSync(new URL('../src/lib/rental-save-queue.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const databaseSource = ts.createSourceFile('database.ts', readFileSync(new URL('../src/lib/database.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const purgeFunction = databaseSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'purgeRentalLocalPhotos');
assert.ok(purgeFunction);
const purgeOutput = ts.transpileModule(purgeFunction.getText(databaseSource), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const clone = (value) => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
async function until(predicate) {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise((resolve) => setImmediate(resolve)); }
  assert.fail('The expected queue checkpoint was not reached.');
}

function fixture() {
  const assessmentModule = { id: 'module-1', key: 'minimum_standards', status: 'draft', revision: 1, answers: { addressNotes: '', accessNotes: '' },
    template: { key: 'rental-v3', templateVersion: 3, assessmentScope: 'current_minimum_standards', sections: [], metadataFields: [
      { key: 'addressNotes', phase: 'setup' }, { key: 'accessNotes', phase: 'setup' }, { key: 'assessorDeclaration', phase: 'final' },
    ] } };
  const baseItem = { id: '', moduleId: assessmentModule.id, revision: 0, sectionKey: 'insulation', checkKey: 'ceiling', instanceKey: 'property',
    locationLabel: '', outcome: '', response: {}, publicNotes: '', internalNotes: '', sortOrder: 0 };
  const input = { workOrderId: 'job-1', module: assessmentModule, baseItem, baseFinding: null, draftKey: 'module-1:insulation:ceiling:property', draftSnapshot: { outcome: 'meets', photos: [] },
    body: { action: 'save_item', moduleId: assessmentModule.id, sectionKey: 'insulation', checkKey: 'ceiling', instanceKey: 'property',
      locationLabel: '', outcome: 'meets', response: {}, publicNotes: '', internalNotes: '', sortOrder: 0 }, photos: [], purpose: 'Ceiling insulation' };
  return { input, result: { ok: true, inspection: { id: 'inspection-1', revision: 1 }, modules: [clone(assessmentModule)], items: [], findings: [], evidence: [] } };
}

function harness(shared = {}) {
  const store = shared.store || new Map();
  const files = shared.files || new Map([['file:///photo.jpg', { size: 2048, bytes: 'original' }]]);
  const state = shared.state || { owner: { key: 'firebase:alice', epoch: 1 }, result: fixture().result, calls: [], prepared: 0, writes: 0, failWrite: false, uuid: 0 };
  const ownerListeners = new Set();
  const assertOwner = (owner) => { if (owner.key !== state.owner.key || owner.epoch !== state.owner.epoch) throw new Error('Owner changed'); };
  class Directory {
    constructor(...parts) { this.uri = parts.map((p) => p.uri || p).join('/'); }
    get exists() { return [...files.keys()].some((key) => key.startsWith(this.uri)); }
    create() {}
    delete() { for (const key of files.keys()) if (key.startsWith(this.uri)) files.delete(key); }
    list() { return [...files.keys()].filter((key) => key.startsWith(this.uri + '/') && !key.slice(this.uri.length + 1).includes('/')).map((key) => new File(key)); }
  }
  class File {
    constructor(...parts) { this.uri = parts.map((p) => p.uri || p).join('/'); }
    get exists() { return files.has(this.uri); }
    get name() { return this.uri.split('/').at(-1); }
    get size() { return files.get(this.uri)?.size || 0; }
    async copy(target, options) {
      assert.ok(this.exists);
      state.copyStarted = true;
      if (state.copyGate) await state.copyGate.promise;
      if (state.copyFailure) throw new Error('Native file copy failed');
      if (files.has(target.uri) && !options?.overwrite) throw new Error('Destination exists');
      files.set(target.uri, clone(files.get(this.uri)));
    }
    delete() { files.delete(this.uri); }
  }
  class FormDataMock {
    values = new Map();
    append(key, value, name) { this.values.set(key, name ? { value, name } : value); }
    get(key) { return this.values.get(key); }
  }
  class ApiError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
  const advance = (result) => { result.inspection.revision++; result.modules[0].revision++; };
  async function defaultRequest(path, init = {}) {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const workOrderId = body?.workOrderId || body?.get?.('workOrderId') || new URL(path, 'https://tlink.test').searchParams.get('workOrderId');
    const result = state.results?.[workOrderId] || state.result;
    state.calls.push({ path, body, workOrderId });
    if (!init.method) return clone(result);
    if (path === '/api/trade-field-work') return { uploadedMediaId: `media-${body.get('clientUploadId')}` };
    if (body.action === 'save_item') {
      assert.equal(body.expectedModuleRevision, result.modules[0].revision);
      const old = result.items.find((item) => item.checkKey === body.checkKey);
      assert.equal(body.expectedItemRevision, old?.revision || 0);
      const item = { ...body, id: old?.id || `item-${body.checkKey}`, revision: (old?.revision || 0) + 1 };
      result.items = [...result.items.filter((entry) => entry.id !== item.id), item];
      advance(result);
    } else if (body.action === 'link_evidence') {
      assert.equal(body.expectedModuleRevision, result.modules[0].revision);
      result.evidence.push({ id: `evidence-${body.jobMediaId}`, moduleId: result.modules[0].id, itemId: body.itemId, jobMediaId: body.jobMediaId, status: 'active' });
      advance(result);
    } else if (body.action === 'save_module_answers') {
      assert.equal(body.expectedRevision, result.modules[0].revision);
      result.modules[0].answers = { ...result.modules[0].answers, ...body.answers };
      advance(result);
    }
    return clone(result);
  }
  state.handler ||= defaultRequest;
  const modules = {
    '../../../src/lib/rental-assessor-workflow.mjs': { rentalAssessorMetadataField },
    'expo-crypto': { randomUUID: () => `00000000-0000-4000-8000-${String(++state.uuid).padStart(12, '0')}` },
    'expo-file-system': { File, Directory, Paths: { document: 'file:///document' } },
    'expo-image-manipulator': { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: { manipulate: (sourceUri) => {
      const dimensions = state.imageDimensions || { width: 3000, height: 2000 };
      let resize = null;
      state.activeContexts = (state.activeContexts || 0) + 1;
      state.maximumContexts = Math.max(state.maximumContexts || 0, state.activeContexts);
      return { resize(value) { resize = value; }, release() { state.activeContexts--; },
        renderAsync: async () => ({ release() { state.renderedReleased = (state.renderedReleased || 0) + 1; }, saveAsync: async (options) => {
          if (state.prepareGate) await state.prepareGate.promise;
          const factor = resize ? (resize.width ? resize.width / dimensions.width : resize.height / dimensions.height) : 1;
          const width = Math.round(dimensions.width * factor), height = Math.round(dimensions.height * factor);
          const attempt = { ...options, sourceUri, width, height, resize };
          (state.imageAttempts ||= []).push(attempt);
          const uri = `file:///prepared-${++state.prepared}.jpg`;
          files.set(uri, { size: state.imageSize ? state.imageSize(attempt, state.prepared) : 512, bytes: `jpeg-${state.prepared}` });
          return { uri, width, height };
        } }) };
    } } },
    '@/lib/api': { ApiError, apiRequest: (...args) => state.handler(...args) },
    '@/lib/auth': { firebaseAuth: { get currentUser() { return state.owner.key.startsWith('firebase:') ? { uid: state.owner.key.slice(9) } : null; } } },
    '@/lib/database': {
      assertLocalDataOwner: assertOwner, getLocalDataOwner: async () => ({ ...state.owner }),
      subscribeLocalDataOwner: (callback) => { ownerListeners.add(callback); return () => ownerListeners.delete(callback); },
      rentalQueueSettings: async (owner) => { assertOwner(owner); return [...store].filter(([key]) => key.startsWith('rental-save:')).map(([key, value]) => ({ key, value })); },
      readRentalSetting: async (owner, key) => { assertOwner(owner); return store.get(key) || ''; },
      writeRentalSetting: async (owner, key, value) => { assertOwner(owner); if (state.failWrite) throw new Error('Disk full'); state.writes++; if (value === null) store.delete(key); else store.set(key, value); },
    },
    '@/lib/evidence': { captureSessionId: () => 'capture-session' },
    '@/lib/field-session': { getFieldPrincipal: async () => null },
    '@/lib/rental-inspection': { RENTAL_ADVERSE_OUTCOMES: new Set(['does_not_meet', 'not_accessible', 'specialist_verification_required', 'exemption_evidence_pending']) },
  };
  const exports = {};
  new Function('require', 'exports', 'FormData', output)((id) => { assert.ok(modules[id], id); return modules[id]; }, exports, FormDataMock);
  const purgePhotos = new Function('Directory', 'File', 'Paths', `${purgeOutput}; return purgeRentalLocalPhotos;`)(Directory, File, { document: 'file:///document' });
  return { queue: exports, state, store, files, ApiError, defaultRequest, purgePhotos,
    changeOwner() { state.owner = { key: 'firebase:bob', epoch: state.owner.epoch + 1 }; store.clear(); for (const listener of ownerListeners) listener(); purgePhotos(); },
    restart() { state.handler = defaultRequest; return harness({ store, files, state }); } };
}

test('enqueue commits an immutable snapshot without waiting for a stalled network; completion rejects promptly', async () => {
  const h = harness(), pending = deferred(), started = deferred();
  h.state.handler = async (...args) => { started.resolve(); await pending.promise; return h.defaultRequest(...args); };
  const { input } = fixture();
  const queued = h.queue.enqueueRentalSave(input);
  input.body.publicNotes = 'A later edit';
  input.draftSnapshot.outcome = 'does_not_meet';
  const record = await queued;
  assert.equal(record.body.publicNotes, '');
  assert.equal(record.draftSnapshot.outcome, 'meets');
  await started.promise;
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 1);
  await assert.rejects(h.queue.requestWhenRentalSynced('job-1', { action: 'complete_module' }), (error) => error.code === 'RENTAL_SAVES_PENDING');
  pending.resolve();
  await h.queue.processRentalSaveQueue('job-1');
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 0);
});

test('a failed durable local write rejects enqueue and does not start an API request', async () => {
  const h = harness(); h.state.failWrite = true;
  await assert.rejects(h.queue.enqueueRentalSave(fixture().input), /Disk full/);
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.store.size, 0);
});

test('repeated Next reuses the same pending snapshot and refuses a different answer', async () => {
  const h = harness(), wait = deferred();
  h.state.handler = async (...args) => { await wait.promise; return h.defaultRequest(...args); };
  const first = await h.queue.enqueueRentalSave(fixture().input);
  const second = await h.queue.enqueueRentalSave(fixture().input);
  assert.equal(first.id, second.id);
  const changed = fixture().input; changed.body.publicNotes = 'New text';
  await assert.rejects(h.queue.enqueueRentalSave(changed), (error) => error.code === 'RENTAL_ANSWER_PENDING');
  wait.resolve(); await h.queue.processRentalSaveQueue('job-1');
});

function photo() {
  return { uri: 'file:///photo.jpg', width: 3000, height: 2000, capture: { captureObservedAtUtc: '2026-09-09T04:00:00Z' },
    location: { permission: { granted: true }, location: { state: 'captured', observedAtUtc: '2026-09-09T04:00:01Z', accuracyMetres: 10, mocked: false, latitude: -37, longitude: 144 } } };
}

test('restart after a failed link reuses the durable uploaded media checkpoint and never prepares or uploads twice', async () => {
  const h = harness(); let failed = false;
  h.state.handler = async (path, init = {}) => {
    if (typeof init.body === 'string' && JSON.parse(init.body).action === 'link_evidence' && !failed) { failed = true; throw new Error('Connection lost while linking'); }
    return h.defaultRequest(path, init);
  };
  const input = fixture().input; input.photos = [photo()];
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  const pending = (await h.queue.getRentalSaveState('job-1')).records[0];
  assert.equal(pending.status, 'retry');
  assert.ok(pending.photos[0].mediaId);
  assert.ok(pending.photos[0].prepared.envelope);
  const restored = h.restart();
  await restored.queue.processRentalSaveQueue('job-1');
  assert.equal((await restored.queue.getRentalSaveState('job-1')).records[0].status, 'succeeded');
  assert.equal(h.state.prepared, 1);
  assert.equal(h.state.calls.filter((call) => call.path === '/api/trade-field-work').length, 1);
});

test('lost upload response retries the same UUID, filename, caption, JPEG bytes and capture envelope', async () => {
  const h = harness(); let first = true;
  h.state.handler = async (path, init) => {
    const result = await h.defaultRequest(path, init);
    if (path === '/api/trade-field-work' && first) { first = false; throw new Error('Upload response lost'); }
    return result;
  };
  const input = fixture().input; input.photos = [photo()];
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  const restored = h.restart(); await restored.queue.processRentalSaveQueue('job-1');
  const uploads = h.state.calls.filter((call) => call.path === '/api/trade-field-work');
  assert.equal(uploads.length, 2);
  for (const key of ['clientUploadId', 'caption', 'evidenceEnvelope']) assert.equal(uploads[0].body.get(key), uploads[1].body.get(key));
  assert.equal(uploads[0].body.get('file').value.uri, uploads[1].body.get('file').value.uri);
  assert.equal(uploads[0].body.get('file').name, uploads[1].body.get('file').name);
  assert.equal(h.state.prepared, 1);
});

test('a lost answer response is acknowledged by matching authoritative fields without a second save', async () => {
  const h = harness(); let first = true;
  h.state.handler = async (path, init) => {
    const result = await h.defaultRequest(path, init);
    if (typeof init?.body === 'string' && JSON.parse(init.body).action === 'save_item' && first) { first = false; throw new Error('Answer response lost'); }
    return result;
  };
  await h.queue.enqueueRentalSave(fixture().input); await h.queue.processRentalSaveQueue('job-1');
  const restored = h.restart(); await restored.queue.processRentalSaveQueue('job-1');
  assert.equal(h.state.calls.filter((call) => call.body?.action === 'save_item').length, 1);
  assert.equal((await restored.queue.getRentalSaveState('job-1')).pending, 0);
});

test('an independently changed item or finding becomes a conflict without a blind overwrite', async () => {
  for (const target of ['item', 'finding']) {
    const h = harness(), { input } = fixture();
    h.state.result.items = [{ ...input.baseItem, id: 'existing', revision: target === 'item' ? 2 : 1, outcome: 'does_not_meet' }];
    if (target === 'finding') { input.baseItem = clone(h.state.result.items[0]); h.state.result.findings = [{ id: 'finding-1', itemId: 'existing', revision: 2 }]; }
    await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
    const state = await h.queue.getRentalSaveState('job-1');
    assert.equal(state.conflicts, 1);
    assert.equal(h.state.calls.filter((call) => call.body?.action === 'save_item').length, 0);
  }
});

test('a template replacement never applies an old queued capture to new checks', async () => {
  const h = harness(); h.state.result.modules[0].template.templateVersion = 4;
  await h.queue.enqueueRentalSave(fixture().input); await h.queue.processRentalSaveQueue('job-1');
  assert.equal((await h.queue.getRentalSaveState('job-1')).conflicts, 1);
  assert.equal(h.state.calls.filter((call) => call.body?.action).length, 0);
});

test('owner change during a pending GET prevents later writes, cache results and mutations', async () => {
  const h = harness(), wait = deferred(), entered = deferred();
  h.state.handler = async (...args) => { entered.resolve(); await wait.promise; return h.defaultRequest(...args); };
  await h.queue.enqueueRentalSave(fixture().input);
  const running = h.queue.processRentalSaveQueue('job-1');
  await entered.promise;
  h.changeOwner(); wait.resolve();
  await assert.rejects(running, /Owner changed|account changed/);
  assert.equal(h.store.size, 0);
  assert.equal(h.state.calls.filter((call) => call.body?.action).length, 0);
});

test('metadata saves merge only their patch and preserve previous answers; final declarations cannot queue', async () => {
  const h = harness(), input = fixture().input;
  h.state.result.modules[0].answers.accessNotes = 'Other assessor update';
  input.body = { action: 'save_module_answers', moduleId: 'module-1', answers: { addressNotes: 'Entry via side gate' } };
  input.draftKey = 'metadata:module-1:addressNotes';
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  assert.deepEqual(h.state.result.modules[0].answers, { accessNotes: 'Other assessor update', addressNotes: 'Entry via side gate' });
  input.body.answers = { assessorDeclaration: true };
  await assert.rejects(h.queue.enqueueRentalSave(input), (error) => error.code === 'RENTAL_FINAL_ANSWERS_REQUIRE_SYNC');
  await h.queue.requestWhenRentalSynced('job-1', { action: 'save_module_answers', moduleId: 'module-1', expectedRevision: 2, answers: { assessorDeclaration: true } });
  assert.equal(h.state.result.modules[0].answers.accessNotes, 'Other assessor update');
  assert.equal(h.state.result.modules[0].answers.assessorDeclaration, true);
});

test('two room additions queued before delivery survive restart and retain both rooms with fresh CAS revisions', async (t) => {
  for (const lostAcknowledgement of [false, true]) {
    await t.test(lostAcknowledgement ? 'restart after the first room commits but its acknowledgement is lost' : 'restart before either room reaches the server', async () => {
      const h = harness(), entered = deferred(), release = deferred();
      const firstRoom = { id: 'room-front', label: 'Front bedroom', type: 'bedroom' };
      const secondRoom = { id: 'room-rear', label: 'Rear bedroom', type: 'bedroom' };
      function addition(rooms, pendingAnswers = {}) {
        const input = fixture().input;
        input.module.answers = { ...input.module.answers, ...clone(pendingAnswers) };
        input.body = { action: 'save_module_answers', moduleId: input.module.id, answers: { roomRoster: clone(rooms) } };
        input.draftKey = `rooms:${input.module.id}:${rooms.at(-1).id}`;
        input.draftSnapshot = { roomRoster: clone(rooms) };
        return input;
      }
      h.state.result.modules[0].answers.accessNotes = 'Keep the side gate shut';
      h.state.handler = async (path, init) => {
        const action = typeof init?.body === 'string' ? JSON.parse(init.body).action : '';
        if (!lostAcknowledgement || action === 'save_module_answers') {
          entered.resolve(); await release.promise;
          if (lostAcknowledgement) await h.defaultRequest(path, init);
          throw new Error(lostAcknowledgement ? 'First room acknowledgement lost' : 'Offline before room delivery');
        }
        return h.defaultRequest(path, init);
      };
      await h.queue.enqueueRentalSave(addition([firstRoom]));
      await entered.promise;
      const pending = await h.queue.getRentalSaveState('job-1');
      const pendingAnswers = Object.assign({}, ...pending.records.map((record) => record.body.answers));
      await h.queue.enqueueRentalSave(addition([...pendingAnswers.roomRoster, secondRoom], pendingAnswers));
      const beforeRestart = await h.queue.getRentalSaveState('job-1');
      assert.equal(beforeRestart.pending, 2);
      assert.equal(beforeRestart.records[0].module.answers.roomRoster, undefined, 'The first snapshot preserves an absent legacy roster');
      assert.deepEqual(beforeRestart.records[1].module.answers.roomRoster, [firstRoom], 'The second snapshot starts from the first pending addition');
      assert.deepEqual(beforeRestart.records.map((record) => record.body.answers.roomRoster), [[firstRoom], [firstRoom, secondRoom]]);
      release.resolve(); await h.queue.processRentalSaveQueue('job-1');
      assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 2);
      const restored = h.restart();
      assert.deepEqual((await restored.queue.getRentalSaveState('job-1')).records.map((record) => record.body.answers.roomRoster), [[firstRoom], [firstRoom, secondRoom]]);
      await restored.queue.processRentalSaveQueue('job-1');
      const delivered = await restored.queue.getRentalSaveState('job-1');
      assert.equal(delivered.pending, 0);
      assert.equal(delivered.conflicts, 0);
      assert.deepEqual(h.state.result.modules[0].answers.roomRoster, [firstRoom, secondRoom]);
      assert.equal(h.state.result.modules[0].answers.accessNotes, 'Keep the side gate shut');
      const saves = h.state.calls.filter((call) => call.body?.action === 'save_module_answers');
      assert.deepEqual(saves.map((call) => call.body.expectedRevision), [1, 2]);
      assert.deepEqual(saves.map((call) => call.body.answers.roomRoster), [[firstRoom], [firstRoom, secondRoom]]);
      assert.equal(h.state.result.modules[0].revision, 3);
    });
  }
});

test('room rosters cannot be queued for licensed modules or written outside minimum standards', async () => {
  for (const moduleKey of ['electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check']) {
    const h = harness(), input = fixture().input;
    input.module.key = moduleKey;
    input.body = { action: 'save_module_answers', moduleId: input.module.id,
      answers: { roomRoster: [{ id: 'room-1', label: 'Bedroom', type: 'bedroom' }] } };
    input.draftKey = 'rooms:module-1:room-1';
    await assert.rejects(h.queue.enqueueRentalSave(input), (error) => error.code === 'RENTAL_FINAL_ANSWERS_REQUIRE_SYNC', moduleKey);
    assert.equal(h.store.size, 0);
    assert.equal(h.state.calls.length, 0);
  }
});

test('a conflicting metadata field is retained for review instead of replacing the latest value', async () => {
  const h = harness(), input = fixture().input;
  h.state.result.modules[0].answers.addressNotes = 'Changed elsewhere';
  input.body = { action: 'save_module_answers', moduleId: 'module-1', answers: { addressNotes: 'Local edit' } };
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  assert.equal((await h.queue.getRentalSaveState('job-1')).conflicts, 1);
  assert.equal(h.state.result.modules[0].answers.addressNotes, 'Changed elsewhere');
});

test('cached inspection results do not regress and successful records stay until acknowledged', async () => {
  const h = harness(), { input } = fixture();
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  let state = await h.queue.getRentalSaveState('job-1');
  assert.equal(state.records[0].status, 'succeeded');
  await h.queue.cacheRentalResult('job-1', fixture().result);
  state = await h.queue.getRentalSaveState('job-1');
  assert.equal(state.result.inspection.revision, 2);
  await h.queue.acknowledgeRentalSave(state.records[0].id);
  assert.equal((await h.queue.getRentalSaveState('job-1')).records.length, 0);
  assert.equal((await h.queue.getRentalSaveState('job-1')).result.inspection.revision, 2);
});

test('finalization refuses a stale reviewed revision and clears its local reservation after failure', async () => {
  const h = harness(); h.state.result.modules[0].revision = 3;
  await assert.rejects(h.queue.requestWhenRentalSynced('job-1', { action: 'complete_module', moduleId: 'module-1', expectedRevision: 2 }), (error) => error.code === 'RENTAL_SAVE_CONFLICT');
  assert.equal(h.state.calls.filter((call) => call.body?.action).length, 0);
  await h.queue.enqueueRentalSave(fixture().input); await h.queue.processRentalSaveQueue('job-1');
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 0);
});

test('two answers for one job serialize mutations while the second enqueue remains local and prompt', async () => {
  const h = harness(), firstSave = deferred(), release = deferred();
  let saving = 0, maximumSaving = 0, intercepted = false;
  h.state.handler = async (path, init) => {
    const isSave = typeof init?.body === 'string' && JSON.parse(init.body).action === 'save_item';
    if (isSave) {
      saving++; maximumSaving = Math.max(maximumSaving, saving);
      if (!intercepted) { intercepted = true; firstSave.resolve(); await release.promise; }
    }
    const result = await h.defaultRequest(path, init);
    if (isSave) saving--;
    return result;
  };
  await h.queue.enqueueRentalSave(fixture().input);
  await firstSave.promise;
  const second = fixture().input; second.body.checkKey = 'draught'; second.baseItem.checkKey = 'draught'; second.draftKey += ':second';
  await h.queue.enqueueRentalSave(second);
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 2);
  release.resolve(); await h.queue.processRentalSaveQueue('job-1');
  assert.equal(maximumSaving, 1);
  assert.equal(h.state.result.items.length, 2);
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 0);
});

test('owner change during the initial load never caches the old account result under the replacement account', async () => {
  const h = harness(), entered = deferred(), release = deferred();
  h.state.handler = async (...args) => { entered.resolve(); await release.promise; return h.defaultRequest(...args); };
  const load = h.queue.loadRentalResult('job-1');
  await entered.promise; h.changeOwner(); release.resolve();
  await assert.rejects(load, /Owner changed|account changed/);
  assert.equal(h.store.size, 0);
});

test('owner change during upload cannot write a media checkpoint or link evidence for the next account', async () => {
  const h = harness(), entered = deferred(), release = deferred();
  h.state.handler = async (path, init) => {
    if (path === '/api/trade-field-work') { entered.resolve(); await release.promise; }
    return h.defaultRequest(path, init);
  };
  const input = fixture().input; input.photos = [photo()];
  await h.queue.enqueueRentalSave(input);
  const running = h.queue.processRentalSaveQueue('job-1');
  await entered.promise; h.changeOwner(); release.resolve();
  await assert.rejects(running, /Owner changed|account changed/);
  assert.equal(h.state.calls.filter((call) => call.body?.action === 'link_evidence').length, 0);
  assert.equal(h.store.size, 0);
  assert.equal([...h.files.keys()].filter((key) => key.startsWith('file:///document/rental-save-photos')).length, 0);
});

test('a lost evidence link response is acknowledged without a duplicate link after restart', async () => {
  const h = harness(); let lost = false;
  h.state.handler = async (path, init) => {
    const result = await h.defaultRequest(path, init);
    if (typeof init?.body === 'string' && JSON.parse(init.body).action === 'link_evidence' && !lost) { lost = true; throw new Error('Link response lost'); }
    return result;
  };
  const input = fixture().input; input.photos = [photo()];
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  const restarted = h.restart(); await restarted.queue.processRentalSaveQueue('job-1');
  assert.equal(h.state.calls.filter((call) => call.body?.action === 'link_evidence').length, 1);
  assert.equal((await restarted.queue.getRentalSaveState('job-1')).pending, 0);
});

test('a missing prepared-file checkpoint can recover a leftover local JPEG before the first upload', async () => {
  const h = harness(), input = fixture().input;
  input.photos = [{ ...photo(), clientUploadId: '00000000-0000-4000-8000-111111111111' }];
  h.files.set('file:///document/rental-save-photos/00000000-0000-4000-8000-111111111111.jpg', { bytes: 'uncheckpointed-file', size: 512 });
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 0);
  assert.equal(h.state.calls.filter((call) => call.path === '/api/trade-field-work').length, 1);
});

test('the prepared JPEG checkpoint and upload wait for the asynchronous native copy to finish', async () => {
  const h = harness(), input = fixture().input;
  input.photos = [photo()]; h.state.copyGate = deferred();
  await h.queue.enqueueRentalSave(input);
  await until(() => h.state.copyStarted);
  const pending = (await h.queue.getRentalSaveState('job-1')).records[0];
  assert.equal(pending.photos[0].prepared, undefined);
  assert.equal(h.state.calls.filter((call) => call.path === '/api/trade-field-work').length, 0);
  h.state.copyGate.resolve(); await h.queue.processRentalSaveQueue('job-1');
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 0);
});

test('native copy rejection retains the original photo and cannot create a false prepared checkpoint', async () => {
  const h = harness(), input = fixture().input;
  input.photos = [photo()]; h.state.copyFailure = true;
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  const pending = (await h.queue.getRentalSaveState('job-1')).records[0];
  assert.equal(pending.status, 'retry');
  assert.equal(pending.photos[0].prepared, undefined);
  assert.equal(h.files.has('file:///photo.jpg'), true);
  assert.equal(h.state.calls.filter((call) => call.path === '/api/trade-field-work').length, 0);
});

test('account purge removes both rental folders and exact legacy capture files while preserving unrelated documents', () => {
  const h = harness();
  const owned = ['file:///document/rental-save-photos/prepared.jpg', 'file:///document/rental-original-photos/original.jpg',
    'file:///document/rental-photo-00000000-0000-4000-8000-111111111111.jpg'];
  const unrelated = ['file:///document/customer-invoice.pdf', 'file:///document/rental-photo-important.jpg',
    'file:///document/other/rental-photo-00000000-0000-4000-8000-111111111111.jpg'];
  for (const uri of [...owned, ...unrelated]) h.files.set(uri, { bytes: 'retained', size: 100 });
  h.purgePhotos();
  for (const uri of owned) assert.equal(h.files.has(uri), false, uri);
  for (const uri of unrelated) assert.equal(h.files.has(uri), true, uri);
});

test('50 held photos leave Next and the next job available, then restart delivers each photo exactly once', async () => {
  const h = harness(), holdUploads = deferred(), enteredUpload = deferred();
  const input = fixture().input;
  input.photos = Array.from({ length: 50 }, (_, index) => {
    const uri = `file:///photo-${index}.jpg`; h.files.set(uri, { size: 4 * 1024 * 1024, bytes: `original-${index}` });
    return { ...photo(), uri };
  });
  input.draftSnapshot.photos = clone(input.photos);
  h.state.imageSize = () => 500 * 1024;
  h.state.results = { 'job-1': h.state.result, 'job-2': fixture().result };
  let linked = 0, interrupted = false;
  h.state.handler = async (path, init) => {
    if (path === '/api/trade-field-work' && init.body.get('workOrderId') === 'job-1') { enteredUpload.resolve(); await holdUploads.promise; }
    const result = await h.defaultRequest(path, init);
    if (typeof init?.body === 'string' && JSON.parse(init.body).action === 'link_evidence') {
      linked++;
      if (linked === 20 && !interrupted) { interrupted = true; throw new Error('Connection dropped after server linked photo 20'); }
    }
    return result;
  };
  let events = 0;
  const leaveScreen = h.queue.subscribeRentalSaves('job-1', () => { events++; });
  await h.queue.enqueueRentalSave(input);
  await enteredUpload.promise;
  const nextAnswer = fixture().input; nextAnswer.body.checkKey = 'draught'; nextAnswer.baseItem.checkKey = 'draught'; nextAnswer.draftKey += ':next';
  await h.queue.enqueueRentalSave(nextAnswer);
  const nextJob = fixture().input; nextJob.workOrderId = 'job-2';
  await h.queue.enqueueRentalSave(nextJob);
  await h.queue.processRentalSaveQueue('job-2');
  assert.equal((await h.queue.getRentalSaveState('job-2')).pending, 0, 'the next job can reach the server while the first upload is held');
  const pending = await h.queue.getRentalSaveState('job-1');
  assert.equal(pending.pending, 2);
  assert.equal(pending.records[0].photos.length, 50);
  assert.equal(pending.records[0].draftSnapshot.photos.length, 50);
  leaveScreen(); const eventsAfterLeaving = events;
  holdUploads.resolve(); await h.queue.processRentalSaveQueue('job-1');
  assert.equal(events, eventsAfterLeaving, 'delivery does not require the mounted form');
  const restored = h.restart(); await restored.queue.processRentalSaveQueue('job-1');
  assert.equal((await restored.queue.getRentalSaveState('job-1')).pending, 0);
  const uploads = h.state.calls.filter((call) => call.path === '/api/trade-field-work' && call.workOrderId === 'job-1');
  const links = h.state.calls.filter((call) => call.body?.action === 'link_evidence' && call.workOrderId === 'job-1');
  assert.equal(uploads.length, 50);
  assert.equal(new Set(uploads.map((call) => call.body.get('clientUploadId'))).size, 50);
  assert.equal(links.length, 50);
  assert.equal(h.state.result.items.length, 2);
  assert.equal(h.state.prepared, 50, 'restart reuses all prepared photo checkpoints');
  assert.equal(h.state.maximumContexts, 1);
  const bytes = (await restored.queue.getRentalSaveState('job-1')).records[0].photos.reduce((sum, entry) => sum + entry.prepared.size, 0);
  assert.equal(bytes, 50 * 500 * 1024);
  assert.ok(bytes < 32 * 1024 * 1024);
});

test('adaptive preparation retains full 1600 detail when it fits and retries bounded quality before shrinking', async () => {
  const h = harness(), input = fixture().input; input.photos = [photo()];
  h.state.imageSize = (_attempt, index) => index < 3 ? 650 * 1024 : 480 * 1024;
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  assert.deepEqual(h.state.imageAttempts.map(({ width, compress }) => [width, compress]), [[1600, 0.68], [1600, 0.56], [1400, 0.64]]);
  const saved = (await h.queue.getRentalSaveState('job-1')).records[0].photos[0].prepared;
  assert.equal(saved.size, 480 * 1024);
  assert.equal(JSON.parse(saved.envelope).processing.widthPixels, 1400);
  assert.equal(h.state.activeContexts, 0);
  assert.equal(h.state.renderedReleased, 3);
  assert.equal([...h.files.keys()].filter((key) => key.startsWith('file:///prepared-')).length, 0);
  assert.ok(h.files.has('file:///photo.jpg'));
});

test('portrait long edge is bounded and smaller originals are never enlarged', async () => {
  for (const dimensions of [{ width: 2000, height: 3000 }, { width: 600, height: 800 }]) {
    const h = harness(), input = fixture().input;
    h.state.imageDimensions = dimensions; input.photos = [{ ...photo(), ...dimensions }];
    await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
    const attempt = h.state.imageAttempts[0];
    assert.ok(Math.max(attempt.width, attempt.height) <= 1600);
    assert.ok(attempt.width <= dimensions.width && attempt.height <= dimensions.height);
    assert.equal(h.state.imageAttempts.length, 1);
  }
});

test('an oversized image stops at the quality floor with visible error and its original retained', async () => {
  const h = harness(), input = fixture().input; input.photos = [photo()]; h.state.imageSize = () => 700 * 1024;
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  const pending = (await h.queue.getRentalSaveState('job-1')).records[0];
  assert.equal(pending.status, 'conflict'); assert.match(pending.error, /original remains/);
  assert.equal(pending.photos[0].prepared, undefined);
  assert.equal(h.state.imageAttempts.length, 5);
  assert.ok(h.state.imageAttempts.every((attempt) => attempt.compress >= 0.56 && Math.max(attempt.width, attempt.height) >= 1000));
  assert.equal(h.state.calls.filter((call) => call.path === '/api/trade-field-work').length, 0);
  assert.ok(h.files.has('file:///photo.jpg'));
  assert.equal(h.state.activeContexts, 0);
});

test('simultaneous jobs prepare at most one native image while keeping both local submissions durable', async () => {
  const h = harness(), gate = deferred();
  h.state.prepareGate = gate;
  h.state.results = { 'job-1': h.state.result, 'job-2': fixture().result };
  const one = fixture().input; one.photos = [photo()];
  const two = fixture().input; two.workOrderId = 'job-2'; two.photos = [photo()];
  await h.queue.enqueueRentalSave(one); await h.queue.enqueueRentalSave(two);
  await until(() => h.state.activeContexts === 1);
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 1);
  assert.equal((await h.queue.getRentalSaveState('job-2')).pending, 1);
  gate.resolve(); await h.queue.processRentalSaveQueue();
  assert.equal(h.state.maximumContexts, 1);
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 0);
  assert.equal((await h.queue.getRentalSaveState('job-2')).pending, 0);
});

test('background authentication failure is durably visible before the worker rejects', async () => {
  const h = harness();
  h.state.handler = async () => { throw new h.ApiError('Sign in to upload these photos', 401, 'AUTH_REQUIRED'); };
  await h.queue.enqueueRentalSave(fixture().input);
  await assert.rejects(h.queue.processRentalSaveQueue('job-1'), /Sign in/);
  const pending = (await h.queue.getRentalSaveState('job-1')).records[0];
  assert.equal(pending.status, 'retry'); assert.match(pending.error, /Sign in/);
});

test('normal sync downloads new jobs and sends ordinary actions while rental photos are held', async () => {
  const syncSource = ts.createSourceFile('sync.ts', readFileSync(new URL('../src/lib/sync.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const syncFunction = syncSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'performSync');
  assert.ok(syncFunction);
  const syncOutput = ts.transpileModule(syncFunction.getText(syncSource), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const photos = deferred(), reached = [];
  const dependencies = { firebaseAuth: { currentUser: { uid: 'alice' } }, getFieldPrincipal: async () => null,
    prepareLocalDataOwner: async () => undefined, verifyFieldAccessModes: async () => ['trade_team'], setSetting: async () => undefined,
    purgeExpiredAddresses: async () => undefined, registerDevice: async () => undefined, processActivityFormCompletionQueue: async () => undefined,
    processRentalSaveQueue: () => { reached.push('rental-started'); return photos.promise; },
    processUploadQueue: async () => { reached.push('other-uploads'); }, sendActions: async () => { reached.push('ordinary-actions'); },
    fetchChanges: async () => { reached.push('new-jobs'); }, queueCounts: async () => ({ actions: 50, uploads: 0, conflicts: 0 }),
    ApiError: class extends Error {}, revokedSignOut: async () => undefined, getSetting: async () => '' };
  const run = new Function(...Object.keys(dependencies), `${syncOutput}; return performSync;`)(...Object.values(dependencies));
  const outcome = await run();
  assert.deepEqual(reached, ['rental-started', 'other-uploads', 'ordinary-actions', 'new-jobs']);
  assert.match(outcome.message, /waiting to sync/);
  assert.equal(outcome.queuedActions, 50);
  photos.resolve();
});

test('SQLite sync counts include all 50 pending rental photos and exclude linked or succeeded evidence', async () => {
  const countFunction = databaseSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'queueCounts');
  assert.ok(countFunction);
  const countOutput = ts.transpileModule(countFunction.getText(databaseSource), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE action_queue (status TEXT); CREATE TABLE upload_queue (status TEXT);');
    const insert = db.prepare('INSERT INTO settings VALUES (?, ?)');
    insert.run('rental-save:owner:first', JSON.stringify({ status: 'syncing', photos: Array.from({ length: 50 }, () => ({ linked: false })) }));
    insert.run('rental-save:owner:linked', JSON.stringify({ status: 'retry', photos: [{ linked: true }, { mediaId: 'uploaded-unlinked' }] }));
    insert.run('rental-save:owner:done', JSON.stringify({ status: 'succeeded', photos: [{ linked: false }] }));
    insert.run('rental-wizard:job', JSON.stringify({ photos: [{ linked: false }] }));
    insert.run('unrelated:invalid', 'not-json');
    db.exec("INSERT INTO upload_queue VALUES ('queued');");
    const exports = {};
    new Function('exports', 'getDatabase', countOutput)(exports, async () => ({ getFirstAsync: async (sql) => db.prepare(sql).get() }));
    assert.deepEqual(await exports.queueCounts(), { actions: 2, uploads: 52, conflicts: 0 });
  } finally { db.close(); }
});

test('ordinary metadata never resends server declarations; false invalidations can queue on frozen templates', async () => {
  const h = harness(), input = fixture().input;
  input.module.template.metadataFields.push({ key: 'coverageConfirmed', type: 'checkbox' }, { key: 'inspectionDate', type: 'date' }, { key: 'qualificationNumber' });
  h.state.result.modules[0].template = clone(input.module.template);
  h.state.result.modules[0].answers.assessorDeclaration = true;
  input.body = { action: 'save_module_answers', moduleId: 'module-1', answers: { addressNotes: 'Gate beside driveway', coverageConfirmed: false } };
  input.draftKey = 'metadata:property';
  await h.queue.enqueueRentalSave(input); await h.queue.processRentalSaveQueue('job-1');
  const sent = h.state.calls.find((call) => call.body?.action === 'save_module_answers');
  assert.deepEqual(sent.body.answers, { addressNotes: 'Gate beside driveway', coverageConfirmed: false });
  assert.equal(h.state.result.modules[0].answers.assessorDeclaration, true);
  for (const answers of [{ coverageConfirmed: true }, { inspectionDate: '2026-09-09' }, { qualificationNumber: '123' }]) {
    input.body.answers = answers;
    await assert.rejects(h.queue.enqueueRentalSave(input), (error) => error.code === 'RENTAL_FINAL_ANSWERS_REQUIRE_SYNC');
  }
});

test('legacy queued metadata uses automatic date and Team details, and never replays a final declaration', async () => {
  const h = harness(), input = fixture().input;
  input.module.template.metadataFields.push({ key: 'inspectionDate', type: 'date' }, { key: 'qualificationNumber' }, { key: 'coverageConfirmed', type: 'checkbox' });
  h.state.result.modules[0].template = clone(input.module.template);
  Object.assign(h.state.result.modules[0].answers, { inspectionDate: '2026-09-09', qualificationNumber: 'TEAM-123', coverageConfirmed: false });
  input.body = { action: 'save_module_answers', moduleId: 'module-1', answers: {
    inspectionDate: '2026-09-08', qualificationNumber: 'OLD-TYPED-VALUE', coverageConfirmed: true, addressNotes: 'Side gate',
  } };
  h.store.set('rental-save:firebase%3Aalice:legacy', JSON.stringify({ ...input, schemaVersion: 1, id: 'legacy', ownerKey: 'firebase:alice', createdAt: 1, status: 'queued', error: '', photos: [] }));
  await h.queue.processRentalSaveQueue('job-1');
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 0);
  assert.deepEqual(h.state.calls.find((call) => call.body?.action === 'save_module_answers').body.answers, { coverageConfirmed: false, addressNotes: 'Side gate' });
  assert.equal(h.state.result.modules[0].answers.inspectionDate, '2026-09-09');
  assert.equal(h.state.result.modules[0].answers.qualificationNumber, 'TEAM-123');
  assert.equal(h.state.result.modules[0].answers.coverageConfirmed, false);
});

test('a legacy queue containing only derived profile metadata finishes without a server write', async () => {
  const h = harness(), input = fixture().input;
  input.module.template.metadataFields.push({ key: 'qualificationNumber' });
  h.state.result.modules[0].template = clone(input.module.template);
  h.state.result.modules[0].answers.qualificationNumber = 'TEAM-123';
  input.body = { action: 'save_module_answers', moduleId: 'module-1', answers: { qualificationNumber: 'OLD-TYPED-VALUE' } };
  h.store.set('rental-save:firebase%3Aalice:legacy', JSON.stringify({ ...input, schemaVersion: 1, id: 'legacy', ownerKey: 'firebase:alice', createdAt: 1, status: 'queued', error: '', photos: [] }));
  await h.queue.processRentalSaveQueue('job-1');
  assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 0);
  assert.equal(h.state.calls.filter((call) => call.body?.action).length, 0);
  assert.equal(h.state.result.modules[0].answers.qualificationNumber, 'TEAM-123');
});

test('previously conflicted legacy identity and queued declarations recover without approving an assessment', async () => {
  for (const answers of [{ qualificationNumber: 'OLD' }, { coverageConfirmed: true }]) {
    const h = harness(), input = fixture().input;
    input.module.template.metadataFields.push({ key: 'qualificationNumber' }, { key: 'coverageConfirmed', type: 'checkbox' });
    input.module.answers.coverageConfirmed = false;
    h.state.result.modules[0].template = clone(input.module.template);
    Object.assign(h.state.result.modules[0].answers, { qualificationNumber: 'TEAM-123', coverageConfirmed: true });
    input.body = { action: 'save_module_answers', moduleId: 'module-1', answers };
    h.store.set('rental-save:firebase%3Aalice:legacy', JSON.stringify({ ...input, schemaVersion: 1, id: 'legacy', ownerKey: 'firebase:alice', createdAt: 1, status: 'conflict', error: 'Old form rejected this field', photos: [] }));
    await h.queue.processRentalSaveQueue('job-1');
    assert.equal((await h.queue.getRentalSaveState('job-1')).pending, 0);
    assert.equal(h.state.result.modules[0].answers.qualificationNumber, 'TEAM-123');
    if (answers.coverageConfirmed) assert.equal(h.state.result.modules[0].answers.coverageConfirmed, false);
  }
});
