import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createVeuElectricalForm, veuElectricalCompletion, VEU_ELECTRICAL_SOURCE_SHA256, VEU_ELECTRICAL_SIGNER_FIELDS } from '../src/lib/veu-electrical-safety-form.ts';
import { activityHash, normaliseActivityAnswers } from '../src/lib/trade-activity-forms.ts';
import { expandedActivityFields, activityWizardSteps } from '../src/lib/trade-activity-form-flow.ts';
import { electricalFixture, signElectricalFixture } from './helpers/veu-electrical-fixture.mjs';

test('official March 2026 asset is pinned and all A/B/C/owner question groups remain distinct', () => {
  assert.equal(activityHash(fs.readFileSync(new URL('../public/forms/veu-pre-installation-electrical-safety-assessment-march-2026.pdf', import.meta.url))), VEU_ELECTRICAL_SOURCE_SHA256);
  const form = createVeuElectricalForm();
  for (let part = 1; part <= 7; part++) assert.ok(form.fields.some((field) => field.section.startsWith(`A · Part ${part} ·`)));
  for (const section of ['B1 ·', 'B2 ·', 'B3 ·', 'C ·', 'Property owner']) assert.ok(form.fields.some((field) => field.section.startsWith(section)));
  assert.equal(new Set(form.fields.map((field) => field.key)).size, form.fields.length);
  assert.deepEqual(form.declarations.map((item) => item.key), ['rectification_electrician', 'property_owner']);
  assert.equal(form.fields.find((field) => field.key === 'initial_correct').requiredValue, true);
  assert.equal(form.declarations.some((item) => item.phase === 'before'), false, 'no invented initial signature');
});
test('no-defect record requires real owner signature and exact original checkbox attestations', () => {
  const record = electricalFixture();
  assert.deepEqual(veuElectricalCompletion(record).missing.map((item) => item.key), ['property_owner']);
  signElectricalFixture(record); assert.equal(veuElectricalCompletion(record).ready, true);
  assert.equal(activityWizardSteps(record.form, record.answers).some((step) => step.key === 'rectification_electrician'), false);
  record.answers.initial_correct = false;
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.key === 'initial_correct'));
});
test('Part 2/3 onsite isolation stays conditional and cannot bypass mandatory Part 4/5/6 defects', () => {
  const record = signElectricalFixture(electricalFixture({ main_switch_secured: false, assessment_outcome: 'onsite_isolation' }));
  assert.equal(veuElectricalCompletion(record).ready, true);
  assert.equal(veuElectricalCompletion(record).outcome, 'onsite_isolation');
  for (const patch of [{ clear_conductive_conduit: false }, { non_tps_cables: true }, { recessed_luminaires: true, luminaire_count: 2, prohibited_luminaires: true }]) {
    const invalid = signElectricalFixture(electricalFixture({ main_switch_secured: false, assessment_outcome: 'onsite_isolation', ...patch }));
    assert.ok(veuElectricalCompletion(invalid).missing.some((item) => item.kind === 'policy' && item.key === 'assessment_outcome'));
  }
});
test('rectification needs full C, named rectifier signature and electrical-works CoES', () => {
  const record = electricalFixture({ assessment_outcome: 'rectification_required', work_rcd: true, rcd_present: false, electrical_works_performed: true });
  signElectricalFixture(record); assert.equal(veuElectricalCompletion(record).ready, true);
  assert.equal(record.signatures.length, 2);
  delete record.answers.coes_number;
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.key === 'coes_number'));
  record.answers.electrical_works_performed = false;
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.key === 'electrical_works_performed' && item.kind === 'policy'));
});
test('life-support consent and retained attachment are mandatory and never defaulted', () => {
  const record = electricalFixture({ life_support: true });
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.key === 'life_support_consent'));
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.key === 'life_support_record' && item.kind === 'evidence'));
  record.answers.life_support_plan = true;
  assert.equal(veuElectricalCompletion(record).missing.some((item) => item.key === 'life_support_consent'), false);
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.key === 'life_support_record'));
});
test('conditional retained values never reopen hidden branches; genuine false is preserved', () => {
  const record = electricalFixture({ alternative_supply: false, alternative_instructions: false, recessed_luminaires: false, prohibited_luminaires: true });
  record.answers = normaliseActivityAnswers(record.form, record.answers);
  assert.equal(record.answers.alternative_instructions, false);
  assert.equal(expandedActivityFields(record.form, record.answers).some((field) => field.key === 'alternative_instructions'), false);
  signElectricalFixture(record); assert.equal(veuElectricalCompletion(record).ready, true);
});
test('repeat hazard rows are canonical and every visible row requires all answers', () => {
  const record = electricalFixture({ ceiling_appliances: true, '$repeat.appliances': 12, other_hazards_present: true, '$repeat.other_hazards': 17 });
  assert.equal(expandedActivityFields(record.form, record.answers).filter((field) => field.repeatGroup === 'appliances').length, 36);
  assert.equal(expandedActivityFields(record.form, record.answers).filter((field) => field.repeatGroup === 'other_hazards').length, 34);
  record.answers = normaliseActivityAnswers(record.form, record.answers);
  delete record.answers['appliance_location[11]'];
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.key === 'appliance_location[11]'));
});
test('changes invalidate signature scope and signer names must match their own saved identity', () => {
  const record = signElectricalFixture(electricalFixture({ assessment_outcome: 'rectification_required', work_other: true, rectification_notes: 'Repair documented defect', electrical_works_performed: false }));
  assert.equal(veuElectricalCompletion(record).ready, true);
  record.signatures[0].signerName = 'A different person';
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.kind === 'policy' && item.key === 'rectification_electrician'));
  assert.deepEqual(Object.keys(VEU_ELECTRICAL_SIGNER_FIELDS), ['rectification_electrician', 'property_owner']);
  record.answers.property_address = 'Changed site';
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.kind === 'signature'));
});
test('initial declaration requires genuine actor/time/current-snapshot attestation without adding a signature', () => {
  const record = signElectricalFixture(electricalFixture());
  delete record.initialAttestation;
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.key === 'initial_correct' && item.kind === 'policy'));
  signElectricalFixture(record); record.initialAttestation.scopeSha256 = '0'.repeat(64);
  assert.ok(veuElectricalCompletion(record).missing.some((item) => item.key === 'initial_correct' && item.kind === 'policy'));
  signElectricalFixture(record); record.initialAttestation.actorUid = '';
  assert.equal(veuElectricalCompletion(record).ready, false);
  signElectricalFixture(record); assert.equal(veuElectricalCompletion(record).ready, true);
  assert.deepEqual(record.signatures.map((item) => item.declarationKey), ['property_owner']);
});
test('no-rectification cannot contradict observed defects, ineffective controls or fractional luminaire counts', () => {
  for (const patch of [{ main_switch_isolates: false }, { work_rcd: true }, { ceiling_appliances: true, hazard_actions_effective: false }, { recessed_luminaires: true, luminaire_count: 1.5, prohibited_luminaires: false }]) {
    assert.equal(veuElectricalCompletion(signElectricalFixture(electricalFixture(patch))).ready, false);
  }
});
