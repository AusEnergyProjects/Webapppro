import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JobAnswersHttpError, activityFormAnswers, businessFormAnswers, jobAnswerValue, loadJobAnswers, workPackAnswers } from '../src/lib/trade-job-answers.ts';
import { ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS } from '../src/lib/trade-activity-field-policy.ts';

const business = (overrides = {}) => ({ id: 'business-1', templateName: 'Site check', templateVersion: 2, status: 'complete',
  template: { fields: [
    { key: 'present', label: 'Equipment present?', type: 'checkbox', section: 'Before', required: false },
    { key: 'condition', label: 'Condition', type: 'text', condition: { fieldKey: 'present', equals: true }, required: false },
    { key: 'note', label: 'What was checked?', type: 'textarea', phase: 'after', section: 'Work', required: false },
  ] }, answers: { present: false, condition: 'Retained hidden answer', note: 'Line one\nLine two' }, ...overrides });
const activity = (overrides = {}) => ({ id: 'activity-1', workOrderId: 'job-1', status: 'draft', updatedAt: '2026-10-05T00:00:00Z',
  form: { title: 'Installation', version: 4, fields: [
    { key: 'type', label: 'Type', type: 'select', options: ['gas'], optionLabels: { gas: 'Gas heater' }, phase: 'before', section: 'Equipment' },
    { key: 'capacity', label: 'Capacity', type: 'number', phase: 'after', section: 'Measurements', repeatGroup: 'units' },
    { key: 'photo', label: 'Equipment photo', type: 'photo', phase: 'after', section: 'Measurements', repeatGroup: 'units' },
  ], declarations: [{ key: 'approved', title: 'Customer declaration', text: 'I, {{customer}}, agree.', phase: 'after' }] },
  answers: { type: 'gas', capacity: 0, 'capacity[1]': 7, '$repeat.units': 2, 'binding.customer': 'Alex' },
  evidence: [{ id: 'photo-1', fieldKey: 'photo[1]', fileName: 'second-unit.jpg' }],
  signatures: [{ id: 'sig-1', declarationKey: 'approved', signerName: 'Alex', signedAt: '2026-10-05T02:00:00Z', strokes: [] },
    { id: 'other-sig', declarationKey: 'another', signerName: 'Wrong signer', signedAt: '', strokes: [] }], ...overrides });
const prompt = (key, type = 'text', overrides = {}) => ({ promptKey: key, type, order: 0, label: key, visibility: null, options: [], unit: '', ...overrides });
const pack = (overrides = {}) => ({
  instance: { id: 'pack-1', complianceIntentId: 'intent-1', status: 'completed' },
  definition: { title: 'Saved activity pack', version: 3, schema: { sections: [
    { sectionKey: 'base', title: 'Basic questions', order: 0, visibility: null, repeatability: null, prompts: [
      prompt('choice', 'select', { options: [{ value: 'e', label: 'Electric' }] }), prompt('unknown'),
      prompt('document', 'reference_document'), prompt('signed', 'signature', { signerRoleKey: 'customer' }),
    ] },
    { sectionKey: 'units', title: 'Units', order: 1, visibility: null, repeatability: { itemLabel: 'Unit' }, prompts: [
      prompt('power', 'number', { unit: 'kW' }), prompt('photo', 'photo'),
      prompt('hidden', 'text', { visibility: { match: 'all', conditions: [{ promptKey: 'power', scope: 'section_instance', operator: 'equals', value: 99 }] } }),
    ] },
  ] } },
  response: { answers: { choice: 'e', document: { acknowledged: true, sourceArtifactId: 'rights', contract: 'creditex-activity-work-pack-reference-document-acknowledgement/v1' }, signed: ['signature-1'] }, repeatableSections: { units: [
    { instanceKey: 'one', answers: { power: 0, photo: ['artifact-1'] } },
    { instanceKey: 'two', answers: { power: 3, photo: ['artifact-2'], hidden: 'Retained but inapplicable' } },
  ] } },
  artifacts: [ { id: 'artifact-1', promptKey: 'units[one].photo', originalFileName: 'first.jpg' },
    { id: 'artifact-2', promptKey: 'units[two].photo', originalFileName: 'second.jpg' } ],
  referenceDocuments: [{ responseKey: 'document', title: 'Customer rights', version: '2', sourceArtifactId: 'rights', acknowledgementMode: 'confirmed' }],
  signatures: [{ id: 'signature-1', promptKey: 'signed', signerRole: 'customer', action: 'captured', signerName: 'Jamie', signedAt: '2026-10-05T01:00:00Z', signaturePayload: { strokes: [] } },
    { id: 'revoked', promptKey: 'signed', signerRole: 'customer', action: 'revoked', signerName: 'Old', signaturePayload: { strokes: [] } },
    { id: 'other', promptKey: 'other-signature', signerRole: 'customer', action: 'captured', signerName: 'Other', signaturePayload: { strokes: [] } }],
  ...overrides,
});
const rows = form => form.sections.flatMap(section => section.rows);

test('answers preserve false, zero, multiline text and human option labels', () => {
  assert.equal(jobAnswerValue(false), 'No');
  assert.equal(jobAnswerValue(true), 'Yes');
  assert.equal(jobAnswerValue(0, {}, 'kW'), '0 kW');
  assert.equal(jobAnswerValue('Line one\nLine two'), 'Line one\nLine two');
  assert.equal(jobAnswerValue(['a', 'b'], { a: 'First', b: 'Second' }), 'First\nSecond');
  for (const value of [undefined, null, '', '  \n ', []]) assert.equal(jobAnswerValue(value), 'Not answered');
  assert.equal(jobAnswerValue({ private: 'internal object' }), 'Saved answer could not be displayed.');
});

test('business answers use attached snapshot fields in order and applicable conditions', () => {
  const result = businessFormAnswers(business());
  assert.equal(result.version, 2);
  assert.deepEqual(rows(result).map(row => [row.question, row.answer]), [['Equipment present?', 'No'], ['What was checked?', 'Line one\nLine two']]);
  assert.deepEqual(result.sections.map(section => section.title), ['Before', 'Work / After work']);
});

test('activity answers show every repeated item and bind files and signatures to the correct questions', () => {
  const result = activityFormAnswers(activity());
  assert.equal(rows(result).find(row => row.key === 'type').answer, 'Gas heater');
  assert.equal(rows(result).find(row => row.key === 'capacity').answer, '0');
  assert.equal(rows(result).find(row => row.key === 'capacity[1]').answer, '7');
  assert.equal(rows(result).find(row => row.key === 'photo').answer, 'No file attached');
  assert.equal(rows(result).find(row => row.key === 'photo[1]').answer, 'second-unit.jpg');
  assert.equal(rows(result).find(row => row.key === 'approved').note, 'I, Alex, agree.');
  assert.deepEqual(rows(result).find(row => row.key === 'approved').signatures.map(item => item.name), ['Alex']);
});

test('activity review omits machine delivery receipts while retaining useful customer answers', () => {
  const base = activity();
  const receiptKeys = Object.values(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS);
  const record = activity({
    form: { ...base.form, fields: [...base.form.fields,
      ...receiptKeys.map(key => ({ key, label: key, type: 'text', section: 'Customer document delivery', phase: 'before', presentation: 'derived' })),
      { key: 'customer.name', label: 'Customer name', type: 'text', phase: 'before', section: 'Customer', presentation: 'derived', autofill: 'job.customer.fullName' },
    ] },
    answers: { ...base.answers, ...Object.fromEntries(receiptKeys.map(key => [key, 'internal-receipt-value'])), 'customer.name': 'Alex Citizen' },
  });
  const result = activityFormAnswers(record);
  assert.equal(rows(result).some(row => receiptKeys.includes(row.key)), false);
  assert.equal(result.sections.some(section => section.title === 'Customer document delivery'), false);
  const customer = rows(result).find(row => row.key === 'customer.name');
  assert.equal(customer.answer, 'Alex Citizen');
  assert.equal(customer.note, 'Automatically supplied from job or profile details.');
  assert.equal(rows(result).find(row => row.key === 'type').note, undefined);
  const submitted = activityFormAnswers({ ...record, status: 'submitted_for_creditex_review' });
  assert.equal(rows(submitted).find(row => row.key === 'customer.name').note, undefined);
  const signedDraft = activityFormAnswers({ ...record, signatures: [{ ...record.signatures[0], phase: 'before' }] });
  assert.equal(rows(signedDraft).find(row => row.key === 'customer.name').note, undefined);
});

test('work pack reads saved labels, units, repeated evidence, acknowledgements and active matching signatures', () => {
  const result = workPackAnswers(pack());
  assert.equal(rows(result).find(row => row.key === 'choice').answer, 'Electric');
  assert.equal(rows(result).find(row => row.key === 'unknown').answer, 'Not answered');
  assert.equal(rows(result).find(row => row.key === 'units[one].power').answer, '0 kW');
  assert.equal(rows(result).find(row => row.key === 'units[two].photo').answer, 'second.jpg');
  assert.equal(rows(result).some(row => row.key.endsWith('.hidden')), false);
  assert.equal(rows(result).find(row => row.key === 'document').answer, 'Customer rights (2)\nAcknowledgement recorded');
  assert.deepEqual(rows(result).find(row => row.key === 'signed').signatures.map(item => item.name), ['Jamie']);
  assert.deepEqual(result.sections.map(section => section.title), ['Basic questions', 'Units / Unit 1', 'Units / Unit 2']);
});

function requestFixture(overrides = {}) {
  const calls = [];
  const responses = {
    '/api/trade-job-forms?workOrderId=job-1': { forms: [] },
    '/api/trade-team/work-packs?workOrderId=job-1': { instances: [] },
    '/api/trade-activity-forms?workOrderId=job-1': { records: [] },
    '/api/trade-rental-inspections?workOrderId=job-1': new JobAnswersHttpError('Rental inspection not found.', 404),
    '/api/trade-swms?workOrderId=job-1': { record: null }, ...overrides,
  };
  return { calls, request: async path => { calls.push(path); const response = responses[path]; if (response instanceof Error) throw response;
    assert.notEqual(response, undefined, `Unexpected request ${path}`); return response; } };
}

test('no forms is returned only when every collection successfully reports no attached forms', async () => {
  const fixture = requestFixture();
  assert.deepEqual(await loadJobAnswers(fixture.request, 'job-1'), { forms: [], errors: [] });
  assert.equal(fixture.calls.length, 5);
});

test('failed or malformed collection is an error and does not erase answers from another source', async () => {
  const fixture = requestFixture({ '/api/trade-job-forms?workOrderId=job-1': { forms: [business()] },
    '/api/trade-team/work-packs?workOrderId=job-1': new Error('Access denied'), '/api/trade-activity-forms?workOrderId=job-1': {} });
  const result = await loadJobAnswers(fixture.request, 'job-1');
  assert.equal(result.forms.length, 1);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /Access denied/);
});

test('unstarted planned activities never create a draft and do not duplicate their attached work pack', async () => {
  const fixture = requestFixture({ '/api/trade-team/work-packs?workOrderId=job-1': { instances: [pack()] },
    '/api/trade-activity-forms?workOrderId=job-1': { records: [{ id: '', intentId: 'intent-1', title: 'Pack activity' }, { id: '', intentId: 'intent-2', title: 'Unstarted activity' }] } });
  const result = await loadJobAnswers(fixture.request, 'job-1');
  assert.equal(result.forms.length, 2);
  assert.match(result.forms[1].emptyMessage, /no form answers have been saved/);
  assert.equal(fixture.calls.length, 5);
});

test('activity details use record GET and reject a response from another job', async () => {
  const summaries = { records: [{ id: 'activity-1', intentId: 'intent-1', title: 'Installation' }] };
  const fixture = requestFixture({ '/api/trade-activity-forms?workOrderId=job-1': summaries,
    '/api/trade-activity-forms?recordId=activity-1': { record: activity() } });
  const result = await loadJobAnswers(fixture.request, 'job-1');
  assert.equal(result.forms[0].key, 'activity:activity-1');
  assert.equal(fixture.calls.at(-1), '/api/trade-activity-forms?recordId=activity-1');
  const wrong = requestFixture({ '/api/trade-activity-forms?workOrderId=job-1': summaries,
    '/api/trade-activity-forms?recordId=activity-1': { record: activity({ workOrderId: 'job-2' }) } });
  const failed = await loadJobAnswers(wrong.request, 'job-1');
  assert.equal(failed.forms.length, 0);
  assert.match(failed.errors[0], /did not match this job/);
});

test('only the exact rental no-inspection response is an empty source, not permission or other failures', async () => {
  for (const error of [new JobAnswersHttpError('Not allowed.', 403), new JobAnswersHttpError('Job not found.', 404), new Error('Rental inspection not found.')]) {
    const fixture = requestFixture({ '/api/trade-rental-inspections?workOrderId=job-1': error });
    const result = await loadJobAnswers(fixture.request, 'job-1');
    assert.equal(result.forms.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Assessment forms could not be loaded/);
  }
});

test('attached assessment and SWMS join the same form choices', async () => {
  const fixture = requestFixture({
    '/api/trade-rental-inspections?workOrderId=job-1': { inspection: { id: 'inspection', status: 'draft' },
      modules: [{ id: 'module', title: 'Rental assessment', status: 'draft', answers: {}, template: { metadataFields: [], sections: [] } }] },
    '/api/trade-swms?workOrderId=job-1': { template: { fields: [{ key: 'safe', label: 'Site made safe?' }], declaration: 'I confirm.' },
      record: { id: 'swms', templateName: 'Safety record', status: 'draft', answers: { safe: false },
        context: { businessName: 'Example', scheduledWorker: { name: 'Worker' } } } },
  });
  const result = await loadJobAnswers(fixture.request, 'job-1');
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.forms.map(form => form.title), ['Rental assessment', 'Safety record']);
  assert.equal(rows(result.forms[1]).find(row => row.key === 'safe').answer, 'No');
});

test('reader has one form selector, vertical question-answer rows, no editor or mutation, and stale-load guards', () => {
  const source = readFileSync(new URL('../src/components/TradeJobAnswersPanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /result\.forms\.length > 1/);
  assert.match(source, /<dt>/); assert.match(source, /<dd>/);
  assert.doesNotMatch(source, /<details|<textarea|<input|useFormTimeTracking|method: ['"](?:POST|PATCH|DELETE)|localStorage|sessionStorage/);
  assert.match(source, /method: 'GET'/);
  assert.match(source, /active = false; controller\.abort\(\)/);
  assert.match(source, /if \(active\) setLoad/);
  assert.match(source, /load\?\.workOrderId === workOrderId/);
  assert.match(source, /!result\.forms\.length && !result\.errors\.length/);
  const css = readFileSync(new URL('../src/components/TradeJobAnswersPanel.module.css', import.meta.url), 'utf8');
  assert.match(css, /data-tlink-colour-mode="night"/);
  assert.match(css, /--question-background/); assert.match(css, /--answer-background/);
});
