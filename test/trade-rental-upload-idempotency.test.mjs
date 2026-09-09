import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { rentalEvidencePhotoCapture } from '../src/lib/trade-rental-evidence.mjs';
import { rentalImageWithinReportLimit } from '../src/lib/trade-rental-image-dimensions.mjs';

const source = fs.readFileSync(new URL('../src/app/api/trade-field-work/route.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
const names = ['safeName', 'serialisedEvidenceEnvelope', 'exactArrayBuffer', 'sha256',
  'rentalUploadIdentity', 'findRentalUpload', 'rentalUploadReplay', 'upload'];
const code = ts.transpileModule(names.map((name) => {
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return declaration.getText(ast);
}).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const uploadId = '0134afc6-7be2-4539-8a02-ffe221389bac';
const imageBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));

function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(`CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT, service_category TEXT,
    revision INTEGER DEFAULT 1, updated_at TEXT, record_status TEXT DEFAULT 'active', assignee_member_id TEXT);
    CREATE TABLE trade_crm_job_media (id TEXT PRIMARY KEY, work_order_id TEXT, firebase_uid TEXT,
      category TEXT, file_name TEXT, content_type TEXT, size_bytes INTEGER, object_key TEXT,
      caption TEXT, evidence_envelope TEXT, original_sha256 TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE trade_work_order_events (id TEXT PRIMARY KEY, work_order_id TEXT, firebase_uid TEXT,
      event_type TEXT, summary TEXT, created_at TEXT);
    INSERT INTO trade_work_orders (id, firebase_uid, service_category) VALUES
      ('job', 'owner', 'rental-inspection'), ('job-two', 'owner', 'rental-inspection'),
      ('other-job', 'other-owner', 'rental-inspection'), ('electrical', 'owner', 'electrical');`);
  const objects = new Map();
  let putCount = 0;
  let beforeBatch;
  let afterCommit;
  let clock = Date.now();
  function statement(query, values = []) {
    return {
      bind(...args) { return statement(query, args); },
      async first() { return sql.prepare(query).get(...values) || null; },
      run() { return sql.prepare(query).run(...values); },
    };
  }
  const db = {
    prepare: statement,
    async batch(statements) {
      if (beforeBatch) await beforeBatch();
      sql.exec('BEGIN');
      try { for (const entry of statements) entry.run(); sql.exec('COMMIT'); }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
      if (afterCommit) { const hook = afterCommit; afterCommit = null; hook(); }
    },
  };
  const dependencies = {
    getD1: () => db,
    adminJson: (value, status = 200) => Response.json(value, { status }),
    cleanAdminText: (value, limit) => String(value || '').trim().slice(0, limit),
    assignedJob: async (access, id) => {
      const job = sql.prepare("SELECT * FROM trade_work_orders WHERE id = ? AND firebase_uid = ? AND record_status = 'active'").get(id, access.ownerUid);
      if (!job) throw new Error('JOB_NOT_ASSIGNED');
      return job;
    },
    bucket: () => ({
      async put(key, value, options) { putCount += 1; objects.set(key, { value, options }); },
      async delete(key) { objects.delete(key); },
    }),
    nextJobRevision: (revision) => Number(revision) + 1,
    jobSyncChangeStatements: () => [],
    rentalEvidencePhotoCapture, rentalImageWithinReportLimit,
    payload: async (_access, workOrderId) => ({ media: sql.prepare('SELECT id FROM trade_crm_job_media WHERE work_order_id = ?').all(workOrderId) }),
    MAX_FILE_BYTES: 8 * 1024 * 1024, MAX_IMAGE_DIMENSION: 4096, MAX_IMAGE_PIXELS: 12_000_000,
    ALLOWED_TYPES: new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    MEDIA_CATEGORIES: new Set(['before', 'progress', 'after', 'document']),
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } },
  };
  const api = new Function(...Object.keys(dependencies), `${code}; return {upload, rentalUploadIdentity};`)(...Object.values(dependencies));
  const capture = new Date(clock).toISOString();
  const envelope = { schemaVersion: 1, kind: 'tlink-rental-inspection-photo', captureSessionId: uploadId,
    source: 'in_app_camera', capture: { captureObservedAtUtc: capture, utcOffsetMinutes: 600, timeZone: 'Australia/Sydney' },
    location: { state: 'captured', observedAtUtc: capture, latitude: -37.8, longitude: 144.9, accuracyMetres: 12, mocked: false } };
  function request(options = {}) {
    const form = new FormData();
    form.set('workOrderId', options.job || 'job');
    if (!options.legacy) form.set('clientUploadId', options.id ?? uploadId);
    form.set('category', options.category || 'progress');
    form.set('caption', options.caption || 'Window overview');
    form.set('evidenceEnvelope', JSON.stringify(options.envelope || envelope));
    form.set('file', new File([options.bytes || imageBytes], options.name || 'window.png', { type: options.type || 'image/png' }));
    return new Request('https://example.test/api/trade-field-work', { method: 'POST', body: form });
  }
  return { api, sql, objects, request, envelope,
    upload: (options = {}, ownerUid = 'owner') => api.upload(request(options), { ownerUid, actorUid: 'assessor' }),
    putCount: () => putCount,
    later: (milliseconds) => { clock += milliseconds; },
    beforeBatch: (hook) => { beforeBatch = hook; }, afterCommit: (hook) => { afterCommit = hook; },
    counts: () => [sql.prepare('SELECT COUNT(*) n FROM trade_crm_job_media').get().n,
      sql.prepare('SELECT COUNT(*) n FROM trade_work_order_events').get().n, objects.size],
  };
}

test('lost acknowledgement replay returns one explicit photo ID without another object, event or revision', async (t) => {
  const f = fixture(t);
  const first = await f.upload(); assert.equal(first.status, 201);
  const created = await first.json();
  assert.deepEqual(Object.keys(created).sort(), ['ok', 'revision', 'uploadedMediaId']);
  assert.equal(created.revision, 2);
  f.later(8 * 24 * 60 * 60 * 1000);
  const replay = await f.upload(); assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), created);
  assert.deepEqual(f.counts(), [1, 1, 1]);
  assert.equal(f.putCount(), 1);
});

test('simultaneous identical requests retain only the winning object and create one event', async (t) => {
  const f = fixture(t);
  let arrived = 0; let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  f.beforeBatch(async () => { arrived += 1; if (arrived === 2) release(); await barrier; });
  const responses = await Promise.all([f.upload(), f.upload()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const values = await Promise.all(responses.map((response) => response.json()));
  assert.equal(values[0].uploadedMediaId, values[1].uploadedMediaId);
  assert.deepEqual(f.counts(), [1, 1, 1]);
  const retained = f.sql.prepare('SELECT object_key FROM trade_crm_job_media').get();
  assert.ok(f.objects.has(retained.object_key));
});

test('a committed database write with a lost batch acknowledgement retains its referenced object', async (t) => {
  const f = fixture(t);
  f.afterCommit(() => { throw new Error('Lost database acknowledgement'); });
  const response = await f.upload();
  assert.equal(response.status, 200);
  assert.ok((await response.json()).uploadedMediaId);
  assert.deepEqual(f.counts(), [1, 1, 1]);
});

test('reusing an upload ID with different bytes, capture or request metadata conflicts without writes', async (t) => {
  const f = fixture(t); await f.upload();
  for (const options of [
    { bytes: new Uint8Array([...imageBytes, 0]) }, { category: 'after' }, { caption: 'Other window' },
    { name: 'different.png' }, { type: 'image/jpeg' },
    { envelope: { ...f.envelope, location: { ...f.envelope.location, accuracyMetres: 13 } } },
  ]) {
    const response = await f.upload(options);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'UPLOAD_IDENTITY_CONFLICT');
  }
  assert.deepEqual(f.counts(), [1, 1, 1]); assert.equal(f.putCount(), 1);
});

test('simultaneous mismatched identities cannot overwrite or delete the winning object', async (t) => {
  const f = fixture(t);
  let arrived = 0; let release; const barrier = new Promise((resolve) => { release = resolve; });
  f.beforeBatch(async () => { arrived += 1; if (arrived === 2) release(); await barrier; });
  const responses = await Promise.all([f.upload(), f.upload({ caption: 'Different capture' })]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.deepEqual(f.counts(), [1, 1, 1]);
  assert.ok(f.objects.has(f.sql.prepare('SELECT object_key FROM trade_crm_job_media').get().object_key));
});

test('identities are isolated by owner and job and replay still requires live assignment', async (t) => {
  const f = fixture(t);
  const responses = await Promise.all([f.upload(), f.upload({ job: 'job-two' }), f.upload({ job: 'other-job' }, 'other-owner')]);
  const ids = await Promise.all(responses.map(async (response) => (await response.json()).uploadedMediaId));
  assert.equal(new Set(ids).size, 3);
  await assert.rejects(f.upload({ job: 'job' }, 'other-owner'), /JOB_NOT_ASSIGNED/);
  f.sql.prepare("UPDATE trade_work_orders SET record_status = 'archived' WHERE id = 'job'").run();
  await assert.rejects(f.upload(), /JOB_NOT_ASSIGNED/);
  assert.deepEqual(f.counts(), [3, 3, 3]);
});

test('invalid client IDs and non-rental or non-image identity requests fail before storage', async (t) => {
  const f = fixture(t);
  for (const options of [{ id: '' }, { id: 'not-a-uuid' }, { job: 'electrical' }, { type: 'application/pdf' }]) {
    const response = await f.upload(options); assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'UPLOAD_IDENTITY_INVALID');
  }
  assert.deepEqual(f.counts(), [0, 0, 0]);
});

test('offline photos upload after an hour or overnight without restamping their capture', async (t) => {
  for (const delay of [60 * 60 * 1000, 24 * 60 * 60 * 1000]) {
    const f = fixture(t); f.later(delay);
    const response = await f.upload(); assert.equal(response.status, 201);
    const stored = f.sql.prepare('SELECT evidence_envelope, created_at FROM trade_crm_job_media').get();
    assert.deepEqual(JSON.parse(stored.evidence_envelope), f.envelope);
    assert.equal(Date.parse(stored.created_at) - Date.parse(f.envelope.capture.captureObservedAtUtc), delay);
    assert.ok(rentalEvidencePhotoCapture(stored.evidence_envelope, { receivedAtUtc: stored.created_at }));
    assert.deepEqual(f.counts(), [1, 1, 1]);
  }
});

test('unseen photos older than the seven-day offline delivery window fail before storage', async (t) => {
  const f = fixture(t); f.later(7 * 24 * 60 * 60 * 1000 + 1);
  const response = await f.upload(); assert.equal(response.status, 400);
  assert.deepEqual(f.counts(), [0, 0, 0]);
});

test('legacy callers retain the full media response', async (t) => {
  const f = fixture(t);
  const response = await f.upload({ legacy: true }); assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.media.length, 1); assert.equal(result.uploadedMediaId, undefined);
});
