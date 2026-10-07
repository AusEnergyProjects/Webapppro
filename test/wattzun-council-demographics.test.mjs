import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as demographics from '../src/lib/council-demographics.ts';
import * as references from '../src/lib/wattzun-work-context.ts';

const source = JSON.parse(readFileSync(new URL('../public/data/council-demographics/abs-2021.json', import.meta.url), 'utf8'));
const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/wattzun-council-demographics-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class AccessError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fixture(change = {}) {
  const selected = { ok: true, identity: { uid: 'council-actor' }, council: { id: 'council-one', name: 'Synthetic Council', role: 'viewer', state: 'VIC', postcodes: ['3199', '3200'] }, ...change };
  const dependencies = {
    '../../public/data/council-demographics/abs-2021.json': { default: source },
    './council-demographics': demographics,
    './council-access-server': { requireCouncilAccess: async () => selected },
    './wattzun-portal-access-server': { WattzunAccessError: AccessError },
  };
  const exports = {};
  Function('require', 'exports', compiled)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, exports);
  return exports;
}
const access = { actorUid: 'council-actor', scope: { portal: 'council', scopeId: 'council-one' }, db: {} };
const reference = { kind: 'council_postcode', postcode: '3199' };
const request = new Request('https://fixture.invalid/api/wattzun/portal');

test('Council demographic conversation loads one official row and its state benchmark with honest scope', async () => {
  const result = await fixture().loadWattzunCouncilDemographics(request, access, reference);
  assert.deepEqual(result.facts.postcode, source.rows.find(row => row.code === '3199'));
  assert.deepEqual(result.facts.stateBenchmark, source.states.find(row => row.code === 'VIC'));
  assert.equal(result.facts.source.censusDate, '2021-08-10');
  assert.equal(result.facts.rows, undefined);
  assert.equal(result.facts.postcode.code, '3199');
  assert.ok(JSON.stringify(result).length < 24000);
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(result.limitations.join(' '), /not current population.*can cross Council/);
  assert.match(result.limitations.join(' '), /not private resident records.*repeat activities/);
  assert.ok(references.readWattzunWorkContextInfo(result, 'council'));
});

test('Council Census selection fails closed for foreign postcode, identity, workspace and access loss', async () => {
  for (const selected of [
    { ok: false },
    { identity: { uid: 'other-person' } },
    { council: { id: 'other-council', postcodes: ['3199'] } },
  ]) await assert.rejects(() => fixture(selected).loadWattzunCouncilDemographics(request, access, reference), error => error.status === 403);
  await assert.rejects(() => fixture().loadWattzunCouncilDemographics(request, access, { ...reference, postcode: '2000' }), error => error.status === 403);
  await assert.rejects(() => fixture().loadWattzunCouncilDemographics(request, { ...access, scope: { ...access.scope, portal: 'trade' } }, reference), error => error.status === 403);
  assert.equal(references.readWattzunWorkReference(reference, 'trade'), null);
  assert.equal(references.readWattzunWorkReference({ ...reference, suppliedFacts: source.rows[0] }, 'council'), null);
});
