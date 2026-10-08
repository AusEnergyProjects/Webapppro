import assert from 'node:assert/strict';
import test from 'node:test';
import { rentalAssessorMetadataField, rentalAssessorCheckPresentation, rentalAssessorEvidenceRequirement, rentalAssessorOutcomePatch, rentalWindowIsFixed } from '../src/lib/rental-assessor-workflow.mjs';
import { rentalAssessmentTemplateSnapshot } from '../src/lib/trade-rental-assessment.mjs';

test('frozen v3 cooling keeps its single-photo rule while v4 asks for equipment and operation evidence', () => {
  const current = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards.sections.find((section) => section.key === 'cooling').checks[0];
  const frozen = structuredClone(current);
  delete frozen.operationPhotoRequired;
  assert.equal(rentalAssessorEvidenceRequirement(frozen, 'meets').minimumPhotos, 1);
  assert.equal(rentalAssessorEvidenceRequirement(current, 'meets').minimumPhotos, 2);
  assert.match(rentalAssessorEvidenceRequirement(current, 'meets').reason, /controller switched on or operating indicator/);
  assert.match(rentalAssessorEvidenceRequirement(current, 'meets').reason, /alone does not prove cooling performance/);
  assert.equal(rentalAssessorEvidenceRequirement(current, 'does_not_meet').minimumPhotos, 2);
});

test('versioned switchboard capture has exactly two authoritative results and one required photo for either', () => {
  const check = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards.sections.find((section) => section.key === 'electrical_safety').checks[0];
  assert.deepEqual(rentalAssessorCheckPresentation(check).outcomeOptions, [{ value: 'meets', label: 'Meets' }, { value: 'does_not_meet', label: "Doesn't meet" }]);
  for (const outcome of ['meets', 'does_not_meet']) assert.equal(rentalAssessorEvidenceRequirement(check, outcome).minimumPhotos, 1);
  const frozen = { ...check, credentialGate: 'licensed_electrician' };
  delete frozen.verificationBasis;
  assert.ok(rentalAssessorCheckPresentation(frozen).outcomeOptions.some((entry) => entry.value === 'specialist_verification_required'));
  assert.equal(rentalAssessorEvidenceRequirement(frozen, 'does_not_meet').minimumPhotos, 2);
});

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

test('Home Star commissioning is the assessment setup question even in an older frozen checkbox', () => {
  const field = { key: 'homeStarCommissioned', label: 'HomeStar opt-in', type: 'checkbox', phase: 'final', source: 'team_profile', required: false, defaultValue: false };
  const before = structuredClone(field);
  const shown = rentalAssessorMetadataField(field);
  assert.equal(shown.label, 'Is this assessment commissioned by Home Star Upgrades?');
  assert.equal(shown.phase, 'setup');
  assert.equal(shown.source, 'assessment');
  assert.equal(shown.required, false);
  assert.equal(shown.defaultValue, false);
  assert.deepEqual(field, before);
});

test('shared hot water asks about the observed apartment supply with no inferred plant compliance', () => {
  const check = { key: 'hot_water_2027_readiness', assessmentPhase: 'energy_readiness_2027', requiredEvidenceCount: 1 };
  const response = { hotWaterSupplyType: 'Shared building system', sharedHotWaterServiceStatus: 'Hot water supplied when checked', sharedHotWaterLimitation: 'Building plant not accessible' };
  const before = structuredClone({ check, response });
  const shown = rentalAssessorCheckPresentation(check, { outcome: 'meets', response });
  assert.equal(shown.prompt, 'Is hot water supplied to this apartment?');
  assert.equal(shown.phaseLabel, 'Apartment hot-water supply');
  assert.equal(shown.outcomeOptions.find(option => option.value === 'meets').label, 'Hot water supplied; shared plant not inspected');
  assert.equal(shown.outcomeOptions.find(option => option.value === 'does_not_meet').label, 'No hot water supplied');
  assert.match(shown.help, /plant's efficiency and future replacement requirements have not been assessed/);
  assert.doesNotMatch(shown.outcomeOptions.map(option => option.label).join(' '), /Ready|efficien.*verified/i);
  for (const sharedHotWaterServiceStatus of ['No hot water when checked', 'Not checked', undefined]) {
    const choices = rentalAssessorCheckPresentation(check, { response: { ...response, sharedHotWaterServiceStatus } });
    assert.equal(choices.outcomeOptions.find(option => option.value === 'meets').label, 'Hot water supplied; shared plant not inspected', 'The answer option remains clear before its required observation is entered; server completion validates contradictory or absent observations separately');
  }
  for (const hotWaterSupplyType of ['Individual unit', 'Unknown', undefined]) {
    const original = rentalAssessorCheckPresentation(check, { response: { ...response, hotWaterSupplyType } });
    assert.match(original.prompt, /2027 replacement requirement/);
    assert.equal(original.photoGuidance, undefined);
  }
  assert.deepEqual({ check, response }, before, 'Presentation does not rewrite the frozen check or saved observation');
});

test('shared hot-water photo policy records accessible apartment supply and retains unresolved/adverse evidence rules', () => {
  const check = { key: 'hot_water_2027_readiness', credentialGate: 'assigned_assessor', requiredEvidenceCount: 1 };
  const response = { hotWaterSupplyType: 'Shared building system', sharedHotWaterServiceStatus: 'Hot water supplied when checked' };
  const required = rentalAssessorEvidenceRequirement(check, 'meets', response);
  assert.equal(required.minimumPhotos, 1);
  assert.equal(required.minimumFiles, 1);
  assert.match(required.reason, /accessible apartment tap or shower/);
  assert.match(required.reason, /inaccessible building plant or its data plate is not required/);
  assert.equal(rentalAssessorCheckPresentation(check, { response }).photoGuidance, required.reason);
  assert.equal(rentalAssessorEvidenceRequirement({ ...check, requiredEvidenceCount: 3 }, 'meets', response).minimumFiles, 3, 'A recorded higher evidence-file contract is preserved');
  assert.equal(rentalAssessorEvidenceRequirement(check, 'not_accessible', { ...response, sharedHotWaterServiceStatus: 'Not checked' }).minimumPhotos, 0);
  assert.equal(rentalAssessorEvidenceRequirement(check, 'does_not_meet', { ...response, sharedHotWaterServiceStatus: 'No hot water when checked' }).minimumPhotos, 2);
  assert.equal(rentalAssessorEvidenceRequirement(check, 'specialist_verification_required', response).minimumPhotos, 0);
  assert.match(rentalAssessorEvidenceRequirement(check, 'meets', { hotWaterSupplyType: 'Individual unit' }).reason, /identifying the equipment/);
});

test('all current and future categories are assessed once for the dwelling', () => {
  const checks = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards.sections.flatMap(s => s.checks);
  assert.equal(checks.length, 31);
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

test('ceiling quoting guidance asks for the safe inside-face gap rather than joist centres', () => {
  const { help } = rentalAssessorCheckPresentation({ key: 'ceiling_2027_readiness' });
  assert.match(help, /inside faces of adjacent ceiling joists in whole millimetres, not centre to centre/);
  assert.match(help, /If the gap varies, record the other measurements and locations/);
  assert.match(help, /Only measure from a safe access point/);
  assert.match(help, /choose Not accessible or Unsafe to measure and give a brief reason/);
  assert.match(help, /Existing insulation need not be upgraded solely because it is below R5/);
});
