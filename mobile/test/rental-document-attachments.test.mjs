import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/rental-document-attachments.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const clone = (value) => structuredClone(value);
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function until(predicate) {
  for (let index = 0; index < 500; index++) { if (predicate()) return; await new Promise((done) => setImmediate(done)); }
  assert.fail('The expected document checkpoint was not reached.');
}
function fixture() {
  const settings = new Map(), files = new Map([['file:///chosen.pdf', new TextEncoder().encode('%PDF-1.7\nProfessional report\n%%EOF')]]);
  const state = { owner: { key: 'firebase:owner', epoch: 1 }, uuid: 0, uploads: [], links: [], loseUpload: false, loseLink: false,
    result: { ok: true, permissions: { canEdit: true }, items: [{ id: 'item', moduleId: 'module', revision: 2 }], modules: [{ id: 'module', revision: 4, status: 'draft' }], evidence: [] } };
  let ownerListener;
  const assertOwner = (owner) => { if (owner.key !== state.owner.key || owner.epoch !== state.owner.epoch) throw new Error('Owner changed'); };
  class Directory {
    constructor(...parts) { this.uri = parts.map((entry) => entry.uri || entry).join('/'); }
    create() {}
  }
  class File {
    constructor(...parts) { this.uri = parts.map((entry) => entry.uri || entry).join('/'); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length || 0; }
    async bytes() { state.bytesStarted = true; if (state.bytesGate) await state.bytesGate.promise; return files.get(this.uri); }
    async copy(target) {
      const bytes = files.get(this.uri).slice(); state.copyStarted = true;
      if (state.copyGate) await state.copyGate.promise;
      files.set(target.uri, bytes);
    }
    delete() { files.delete(this.uri); }
  }
  class FormDataMock { values = new Map(); append(key, value, name) { this.values.set(key, name ? { value, name } : value); } get(key) { return this.values.get(key); } }
  async function apiRequest(path, init = {}) {
    assert.equal(init.signal.aborted, false);
    if (!init.method) return clone(state.result);
    if (path === '/api/trade-field-work') {
      state.uploads.push(init.body);
      if (state.changeOwnerOnUpload) { state.owner = { key: 'firebase:other', epoch: 2 }; ownerListener(); return { uploadedMediaId: 'foreign-result' }; }
      if (state.loseUpload) { state.loseUpload = false; throw new Error('Upload acknowledgement lost'); }
      return { uploadedMediaId: 'media-' + init.body.get('clientUploadId') };
    }
    const body = JSON.parse(init.body); state.links.push(body);
    assert.equal(body.expectedModuleRevision, state.result.modules[0].revision);
    state.result.evidence.push({ itemId: body.itemId, jobMediaId: body.jobMediaId, status: 'active' });
    state.result.modules[0].revision++;
    if (state.loseLink) { state.loseLink = false; throw new Error('Link acknowledgement lost'); }
    return clone(state.result);
  }
  const imports = {
    'expo-crypto': { randomUUID: () => '00000000-0000-4000-8000-' + String(++state.uuid).padStart(12, '0') },
    'expo-file-system': { File, Directory, Paths: { document: 'file:///document' } },
    '@/lib/api': { apiRequest },
    '@/lib/database': { getLocalDataOwner: async () => ({ ...state.owner }), assertLocalDataOwner: assertOwner,
      subscribeLocalDataOwner: (listener) => { ownerListener = listener; },
      readRentalSetting: async (owner, key) => { assertOwner(owner); return settings.get(key) || ''; },
      writeRentalSetting: async (owner, key, value) => {
        assertOwner(owner); state.writeStarted = true;
        if (state.writeGate) await state.writeGate.promise;
        assertOwner(owner); if (value === null) settings.delete(key); else settings.set(key, value);
      } },
  };
  const exports = {};
  new Function('require', 'exports', 'FormData', compiled)((key) => { assert.ok(imports[key], key); return imports[key]; }, exports, FormDataMock);
  return { documents: exports, state, files, settings,
    changeOwner() {
      state.owner = { key: 'firebase:other', epoch: state.owner.epoch + 1 }; ownerListener(); settings.clear();
      for (const uri of files.keys()) if (uri.includes('/rental-professional-documents/')) files.delete(uri);
    },
    retain: () => exports.retainRentalDocument('job', state.result.items[0], { uri: 'file:///chosen.pdf', name: 'service-record.pdf' }) };
}

test('native PDF is durable before upload and an upload retry keeps identical identity and bytes', async () => {
  const f = fixture(); const record = await f.retain();
  assert.ok(f.files.has('file:///document/rental-professional-documents/' + record.id + '.pdf'));
  assert.equal((await f.documents.pendingRentalDocuments('job')).length, 1);
  assert.equal(f.state.uploads.length, 0);
  f.state.loseUpload = true;
  await assert.rejects(f.documents.uploadRentalDocument('job', record.id), /acknowledgement lost/);
  assert.equal((await f.documents.pendingRentalDocuments('job')).length, 1);
  await f.documents.uploadRentalDocument('job', record.id);
  assert.equal(f.state.uploads.length, 2); assert.equal(f.state.links.length, 1);
  for (const key of ['clientUploadId', 'evidenceEnvelope', 'caption', 'category']) assert.equal(f.state.uploads[0].get(key), f.state.uploads[1].get(key));
  assert.equal(f.state.uploads[0].get('file').value.uri, f.state.uploads[1].get('file').value.uri);
  assert.equal((await f.documents.pendingRentalDocuments('job')).length, 0);
  assert.equal(f.files.has('file:///document/rental-professional-documents/' + record.id + '.pdf'), false);
});
test('a committed evidence link is recovered after the response is lost, including an issued visit', async () => {
  const f = fixture(); const record = await f.retain(); f.state.loseLink = true;
  await assert.rejects(f.documents.uploadRentalDocument('job', record.id), /acknowledgement lost/);
  assert.ok((await f.documents.pendingRentalDocuments('job'))[0].mediaId);
  f.state.result.permissions.canEdit = false; f.state.result.modules[0].status = 'complete';
  await f.documents.uploadRentalDocument('job', record.id);
  assert.equal(f.state.uploads.length, 1); assert.equal(f.state.links.length, 1);
  assert.equal((await f.documents.pendingRentalDocuments('job')).length, 0);
});
test('a changed answer, invalid PDF or second retained attachment is never silently substituted', async () => {
  const f = fixture(); const record = await f.retain();
  await assert.rejects(f.retain(), /Retry or remove/);
  f.state.result.items[0].revision++;
  await assert.rejects(f.documents.uploadRentalDocument('job', record.id), /answer changed/);
  assert.equal(f.state.uploads.length, 0);
  await f.documents.discardRentalDocument('job', record.id);
  f.files.set('file:///chosen.pdf', new TextEncoder().encode('pretend PDF'));
  await assert.rejects(f.retain(), /valid PDF/);
  assert.equal((await f.documents.pendingRentalDocuments('job')).length, 0);
});
test('owner changes cannot persist or link a document using the previous account', async () => {
  const f = fixture(); const record = await f.retain(); f.state.changeOwnerOnUpload = true;
  await assert.rejects(f.documents.uploadRentalDocument('job', record.id), /Owner changed/);
  assert.equal(f.state.links.length, 0);
  const retained = JSON.parse(f.settings.get('rental-documents:job'))[0];
  assert.equal(retained.mediaId, ''); assert.equal(retained.ownerKey, 'firebase:owner');
  await assert.rejects(f.documents.pendingRentalDocuments('job'), /another account/);
});

test('overlapping retained documents serialize per job and cannot overwrite each other', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([
    f.retain(),
    f.documents.retainRentalDocument('job', { ...f.state.result.items[0], id: 'second-item' }, { uri: 'file:///chosen.pdf', name: 'second.pdf' }),
  ]);
  assert.deepEqual((await f.documents.pendingRentalDocuments('job')).map((entry) => entry.id), [first.id, second.id]);
  await Promise.all([f.documents.discardRentalDocument('job', first.id), f.documents.discardRentalDocument('job', second.id)]);
  assert.equal((await f.documents.pendingRentalDocuments('job')).length, 0);
  assert.equal([...f.files.keys()].filter((key) => key.includes('rental-professional-documents')).length, 0);
});

test('a confirmed job purge fences a pending PDF read and preserves other jobs', async () => {
  const f = fixture();
  const other = await f.documents.retainRentalDocument('other-job', f.state.result.items[0], { uri: 'file:///chosen.pdf', name: 'other.pdf' });
  f.state.bytesStarted = false; f.state.bytesGate = deferred();
  const retain = assert.rejects(f.retain(), /no longer available/);
  await until(() => f.state.bytesStarted);
  const purge = f.documents.purgeRentalDocuments(f.state.owner, 'job');
  await new Promise((done) => setImmediate(done));
  f.state.bytesGate.resolve(); await retain; const deletion = await purge;
  assert.equal(f.settings.has('rental-documents:job'), false);
  assert.deepEqual([...f.files.keys()].filter((uri) => uri.includes('/rental-professional-documents/')),
    ['file:///document/rental-professional-documents/' + other.id + '.pdf']);
  await assert.rejects(f.retain(), /no longer available/);
  await f.documents.restoreRentalDocumentAccess(f.state.owner, 'job', deletion);
  await f.retain();
  assert.equal((await f.documents.pendingRentalDocuments('job')).length, 1);
});

for (const revokedBy of ['job purge', 'account change']) {
  test(`an asynchronous PDF copy finishing after ${revokedBy} leaves no private file or setting`, async () => {
    const f = fixture(); f.state.copyGate = deferred();
    const retain = assert.rejects(f.retain(), /no longer available|Owner changed/);
    await until(() => f.state.copyStarted);
    const purge = revokedBy === 'job purge' ? f.documents.purgeRentalDocuments(f.state.owner, 'job') : (f.changeOwner(), Promise.resolve());
    await new Promise((done) => setImmediate(done));
    f.state.copyGate.resolve(); await retain; await purge;
    assert.equal(f.settings.has('rental-documents:job'), false);
    assert.equal([...f.files.keys()].filter((uri) => uri.includes('/rental-professional-documents/')).length, 0);
  });
}

test('purge waits for an in-flight upload manifest write then removes it and blocks the link', async () => {
  const f = fixture(); const record = await f.retain();
  f.state.writeStarted = false; f.state.writeGate = deferred();
  const upload = assert.rejects(f.documents.uploadRentalDocument('job', record.id), /no longer available/);
  await until(() => f.state.writeStarted);
  const purge = f.documents.purgeRentalDocuments(f.state.owner, 'job');
  await new Promise((done) => setImmediate(done));
  f.state.writeGate.resolve(); await upload; await purge;
  assert.equal(f.state.links.length, 0);
  assert.equal(f.settings.has('rental-documents:job'), false);
  assert.equal([...f.files.keys()].filter((uri) => uri.includes('/rental-professional-documents/')).length, 0);
});

test('a later purge invalidates a queued access restoration', async () => {
  const f = fixture(); f.state.bytesGate = deferred();
  const retain = assert.rejects(f.retain(), /no longer available/);
  await until(() => f.state.bytesStarted);
  const firstDeletion = Symbol('first');
  const firstPurge = f.documents.purgeRentalDocuments(f.state.owner, 'job', firstDeletion);
  await new Promise((done) => setImmediate(done));
  const restore = f.documents.restoreRentalDocumentAccess(f.state.owner, 'job', firstDeletion);
  await new Promise((done) => setImmediate(done));
  const lastPurge = f.documents.purgeRentalDocuments(f.state.owner, 'job');
  await new Promise((done) => setImmediate(done));
  f.state.bytesGate.resolve(); await Promise.all([retain, firstPurge, restore, lastPurge]);
  await assert.rejects(f.retain(), /no longer available/);
});

test('a stale caller cannot reopen a newer purge using an older deletion token', async () => {
  const f = fixture();
  const oldDeletion = await f.documents.purgeRentalDocuments(f.state.owner, 'job');
  const latestDeletion = await f.documents.purgeRentalDocuments(f.state.owner, 'job');
  await f.documents.restoreRentalDocumentAccess(f.state.owner, 'job', oldDeletion);
  await assert.rejects(f.retain(), /no longer available/);
  await f.documents.restoreRentalDocumentAccess(f.state.owner, 'job', latestDeletion);
  await f.retain();
  assert.equal((await f.documents.pendingRentalDocuments('job')).length, 1);
});


test('purge and restore reject a captured previous owner at the save-queue boundary', async () => {
  const f = fixture(), oldOwner = { ...f.state.owner };
  f.changeOwner();
  const current = await f.retain();
  await assert.rejects(f.documents.purgeRentalDocuments(oldOwner, 'job'), /Owner changed/);
  assert.equal((await f.documents.pendingRentalDocuments('job'))[0].id, current.id);
  assert.ok(f.files.has('file:///document/rental-professional-documents/' + current.id + '.pdf'));
  const deletion = await f.documents.purgeRentalDocuments(f.state.owner, 'job');
  await assert.rejects(f.documents.restoreRentalDocumentAccess(oldOwner, 'job', deletion), /Owner changed/);
  await assert.rejects(f.retain(), /no longer available/);
  await f.documents.restoreRentalDocumentAccess(f.state.owner, 'job', deletion);
  await f.retain();
  assert.equal((await f.documents.pendingRentalDocuments('job')).length, 1);
});
