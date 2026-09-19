import assert from 'node:assert/strict';
import test from 'node:test';
import { GOVERNMENT_ACTIVITY_TEMPLATES } from '../src/lib/australian-government-program-catalogue.ts';
import { ENERGY_SERVICE_CATALOGUE } from '../src/lib/energy-service-catalogue.mjs';
import { OTHER_TRAINING_SECTIONS, TRAINING_SERVICE_SECTIONS, trainingServiceSection } from '../src/lib/training-service-sections.mjs';

test('every Other activity has exactly one curated section and canonical services stay unchanged', () => {
  const other = GOVERNMENT_ACTIVITY_TEMPLATES.filter(activity => activity.serviceCategory === 'other');
  assert.equal(other.length, 41);
  const mapped = OTHER_TRAINING_SECTIONS.flatMap(section => section.activityIds);
  assert.equal(mapped.length, new Set(mapped).size);
  assert.deepEqual([...mapped].sort(), other.map(activity => activity.templateId).sort());
  for (const activity of other) {
    const section = trainingServiceSection({ id: activity.templateId, serviceCategory: activity.serviceCategory });
    assert.equal(section.serviceCategory, 'other');
    assert.notEqual(section.trainingSection, 'other-training');
  }
  for (const service of ENERGY_SERVICE_CATALOGUE.filter(service => service.id !== 'other')) {
    assert.deepEqual(trainingServiceSection({ serviceCategory: service.id }), { ...service, serviceCategory: service.id, trainingSection: '' });
  }
  assert.equal(new Set(TRAINING_SERVICE_SECTIONS.map(section => section.id)).size, TRAINING_SERVICE_SECTIONS.length);
});

test('section assignment uses immutable activity IDs rather than titles and safely handles custom forms', () => {
  assert.equal(trainingServiceSection({ id: 'veu-26', serviceCategory: 'other', trainingSection: 'commercial-refrigeration' }).label, 'Pool and spa pumps');
  assert.equal(trainingServiceSection({ id: 'custom-pump', serviceCategory: 'other', trainingSection: 'pool-pumps' }).label, 'Pool and spa pumps');
  assert.equal(trainingServiceSection({ id: 'custom-pump', serviceCategory: 'other' }).label, 'Other activity training');
  assert.equal(trainingServiceSection({ id: 'custom-pump', serviceCategory: 'other', trainingSection: 'invalid' }).label, 'Other activity training');
  assert.equal(trainingServiceSection({ id: 'custom-pump', serviceCategory: 'insulation', trainingSection: 'pool-pumps' }).label, 'Insulation');
});
