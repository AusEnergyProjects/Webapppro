import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/activity-field-completion.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function('exports', code)(exports);
const { activityIntentComplete } = exports;

test('a submitted field record completes its own activity without certificate-case creation', () => {
  const records = [{ intentId: 'heat-pump', status: 'submitted_for_creditex_review' }];
  assert.equal(activityIntentComplete('heat-pump', records, []), true);
  assert.equal(activityIntentComplete('second-activity', records, []), false);
  assert.equal(activityIntentComplete('heat-pump', [{ intentId: 'heat-pump', status: 'draft' }], []), false);
});
test('the existing signed work-pack final record remains a valid completion path', () => {
  const pack = { instance: { complianceIntentId: 'legacy-activity', status: 'completed' }, finalRecord: { id: 'pdf' } };
  assert.equal(activityIntentComplete('legacy-activity', [], [pack]), true);
  assert.equal(activityIntentComplete('legacy-activity', [], [{ ...pack, finalRecord: null }]), false);
});

test('a finish saved on this phone completes only that activity immediately', () => {
  const records = [{ intentId: 'air-conditioning', status: 'draft' }];
  assert.equal(activityIntentComplete('air-conditioning', records, [], ['air-conditioning']), true);
  assert.equal(activityIntentComplete('heat-pump', records, [], ['air-conditioning']), false);
});
