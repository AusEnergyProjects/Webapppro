import type { ActivityCondition, ActivityDeclaration, ActivityField, ActivityForm } from './trade-activity-form-types';
import { activityHash, activityMissing, activitySigningScope } from './trade-activity-forms.ts';
import type { PiesaMissing, PiesaRecord } from './veu-electrical-assessment';

export const VEU_ELECTRICAL_FORM_ID = 'veu-pre-installation-electrical-safety-assessment';
export const VEU_ELECTRICAL_SOURCE_URL = 'https://www.energy.vic.gov.au/__data/assets/pdf_file/0037/783379/VEU-Pre-installation-electrical-safety-assessment.pdf';
export const VEU_ELECTRICAL_SOURCE_PATH = '/forms/veu-pre-installation-electrical-safety-assessment-march-2026.pdf';
export const VEU_ELECTRICAL_SOURCE_SHA256 = '225c361b24cde11116b942c7afc2bb40a11a6ec32ba17e4c11b1c6b1f5c9cfc8';
export const VEU_ELECTRICAL_SIGNER_FIELDS = { rectification_electrician: 'rectification_electrician_name', property_owner: 'owner_name' } as const;
export const VEU_ELECTRICAL_CORRECT_DECLARATION = 'I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission';
export const VEU_ELECTRICAL_INITIAL_DECLARATION = 'I, the below named licensed electrician, have carried out a pre-installation electrical safety assessment of this residential property per the requirements of the Victorian Energy Efficiency Target Regulations 2018 and/or the Residential Tenancies Amendment (Minimum Energy Efficiency Standards) Regulations 2025 and set out in the Australian/New Zealand Standard AS/NZS 3019, Electrical installations—Periodic assessment, and have recorded my observations, condition and required rectifications.';
const eq = (fieldKey: string, equals: string | boolean): ActivityCondition => ({ fieldKey, equals });
const rectification = eq('assessment_outcome', 'rectification_required');
const alternative = eq('alternative_supply', true);
const luminaires = eq('recessed_luminaires', true);
const appliances = { any: [eq('ceiling_appliances', true), eq('ceiling_flues', true)] };
const rectificationConfirmations = [
  ['rectification_complete', 'I confirm all identified rectification works have been completed in accordance with the requirements detailed in the Observations, Conditions and Required Rectifications section of this pre-installation electrical safety check assessment.'],
  ['rectification_luminaires', 'I confirm that all luminaires present in the ceiling area are IC and/or IC-4 rated (i.e. classified and marked).'],
  ['rectification_rcd', 'I confirm that all mains connected cables in the ceiling space are appropriately protected by an RCD where required, as per the most current version of AS/NZS 3000.'],
  ['rectification_tps', 'I confirm that all mains connected cables in the ceiling space are thermoplastic insulated and sheathed (TPS) or an equivalent cable type as per the most current version of AS/NZS 3000.'],
  ['rectification_protection', 'I confirm that all mains connected cables in the ceiling space meet Basic Protection requirements, as per the most current version of AS/NZS 3000.'],
  ['rectification_hazards', 'I confirm that an electrical safety assessment has been completed and the ceiling space is either: free from electrical hazards; or the remaining electrical hazards and required controls have been documented and provided to the insulation installer to implement; so that the installation of insulation can proceed safely.'],
] as const;
const ownerConfirmations = [
  ['owner_access', 'I acknowledge that access to the ceiling space between now and the installation of insulation may void this assessment.'],
  ['owner_assessment', 'I confirm that the electrical safety assessment works were completed on the above date.'],
  ['owner_rectification', 'I confirm that any electrical rectification works were completed on the above date.'],
  ['owner_information', 'I understand that information contained within this form will be provided to the person undertaking the installation work and may be provided upon request to Essential Services Commission (ESC) for the purposes of monitoring compliance with the Victorian Energy Efficiency Target Act 2007.'],
] as const;

/** Official March 2026 assessment. Standalone job safety record, not a credit claim. */
export function createVeuElectricalForm(): ActivityForm {
  const fields: ActivityField[] = [];
  const add = (key: string, section: string, label: string, type: ActivityField['type'] = 'boolean', extra: Partial<ActivityField> = {}) => fields.push({ key, section, label, type, required: true, options: [], help: '', phase: 'before', sourceRequirementId: key, ...extra });
  const p1 = 'A · Part 1 · Property details';
  add('job_reference', p1, 'Job Reference ID', 'text', { autofill: 'job.reference' });
  add('property_address', p1, 'Address including postcode', 'text', { autofill: 'job.address' });
  add('inspection_date', p1, 'Date of inspection', 'date');
  add('life_support', p1, 'Is anyone at this property dependent on life support?');
  add('life_support_consent', p1, 'Written consent received before this assessment commenced', 'boolean', { condition: eq('life_support', true), required: false });
  add('life_support_plan', p1, 'Medical plan received before this assessment commenced', 'boolean', { condition: eq('life_support', true), required: false });
  add('life_support_record', p1, 'Attach the written consent or medical plan', 'document', { condition: eq('life_support', true), help: 'The official form requires this written record as an attachment. Installation cannot proceed without consent or a medical plan.' });
  const p2 = 'A · Part 2 · Mains power';
  for (const [key, label] of [
    ['mains_identified', 'Has the presence of any consumer mains cable in the ceiling space been identified and marked?'],
    ['main_switch_accessible', 'Is the main switch accessible and operational?'],
    ['main_switch_isolates', 'Is the main switch able to isolate all cables running through the ceiling space safely (excluding the mains cables)?'],
    ['main_switch_secured', 'Is the main switch able to be secured in the off position?'],
    ['mains_deenergised', 'Has testing been carried out to ensure all cables and equipment within the ceiling area are de-energised when the main switch is isolated?'],
    ['rcd_present', 'Are Residual Current Devices (RCDs) (safety switches) present for circuits within the ceiling insulation area, as per the most current version of AS/NZS 3000?'],
    ['rcd_tested', 'Have all RCDs been tested for operation?'],
  ]) add(key, p2, label, 'boolean', { help: 'Inform the occupant before isolating power. Any No requires rectification, or the Part 2 onsite-electrician isolation, lock-out and tag-out alternative.' });
  const p3 = 'A · Part 3 · Solar, battery or alternative supply';
  add('alternative_supply', p3, 'Is there a Solar PV, Battery system and/or alternative supply, such as a fuel driven generator present?');
  for (const [key, label] of [
    ['alternative_instructions', 'Are instructions provided on the safe shutdown/isolation, and re-energisation of the solar, battery or alternative supply system?'],
    ['alternative_isolator', 'Is the ground level system AC and/or DC (may be part of the inverter) isolator accessible, operational and can be isolated safely?'],
    ['alternative_conduit', 'Are all system cables in the ceiling space in conduit and clearly labelled?'],
    ['alternative_protected', 'Are the system cables within the ceiling space protected and/or supported in accessible areas to prevent damage?'],
  ]) add(key, p3, label, 'boolean', { condition: alternative, help: 'Any No requires rectification, or an electrician at the start of installation to isolate, lock out, tag and confirm the area is safe.' });
  const p4 = 'A · Part 4 · Electrical hazard identification';
  for (const [key, label] of [
    ['clear_conductive_conduit', 'Is the premises clear of any electrically conductive conduit?'],
    ['cables_supported', 'Are the electrical cables present in the ceiling space supported or run in a way to reduce the risk of damage or strain during insulation installation work?'],
    ['cables_thermal_treatment', 'Do electrical cables that are or will be completely or partially surrounded by thermal insulation meet the treatment requirements of AS 3999:2015 section 2.6 or AS/NZS 3000:2018 clause 3.3.2.13?'],
  ]) add(key, p4, label);
  add('tps_safe', p4, 'Have thermoplastic insulated and sheathed (TPS) cables present in the ceiling space been visually inspected and deemed safe (free from deterioration or damage)?', 'select', { options: ['yes', 'no', 'not_applicable'], optionLabels: { yes: 'Yes', no: 'No', not_applicable: 'N/A' } });
  for (const [key, label] of [
    ['terminations_protected', 'Do all electrical terminations and connections within the ceiling space meet basic protection requirements (enclosed securely in junction boxes or enclosures, no exposed conductors or connectors, IP2X maintained including exposed wiring joints or terminations)?'],
    ['plug_bases_fixed', 'Are all plug bases within the ceiling space securely fixed (lighting or fan plug bases cannot move and cause stress on cables and connections)?'],
    ['conductive_insulation_safe', 'If electrically conductive insulation (e.g. foil backed) is present in the ceiling space, has it been confirmed that it is not live?'],
  ]) add(key, p4, label, 'boolean', { help: 'Any No in Part 4 requires rectification before ceiling insulation work can commence.' });
  const p5 = 'A · Part 5 · Cable types';
  add('non_tps_cables', p5, 'Are there any mains connected cables which are not TPS in the ceiling?', 'boolean', { help: 'All non-TPS mains cables must be replaced with TPS or equivalent meeting the most current AS/NZS 3000 Wiring rules.' });
  add('split_metal_conduit', p5, 'Is there split metal conduit wiring present in the ceiling space?');
  add('damaged_cables', p5, 'Are there damaged or deteriorated cables present in the ceiling space?');
  const p6 = 'A · Part 6 · Prohibited luminaires';
  add('recessed_luminaires', p6, 'Are there recessed luminaires present in the ceiling?', 'boolean', { help: 'Only IC or IC-4 light fittings are permitted in the ceiling area being upgraded. The source exception applies to ceilings with another room or sole occupancy unit above where insulation is not being installed.' });
  add('luminaire_count', p6, 'Total number of luminaires', 'number', { condition: luminaires });
  add('prohibited_luminaires', p6, 'Are there prohibited luminaires that are not IC and/or IC-4 rated (classified and marked) installed at the premises?', 'boolean', { condition: luminaires, help: 'Yes requires rectification before ceiling insulation work commences.' });
  const p7 = 'A · Part 7 · Potential hazards';
  add('ceiling_appliances', p7, 'Are there any electrical appliances in the ceiling space (e.g. water heaters, air conditioning units, radiant heating panels, heat lamps or similar)?');
  add('ceiling_flues', p7, 'Are there any exhaust fans or heating flues that vent into or through the ceiling space?');
  for (const [key, label] of [['appliance', 'Appliance'], ['appliance_location', 'Location'], ['appliance_hazard', 'Hazard']]) add(key, p7, label, 'text', { condition: appliances, repeatGroup: 'appliances' });
  add('hazard_actions', p7, 'If a hazard was identified, what actions were undertaken, or should be undertaken by the insulation installer, to eliminate or minimize associated risks?', 'text', { condition: appliances });
  add('hazard_actions_effective', p7, 'Does this action effectively reduce the risk associated with the identified hazards?', 'boolean', { condition: appliances });
  add('other_hazards_present', p7, 'Are there other electrical or other hazards identified in the ceiling space?', 'boolean', { help: 'Routing question for the official other hazards table. Record any hazard and the action taken or required before insulation.' });
  for (const [key, label] of [['other_hazard', 'Other electrical or other hazard (e.g. rotten joist)'], ['other_hazard_action', 'Action taken, or to be taken, to mitigate the hazard before insulation (e.g. joist replaced)']]) add(key, p7, label, 'text', { condition: eq('other_hazards_present', true), repeatGroup: 'other_hazards' });
  add('assessment_outcome', 'B1 · Assessment outcome', 'Assessment outcome (select one)', 'select', { options: ['no_rectification', 'rectification_required', 'onsite_isolation'], optionLabels: {
    no_rectification: 'Electrical rectification work is not required before insulation is installed or upgraded.',
    rectification_required: 'Electrical rectification work is required before insulation is installed or upgraded.',
    onsite_isolation: 'Electrical rectification work is not possible before installation under Parts 2 and 3. An electrician must attend at the start to isolate, lock out, tag and confirm the work area is safe.',
  }, help: 'The onsite electrician alternative applies only to Parts 2 and 3. Parts 4, 5 and prohibited luminaires still require rectification.' });
  const b2 = 'B2 · Observations, conditions and required rectifications';
  for (const [key, label] of [
    ['work_luminaires', 'Prohibited luminaires need replacing with IC and/or IC4 rated LED lights.'],
    ['work_circuit_rating', 'Circuit protection rating needs upgrading for thermal insulation effects on wiring (derated).'],
    ['work_rcd', 'RCDs need installing for circuits within the ceiling insulation area, per the most current AS/NZS 3000.'],
    ['work_tps', 'Ceiling or switchboard cables need replacing with TPS or equivalent cable, per the most current AS/NZS 3000.'],
    ['work_basic_protection', 'Ceiling cables and wiring need altering or repairing to meet Basic Protection requirements, per the most current AS/NZS 3000.'],
    ['work_other', 'Other rectification work (describe below).'],
  ]) add(key, b2, label, 'boolean', { required: false });
  add('rectification_notes', b2, 'Other required rectification work, observations or conditions', 'text', { required: false, help: 'Describe all required work, including actions not covered by the selected checkboxes. Serious electrical hazards must be notified to Energy Safe Victoria as described in the official form.' });
  const b3 = 'B3 · Electrician declaration - initial assessment';
  for (const [key, label] of [['initial_electrician_licence', 'Licensed electrician licence number'], ['initial_electrician_name', 'Licensed electrician full name'], ['initial_rec_name', 'Registered Electrical Contractor name'], ['initial_rec_number', 'REC registration number'], ['initial_rec_phone', 'REC telephone number']]) add(key, b3, label, 'text');
  add('initial_correct', b3, VEU_ELECTRICAL_CORRECT_DECLARATION, 'boolean', { requiredValue: true, help: VEU_ELECTRICAL_INITIAL_DECLARATION });
  const c = 'C · Completed assessment and rectification';
  for (const [key, label] of [['rectification_electrician_licence', 'Rectifying electrician licence number'], ['rectification_electrician_name', 'Rectifying electrician full name'], ['rectification_rec_name', 'Rectifying Registered Electrical Contractor name'], ['rectification_rec_number', 'Rectifying REC registration number'], ['rectification_rec_phone', 'Rectifying REC telephone number']]) add(key, c, label, 'text', { condition: rectification, phase: 'after' });
  for (const [key, label] of rectificationConfirmations) add(key, c, label, 'boolean', { condition: rectification, phase: 'after', requiredValue: true });
  add('rectification_correct', c, VEU_ELECTRICAL_CORRECT_DECLARATION, 'boolean', { condition: rectification, phase: 'after', requiredValue: true });
  add('rectification_date', c, 'Date of completion', 'date', { condition: rectification, phase: 'after' });
  add('electrical_works_performed', c, 'Were any electrical works completed?', 'boolean', { condition: rectification, phase: 'after', help: 'Controls the official Certificate of Electrical Safety requirement. Never enter a certificate for work that has not occurred.' });
  const certificate = { all: [rectification, eq('electrical_works_performed', true)] };
  add('coes_number', c, 'Certificate of Electrical Safety number (required for any electrical works completed)', 'text', { condition: certificate, phase: 'after' });
  add('certification_date', c, 'Date of Certification', 'date', { condition: certificate, phase: 'after' });
  const o = 'Property owner / representative declaration';
  add('owner_name', o, 'Property owner or representative name', 'text', { phase: 'after', autofill: 'customer.name' });
  for (const [key, label] of ownerConfirmations) add(key, o, label, 'boolean', { phase: 'after', requiredValue: true });
  add('owner_date', o, 'Owner declaration date', 'date', { phase: 'after' });
  const declaration = (key: string, title: string, text: string, role: ActivityDeclaration['role'], condition?: ActivityCondition): ActivityDeclaration => ({ key, title, text, role, phase: 'after', required: true, ...(condition ? { condition } : {}), sourceUrl: VEU_ELECTRICAL_SOURCE_URL, sourceTextSha256: activityHash(text) });
  return { id: VEU_ELECTRICAL_FORM_ID, activityTemplateId: VEU_ELECTRICAL_FORM_ID, version: 1, title: 'VEU pre-installation electrical safety assessment (Insulation)', programCode: 'VEU', variantId: 'march-2026', variantOptions: [], fields,
    declarations: [declaration('rectification_electrician', 'Rectifying electrician signature', [...rectificationConfirmations.map(([, label]) => label), VEU_ELECTRICAL_CORRECT_DECLARATION].join('\n\n'), 'other', rectification), declaration('property_owner', 'Property owner / representative signature', 'I am the property owner or owner’s representative and:\n\n' + ownerConfirmations.map(([, label]) => label).join('\n\n'), 'customer')],
    sources: [{ title: 'Official VEU pre-installation electrical safety assessment, March 2026', url: VEU_ELECTRICAL_SOURCE_URL, sha256: VEU_ELECTRICAL_SOURCE_SHA256 }],
    reviewNotes: ['Standalone job safety assessment; does not create a certificate claim or compliance intent.', 'A licensed electrician engaged by a Registered Electrical Contractor must complete this assessment. Provide the completed form to the insulation installer and property owner/representative at least 24 hours before installation.', 'Section C is completed only after all required Section B electrical work. An onsite-isolation assessment remains conditional and is not an unconditional installation clearance.', 'The original B3 declaration is an attested checkbox, not an additional drawn signature. Actual Section C and owner signatures are retained with their saved scope.'] };
}

const part23 = ['mains_identified', 'main_switch_accessible', 'main_switch_isolates', 'main_switch_secured', 'mains_deenergised', 'rcd_present', 'rcd_tested'];
const part3 = ['alternative_instructions', 'alternative_isolator', 'alternative_conduit', 'alternative_protected'];
const part4 = ['clear_conductive_conduit', 'cables_supported', 'cables_thermal_treatment', 'terminations_protected', 'plug_bases_fixed', 'conductive_insulation_safe'];
export function veuElectricalCompletion(record: Pick<PiesaRecord, 'id' | 'form' | 'formSha256' | 'answers' | 'evidence' | 'signatures' | 'initialAttestation'>) {
  const missing: PiesaMissing[] = activityMissing(record);
  const a = record.answers;
  const outcome = a.assessment_outcome === 'no_rectification' || a.assessment_outcome === 'rectification_required' || a.assessment_outcome === 'onsite_isolation' ? a.assessment_outcome : '';
  const issue = (key: string, label: string) => missing.push({ key, label, kind: 'policy' });
  if (a.initial_correct === true && (!record.initialAttestation?.actorUid.trim() || !Number.isFinite(Date.parse(record.initialAttestation.confirmedAt))
    || record.initialAttestation.scopeSha256 !== activitySigningScope(record, 'before'))) issue('initial_correct', 'Confirm the initial electrician declaration against the current assessment answers and attachments.');
  if (a.life_support === true && a.life_support_consent !== true && a.life_support_plan !== true) issue('life_support_consent', 'Written consent or medical plan is required before assessment; installation cannot proceed.');
  const isolationDefect = part23.some((key) => a[key] === false) || (a.alternative_supply === true && part3.some((key) => a[key] === false));
  const mandatoryDefect = part4.some((key) => a[key] === false) || a.tps_safe === 'no' || ['non_tps_cables', 'split_metal_conduit', 'damaged_cables'].some((key) => a[key] === true) || (a.recessed_luminaires === true && a.prohibited_luminaires === true);
  const workSelected = ['work_luminaires', 'work_circuit_rating', 'work_rcd', 'work_tps', 'work_basic_protection', 'work_other'].some((key) => a[key] === true);
  if (outcome === 'no_rectification' && (isolationDefect || mandatoryDefect || workSelected)) issue('assessment_outcome', 'The no-rectification outcome conflicts with identified defects or required work.');
  if (outcome === 'onsite_isolation' && mandatoryDefect) issue('assessment_outcome', 'The Parts 2/3 onsite-electrician alternative cannot bypass Part 4, Part 5 or prohibited-luminaire rectification.');
  if (outcome === 'onsite_isolation' && !isolationDefect) issue('assessment_outcome', 'The onsite-electrician alternative requires an identified Part 2 or Part 3 isolation issue.');
  if (outcome === 'rectification_required' && !workSelected && !String(a.rectification_notes || '').trim()) issue('rectification_notes', 'Record the required rectification work in B2.');
  if (outcome === 'rectification_required' && ['work_luminaires', 'work_circuit_rating', 'work_rcd', 'work_tps', 'work_basic_protection'].some((key) => a[key] === true) && a.electrical_works_performed !== true) issue('electrical_works_performed', 'The selected electrical rectification work requires its Certificate of Electrical Safety details.');
  if (a.work_other === true && !String(a.rectification_notes || '').trim()) issue('rectification_notes', 'Describe the other required rectification work.');
  if (a.recessed_luminaires === true && (!Number.isInteger(a.luminaire_count) || Number(a.luminaire_count) < 1)) issue('luminaire_count', 'Enter a positive whole number of luminaires.');
  if (a.hazard_actions_effective === false) issue('hazard_actions_effective', 'Resolve or document effective controls for the identified hazards before final completion.');
  for (const [declarationKey, fieldKey] of Object.entries(VEU_ELECTRICAL_SIGNER_FIELDS)) {
    const signature = record.signatures.find((item) => item.declarationKey === declarationKey);
    if (signature && signature.signerName.trim().toLocaleLowerCase() !== String(a[fieldKey] || '').trim().toLocaleLowerCase()) issue(declarationKey, 'The actual signer must match the named person for this declaration.');
  }
  return { ready: missing.length === 0, missing, outcome };
}
