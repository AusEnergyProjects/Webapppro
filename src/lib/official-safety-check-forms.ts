import type { ActivityDeclaration, ActivityField, ActivityForm } from './trade-activity-form-types';
import type { SafetyCheckKind } from './job-safety-check';

const ELECTRICAL_SOURCE = {
  title: 'Energy Safe Victoria Electrical Safety Check Report, ESV-RTR-ESC 01.1 (April 2021)',
  url: 'https://www.energysafe.vic.gov.au/sites/default/files/2022-12/ElectricalSafetyChecklist_May2021.pdf',
  sha256: '5eb63d2e684c27951f844680fc242a8450cd5e733914b312121aa6141da73535',
};
const GAS_SOURCE = {
  title: 'Energy Safe Victoria Gas Safety Check (June 2022)',
  url: 'https://www.energysafe.vic.gov.au/sites/default/files/2022-12/Gas-safety-check-6062022.docx',
  sha256: '1ae1db90f05fa2a7d39f0ff439239ec606fab4188bb0ce6452e7a44d34c3793e',
};

export const OFFICIAL_SAFETY_SIGNER_FIELDS: Readonly<Record<SafetyCheckKind, Readonly<Record<string, string>>>> = {
  electrical: { electrical_inspector_declaration: 'inspector_name' },
  gas: { gasfitter_declaration: 'inspector_name' },
};

function field(key: string, label: string, section: string, type: ActivityField['type'] = 'text',
  details: Partial<Omit<ActivityField, 'key' | 'label' | 'section' | 'type' | 'phase'>> = {}): ActivityField {
  return { key, label, section, type, phase: 'after', required: true, options: [], help: '', ...details };
}
const selection = (key: string, label: string, section: string, options: string[], help = '',
  details: Partial<Omit<ActivityField, 'key' | 'label' | 'section' | 'type' | 'phase' | 'options' | 'help'>> = {}) =>
  field(key, label, section, 'select', { options, help, ...details });
const YES_NO = ['yes', 'no'];
const YES_NO_NA = ['yes', 'no', 'not_applicable'];
const PASS_FAIL = ['pass', 'fail'];
const STATUS_LABELS = { included: 'Included', verified: 'Visually inspected', tested: 'Tested',
  not_applicable: 'Not applicable', not_included: 'NI: not included in the safety check' };

type ElectricalItem = readonly [key: string, label: string, widgetName: string];
const ELECTRICAL_SCOPE: readonly ElectricalItem[] = [
  ['main_switchboard', 'Main switchboard', 'Check Box1'],
  ['main_earthing_system', 'Main earthing system', 'Check Box2'],
  ['kitchen', 'Kitchen', 'Check Box3'],
  ['bathroom_main', 'Bathroom (main)', 'Check Box4'],
  ['other_bathrooms_ensuites', 'Other bathrooms/ensuites', 'Check Box5'],
  ['bedroom_main', 'Bedroom (main)', 'Check Box6'],
  ['other_bedrooms', 'Other bedrooms', 'Check Box7'],
  ['living_room', 'Living room', 'Check Box8'],
  ['other_living_areas', 'Other living areas', 'Check Box9'],
  ['laundry', 'Laundry', 'Check Box10'],
  ['garage', 'Garage', 'Check Box11'],
  ['solar_battery_system', 'Solar/battery system', 'Check Box12'],
  ['electric_water_heater', 'Electric water heater', 'Check Box13'],
  ['dishwasher', 'Dishwasher', 'Check Box14'],
  ['electric_room_space_heaters', 'Electric room/space heaters', 'Check Box15'],
  ['swimming_pool_equipment', 'Swimming pool equipment', 'Check Box16'],
];
const ELECTRICAL_VISUAL: readonly ElectricalItem[] = [
  ['consumers_mains', 'Consumers mains', 'Check Box19'],
  ['switchboards', 'Switchboards', 'Check Box20'],
  ['exposed_earth_electrode', 'Exposed earth electrode', 'Check Box21'],
  ['metallic_water_pipe_bond', 'Metallic water pipe bond', 'Check Box22'],
  ['rcds', 'RCDs (Safety switches)', 'Check Box23'],
  ['circuit_protection', 'Circuit protection (circuit breakers / fuses)', 'Check Box24'],
  ['socket_outlets', 'Socket-outlets', 'Check Box25'],
  ['light_fittings', 'Light fittings', 'Check Box26'],
  ['electric_water_heater', 'Electric water heater', 'Check Box27'],
  ['air_conditioners', 'Air conditioners', 'Check Box28'],
  ['space_heaters', 'Space heaters', 'Check Box29'],
  ['cooking_equipment', 'Cooking equipment', 'Check Box30'],
  ['dishwasher', 'Dishwasher', 'Check Box31'],
  ['exhaust_fans', 'Exhaust fans', 'Check Box32'],
  ['ceiling_fans', 'Celling fans', 'Check Box33'],
  ['washing_machine_dryer', 'Washing machine/dryer', 'Check Box34'],
  ['installation_wiring', 'Installation wiring', 'Check Box35'],
  ['solar_renewable_systems', 'Solar and other renewable systems', 'Check Box36'],
  ['swimming_pool_equipment', 'Swimming pool equipment', 'Check Box37'],
  ['vehicle_chargers', 'Vehicle chargers', 'Check Box38'],
];
const ELECTRICAL_POLARITY: readonly ElectricalItem[] = [
  ['consumers_mains', 'Consumers mains', 'Check Box39'],
  ['circuit_protection', 'Circuit protection (circuit breakers / fuses)', 'Check Box40'],
  ['rcds', 'RCDs (Safety switches)', 'Check Box41'],
  ['socket_outlets', 'Socket-outlets', 'Check Box42'],
  ['circuit_protection_second_row', 'Circuit protection (circuit breakers / fuses)', 'Check Box43'],
  ['socket_outlets_second_row', 'Socket-outlets', 'Check Box44'],
  ['light_fittings', 'Light fittings', 'Check Box45'],
  ['electric_water_heater', 'Electric water heater', 'Check Box46'],
  ['air_conditioners', 'Air conditioners', 'Check Box47'],
  ['cooking_equipment', 'Cooking equipment', 'Check Box48'],
  ['dishwasher', 'Dishwasher', 'Check Box49'],
  ['solar_renewable_systems', 'Solar and other renewable systems', 'Check Box50'],
  ['swimming_pool_equipment', 'Swimming pool equipment', 'Check Box51'],
  ['vehicle_chargers', 'Vehicle chargers', 'Check Box52'],
];
const ELECTRICAL_EARTH: readonly ElectricalItem[] = [
  ['mains_earth_conductor', 'Mains earth conductor', 'Check Box53'],
  ['switchboards_enclosure', 'Switchboards enclosure', 'Check Box54'],
  ['metallic_water_pipe_bond', 'Metallic water pipe bond', 'Check Box55'],
  ['socket_outlets', 'Socket-outlets', 'Check Box56'],
  ['light_fittings', 'Light fittings', 'Check Box57'],
  ['exhaust_fans', 'Exhaust fans', 'Check Box58'],
  ['ceiling_fans', 'Celling fans', 'Check Box59'],
  ['electric_water_heater', 'Electric water heater', 'Check Box60'],
  ['air_conditioners', 'Air conditioners', 'Check Box61'],
  ['cooking_equipment', 'Cooking equipment', 'Check Box63'],
  ['dishwasher', 'Dishwasher', 'Check Box64'],
  ['solar_renewable_systems', 'Solar and other renewable systems', 'Check Box65'],
  ['swimming_pool_equipment', 'Swimming pool equipment', 'Check Box66'],
  ['vehicle_chargers', 'Vehicle chargers', 'Check Box67'],
];

function electricalFields(): ActivityField[] {
  const checkItems = (prefix: string, section: string, items: readonly ElectricalItem[], checked: string, help: string) =>
    items.map(([key, label]) => selection(`${prefix}.${key}`, label, section,
      [checked, 'not_applicable', 'not_included'], help, { optionLabels: STATUS_LABELS }));
  return [
    field('property_address', 'Address', 'A. Installation address'),
    field('previous_safety_check_date', 'Date of previous Safety Check (if any)', 'A. Installation address', 'date', { required: false }),
    ...checkItems('electrical.scope', 'B. Extent of the installation and limitations of the inspection and testing', ELECTRICAL_SCOPE, 'included',
      'Record whether this part of the installation is included, not applicable, or NI (not included). Record limitations below.'),
    field('electrical.scope.limitations', 'Details of those parts of the installation and limitations of the safety check covered by this certificate',
      'B. Extent of the installation and limitations of the inspection and testing', 'text', { required: false }),
    ...checkItems('electrical.visual', 'C. Safety check verified by visual inspection', ELECTRICAL_VISUAL, 'verified',
      'Record the actual visual inspection. The supplied April 2021 form refers to sections 3 and 4 of AS/NZS 3019:2007. Record your actual inspection standard in certification.'),
    ...checkItems('electrical.polarity', 'D. Polarity and correct connections testing', ELECTRICAL_POLARITY, 'tested',
      'Record the actual testing, not applicable, or NI (not included). Record any defect and test limitation in observations.'),
    ...checkItems('electrical.earth', 'D. Earth continuity testing', ELECTRICAL_EARTH, 'tested',
      'Record the actual testing, not applicable, or NI (not included). Record any defect and test limitation in observations.'),
    field('electrical.rcd.circuit_protected', 'Circuit protected', 'D. RCD testing', 'text', { repeatGroup: 'circuits' }),
    selection('electrical.rcd.push_button_test', 'Push button test (pass / fail)', 'D. RCD testing', PASS_FAIL,
      'Record the actual result for this circuit. No result is selected automatically.', { repeatGroup: 'circuits' }),
    selection('electrical.rcd.time_test', 'Time test (pass / fail)', 'D. RCD testing', PASS_FAIL,
      'Record the actual result for this circuit. Add the measured time and any limitations to observations.', { repeatGroup: 'circuits' }),
    field('electrical.rcd.identifying_photo', 'Circuit identification photo', 'D. RCD testing', 'photo', {
      repeatGroup: 'circuits', required: false, help: 'Optional TLink supporting evidence that identifies this circuit. This photo is a platform supplement, not a government form requirement.',
    }),
    selection('electrical.smoke_alarms', "All smoke alarms are correctly installed and in working condition; and have been tested according to the manufacturer's instructions", 'E. Smoke alarms', YES_NO),
    field('electrical.next_smoke_alarm_check_due', 'Next smoke alarms check is due by', 'E. Smoke alarms', 'date', {
      help: "All smoke alarms must be tested according to the manufacturer's instructions at least once every 12 months.",
    }),
    field('electrical.observations', 'The following observations and recommendations are made', 'F. Observations and recommendations for any actions to be taken', 'text', {
      help: 'Record actual observations, defects, limitations and recommended actions. If there are none, explicitly record that finding.',
    }),
    field('inspector_name', 'Electrical Safety check completed by', 'F. Electrical Safety Check Certification'),
    field('inspector_licence', 'Licence/registration number', 'F. Electrical Safety Check Certification'),
    field('inspection_date', 'Inspection date', 'F. Electrical Safety Check Certification', 'date'),
    field('next_safety_check_due', 'Next inspection due by', 'F. Electrical Safety Check Certification', 'date'),
    selection('electrical.inspection_standard', 'Standard used for this electrical safety check', 'F. Electrical Safety Check Certification', ['AS/NZS 3019:2022'],
      'TLink records the standard actually used by the inspecting electrician. The supplied government template is the April 2021 form and retains its original wording.'),
    field('electrical.switchboard_photo', 'Switchboard identification photo', 'TLink electrical supporting evidence', 'photo', {
      help: 'TLink requires an identifying photo of the inspected switchboard. This is a platform evidence requirement, not a photo mandate in the government template.',
    }),
    field('electrical.test_evidence_photo', 'Electrical testing evidence photo', 'TLink electrical supporting evidence', 'photo', {
      help: 'TLink requires a legible photo of the actual test instrument results or recorded test sheet for this check. This is a platform evidence requirement, not a photo mandate in the government template.',
    }),
  ];
}

function gasFields(): ActivityField[] {
  const appliance = { repeatGroup: 'appliances' };
  return [
    field('inspection_date', 'Date', 'Gas safety check details', 'date'),
    field('gas.vba_record_number', 'Servicing record number, if already issued', 'Gas safety check details', 'text', { required: false, help: 'The government template calls this the VBA record number. Enter the current BPC reference when available. Required regulator reporting remains the licensed issuer’s responsibility.' }),
    field('gas.issuer_name', 'Licensed/Registered person', 'Gas safety check details'),
    field('gas.issuer_licence', 'License/Registration no', 'Gas safety check details'),
    field('inspector_name', 'Check completed by', 'Gas safety check details'),
    field('inspector_licence', 'License/Registration no', 'Gas safety check details'),
    field('gas.client_name', 'Client name', 'Gas safety check details'),
    field('gas.contact_number', 'Contact no', 'Gas safety check details'),
    field('property_address', 'Street address', 'Gas safety check details'),
    field('gas.suburb', 'Suburb', 'Gas safety check details'),
    field('gas.postcode', 'Postcode', 'Gas safety check details'),
    selection('gas.lpg_components', 'LP Gas cylinders and associated components (i.e. Regulators, pigtails) installed correctly', 'Gas installation', YES_NO_NA),
    selection('gas.installation_leakage_test', 'Gas installation leakage test', 'Gas installation', PASS_FAIL),
    field('gas.installation_comments', 'Comments', 'Gas installation', 'text', { required: false }),
    field('gas.appliance.description', 'Appliance', 'Gas appliance', 'text', {
      ...appliance, help: 'Identify this appliance in the source appliance record. Include its type, make/model and location so its tests and photo can be matched.',
    }),
    selection('gas.appliance.isolation_valve', 'Appliance isolation valve', 'Gas appliance', YES_NO_NA, '', appliance),
    selection('gas.appliance.electrically_safe', 'Electrically safe', 'Gas appliance', YES_NO, '', appliance),
    selection('gas.appliance.adequate_ventilation', 'Adequate ventilation', 'Gas appliance', YES_NO, '', appliance),
    selection('gas.appliance.combustible_clearances', 'Adequate clearances to combustible surfaces', 'Gas appliance', YES_NO, '', appliance),
    selection('gas.appliance.as4575_service', 'Completed service in accordance with AS 4575', 'Gas appliance', YES_NO,
      'VBA online system report. Regulation 12(4) prescribes AS 4575 as the standard for Type A appliance servicing work on an appliance that is part of a standard gas installation.', appliance),
    field('gas.appliance.comments', 'Comments', 'Gas appliance', 'text', { ...appliance, required: false }),
    field('gas.appliance.identifying_photo', 'Appliance identification photo', 'Gas appliance', 'photo', {
      ...appliance, help: 'TLink requires a photo of each appliance that identifies the appliance and its location. This is a platform evidence requirement, not a photo mandate in the government template.',
    }),
    field('gas.fault.description', 'Details of identified faults', 'Identified faults and remedial action', 'text', { repeatGroup: 'faults', required: false }),
    field('gas.fault.remedial_action', 'Remedial action to be taken', 'Identified faults and remedial action', 'text', { repeatGroup: 'faults', required: false }),
    field('gas.additional_comments', 'Additional Comments', 'Identified faults and remedial action', 'text', { required: false }),
    selection('gas.all_appliances_serviced', 'I have serviced all appliances in accordance with AS 4575', 'Appliance servicing', YES_NO_NA),
    selection('gas.consumer_record_provided', 'I have created a record (VBA online) under regulation 36(2) or 37(2) of the Gas Safety (Gas Installation) Regulations 2018 and provided a copy to the rental provider under regulation 30(1)(ab) of the Residential Tenancies Regulations 2021', 'Appliance servicing', YES_NO_NA),
    field('gas.as4575_consumer_record', 'Full AS 4575 appliance servicing record provided to the rental provider', 'Appliance servicing', 'document', {
      help: 'Attach the full PDF consumer copy of the appliance servicing record for every appliance covered by this check. The gas safety checklist alone does not replace that record.',
    }),
    selection('gas.outcome', 'In my judgment, the appliance(s) and corresponding installation(s) is/are', 'Declaration', ['compliant', 'non_compliant', 'unsafe'], '', {
      optionLabels: {
        compliant: 'Compliant: gas appliance or gas installation complies with the criteria for a gas safety check in the residential tenancies regulations',
        non_compliant: 'Non-compliant: no immediate risk, however the customer should be advised that remedial work is required to bring the gas appliance or its installation up to standard',
        unsafe: 'Unsafe: gas appliance or its installation is unsafe and requires disconnection and urgent work as the safety of persons may be at risk or there may be damage to property',
      },
    }),
    field('next_safety_check_due', 'Next gas safety check due', 'Declaration', 'date', { help: 'Next gas safety check is due within 24 months.' }),
  ];
}

const ELECTRICAL_DECLARATION = 'I the above named licenced electrician have carried out an electrical safety check of this residential tenancies per the requirements of the Residential Tenancies Regulations 2021 and set out in the Australian/New Zealand Standard AS/NZS 3019, "Electrical installations - Periodic verification", and have recorded my observations and recommendations.';
const GAS_DECLARATION = 'I, being the person responsible for the inspection of the identified gas appliances or installations in the rental property or rooming house, particulars of which are described here, having exercised reasonable skill and care when carrying out the inspection, hereby declare on the date of inspection that the information in this report, including the observations and recommendations, provides an accurate assessment of the condition of the gas appliances or installations in the rental property or rooming house taking into account the stated extent of the installation and the limitations of the inspection and testing.\nI further declare that in my judgment, the said appliance(s) and corresponding installation(s) is/are:\nCompliant - gas appliance or gas installation complies with the criteria for a "gas safety check" in the residential tenancies regulations\nNon-compliant - no immediate risk, however the customer should be advised that remedial work is required to be carried out to bring the gas appliance or its installation up to standard.\nUnsafe - gas appliance or its installation is unsafe and requires disconnection and urgent work as the safety of persons may be at risk or there may be damage to property';

/** Page numbers are one based. Rectangles use PDF points from the bottom left.
 * A value identifies the selected answer that marks a source checkbox. Repeated
 * keys use the shared flow's base key followed by [1] through [19]. Additional
 * records beyond the source's printed rows belong in the report continuation.
 */
export type OfficialSafetyPdfField = {
  key: string; page: 1 | 2; widgetName?: string; rect?: [number, number, number, number]; value?: string; label: string;
};
const repeatedKey = (key: string, index: number) => index === 0 ? key : `${key}[${index}]`;
const electricalCheckMap = (prefix: string, items: readonly ElectricalItem[], value: string): OfficialSafetyPdfField[] =>
  items.map(([key, label, widgetName]) => ({ key: `${prefix}.${key}`, page: 1, widgetName, value, label }));
const ELECTRICAL_PRINTED_CIRCUIT_RECTS: [number, number, number, number][] = [
  [95, 762.24, 220.2, 773.88], [95, 749.52, 220.2, 761.16], [95, 736.8, 220.2, 748.44],
  [95, 724.08, 220.2, 735.72], [95, 711.36, 220.2, 723], [95, 698.76, 220.2, 710.28],
];
const ELECTRICAL_PDF_MAP: OfficialSafetyPdfField[] = [
  { key: 'property_address', page: 1, widgetName: 'Address', label: 'Address' },
  { key: 'previous_safety_check_date', page: 1, widgetName: 'Date17_af_date', label: 'Date of previous Safety Check' },
  ...electricalCheckMap('electrical.scope', ELECTRICAL_SCOPE, 'included'),
  ...electricalCheckMap('electrical.visual', ELECTRICAL_VISUAL, 'verified'),
  ...electricalCheckMap('electrical.polarity', ELECTRICAL_POLARITY, 'tested'),
  ...electricalCheckMap('electrical.earth', ELECTRICAL_EARTH, 'tested'),
  ...[
    'Time test pass  failPower outlets', 'Time test pass  failPower outlets_2', 'Time test pass  failPower outlets_3',
    'Time test pass  failLighting', 'Time test pass  failLighting_2', 'Time test pass  failOther',
    'Time test pass  failRow7', 'Time test pass  failRow8', 'Time test pass  failRow9', 'Time test pass  failRow10',
  ].flatMap((widgetName, index): OfficialSafetyPdfField[] => [
    { key: repeatedKey('electrical.rcd.circuit_protected', index), page: 2,
      ...(index < 6 ? { rect: ELECTRICAL_PRINTED_CIRCUIT_RECTS[index] } : { widgetName: `OtherRow${index - 5}` }),
      label: 'Circuit protected' },
    { key: repeatedKey('electrical.rcd.push_button_test', index), page: 2, widgetName: `Dropdown${21 + index}`, label: 'Push button test (pass / fail)' },
    { key: repeatedKey('electrical.rcd.time_test', index), page: 2, widgetName, label: 'Time test (pass / fail)' },
  ]),
  { key: 'electrical.smoke_alarms', page: 2, widgetName: 'Check Box YES', value: 'yes', label: 'Smoke alarms: Yes' },
  { key: 'electrical.smoke_alarms', page: 2, widgetName: 'Check Box No', value: 'no', label: 'Smoke alarms: No' },
  { key: 'electrical.next_smoke_alarm_check_due', page: 2, widgetName: 'Date63_af_date', label: 'Next smoke alarms check due' },
  { key: 'electrical.observations', page: 2, widgetName: 'The following observations and recommendations are made', label: 'Observations and recommendations' },
  { key: 'inspector_name', page: 2, widgetName: 'Electrical Safety check completed by', label: 'Electrical Safety check completed by' },
  { key: 'inspector_licence', page: 2, widgetName: 'Licence registration number', label: 'Licence/registration number' },
  { key: 'inspection_date', page: 2, widgetName: 'Date64_af_date', label: 'Inspection date' },
  { key: 'next_safety_check_due', page: 2, widgetName: 'Date65_af_date', label: 'Next inspection due by' },
  { key: 'electrical_inspector_declaration', page: 2, widgetName: 'Sign', label: 'Sign' },
  { key: '$signedAt.electrical_inspector_declaration', page: 2, widgetName: 'Date66_af_date', label: 'Signature date' },
];

function gasChecks(key: string, label: string, options: string[], rectangles: [number, number, number, number][], page: 1 | 2 = 1): OfficialSafetyPdfField[] {
  return rectangles.map((rect, index) => ({ key, label, page, rect, value: options[index] }));
}
// Checkbox rectangles are the individual empty-square glyph bounds in the
// prepared June 2022 DOCX's PDF, rather than the surrounding Yes/No label bounds.
const GAS_APPLIANCE_RECTS: {
  description: [number, number, number, number]; comments: [number, number, number, number];
  isolation: [number, number, number, number][]; electrical: [number, number, number, number][];
  ventilation: [number, number, number, number][]; clearances: [number, number, number, number][];
  service: [number, number, number, number][];
}[] = [
  { description: [186, 540.89, 555, 552.89], comments: [38, 435.89, 555, 478.89],
    isolation: [[145.1, 513.539, 151.988, 521.539], [164.35, 513.539, 171.238, 521.539], [186.75, 513.539, 193.638, 521.539]],
    electrical: [[291.85, 513.539, 298.738, 521.539], [317.8, 513.539, 324.688, 521.539]],
    ventilation: [[127.75, 502.889, 134.638, 510.889], [149.25, 502.889, 156.138, 510.889]],
    clearances: [[393.5, 502.889, 400.388, 510.889], [415, 502.889, 421.888, 510.889]],
    service: [[225.1, 489.939, 231.988, 497.939], [244.35, 489.939, 251.238, 497.939]] },
  { description: [190, 422.89, 555, 434.89], comments: [38, 315.29, 555, 358.29],
    isolation: [[143.05, 392.839, 149.938, 400.839], [162.3, 392.839, 169.188, 400.839], [184.7, 392.839, 191.588, 400.839]],
    electrical: [[289.8, 392.839, 296.688, 400.839], [315.75, 392.839, 322.638, 400.839]],
    ventilation: [[127.95, 382.189, 134.838, 390.189], [149.45, 382.189, 156.338, 390.189]],
    clearances: [[393.7, 382.189, 400.588, 390.189], [415.2, 382.189, 422.088, 390.189]],
    service: [[225.3, 369.239, 232.188, 377.239], [244.55, 369.239, 251.438, 377.239]] },
  { description: [190, 302.29, 555, 314.29], comments: [38, 194.69, 555, 237.69],
    isolation: [[143.05, 272.239, 149.938, 280.239], [162.3, 272.239, 169.188, 280.239], [184.7, 272.239, 191.588, 280.239]],
    electrical: [[289.8, 272.239, 296.688, 280.239], [315.75, 272.239, 322.638, 280.239]],
    ventilation: [[127.95, 261.589, 134.838, 269.589], [149.45, 261.589, 156.338, 269.589]],
    clearances: [[393.7, 261.589, 400.588, 269.589], [415.2, 261.589, 422.088, 269.589]],
    service: [[225.3, 248.639, 232.188, 256.639], [244.55, 248.639, 251.438, 256.639]] },
  { description: [190, 181.69, 555, 193.69], comments: [38, 58.89, 555, 117.09],
    isolation: [[143.05, 151.639, 149.938, 159.639], [162.3, 151.639, 169.188, 159.639], [184.7, 151.639, 191.588, 159.639]],
    electrical: [[289.8, 151.639, 296.688, 159.639], [315.75, 151.639, 322.638, 159.639]],
    ventilation: [[127.95, 140.989, 134.838, 148.989], [149.45, 140.989, 156.338, 148.989]],
    clearances: [[393.7, 140.989, 400.588, 148.989], [415.2, 140.989, 422.088, 148.989]],
    service: [[225.3, 128.039, 232.188, 136.039], [244.55, 128.039, 251.438, 136.039]] },
];
const GAS_PDF_MAP: OfficialSafetyPdfField[] = [
  { key: 'inspection_date', page: 1, rect: [186, 771.89, 298, 783.89], label: 'Date' },
  { key: 'gas.vba_record_number', page: 1, rect: [381, 773.89, 555, 785.89], label: 'VBA record number' },
  { key: 'gas.issuer_name', page: 1, rect: [186, 758.39, 376, 770.39], label: 'Licensed/Registered person' },
  { key: 'gas.issuer_licence', page: 1, rect: [472, 758.39, 555, 770.39], label: 'License/Registration no' },
  { key: 'inspector_name', page: 1, rect: [186, 743.29, 376, 755.29], label: 'Check completed by' },
  { key: 'inspector_licence', page: 1, rect: [472, 743.29, 555, 755.29], label: 'License/Registration no' },
  { key: 'gas.client_name', page: 1, rect: [186, 728.19, 376, 740.19], label: 'Client name' },
  { key: 'gas.contact_number', page: 1, rect: [474, 728.19, 555, 740.19], label: 'Contact no' },
  { key: 'property_address', page: 1, rect: [186, 714.49, 555, 726.49], label: 'Street address' },
  { key: 'gas.suburb', page: 1, rect: [186, 700.79, 376, 712.79], label: 'Suburb' },
  { key: 'gas.postcode', page: 1, rect: [474, 700.79, 555, 712.79], label: 'Postcode' },
  ...gasChecks('gas.lpg_components', 'LP Gas cylinders and associated components installed correctly', YES_NO_NA,
    [[370.05, 673.319, 378.05, 681.319], [392.65, 673.319, 400.65, 681.319], [418.35, 673.319, 426.35, 681.319]]),
  ...gasChecks('gas.installation_leakage_test', 'Gas installation leakage test', PASS_FAIL,
    [[159.3, 651.069, 167.3, 659.069], [184.55, 651.069, 192.55, 659.069]]),
  { key: 'gas.installation_comments', page: 1, rect: [38, 589.89, 555, 630.89], label: 'Comments' },
  ...GAS_APPLIANCE_RECTS.flatMap((rects, index): OfficialSafetyPdfField[] => [
    { key: repeatedKey('gas.appliance.description', index), page: 1, rect: rects.description, label: `Appliance ${index + 1}` },
    ...gasChecks(repeatedKey('gas.appliance.isolation_valve', index), 'Appliance isolation valve', YES_NO_NA, rects.isolation),
    ...gasChecks(repeatedKey('gas.appliance.electrically_safe', index), 'Electrically safe', YES_NO, rects.electrical),
    ...gasChecks(repeatedKey('gas.appliance.adequate_ventilation', index), 'Adequate ventilation', YES_NO, rects.ventilation),
    ...gasChecks(repeatedKey('gas.appliance.combustible_clearances', index), 'Adequate clearances to combustible surfaces', YES_NO, rects.clearances),
    ...gasChecks(repeatedKey('gas.appliance.as4575_service', index), 'Completed service in accordance with AS 4575', YES_NO, rects.service),
    { key: repeatedKey('gas.appliance.comments', index), page: 1, rect: rects.comments, label: 'Comments' },
  ]),
  ...[792.49, 780.29, 768.09, 755.89].flatMap((bottom, index): OfficialSafetyPdfField[] => [
    { key: repeatedKey('gas.fault.description', index), page: 2, rect: [46, bottom, 149, bottom + 11], label: 'Details of identified faults' },
    { key: repeatedKey('gas.fault.remedial_action', index), page: 2, rect: [151, bottom, 555, bottom + 11], label: 'Remedial action to be taken' },
  ]),
  { key: 'gas.additional_comments', page: 2, rect: [38, 644.89, 555, 745.89], label: 'Additional Comments' },
  ...gasChecks('gas.all_appliances_serviced', 'I have serviced all appliances in accordance with AS 4575', YES_NO_NA,
    [[474.1, 595.839, 480.988, 603.839], [506.6, 596.319, 514.6, 604.319], [539.75, 596.319, 547.75, 604.319]], 2),
  ...gasChecks('gas.consumer_record_provided', 'I have created a record and provided a copy to the rental provider', YES_NO_NA,
    [[474.1, 580.689, 480.988, 588.689], [507.2, 580.689, 514.088, 588.689], [540.3, 580.689, 547.188, 588.689]], 2),
  ...gasChecks('gas.outcome', 'Declaration outcome', ['compliant', 'non_compliant', 'unsafe'],
    [[42.6, 304.889, 49.488, 312.889], [42.6, 292.239, 49.488, 300.239], [42.6, 270.389, 49.488, 278.389]], 2),
  { key: 'gasfitter_declaration', page: 2, rect: [42.6, 230.89, 512, 247.89], label: 'Signed by gasfitter' },
  { key: 'next_safety_check_due', page: 2, rect: [328, 219.29, 555, 231.29], label: 'Next gas safety check due' },
];
export const OFFICIAL_SAFETY_PDF_MAP: Readonly<Record<SafetyCheckKind, readonly OfficialSafetyPdfField[]>> = {
  electrical: ELECTRICAL_PDF_MAP, gas: GAS_PDF_MAP,
};

export function createOfficialSafetyCheckForm(kind: SafetyCheckKind): ActivityForm {
  const electrical = kind === 'electrical';
  const source = electrical ? ELECTRICAL_SOURCE : GAS_SOURCE;
  const declaration: ActivityDeclaration = {
    key: electrical ? 'electrical_inspector_declaration' : 'gasfitter_declaration',
    title: electrical ? 'Electrical Safety Check Certification: inspector signature' : 'Signed by gasfitter',
    text: electrical ? ELECTRICAL_DECLARATION : GAS_DECLARATION,
    role: 'technician', phase: 'after', required: true, sourceUrl: source.url, sourceTextSha256: source.sha256,
  };
  return {
    id: `official-vic-${kind}-safety-check`, title: electrical ? 'Electrical Safety Check Report' : 'Gas Safety Check',
    version: 1, activityTemplateId: `official-vic-${kind}-safety-check`, programCode: 'VIC_RENTAL_SAFETY',
    variantId: kind, variantOptions: [{ id: kind, label: electrical ? 'Electrical safety check' : 'Gas safety check' }],
    fields: electrical ? electricalFields() : gasFields(), declarations: [declaration], sources: [{ ...source }],
    reviewNotes: electrical ? [
      'Uses the blank ESV-RTR-ESC 01.1 April 2021 government report. Source visual/testing instructions retain their AS/NZS 3019:2007 reference; the actual AS/NZS 3019:2022 standard used is recorded separately.',
      'Each circuit is a separate record in the existing repeat flow, with a maximum of 20. Identifying switchboard and testing evidence photos are required by TLink; individual circuit photos are optional supporting evidence.',
      'No visual, testing, smoke alarm or RCD result is defaulted. Only the actual inspecting electrician signs the source certification.',
    ] : [
      'Uses the current June 2022 government DOCX, not the older three-page print checklist. The issuer and person who completed the check have separate name and licence fields.',
      'Each appliance is a separate record in the existing repeat flow, with a maximum of 20. The identifying photo per appliance is a TLink platform requirement.',
      'Attach the full AS 4575 appliance servicing consumer record PDF. This safety checklist does not replace the servicing record or its source requirement to provide a copy to the rental provider.',
      'Dangerous gas installations: the source directs the gasfitter to make the installation safe and notify the owner and occupier without delay; if unable or unreasonable, notify Energy Safe Victoria and the relevant distributor or LPG retailer without delay.',
      'No installation, appliance servicing or compliance result is defaulted. Only the actual gasfitter who completed the inspection signs the source declaration.',
    ],
  };
}
