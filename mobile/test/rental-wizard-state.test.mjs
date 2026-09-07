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

test('camera is available before an answer exists and metadata mutations use the server revision contract', () => {
  const source = readFileSync(new URL('../src/components/rental-inspection-workflow.tsx', import.meta.url), 'utf8');
  const capture = source.slice(source.indexOf('async function capture()'), source.indexOf('async function updatePhoto'));
  assert.ok(capture.indexOf('await persist(next)') < capture.indexOf('await observeLocation(true)'), 'Photo reference must survive GPS errors');
  assert.doesNotMatch(capture, /if \(!item\.id\)|if \(!draft\.item\.id\)/);
  assert.match(source, /Remove pending photo/);
  assert.match(source, /action: 'save_module_answers', moduleId: active\.id, expectedRevision: active\.revision/);
  assert.match(source, /rentalObservationsComplete\(data, active\.id\) && !activeHasDraft/);
  assert.match(source, /active\.status === 'complete' \|\| !data\.completion/);
  assert.match(source, /else advanceQuestion\(\)/);
});
