import assert from 'node:assert/strict';
import test from 'node:test';
import { rentalAssessmentCompletion, rentalAssessmentTemplateSnapshot, publicRentalReportValue } from '../src/lib/trade-rental-assessment.mjs';

function assessment(checkKey, outcome = 'meets') {
  const full = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards;
  const section = full.sections.find(s => s.checks.some(c => c.key === checkKey));
  const check = section.checks.find(c => c.key === checkKey);
  return { moduleTemplate: { key: full.key, credentialGate: full.credentialGate, sections: [{ ...section, checks: [check] }] },
    items: [{ id: 'one', itemKey: 'one', sectionKey: section.key, checkKey, instanceKey: 'property', locationLabel: 'Property', outcome, requiredEvidenceCount: 1, responseJson: {} }],
    answers: {}, findings: [], evidenceCounts: {}, photoCounts: {} };
}

test('property observations finish without a room roster, including frozen repeated checks', () => {
  for (const key of ['mould_damp_observation', 'structure_weatherproofing', 'artificial_lighting', 'toilet_function', 'external_door_lock']) {
    const input = assessment(key);
    input.moduleTemplate.sections[0].checks[0].repeatBy = 'room';
    input.moduleTemplate.sections[0].checks[0].credentialGate = 'qualified_assessor';
    input.answers.roomRoster = [{ id: 'old-room', label: '' }];
    assert.deepEqual(rentalAssessmentCompletion(input), { complete: true, blockers: [] });
    input.items[0].outcome = 'does_not_meet';
    input.findings = [{ itemId: 'one', title: 'Issue seen', description: 'Photographed damage' }];
    input.evidenceCounts.one = 2;
    assert.equal(rentalAssessmentCompletion(input).complete, false, 'Documents cannot replace defect photos');
    input.photoCounts.one = 2;
    assert.equal(rentalAssessmentCompletion(input).complete, true);
  }
});

test('a prior room pass cannot silently become a whole-dwelling result', () => {
  const input = assessment('mould_damp_observation');
  input.items[0].instanceKey = 'bedroom-1';
  input.items[0].locationLabel = 'Bedroom 1';
  const before = structuredClone(input);
  assert.deepEqual(rentalAssessmentCompletion(input).blockers.map(b => b.key), ['check:mould_damp:mould_damp_observation']);
  assert.deepEqual(input, before);
  input.items.push({ ...input.items[0], id: 'dwelling', itemKey: 'dwelling', instanceKey: 'property', locationLabel: 'Property' });
  assert.equal(rentalAssessmentCompletion(input).complete, true);
});

test('sealing photos and vent-type proof remain completion requirements for clear answers', () => {
  for (const key of ['doors_2027_readiness', 'windows_2027_readiness', 'vents_2027_readiness']) {
    const input = assessment(key);
    input.evidenceCounts.one = 1;
    assert.equal(rentalAssessmentCompletion(input).complete, false);
    input.photoCounts.one = 1;
    assert.equal(rentalAssessmentCompletion(input).complete, true);
  }
});

test('inaccessible checks finish honestly and electrical verification stays protected', () => {
  const input = assessment('mould_damp_observation', 'not_accessible');
  assert.equal(rentalAssessmentCompletion(input).complete, false);
  input.findings = [{ itemId: 'one', title: 'Area not accessed', description: 'Locked and no key available' }];
  assert.equal(rentalAssessmentCompletion(input).complete, true);
  const electrical = assessment('outlet_lighting_protection');
  electrical.evidenceCounts.one = 2; electrical.photoCounts.one = 2;
  assert.ok(rentalAssessmentCompletion(electrical).blockers.some(b => b.key.startsWith('credential:')));
});

test('legacy evidence stays readable without exposing its internal room identity', () => {
  const original = { locationLabel: 'Lounge - Window 1', response: { roomId: 'internal-id', sealLengthMetres: '4.8' } };
  assert.deepEqual(publicRentalReportValue(original), { locationLabel: 'Lounge - Window 1', response: { sealLengthMetres: '4.8' } });
  assert.equal(original.response.roomId, 'internal-id');
});
