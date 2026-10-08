import assert from 'node:assert/strict';
import test from 'node:test';
import { rentalInspectionAnswers, swmsAnswers } from '../src/lib/trade-job-assessment-answers.ts';

const rows = form => form.sections.flatMap(section => section.rows);
const answer = (form, question) => rows(form).find(row => row.question === question);
function rentalFixture() {
  return {
    inspection: { id: 'inspection-1', status: 'draft' },
    modules: [{ id: 'module-1', title: 'Saved rental assessment', status: 'draft', templateVersion: 3,
      template: { metadataFields: [
        { key: 'assessorName', label: 'Assessor', source: 'team_profile' },
        { key: 'inspectionDate', label: 'Assessment date', source: 'automatic' },
        { key: 'coverageConfirmed', label: 'Coverage confirmed', type: 'checkbox' },
        { key: 'rooms', label: 'Room count' },
        { key: 'rentalRegime', label: 'Rental type', options: [{ value: 'ordinary', label: 'Ordinary residential rental' }] },
        { key: 'blank', label: 'Optional detail' },
      ], sections: [{ key: 'heating', title: 'Heating', checks: [
        { key: 'heater_operation', prompt: 'Saved heater question', repeatBy: 'room' },
        { key: 'unanswered', prompt: 'Another saved question', repeatBy: 'room' },
      ] }] },
      answers: { assessorName: 'Current assessor', inspectionDate: '2026-10-06', coverageConfirmed: false, rooms: 0, rentalRegime: 'ordinary' } }],
    items: [], evidence: [], findings: [],
  };
}
function item(id, overrides = {}) {
  return { id, moduleId: 'module-1', sectionKey: 'heating', checkKey: 'heater_operation', instanceKey: id,
    locationLabel: 'Bedroom', outcome: 'meets', response: {}, ...overrides };
}

test('no attached records produce no invented assessment or SWMS forms', () => {
  assert.deepEqual(rentalInspectionAnswers({}), []);
  assert.deepEqual(rentalInspectionAnswers({ inspection: { id: 'x', status: 'draft' }, modules: [] }), []);
  assert.equal(swmsAnswers({ record: null }), null);
});

test('rental metadata preserves false, zero, choice labels and unanswered values with profile provenance', () => {
  const [form] = rentalInspectionAnswers(rentalFixture());
  assert.equal(answer(form, 'Coverage confirmed').answer, 'No');
  assert.equal(answer(form, 'Room count').answer, '0');
  assert.equal(answer(form, 'Rental type').answer, 'Ordinary residential rental');
  assert.equal(answer(form, 'Optional detail').answer, 'Not answered');
  assert.equal(answer(form, 'Assessor').note, 'Current team profile detail.');
  assert.equal(answer(form, 'Assessment date').note, 'Automatically provided assessment date.');
  assert.equal(answer(form, 'Another saved question').note, 'No items recorded.');
});

test('every saved repeated observation is shown against its snapshot question without changing input', () => {
  const payload = rentalFixture();
  payload.items = [item('one', { locationLabel: 'Bedroom 1', response: { model: 'Heater A' } }),
    item('two', { locationLabel: 'Bedroom 2', outcome: 'does_not_meet', response: { model: 'Heater B' } }),
    item('foreign', { moduleId: 'other-module', response: { model: 'Wrong job/module' } })];
  const original = structuredClone(payload);
  const [form] = rentalInspectionAnswers(payload);
  assert.equal(answer(form, 'Saved heater question (Bedroom 1)').answer, 'Heater works');
  assert.equal(answer(form, 'Saved heater question (Bedroom 2)').answer, 'Heater does not work');
  assert.deepEqual(rows(form).filter(row => row.question === 'Make / model from label (optional)').map(row => row.answer), ['Heater A', 'Heater B']);
  assert.equal(JSON.stringify(form).includes('Wrong job/module'), false);
  assert.deepEqual(payload, original);
});

test('conditional unanswered fields stay hidden but earlier saved values remain visible and labelled', () => {
  const payload = rentalFixture();
  payload.modules[0].template.sections[0].checks = [{ key: 'oven_function', prompt: 'Saved oven check', repeatBy: 'property' }];
  payload.items = [item('oven', { checkKey: 'oven_function', response: { cabinetWidthMm: 0, widthMm: '590', limitationStatus: 'No limitation' } })];
  const [form] = rentalInspectionAnswers(payload);
  const saved = answer(form, 'Cabinet opening width, if safely visible');
  assert.equal(saved.answer, '0 mm');
  assert.equal(saved.note, 'Saved answer from an earlier selection.');
  assert.equal(answer(form, 'Cabinet opening height, if safely visible'), undefined);
  assert.equal(answer(form, 'Brief reason'), undefined);
  assert.equal(answer(form, 'Earlier oven width').answer, '590 mm');
});

test('shared hot water answers describe the observed apartment supply rather than certifying the plant', () => {
  const payload = rentalFixture();
  payload.modules[0].key = 'minimum_standards';
  payload.modules[0].template.sections[0].checks = [{ key: 'hot_water_2027_readiness', prompt: 'Saved hot-water question', repeatBy: 'property' }];
  payload.items = [item('water', { checkKey: 'hot_water_2027_readiness', response: {
    hotWaterSupplyType: 'Shared building system', sharedHotWaterServiceStatus: 'Hot water supplied when checked', sharedHotWaterLimitation: 'Building plant not accessible',
  } })];
  const before = structuredClone(payload);
  const [form] = rentalInspectionAnswers(payload);
  assert.equal(answer(form, 'Saved hot-water question (Bedroom)').answer, 'Hot water supplied; shared plant not inspected');
  assert.deepEqual(payload, before);
});

test('findings, notes and active evidence remain readable and scoped to their saved observation', () => {
  const payload = rentalFixture();
  payload.items = [item('one', { publicNotes: 'Access limited', internalNotes: 'Arrange follow-up', response: { credentialNumber: 'EL123', roomId: 'internal-room-id', showerCaptureVersion: 1 } })];
  payload.findings = [{ id: 'finding', moduleId: 'module-1', itemId: 'one', title: 'Repair needed', quantityMilli: 0,
    details: { quotation: { measurements: 'Recorded measurement', missingInformation: 'Check access' } } },
    { id: 'foreign', moduleId: 'other-module', itemId: 'one', title: 'Wrong finding' }];
  payload.evidence = [{ id: 'file', moduleId: 'module-1', itemId: 'one', status: 'active', fileName: 'heater.jpg', caption: 'Label photo' },
    { id: 'removed', moduleId: 'module-1', itemId: 'one', status: 'removed', fileName: 'removed.jpg' }];
  const [form] = rentalInspectionAnswers(payload);
  assert.equal(answer(form, 'Report detail').answer, 'Access limited');
  assert.equal(answer(form, 'Internal assessment note').answer, 'Arrange follow-up');
  assert.equal(answer(form, 'Credential Number').answer, 'EL123');
  assert.equal(answer(form, 'Quantity').answer, '0');
  assert.equal(answer(form, 'Recorded assessment limitation').answer, 'Check access');
  assert.equal(answer(form, 'Attached evidence').answer, 'heater.jpg · Label photo');
  assert.equal(JSON.stringify(form).includes('Wrong finding'), false);
  assert.equal(JSON.stringify(form).includes('internal-room-id'), false);
  assert.equal(answer(form, 'Shower Capture Version'), undefined);
});

test('completed rental modules use their returned saved snapshot without current-profile notes', () => {
  const payload = rentalFixture();
  payload.modules[0].status = 'complete';
  payload.modules[0].answers.assessorName = 'Original assessor';
  const [form] = rentalInspectionAnswers(payload);
  assert.equal(form.status, 'Complete');
  assert.equal(answer(form, 'Assessor').answer, 'Original assessor');
  assert.equal(answer(form, 'Assessor').note, undefined);
});

test('signed SWMS uses frozen template, answers, context and signature rather than current job details', () => {
  const strokes = [{ points: [{ x: 0.2, y: 0.4 }, { x: 0.8, y: 0.6 }] }];
  const payload = { context: { businessName: 'Current business' },
    template: { fields: [{ key: 'workDescription', label: 'Snapshot question' }, { key: 'reviewPlan', label: 'Review plan' }], declaration: 'Snapshot declaration' },
    record: { id: 'swms-1', templateName: 'Signed SWMS', templateVersion: 1, status: 'complete', completedAt: '2026-10-01T03:00:00Z',
      context: { businessName: 'Signed business', abn: '123', workNumber: 'JOB-1', jobTitle: 'Original job', siteAddress: 'Original site', scheduledWorker: { name: 'Original worker' } },
      answers: { workDescription: 'Saved work', reviewPlan: '' },
      signature: { signerName: 'Signer', signedAt: '2026-10-01T03:00:00Z', strokes } } };
  const form = swmsAnswers(payload);
  assert.equal(answer(form, 'Business').answer, 'Signed business');
  assert.equal(answer(form, 'Snapshot question').answer, 'Saved work');
  assert.equal(answer(form, 'Review plan').answer, 'Not answered');
  assert.equal(answer(form, 'Snapshot declaration').answer, 'Signed');
  assert.deepEqual(answer(form, 'Snapshot declaration').signatures[0].strokes, strokes);
  assert.equal(form.recordedAt, '2026-10-01T03:00:00Z');
});
