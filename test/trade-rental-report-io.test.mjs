import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';
import * as evidence from '../src/lib/trade-rental-evidence.mjs';

const source = fs.readFileSync(new URL('../src/lib/trade-rental-report-server.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(`${source}\nexport { evidenceForSnapshot, storePreparedRentalEvidence };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const identity = { reportId: 'report', revision: 1 };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function service(bucket) {
  const dependencies = {
    'cloudflare:workers': { env: { EVIDENCE: bucket } },
    '../../db': {}, '@/lib/trade-team-server': {}, '@/lib/trade-team-sync-server': {},
    '@/lib/trade-rental-assessment.mjs': {}, '@/lib/trade-issued-document-store': {},
    '@/lib/trade-rental-report-links': {}, '@/lib/customer-plan-pdf-fonts': {},
    '@/lib/trade-rental-evidence.mjs': evidence, '@/lib/trade-rental-credentials': {},
    '@/lib/rental-assessor-workflow.mjs': {}, '@/lib/trade-rental-schema-guards': {},
    '@/lib/rental-report-answer.mjs': {},
  };
  const moduleRecord = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((id) => {
    assert.ok(id in dependencies, `Unmocked dependency ${id}`);
    return dependencies[id];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function deferredOperations() {
  const calls = [];
  const watchers = [];
  let active = 0;
  let peak = 0;
  return {
    calls,
    get active() { return active; },
    get peak() { return peak; },
    start(...args) {
      active += 1;
      peak = Math.max(peak, active);
      const promise = new Promise((resolve, reject) => calls.push({ args, resolve, reject }));
      for (const watcher of watchers) if (calls.length >= watcher.count) watcher.resolve();
      return promise.finally(() => { active -= 1; });
    },
    count(count) {
      return calls.length >= count ? Promise.resolve() : new Promise((resolve) => watchers.push({ count, resolve }));
    },
  };
}

function rows(count) {
  return Array.from({ length: count }, (_, index) => {
    const bytes = new Uint8Array([index, 11, 22]);
    return { object_key: `photos/${index}`, item_id: `item-${index}`, file_name: `photo-${index}.jpg`,
      size_bytes: bytes.length, content_type: 'image/jpeg', evidence_type: 'photo', original_sha256: digest(bytes) };
  });
}

test('50 report photos read four at a time and retain source order despite reverse completion', { timeout: 5000 }, async () => {
  const reads = deferredOperations();
  const input = rows(50);
  const result = service({ get: (key) => reads.start(key) }).evidenceForSnapshot(input, identity);
  for (let offset = 0; offset < 50; offset += 4) {
    const end = Math.min(offset + 4, 50);
    await reads.count(end);
    assert.equal(reads.calls.length, end, 'A later batch cannot start before this batch finishes');
    assert.equal(reads.active, end - offset);
    for (let index = end - 1; index >= offset; index -= 1) {
      const bytes = new Uint8Array([index, 11, 22]);
      reads.calls[index].resolve({ arrayBuffer: async () => bytes.buffer });
    }
  }
  const loaded = await result;
  assert.equal(reads.peak, 4, 'Storage reads overlap without exhausting the connection budget');
  assert.equal(reads.active, 0);
  assert.deepEqual(loaded.evidence.map((entry) => entry.sourceItemId), input.map((row) => row.item_id));
  assert.deepEqual(loaded.evidence.map((entry) => entry.originalSha256), input.map((row) => row.original_sha256));
  assert.equal(loaded.preparedObjects.length, 50);
  assert.equal(Object.keys(loaded.assets).length, 50);
  for (const [index, entry] of loaded.evidence.entries()) {
    assert.deepEqual(loaded.assets[entry.id].bytes, new Uint8Array([index, 11, 22]));
    assert.equal(loaded.preparedObjects[index].objectKey, entry.objectKey);
    assert.equal(loaded.preparedObjects[index].evidenceId, entry.id);
    assert.match(entry.objectKey, /^trade-issued-documents\/rental-report\/report\/revision-1\/evidence\//);
  }
});

test('the 32 MiB evidence preflight rejects oversized reports before reading any object', async () => {
  let gets = 0;
  const server = service({ get: async () => { gets += 1; return null; } });
  await assert.rejects(server.evidenceForSnapshot([
    { ...rows(1)[0], size_bytes: 32 * 1024 * 1024 },
    { ...rows(1)[0], size_bytes: 1 },
  ], identity), /RENTAL_REPORT_EVIDENCE_TOO_LARGE/);
  assert.equal(gets, 0);
});

test('actual evidence size and hash must match their saved records', async (t) => {
  const bytes = new Uint8Array([0, 11, 22]);
  for (const [name, changes] of [['size', { size_bytes: 4 }], ['hash', { original_sha256: 'f'.repeat(64) }]]) {
    await t.test(name, async () => {
      const server = service({ get: async () => ({ arrayBuffer: async () => bytes.buffer }) });
      await assert.rejects(server.evidenceForSnapshot([{ ...rows(1)[0], ...changes }], identity), /RENTAL_REPORT_EVIDENCE_INTEGRITY/);
    });
  }
});

test('50 immutable evidence copies write four at a time with exact bytes and provenance', { timeout: 5000 }, async () => {
  const puts = deferredOperations();
  const prepared = rows(50).map((row, index) => ({
    objectKey: `issued/${index}`, bytes: new Uint8Array([255, index, 11, 22, 255]).subarray(1, 4),
    contentType: row.content_type, evidenceId: `evidence-${index}`, sha256: row.original_sha256,
  }));
  const completed = service({ put: (...args) => puts.start(...args) }).storePreparedRentalEvidence(prepared, identity);
  for (let offset = 0; offset < 50; offset += 4) {
    const end = Math.min(offset + 4, 50);
    await puts.count(end);
    assert.equal(puts.calls.length, end);
    for (let index = end - 1; index >= offset; index -= 1) {
      const [key, buffer, options] = puts.calls[index].args;
      assert.equal(key, prepared[index].objectKey);
      assert.deepEqual(new Uint8Array(buffer), prepared[index].bytes, 'Copy excludes bytes outside a Uint8Array view');
      assert.equal(options.httpMetadata.contentType, 'image/jpeg');
      assert.deepEqual(options.customMetadata, { documentKind: 'rental-report-evidence', reportId: 'report',
        revision: '1', evidenceId: `evidence-${index}`, sha256: prepared[index].sha256, retention: 'immutable-issued-document' });
      puts.calls[index].resolve();
    }
  }
  await completed;
  assert.equal(puts.peak, 4);
  assert.equal(puts.active, 0);
});

test('a failed copy waits for active writes before rejecting and never starts the next batch', { timeout: 5000 }, async () => {
  const puts = deferredOperations();
  const prepared = Array.from({ length: 8 }, (_, index) => ({ objectKey: `issued/${index}`,
    bytes: new Uint8Array([index]), contentType: 'image/jpeg', evidenceId: `evidence-${index}`, sha256: 'a'.repeat(64) }));
  let settled = false;
  const failure = new Error('Object store unavailable');
  const completed = service({ put: (...args) => puts.start(...args) }).storePreparedRentalEvidence(prepared, identity);
  completed.then(() => { settled = true; }, () => { settled = true; });
  const rejection = assert.rejects(completed, (error) => error === failure);
  await puts.count(4);
  puts.calls[0].reject(failure);
  puts.calls[1].resolve();
  puts.calls[2].resolve();
  await setImmediate();
  assert.equal(settled, false, 'Cleanup must not start while the final in-flight PUT can still create a file');
  assert.equal(puts.active, 1);
  assert.equal(puts.calls.length, 4, 'A failed batch prevents subsequent storage writes');
  puts.calls[3].resolve();
  await rejection;
  assert.equal(puts.active, 0);
  assert.equal(puts.calls.length, 4);
});
