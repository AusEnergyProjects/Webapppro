import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDeclarationPages, activityWizardSteps, expandedActivityFields, fieldConditionMet } from '../src/lib/trade-activity-form-flow.ts';
import { activityMissing, normaliseActivityAnswers, activitySigningScope } from '../src/lib/trade-activity-forms.ts';

const field = (key, type = 'text', extra = {}) => ({ key, type, label: key, section: 'Equipment', required: true, phase: 'after', options: [], help: '', ...extra });
const form = {
  id: 'fixture', version: 1, activityTemplateId: 'fixture', variantId: 'fixture', variantOptions: [], programCode: 'VEU', title: 'Fixture', sources: [], reviewNotes: [],
  fields: [field('consent', 'boolean', { phase: 'before' }), field('installed', 'boolean', { repeatGroup: 'units' }), field('serial', 'text', { repeatGroup: 'units', condition: { fieldKey: 'installed', equals: true } }), field('photo', 'photo', { repeatGroup: 'units', condition: { fieldKey: 'installed', equals: true } })],
  declarations: [{ key: 'customer', phase: 'before', role: 'customer', title: 'Customer declaration', text: 'I authorise {{customer}}.', required: true }, { key: 'technician', phase: 'after', role: 'technician', title: 'Technician declaration', text: 'I recorded the work.', required: true }],
};
const record = (answers = {}) => ({ id: 'record', form, formSha256: 'hash', answers, evidence: [], signatures: [] });

test('same-item conditional questions never borrow the first equipment answer', () => {
  const answers = { '$repeat.units': 2, installed: true, 'installed[1]': false };
  assert.deepEqual(expandedActivityFields(form, answers).map((item) => item.key), ['consent', 'installed', 'serial', 'photo', 'installed[1]']);
  assert.equal(fieldConditionMet({ all: [{ fieldKey: 'installed', equals: true }, { any: [{ fieldKey: 'consent', equals: true }, { fieldKey: 'consent', equals: false }] }] }, { ...answers, consent: false }, form, 'units', 1), false);
});
test('numeric upper-bound conditions use typed numbers and include the exact boundary', () => {
  const condition = { fieldKey: 'distance', lessThanOrEqual: 1 };
  assert.equal(fieldConditionMet(condition, { distance: 0.75 }), true);
  assert.equal(fieldConditionMet(condition, { distance: 1 }), true);
  assert.equal(fieldConditionMet(condition, { distance: 1.01 }), false);
  assert.equal(fieldConditionMet(condition, { distance: '0.75' }), false);
});
test('repeat instances keep the same identity while each section remains one run', () => {
  const split = { ...form, fields: [
    field('installed', 'boolean', { repeatGroup: 'units', section: 'Equipment' }),
    field('serial', 'text', { repeatGroup: 'units', section: 'Equipment', condition: { fieldKey: 'installed', equals: true } }),
    field('price', 'number', { repeatGroup: 'units', section: 'Payment' }),
  ] };
  const answers = { '$repeat.units': 2, installed: true, 'installed[1]': true };
  assert.deepEqual(expandedActivityFields(split, answers).map((item) => item.key),
    ['installed', 'serial', 'installed[1]', 'serial[1]', 'price', 'price[1]']);
});
test('question wizard puts before signatures before work and final signature after work', () => {
  const steps = activityWizardSteps(form, { installed: true });
  assert.deepEqual(steps.map((item) => item.key), ['consent', 'customer:read:0', 'customer', 'installed', 'serial', 'photo', 'technician:read:0', 'technician', 'review']);
});
test('declaration pagination retains every exact character without scrolling through a whole document', () => {
  const declaration = ('A complete declaration with meaningful spaces.\n').repeat(150);
  const pages = activityDeclarationPages(declaration);
  assert.equal(pages.join(''), declaration);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.length <= 450));
});
test('every repeated required photo and answer blocks completion independently', () => {
  const answers = normaliseActivityAnswers(form, { '$repeat.units': 2, consent: false, installed: true, 'installed[1]': true, serial: 'A' });
  assert.deepEqual(activityMissing(record(answers), 'after', false).map((item) => item.key), ['photo', 'serial[1]', 'photo[1]']);
  assert.throws(() => normaliseActivityAnswers(form, { '$repeat.not-a-group': 2 }), /INVALID_ACTIVITY_REPEAT/);
  assert.throws(() => normaliseActivityAnswers(form, { '$repeat.units': 1, 'serial[1]': 'hidden' }), /INVALID_ACTIVITY_REPEAT/);
});
test('repeated evidence and count changes are bound into the exact signed scope', () => {
  const original = record({ '$repeat.units': 2, installed: true, 'installed[1]': true });
  const withEvidence = { ...original, evidence: [{ id: 'photo2', fieldKey: 'photo[1]', sha256: 'one', capturedAt: '2026-09-07', latitude: -37, longitude: 145, accuracy: 8 }] };
  assert.notEqual(activitySigningScope(original, 'after'), activitySigningScope(withEvidence, 'after'));
  assert.notEqual(activitySigningScope(withEvidence, 'after'), activitySigningScope({ ...withEvidence, answers: { ...withEvidence.answers, '$repeat.units': 1 } }, 'after'));
});
