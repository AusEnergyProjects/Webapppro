import { createVeuElectricalForm } from '../../src/lib/veu-electrical-safety-form.ts';
import { activityHash, activitySigningScope } from '../../src/lib/trade-activity-forms.ts';
import { expandedActivityFields, fieldConditionMet } from '../../src/lib/trade-activity-form-flow.ts';

export function electricalFixture(overrides = {}) {
  const form = createVeuElectricalForm();
  const answers = {
    assessment_outcome: 'no_rectification', life_support: false, alternative_supply: false, recessed_luminaires: false,
    ceiling_appliances: false, ceiling_flues: false, other_hazards_present: false,
    non_tps_cables: false, split_metal_conduit: false, damaged_cables: false,
    tps_safe: 'yes', initial_electrician_name: 'Casey Electrician', owner_name: 'Sam Owner',
    ...overrides,
  };
  for (const field of expandedActivityFields(form, answers)) {
    if (!field.required || Object.hasOwn(answers, field.key) || ['photo', 'document'].includes(field.type)) continue;
    answers[field.key] = field.type === 'boolean' ? true : field.type === 'date' ? '2026-10-08'
      : field.type === 'number' ? 1 : field.type === 'select' ? field.options[0] : `Example ${field.label}`;
  }
  const record = { id: 'piesa-synthetic', recordNumber: 'PIESA-TEST-001', workOrderId: 'job-test', ownerUid: 'business-test', revision: 4,
    status: 'complete', form, formSha256: activityHash(form), answers, evidence: [], signatures: [], signerDefaults: { customer: 'Sam Owner', technician: 'Casey Electrician' },
    createdAt: '2026-10-08T01:00:00.000Z', updatedAt: '2026-10-08T02:00:00.000Z', completedAt: '2026-10-08T02:00:00.000Z' };
  record.initialAttestation = { actorUid: 'synthetic-electrician-actor', confirmedAt: '2026-10-08T01:30:00.000Z', scopeSha256: activitySigningScope(record, 'before') };
  return record;
}
export function signElectricalFixture(record) {
  record.initialAttestation = { actorUid: 'synthetic-electrician-actor', confirmedAt: '2026-10-08T01:30:00.000Z', scopeSha256: activitySigningScope(record, 'before') };
  record.signatures = record.form.declarations.filter((declaration) => fieldConditionMet(declaration.condition, record.answers, record.form)).map((declaration) => ({
    id: `signature-${declaration.key}`, declarationKey: declaration.key, signerName: declaration.key === 'property_owner' ? record.answers.owner_name : record.answers.rectification_electrician_name,
    role: declaration.role, phase: declaration.phase, declarationText: declaration.text, declarationSha256: activityHash(declaration.text),
    scopeSha256: activitySigningScope(record, declaration.phase), signedAt: '2026-10-08T01:59:00.000Z', actorUid: 'synthetic-actor',
    strokes: [{ points: [{ x: 0.05, y: 0.7 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.8 }, { x: 0.6, y: 0.4 }, { x: 0.9, y: 0.5 }] }],
  }));
  return record;
}
