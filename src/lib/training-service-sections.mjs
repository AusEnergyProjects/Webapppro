import { ENERGY_SERVICE_CATALOGUE } from './energy-service-catalogue.mjs';

// Display sections only. Persisted service capabilities and eligibility still use
// the canonical service category. Activity IDs, never editable titles, set a section.
/** @type {readonly { id: string, label: string, activityIds: readonly string[] }[]} */
export const OTHER_TRAINING_SECTIONS = Object.freeze([
  { id: 'refrigerators-freezers', label: 'Fridges and freezers', activityIds: ['veu-22', 'nsw-ess-c1', 'nsw-ess-c2', 'act-eeis-5-1', 'act-eeis-5-2', 'sa-reps-app1a', 'sa-reps-app1b', 'sa-reps-app2'] },
  { id: 'commercial-refrigeration', label: 'Commercial refrigeration', activityIds: ['veu-32', 'nsw-ess-f1-1', 'nsw-ess-f1-2', 'nsw-pdrs-rf2', 'act-eeis-5-7', 'sa-reps-rdc1'] },
  { id: 'efficient-appliances', label: 'Energy-efficient appliances', activityIds: ['veu-24', 'veu-25', 'act-eeis-5-3', 'act-eeis-5-4', 'sa-reps-app1d', 'tas-nils-es-appliance'] },
  { id: 'pool-pumps', label: 'Pool and spa pumps', activityIds: ['veu-26', 'nsw-ess-d5', 'nsw-pdrs-sys2', 'act-eeis-5-6', 'sa-reps-app3'] },
  { id: 'commercial-boilers-steam', label: 'Commercial boilers and steam systems', activityIds: ['veu-37', 'veu-38', 'veu-41', 'veu-42', 'nsw-ess-f8', 'nsw-ess-f11', 'nsw-ess-f12', 'nsw-ess-f14', 'nsw-ess-f15'] },
  { id: 'roof-ventilation', label: 'Roof ventilation', activityIds: ['nsw-ess-d13'] },
  { id: 'renewable-generation', label: 'Renewable power generation', activityIds: ['lret-power-station', 'rego-generation'] },
  { id: 'industrial-emissions-equipment', label: 'Industrial emissions and equipment', activityIds: ['accu-icer', 'accu-ieu'] },
  { id: 'household-upgrade-support', label: 'Household upgrade support', activityIds: ['act-shs-home-upgrade', 'act-hes-electrification'] },
  { id: 'other-training', label: 'Other activity training', activityIds: [] },
].map(section => Object.freeze({ ...section, activityIds: Object.freeze(section.activityIds) })));

/** @typedef {{ id: string, label: string, serviceCategory: string, trainingSection: string }} TrainingServiceSection */
/** @type {readonly TrainingServiceSection[]} */
export const TRAINING_SERVICE_SECTIONS = Object.freeze(ENERGY_SERVICE_CATALOGUE.flatMap(service => service.id === 'other'
  ? OTHER_TRAINING_SECTIONS.map(section => Object.freeze({ id: `other:${section.id}`, label: section.label, serviceCategory: 'other', trainingSection: section.id }))
  : [Object.freeze({ id: service.id, label: service.label, serviceCategory: service.id, trainingSection: '' })]));

/**
 * @param {{ id?: string, serviceCategory?: string, trainingSection?: string, activityTemplateIds?: readonly string[] }} module
 * @returns {TrainingServiceSection}
 */
export function trainingServiceSection(module) {
  if (module.serviceCategory && module.serviceCategory !== 'other') {
    const service = TRAINING_SERVICE_SECTIONS.find(section => section.id === module.serviceCategory);
    if (service) return service;
  }
  const activityIds = module.activityTemplateIds?.length ? module.activityTemplateIds : [module.id];
  const sectionId = OTHER_TRAINING_SECTIONS.find(section => section.activityIds.some(id => activityIds.includes(id)))?.id
    || OTHER_TRAINING_SECTIONS.find(section => section.id === module.trainingSection)?.id
    || 'other-training';
  return TRAINING_SERVICE_SECTIONS.find(section => section.id === `other:${sectionId}`) || TRAINING_SERVICE_SECTIONS[TRAINING_SERVICE_SECTIONS.length - 1];
}
