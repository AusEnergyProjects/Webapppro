import assert from 'node:assert/strict';
import test from 'node:test';
import { rentalAssessorMetadataField, rentalAssessorCheckPresentation, rentalAssessorEvidenceRequirement, rentalAssessorOutcomePatch, rentalWindowIsFixed } from '../src/lib/rental-assessor-workflow.mjs';
import { rentalAssessmentTemplateSnapshot } from '../src/lib/trade-rental-assessment.mjs';

test('frozen metadata uses automatic capture and Team profile without changing the source', () => {
  for (const key of ['assessorName', 'qualificationType', 'qualificationNumber', 'licenceNumber']) {
    const old = { key, type: 'text', required: true };
    assert.equal(rentalAssessorMetadataField(old).source, 'team_profile');
    assert.equal(rentalAssessorMetadataField(old).phase, 'profile');
    assert.equal(old.source, undefined);
  }
  assert.equal(rentalAssessorMetadataField({ key: 'inspectionDate', type: 'date' }).source, 'automatic');
  assert.equal(rentalAssessorMetadataField({ key: 'assessorDeclaration', type: 'checkbox' }).phase, 'final');
  assert.equal(rentalAssessorMetadataField({ key: 'agreementStartDate', type: 'date' }).source, 'assessment');
});

test('all current and future categories are assessed once for the dwelling', () => {
  const checks = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards.sections.flatMap(s => s.checks);
  assert.equal(checks.length, 32);
  assert.equal(checks.filter(c => c.assessmentPhase === 'energy_readiness_2027').length, 8);
  assert.ok(checks.every(c => c.repeatBy === 'property'));
  assert.match(rentalAssessorCheckPresentation({ key: 'toilet_function' }).prompt, /property have a working toilet/);
  assert.match(rentalAssessorCheckPresentation({ key: 'mould_damp_observation' }).prompt, /present in the property/);
});

test('existing seals and vent types need photo proof even with positive or uncertain answers', () => {
  for (const key of ['doors_2027_readiness', 'windows_2027_readiness', 'vents_2027_readiness']) {
    for (const outcome of ['meets', 'specialist_verification_required']) {
      const evidence = rentalAssessorEvidenceRequirement({ key, credentialGate: 'qualified_assessor' }, outcome);
      assert.equal(evidence.minimumPhotos, 1);
      assert.equal(evidence.minimumFiles, 1);
      assert.match(evidence.reason, /Photograph/);
    }
    assert.equal(rentalAssessorEvidenceRequirement(key, 'does_not_meet').minimumPhotos, 2);
    assert.equal(rentalAssessorEvidenceRequirement(key, 'not_accessible').minimumPhotos, 0);
  }
  const none = rentalAssessorOutcomePatch('vents_2027_readiness', 'not_applicable');
  assert.match(none.publicNotes, /No wall vents/);
  assert.equal(rentalAssessorEvidenceRequirement('vents_2027_readiness', none.outcome).minimumPhotos, 0);
});

test('basic observations do not demand test certificates while licensed tests still do', () => {
  for (const key of ['mould_damp_observation', 'structure_weatherproofing', 'artificial_lighting', 'toilet_function', 'external_door_lock']) {
    assert.equal(rentalAssessorEvidenceRequirement({ key, credentialGate: 'qualified_assessor' }, 'meets').minimumFiles, 0);
    assert.equal(rentalAssessorEvidenceRequirement(key, 'does_not_meet').minimumPhotos, 2);
  }
  assert.equal(rentalAssessorEvidenceRequirement({ key: 'artificial_lighting', credentialGate: 'licensed_electrician' }, 'meets').minimumFiles, 1);
  assert.equal(rentalAssessorEvidenceRequirement({ key: 'rcd_testing', responseType: 'test_result' }, 'meets').minimumFiles, 1);
});

test('plain wording keeps uncertain ratings and specialist decisions honest', () => {
  assert.match(rentalAssessorCheckPresentation({ key: 'room_ventilation' }).help, /does not by itself prove compliance/);
  assert.match(rentalAssessorCheckPresentation({ key: 'ceiling_2027_readiness' }).help, /need not be upgraded solely because it is below R5/);
  assert.match(rentalAssessorCheckPresentation({ key: 'showerhead_rating' }).help, /Flow alone does not prove its WELS rating/);
  assert.match(rentalAssessorCheckPresentation({ key: 'vents_2027_readiness' }).help, /installer must check gas and ventilation/);
  const fixed = rentalAssessorOutcomePatch('window_operation_security', 'not_applicable');
  assert.match(fixed.publicNotes, /No openable windows at the property/);
  assert.equal(rentalWindowIsFixed(fixed.outcome, fixed.publicNotes), true);
  assert.equal(rentalWindowIsFixed('not_applicable', 'Fixed glazing; this window is not designed to open.'), true);
  assert.deepEqual(rentalAssessorOutcomePatch('window_operation_security', 'meets', fixed.publicNotes), { outcome: 'meets', publicNotes: '' });
});
