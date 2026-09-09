import assert from 'node:assert/strict';
import test from 'node:test';
import { rentalAssessmentCompletion, rentalAssessmentTemplateSnapshot, publicRentalReportValue } from '../src/lib/trade-rental-assessment.mjs';
import { RENTAL_ROOM_TYPES } from '../src/lib/rental-assessor-workflow.mjs';

function assessment(checkKey, outcome = 'meets') {
  const full = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards;
  const source = full.sections.find((section) => section.checks.some((check) => check.key === checkKey));
  const check = source.checks.find((candidate) => candidate.key === checkKey);
  const item = { id: 'item-1', itemKey: 'item-1', sectionKey: source.key, checkKey, instanceKey: 'room-1', locationLabel: 'Front bedroom',
    outcome, requiredEvidenceCount: 1, responseJson: {} };
  return { moduleTemplate: { key: full.key, credentialGate: full.credentialGate, sections: [{ ...source, checks: [check] }] },
    items: [item], answers: {}, findings: [], evidenceCounts: {}, photoCounts: {} };
}

test('clear ordinary room observations require no photos even with a legacy stored evidence count', () => {
  for (const key of ['mould_damp_observation', 'structure_weatherproofing', 'artificial_lighting']) {
    const input = assessment(key);
    assert.deepEqual(rentalAssessmentCompletion(input), { complete: true, blockers: [] }, key);
    input.items[0].outcome = 'does_not_meet';
    input.findings = [{ itemId: 'item-1', title: 'Observed damage', description: 'Damage at the window frame' }];
    assert.equal(rentalAssessmentCompletion(input).complete, false);
    input.evidenceCounts = { 'item-1': 2 };
    assert.equal(rentalAssessmentCompletion(input).complete, false, 'Documents cannot substitute for defect photos');
    input.photoCounts = { 'item-1': 2 };
    assert.equal(rentalAssessmentCompletion(input).complete, true);
  }
});

test('equipment proof and licensed verification remain required', () => {
  const equipment = assessment('main_living_heater');
  assert.equal(rentalAssessmentCompletion(equipment).complete, false);
  equipment.evidenceCounts = { 'item-1': 1 };
  assert.equal(rentalAssessmentCompletion(equipment).complete, false);
  equipment.photoCounts = { 'item-1': 1 };
  assert.equal(rentalAssessmentCompletion(equipment).complete, true);
  const electrical = assessment('outlet_lighting_protection');
  electrical.evidenceCounts = { 'item-1': 2 }; electrical.photoCounts = { 'item-1': 2 };
  assert.ok(rentalAssessmentCompletion(electrical).blockers.some((blocker) => blocker.key.startsWith('credential:')));
});

test('all applicable rooms must be assessed while legacy room instance IDs retain their observations', () => {
  const input = assessment('mould_damp_observation');
  const type = RENTAL_ROOM_TYPES.find((room) => room.value === 'bedroom').value;
  input.answers.roomRoster = [{ id: 'room-1', label: 'Front bedroom', type }, { id: 'room-2', label: 'Rear bedroom', type }];
  assert.ok(rentalAssessmentCompletion(input).blockers.some((blocker) => blocker.key === 'room:room-2:mould_damp_observation'));
  input.items.push({ ...input.items[0], id: 'item-2', itemKey: 'item-2', instanceKey: 'old-device-room-key', locationLabel: '  REAR   bedroom ' });
  assert.equal(rentalAssessmentCompletion(input).complete, true);
  assert.equal(input.items[1].instanceKey, 'old-device-room-key');
  input.items[1].outcome = 'not_assessed';
  assert.equal(rentalAssessmentCompletion(input).complete, false);
  input.answers.roomRoster = [{ id: 'room-1', label: '', type }];
  assert.ok(rentalAssessmentCompletion(input).blockers.some((blocker) => blocker.key === 'room-roster'));
});

test('a legacy instance reused by a different room cannot satisfy another room in server completion', () => {
  const input = assessment('mould_damp_observation');
  input.answers.roomRoster = [{ id: 'first', label: 'Front bedroom', type: 'bedroom' }, { id: 'room-rear', label: 'Rear bedroom', type: 'bedroom' }];
  input.items = [
    { ...input.items[0], id: 'front-lighting', itemKey: 'front-lighting', sectionKey: 'lighting', checkKey: 'artificial_lighting', instanceKey: 'first', locationLabel: 'Front bedroom' },
    { ...input.items[0], id: 'rear-mould', itemKey: 'rear-mould', instanceKey: 'first', locationLabel: 'Rear bedroom' },
  ];
  const result = rentalAssessmentCompletion(input);
  assert.equal(result.complete, false);
  assert.deepEqual(result.blockers.filter((blocker) => blocker.key.startsWith('room:')).map((blocker) => blocker.key), ['room:first:mould_damp_observation']);
  assert.equal(input.items[1].instanceKey, 'first', 'Reviewing coverage must not rewrite the saved rear-room evidence identity');
});

test('inaccessible areas retain honest findings without requiring unsafe photos', () => {
  const input = assessment('mould_damp_observation', 'not_accessible');
  assert.equal(rentalAssessmentCompletion(input).complete, false, 'A reason remains required');
  input.findings = [{ itemId: 'item-1', title: 'Locked room', description: 'The room was locked and no key was available' }];
  assert.equal(rentalAssessmentCompletion(input).complete, true);
  assert.equal(input.items[0].outcome, 'not_accessible');
});

test('each recorded room window needs its own covering answer before completion', () => {
  const input = assessment('window_covering');
  const full = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards;
  input.moduleTemplate.sections.push(full.sections.find((section) => section.key === 'windows'));
  input.answers.roomRoster = [{ id: 'room-1', label: 'Front bedroom', type: 'bedroom' }];
  const first = { ...input.items[0], instanceKey: 'window-1', locationLabel: 'Front bedroom - Window 1', responseJson: JSON.stringify({ roomId: 'room-1' }) };
  const operation = { ...first, id: 'operation-1', itemKey: 'operation-1', sectionKey: 'windows', checkKey: 'window_operation_security' };
  const secondOperation = { ...operation, id: 'operation-2', itemKey: 'operation-2', instanceKey: 'window-2', locationLabel: 'Front bedroom - Window 2' };
  input.items = [first, operation, secondOperation];
  assert.deepEqual(rentalAssessmentCompletion(input).blockers.map((blocker) => blocker.key), ['window:window-2:window_covering']);
  input.items.push({ ...first, id: 'covering-2', itemKey: 'covering-2', instanceKey: 'legacy-covering-key', locationLabel: secondOperation.locationLabel });
  assert.equal(rentalAssessmentCompletion(input).complete, true, 'An existing answer at this exact window location remains usable');
  input.items.at(-1).outcome = 'not_assessed';
  assert.equal(rentalAssessmentCompletion(input).complete, false, 'An unanswered second window cannot borrow the first result');
});

test('report observations retain useful measurements without exposing internal room identifiers', () => {
  const input = { locationLabel: 'Lounge - Window 1', response: { roomId: 'room-internal-id', sealLengthMetres: '4.8' } };
  assert.deepEqual(publicRentalReportValue(input), { locationLabel: 'Lounge - Window 1', response: { sealLengthMetres: '4.8' } });
  assert.equal(input.response.roomId, 'room-internal-id', 'The editable job retains its room association');
});
