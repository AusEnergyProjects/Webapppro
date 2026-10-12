import assert from 'node:assert/strict';
import test from 'node:test';
import * as contract from '../src/lib/form-compliance.ts';
const context = { scope: 'business', workOrderId: 'job', formId: 'form' };
const review = { ...context, action: 'save_review', expectedRevision: 0, expectedSourceHash: 'a'.repeat(64), templateRevision: 0,
  status: 'draft', answers: [{ key: 'a', response: 'unchecked', note: '' }] };
test('default compliance checks are separate, stable, contextual and limited to 16 to 25 questions', () => {
  const fields = Array.from({ length: 40 }, (_, index) => ({ key: `field${index}`, label: `Work answer ${index}` }));
  const questions = contract.defaultComplianceQuestions(fields);
  assert.equal(questions.length, 25);
  assert.deepEqual(questions, contract.defaultComplianceQuestions(fields));
  assert.equal(new Set(questions.map(question => question.key)).size, 25);
  assert.equal(questions.find(question => question.sourceFieldKey === 'field0').label, 'Does the recorded answer for "Work answer 0" agree with the job evidence?');
  assert.equal(contract.defaultComplianceQuestions([]).length, 16);
});
test('template validation preserves edited order and rejects duplicate, foreign, empty and oversized fields', () => {
  const first = { key: 'a', label: '  First check  ', required: true }, second = { key: 'b', label: 'Second', required: false, sourceFieldKey: 'answer' };
  assert.deepEqual(contract.cleanComplianceQuestions([second, first]), [second, { ...first, label: 'First check' }]);
  for (const value of [[], [first, first], [{ ...first, extra: true }], [{ ...first, label: '' }], [{ ...first, required: 'yes' }], Array.from({ length: 61 }, (_, i) => ({ ...first, key: String(i) }))]) assert.throws(() => contract.cleanComplianceQuestions(value));
  assert.throws(() => contract.cleanComplianceTemplateInput({ action: 'save_template', scope: 'business', formKey: 'activity:abc:', expectedRevision: 0, questions: [first] }));
});
test('review requests reject foreign context and unknown fields rather than accepting mass assignment', () => {
  assert.deepEqual(contract.cleanComplianceReviewInput(review), review);
  for (const value of [{ ...review, ownerUid: 'foreign' }, { ...review, organisationId: 'foreign' }, { ...review, intentId: 'foreign' },
    { ...review, status: 'approved' }, { ...review, expectedRevision: 0.1 }, { ...review, expectedSourceHash: 'bad' },
    { ...review, answers: [{ key: 'a', response: 'pass', note: '', customerName: 'private' }] }]) assert.throws(() => contract.cleanComplianceReviewInput(value));
});
test('failed checks or unchecked required answers block completion; not applicable always requires a reason', () => {
  const questions = [{ key: 'a', label: 'Required', required: true }, { key: 'b', label: 'Optional', required: false }];
  const yes = [{ key: 'a', response: 'pass', note: '' }, { key: 'b', response: 'unchecked', note: '' }];
  contract.assertComplianceCompletion(questions, yes, true);
  for (const response of ['fail', 'unchecked']) assert.throws(() => contract.assertComplianceCompletion(questions, [{ ...yes[0], response }, yes[1]], true));
  assert.throws(() => contract.assertComplianceCompletion(questions, [yes[0], { ...yes[1], response: 'fail' }], true));
  assert.throws(() => contract.cleanComplianceReviewInput({ ...review, answers: [{ key: 'a', response: 'na', note: ' ' }] }));
  contract.cleanComplianceReviewInput({ ...review, answers: [{ key: 'a', response: 'na', note: 'This assessment did not install equipment.' }] });
  assert.throws(() => contract.assertComplianceCompletion(questions, [yes[0]], false));
});
test('stale forms or new questionnaire versions start a fresh review without carrying old passes', () => {
  const workspace = { template: { questions: [{ key: 'a' }, { key: 'new' }] }, stale: false,
    review: { answers: [{ key: 'a', response: 'pass', note: 'Checked' }] } };
  assert.deepEqual(contract.initialComplianceAnswers(workspace), [{ key: 'a', response: 'pass', note: 'Checked' }, { key: 'new', response: 'unchecked', note: '' }]);
  assert.deepEqual(contract.initialComplianceAnswers({ ...workspace, stale: true }), [{ key: 'a', response: 'unchecked', note: '' }, { key: 'new', response: 'unchecked', note: '' }]);
});
