import assert from 'node:assert/strict';
import test from 'node:test';
import { rentalAssessorSections, rentalShowerChoicePatch, rentalShowerChoiceValue, rentalShowerAssessmentProjection } from '../src/lib/rental-assessor-workflow.mjs';
import { rentalAssessmentCompletion, rentalAssessmentTemplateSnapshot } from '../src/lib/trade-rental-assessment.mjs';
import { rentalObservationFields } from '../src/lib/rental-quotation.mjs';

const fullTemplate = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards;
const moduleTemplate = { ...fullTemplate, metadataFields: [], sections: fullTemplate.sections.map((section) => ({ ...section,
  checks: section.checks.filter((check) => ['showerhead_rating', 'shower_2027_readiness'].includes(check.key)),
})).filter((section) => section.checks.length) };
const main = (rating, extra = {}) => ({ id: 'main', itemKey: 'minimum_standards:bathroom:showerhead_rating:property',
  moduleId: 'module', sectionKey: 'bathroom', checkKey: 'showerhead_rating', instanceKey: 'property', locationLabel: 'Property',
  ...rentalShowerChoicePatch('showerhead_rating', rating, { flowLitresPerMinute: '7.5' }), ...extra,
});

test('the full dwelling assessment asks one shower question without editing frozen standards', () => {
  const original = structuredClone(moduleTemplate);
  assert.deepEqual(rentalAssessorSections(moduleTemplate).flatMap((section) => section.checks.map((check) => check.key)), ['showerhead_rating']);
  assert.deepEqual(moduleTemplate, original);
  const futureOnly = { ...moduleTemplate, sections: moduleTemplate.sections.filter((section) => section.key === 'showers') };
  assert.equal(rentalAssessorSections(futureOnly)[0].checks[0].key, 'shower_2027_readiness');
  assert.ok(!rentalObservationFields('showerhead_rating').some((field) => field.key === 'serialNumber'));
});

test('one 3-star observation and one label photo completes current and future shower checks', () => {
  const item = main('3 stars');
  const projection = rentalShowerAssessmentProjection({ moduleTemplate, items: [item] });
  assert.equal(item.outcome, 'meets', '3 stars does not become a current non-compliance');
  const future = projection.items.find((entry) => entry.checkKey === 'shower_2027_readiness');
  assert.equal(future.outcome, 'does_not_meet');
  assert.equal(future.evidenceSourceItemId, 'main');
  assert.equal(future.response.flowLitresPerMinute, '7.5');
  assert.equal(projection.findings.length, 1);
  assert.match(projection.findings[0].description, /7.5 L\/min/);
  assert.equal(projection.findings[0].severity, 'recommended');
  assert.equal(rentalAssessmentCompletion({ moduleTemplate, items: [item], evidenceCounts: { main: 1 }, photoCounts: { main: 1 } }).complete, true);
  const noPhoto = rentalAssessmentCompletion({ moduleTemplate, items: [item], evidenceCounts: { main: 0 }, photoCounts: { main: 0 } });
  assert.equal(noPhoto.complete, false, 'Shared evidence is still mandatory');
  assert.ok(noPhoto.blockers.every((blocker) => /evidence:|photo:/.test(blocker.key)));
});

test('4 stars passes both thresholds while a flow measurement cannot establish either rating', () => {
  const rated = main('4 stars or above');
  const projection = rentalShowerAssessmentProjection({ moduleTemplate, items: [rated] });
  assert.ok(projection.items.every((entry) => entry.outcome === 'meets'));
  assert.equal(projection.findings.length, 0);
  const unknown = main('Not labelled / unknown');
  const unverified = rentalShowerAssessmentProjection({ moduleTemplate, items: [unknown] });
  assert.ok(unverified.items.every((entry) => entry.outcome === 'specialist_verification_required'));
  const legacy = main('3 stars', { response: { flowLitresPerMinute: '3' } });
  const legacyProjection = rentalShowerAssessmentProjection({ moduleTemplate, items: [legacy] });
  assert.equal(legacyProjection.items.length, 1, 'Old flow-only data is not a WELS rating');
  assert.ok(rentalAssessmentCompletion({ moduleTemplate, items: [legacy], evidenceCounts: { main: 1 }, photoCounts: { main: 1 } }).blockers.some((blocker) => blocker.key === 'check:showers:shower_2027_readiness'));
});

test('recording no shower needs no absence photo and applies to both shower thresholds', () => {
  const item = main('not_applicable');
  assert.equal(rentalShowerChoiceValue(item), 'not_applicable');
  assert.match(item.publicNotes, /No shower/);
  assert.equal(rentalAssessmentCompletion({ moduleTemplate, items: [item] }).complete, true);
  const reset = rentalShowerChoicePatch('showerhead_rating', '3 stars', item.response, item.publicNotes);
  assert.equal(reset.publicNotes, '');
});

test('derived readiness is repeatable and never changes saved historical observations or specialist uncertainty', () => {
  const item = main('3 stars');
  const historical = { ...main('4 stars or above'), id: 'older-room-shower', instanceKey: 'shower-1' };
  const original = structuredClone([item, historical]);
  const once = rentalShowerAssessmentProjection({ moduleTemplate, items: [item, historical] });
  assert.deepEqual([item, historical], original);
  const twice = rentalShowerAssessmentProjection({ moduleTemplate, ...once });
  assert.deepEqual(twice, once);
  const notConfirmed = main('3 stars', { outcome: 'specialist_verification_required' });
  assert.equal(rentalShowerAssessmentProjection({ moduleTemplate, items: [notConfirmed] }).items.at(-1).outcome, 'specialist_verification_required');
});
