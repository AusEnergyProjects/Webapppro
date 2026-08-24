export const RENTAL_INSPECTION_SERVICE_CATEGORY = "rental-inspection";

export const RENTAL_ASSESSMENT_TEMPLATE_KEY = "vic-rental-minimum-standards";
export const RENTAL_ASSESSMENT_TEMPLATE_VERSION = 1;
export const RENTAL_ASSESSMENT_TEMPLATE_EFFECTIVE_FROM = "2026-06-30";
export const RENTAL_REPORT_LINK_DAYS = 60;

export function rentalInspectionServiceAddressAccepted(serviceCategory, addressState) {
  return String(serviceCategory || "") !== RENTAL_INSPECTION_SERVICE_CATEGORY
    || String(addressState || "").trim().toUpperCase() === "VIC";
}

export const RENTAL_ASSESSMENT_OUTCOMES = Object.freeze([
  "meets",
  "does_not_meet",
  "specialist_verification_required",
  "not_accessible",
  "not_applicable",
  "exemption_evidence_pending",
]);

export const RENTAL_ASSESSMENT_FINDING_SEVERITIES = Object.freeze([
  "immediate_safety_risk",
  "urgent",
  "required",
  "recommended",
  "information",
]);

export const RENTAL_ASSESSMENT_FINDING_STATUSES = Object.freeze([
  "recommendation",
  "faulty",
  "non_compliant",
  "safety_issue",
  "disconnected",
  "not_tested",
]);

export const RENTAL_ASSESSMENT_MODULES = Object.freeze([
  Object.freeze({
    key: "minimum_standards",
    label: "Rental minimum standards assessment",
    shortLabel: "Minimum standards",
    optional: false,
    credentialGate: "qualified_assessor",
    reportBoundary: "This is the default assessment. It does not by itself certify the separate electrical, gas or smoke alarm safety checks.",
  }),
  Object.freeze({
    key: "electrical_safety_check",
    label: "Electrical safety check",
    shortLabel: "Electrical safety",
    optional: true,
    credentialGate: "licensed_electrician",
    reportBoundary: "This module can be issued only by an appropriately licensed electrician using the current statutory test and authentication requirements.",
  }),
  Object.freeze({
    key: "gas_safety_check",
    label: "Gas safety check",
    shortLabel: "Gas safety",
    optional: true,
    credentialGate: "licensed_gasfitter",
    reportBoundary: "This module can be issued only by an appropriately licensed or supervised gasfitter using the current gas servicing record requirements.",
  }),
  Object.freeze({
    key: "smoke_alarm_check",
    label: "Smoke alarm service and check",
    shortLabel: "Smoke alarms",
    optional: true,
    credentialGate: "suitably_qualified_smoke_alarm_worker",
    reportBoundary: "This separate optional smoke alarm assessment workflow is not part of the default minimum standards assessment.",
  }),
]);

export const RENTAL_ASSESSMENT_MODULE_KEYS = Object.freeze(
  RENTAL_ASSESSMENT_MODULES.map((module) => module.key),
);

export const RENTAL_ASSESSMENT_OPTIONAL_MODULE_KEYS = Object.freeze(
  RENTAL_ASSESSMENT_MODULES.filter((module) => module.optional).map((module) => module.key),
);

const currentSources = Object.freeze([
  Object.freeze({
    title: "Residential Tenancies Regulations 2021",
    version: "009",
    effectiveFrom: "2026-06-30",
    url: "https://www.legislation.vic.gov.au/in-force/statutory-rules/residential-tenancies-regulations-2021/009",
  }),
  Object.freeze({
    title: "Consumer Affairs Victoria rental minimum standards checklist",
    version: "retrieved-2026-08-24",
    effectiveFrom: "2026-06-30",
    url: "https://www.consumer.vic.gov.au/housing/renting/repairs-alterations-safety-and-pets/minimum-standards/checklist-rental-properties-minimum-standards",
  }),
]);

function check(key, prompt, options = {}) {
  return Object.freeze({
    key,
    prompt,
    required: options.required !== false,
    requiredEvidenceCount: Number.isInteger(options.requiredEvidenceCount) ? options.requiredEvidenceCount : 1,
    responseType: options.responseType || "outcome",
    repeatBy: options.repeatBy || "property",
    photoGuidance: options.photoGuidance || "Take one clear overview and one close photo of anything that affects the answer.",
    help: options.help || "Record only what you observed or tested. Use Specialist verification required when the answer needs a licensed or suitably qualified person.",
    credentialGate: options.credentialGate || "qualified_assessor",
  });
}

function field(key, label, type, options = {}) {
  return Object.freeze({
    key,
    label,
    type,
    required: options.required === true,
    help: options.help || "",
    placeholder: options.placeholder || "",
    options: Object.freeze(options.options || []),
  });
}

const minimumStandardsMetadata = Object.freeze([
  field("inspectionDate", "Assessment date", "date", { required: true }),
  field("agreementStartDate", "Rental agreement start date, if known", "date", {
    help: "This helps identify which effective-dated rule applies. Leave blank when it has not been confirmed.",
  }),
  field("periodicConversionDate", "Date the agreement became periodic, if relevant", "date"),
  field("dwellingClass", "Property type", "select", {
    required: true,
    options: [
      { value: "house", label: "House" },
      { value: "unit_apartment", label: "Unit or apartment" },
      { value: "townhouse", label: "Townhouse" },
      { value: "other", label: "Other residential property" },
    ],
  }),
  field("occupancyAtAssessment", "Occupancy during the assessment", "select", {
    required: true,
    options: [
      { value: "vacant", label: "Vacant" },
      { value: "occupied_renter_present", label: "Occupied, renter present" },
      { value: "occupied_renter_absent", label: "Occupied, renter absent" },
    ],
  }),
  field("areasNotAccessed", "Areas not accessed", "textarea", {
    help: "List every locked, unsafe, concealed or otherwise inaccessible area. Enter None when the whole property was accessible.",
  }),
  field("weatherConditions", "Weather or site conditions that affected observations", "text"),
  field("qualificationType", "Assessor qualification or authority", "text", { required: true }),
  field("qualificationNumber", "Qualification, registration or licence number", "text", { required: true }),
  field("credentialConfirmed", "I confirm my qualification details are current and accurate", "checkbox", { required: true }),
  field("coverageConfirmed", "I have added every relevant room, door, window, fixture and area to the repeatable checks", "checkbox", { required: true }),
  field("assessorDeclaration", "I confirm this assessment is complete and accurate to the best of my knowledge", "checkbox", { required: true }),
]);

const minimumStandardsSections = Object.freeze([
  Object.freeze({
    key: "bathroom",
    title: "Bathroom",
    summary: "Check the washbasin, bath or shower, hot and cold water and the showerhead efficiency requirement.",
    checks: Object.freeze([
      check("bathroom_facilities", "The bathroom has a washbasin and a shower or bath.", { photoGuidance: "Photograph the whole bathroom from the doorway, then the basin and shower or bath." }),
      check("bathroom_water", "Hot and cold water are available at the required bathroom fixtures.", { photoGuidance: "Photograph the taps and capture the water running. Do not photograph occupants." }),
      check("showerhead_rating", "The showerhead meets the current water efficiency requirement or a supported installation exception applies.", { photoGuidance: "Photograph the complete showerhead, its make and model, and the WELS label or supporting product evidence." }),
    ]),
  }),
  Object.freeze({
    key: "electrical_safety",
    title: "Electrical safety minimum standard",
    summary: "Record the switchboard and obtain licensed verification of circuit breaker and residual current device protection where required.",
    checks: Object.freeze([
      check("switchboard_observation", "The switchboard and circuit schedule have been recorded.", { photoGuidance: "Take a straight, readable photo of the complete switchboard exterior, then the open board and circuit schedule only when safe and authorised." }),
      check("outlet_lighting_protection", "Power outlet and lighting circuits have the required circuit breaker and residual current device protection.", { credentialGate: "licensed_electrician", photoGuidance: "A photo alone cannot prove this result. Record the electrician verification and supporting switchboard evidence." }),
    ]),
  }),
  Object.freeze({
    key: "heating",
    title: "Heating",
    summary: "Check the fixed heater in the main living area, operation and applicable efficiency requirement.",
    checks: Object.freeze([
      check("main_living_heater", "A qualifying fixed heater is installed in the main living area.", { photoGuidance: "Photograph the main living area showing the heater location, then photograph the heater front and data plate." }),
      check("heater_operation", "The main living area heater operates as intended.", { photoGuidance: "Photograph the operating display or control and record the heating mode used for the function test." }),
      check("heater_efficiency", "The heater satisfies the efficiency rule that applies to this property and agreement.", { photoGuidance: "Photograph the energy rating, make, model and serial. Record the property class and agreement trigger used." }),
    ]),
  }),
  Object.freeze({
    key: "kitchen",
    title: "Kitchen",
    summary: "Check the food preparation area, sink, water supply, cooktop and oven where provided.",
    checks: Object.freeze([
      check("kitchen_preparation", "The kitchen has a dedicated food preparation and cooking area.", { photoGuidance: "Take a wide photo that shows the preparation surface, sink and cooking appliances together." }),
      check("kitchen_sink_water", "The kitchen sink has hot and cold water.", { photoGuidance: "Photograph the sink and taps, then capture hot and cold water running." }),
      check("cooktop_function", "The cooktop has the required functioning burners.", { photoGuidance: "Photograph the cooktop and each burner operating. Keep flammable objects clear." }),
      check("oven_function", "The oven functions when an oven is provided.", { photoGuidance: "Photograph the oven, controls and operating indicator. Select Not applicable only when no oven is provided." }),
    ]),
  }),
  Object.freeze({
    key: "laundry",
    title: "Laundry",
    summary: "Check the laundry water connections where a laundry is provided.",
    checks: Object.freeze([
      check("laundry_connections", "The laundry has the required hot and cold water connections when a laundry is provided.", { photoGuidance: "Photograph the laundry area and both labelled tap connections. Show them operating when safe." }),
    ]),
  }),
  Object.freeze({
    key: "lighting",
    title: "Lighting",
    summary: "Check artificial light throughout the property and daylight access in habitable rooms.",
    checks: Object.freeze([
      check("artificial_lighting", "Artificial lighting works in this room, corridor or hallway.", { repeatBy: "room_or_passage", photoGuidance: "Take one photo with the light off and one with it on, from a position that identifies the space." }),
      check("habitable_daylight", "This habitable room receives natural light.", { repeatBy: "habitable_room", photoGuidance: "Photograph the room toward the window during daylight, showing the window and surrounding wall." }),
    ]),
  }),
  Object.freeze({
    key: "locks",
    title: "Locks",
    summary: "Check each external entry door and record any supported exception.",
    checks: Object.freeze([
      check("external_door_lock", "This external entry door has a functioning deadlock or other required locking device.", { repeatBy: "external_entry_door", photoGuidance: "Photograph both sides of the full door, then the lock and strike plate. Record the door location and demonstrate operation." }),
    ]),
  }),
  Object.freeze({
    key: "mould_damp",
    title: "Mould and damp",
    summary: "Inspect every accessible area for mould and damp caused by or related to the building structure.",
    checks: Object.freeze([
      check("mould_damp_observation", "No mould or damp condition that may relate to the building structure was observed in this area.", { repeatBy: "room_or_area", photoGuidance: "Take a wide photo locating the area and close photos showing the extent. Include a moisture reading only when one was taken correctly." }),
    ]),
  }),
  Object.freeze({
    key: "structural_soundness",
    title: "Structural soundness and weatherproofing",
    summary: "Record visible structural and weatherproofing conditions without asserting specialist causation.",
    checks: Object.freeze([
      check("structure_weatherproofing", "No visible condition requiring structural or weatherproofing follow-up was observed in this area.", { repeatBy: "building_area", photoGuidance: "Photograph all accessible elevations and each concern in context and close up. Include floors, walls, ceilings, roof indicators, cracks and water entry." }),
    ]),
  }),
  Object.freeze({
    key: "toilets",
    title: "Toilets",
    summary: "Check each toilet, flush operation, waste connection and room configuration.",
    checks: Object.freeze([
      check("toilet_function", "This toilet is present, functioning and connected to an appropriate waste system.", { repeatBy: "toilet", photoGuidance: "Photograph the whole toilet room, pan and cistern, visible waste connection and the flush operating." }),
    ]),
  }),
  Object.freeze({
    key: "ventilation",
    title: "Ventilation",
    summary: "Check natural or mechanical ventilation in habitable rooms and wet areas.",
    checks: Object.freeze([
      check("room_ventilation", "This room has the required natural or mechanical ventilation.", { repeatBy: "room", photoGuidance: "Photograph openable windows, permanent vents and exhaust fans. Show the window open or the fan operating." }),
    ]),
  }),
  Object.freeze({
    key: "vermin_proof_bins",
    title: "Vermin proof bins",
    summary: "Check the rubbish and recycling bins supplied for the property.",
    checks: Object.freeze([
      check("bins", "The property has vermin proof rubbish and recycling bins compatible with the council collection service.", { photoGuidance: "Photograph both complete bins with lids closed, then any damage that prevents the lid sealing." }),
    ]),
  }),
  Object.freeze({
    key: "windows",
    title: "Windows",
    summary: "Check every openable external window and its latch or security device.",
    checks: Object.freeze([
      check("window_operation_security", "This external window opens, closes and has a functioning latch or security device.", { repeatBy: "openable_external_window", photoGuidance: "Photograph the whole window closed and open, then the latch or security device. Record its room and position." }),
    ]),
  }),
  Object.freeze({
    key: "window_coverings",
    title: "Window coverings",
    summary: "Check privacy and reasonable light blocking in rooms where coverings are required.",
    checks: Object.freeze([
      check("window_covering", "This bedroom or living area window has a covering that provides privacy and reasonably blocks light.", { repeatBy: "bedroom_or_living_window", photoGuidance: "Photograph the complete window with the covering open and closed." }),
    ]),
  }),
  Object.freeze({
    key: "window_covering_cords",
    title: "Window covering cords",
    summary: "Check every corded internal window covering for the required anchor or safety device and loop controls.",
    checks: Object.freeze([
      check("cord_anchor", "This corded window covering has the required secure cord anchor or safety device and controlled loop.", { repeatBy: "corded_window_covering", photoGuidance: "Photograph the whole covering, the cord path, anchor or cleat, installation height and the measured loop. Record any retention test performed." }),
    ]),
  }),
]);

const electricalSafetyMetadata = Object.freeze([
  field("inspectionDate", "Electrical safety check date", "date", { required: true }),
  field("previousCheckDate", "Previous electrical safety check date, if known", "date"),
  field("electricianName", "Licensed electrician name", "text", { required: true, help: "Must match the assigned assessor's TLink profile." }),
  field("licenceNumber", "Electrical licence number", "text", { required: true }),
  field("recName", "Registered electrical contractor or employer", "text"),
  field("recNumber", "REC number", "text"),
  field("standardEdition", "Inspection standard", "select", {
    required: true,
    options: [{ value: "AS/NZS 3019:2022", label: "AS/NZS 3019:2022" }],
  }),
  field("areasExcluded", "Areas or equipment excluded from the check", "textarea", {
    help: "Identify every excluded or inaccessible area. Enter None when the complete installation was checked.",
  }),
  field("credentialConfirmed", "I confirm the electrical licence details are current and accurate", "checkbox", { required: true }),
  field("coverageConfirmed", "I confirm every applicable electrical check and excluded area is recorded", "checkbox", { required: true }),
  field("assessorDeclaration", "I authenticate this electrical safety-check record", "checkbox", { required: true }),
]);

const electricalSafetySections = Object.freeze([
  Object.freeze({
    key: "installation_scope",
    title: "Installation scope and visual inspection",
    summary: "Record the complete installation scope, exclusions and the condition of each accessible part.",
    checks: Object.freeze([
      check("mains_switchboards_earthing", "Consumer mains, switchboards, protective devices, earthing and bonding were inspected and tested.", { credentialGate: "licensed_electrician", repeatBy: "switchboard_or_supply", photoGuidance: "Photograph every switchboard, circuit schedule, main switch, protective device, earthing connection and any defect. Keep covers in place unless removal is safe and authorised." }),
      check("wiring_outlets_lighting", "Accessible wiring, socket outlets, switches, lighting points and fittings were inspected and tested.", { credentialGate: "licensed_electrician", repeatBy: "installation_area", photoGuidance: "Photograph each affected area and every defect. Include a readable close photo and enough context to locate it." }),
      check("fixed_special_equipment", "Applicable fixed appliances, solar, battery, pool and electric vehicle equipment were included or explicitly excluded.", { credentialGate: "licensed_electrician", repeatBy: "equipment", photoGuidance: "Photograph the equipment, isolator, connection point and readable data plate. Record Not applicable only when the equipment is not present." }),
    ]),
  }),
  Object.freeze({
    key: "electrical_tests",
    title: "Mandatory electrical tests",
    summary: "Record test values, instruments and results. A photo alone is not a test result.",
    checks: Object.freeze([
      check("polarity_connections", "Required polarity and connection tests are satisfactory.", { credentialGate: "licensed_electrician", repeatBy: "tested_circuit_or_point", responseType: "test_result", photoGuidance: "Record the circuit or point, instrument, measured result and acceptance decision. Photograph the test setup only when safe." }),
      check("earth_continuity", "Required protective earthing continuity tests are satisfactory.", { credentialGate: "licensed_electrician", repeatBy: "tested_circuit_or_point", responseType: "test_result", photoGuidance: "Record the circuit or point, instrument and measured resistance. Attach a legible instrument display or test record." }),
      check("rcd_testing", "Required residual current device tests are satisfactory.", { credentialGate: "licensed_electrician", repeatBy: "rcd", responseType: "test_result", photoGuidance: "Record the RCD identifier, rated residual current, test current, trip time and instrument. Photograph the labelled RCD and supporting test result." }),
    ]),
  }),
  Object.freeze({
    key: "electrical_actions",
    title: "Defects, repairs and records",
    summary: "Record every repair required, action taken and related electrical safety certificate.",
    checks: Object.freeze([
      check("defects_and_actions", "Every defect, required repair, action taken and outstanding recommendation is recorded.", { credentialGate: "licensed_electrician", repeatBy: "defect_or_action", responseType: "action_record", photoGuidance: "Photograph the defect before work and the completed repair after work. Link the Certificate of Electrical Safety when electrical work was performed." }),
    ]),
  }),
]);

const gasSafetyMetadata = Object.freeze([
  field("inspectionDate", "Gas safety check date", "date", { required: true }),
  field("previousCheckDate", "Previous gas safety check date, if known", "date"),
  field("gasfitterName", "Gasfitter name", "text", { required: true, help: "Must match the assigned assessor's TLink profile." }),
  field("licenceNumber", "Gasfitter licence or registration number", "text", { required: true }),
  field("supervisorName", "Licensed supervisor name, if required", "text"),
  field("supervisorLicenceNumber", "Supervisor licence number, if required", "text"),
  field("bpcSubmissionReference", "BPC servicing submission reference", "text"),
  field("areasExcluded", "Areas, installations or appliances excluded from the check", "textarea"),
  field("credentialConfirmed", "I confirm the gasfitting credential details are current and accurate", "checkbox", { required: true }),
  field("coverageConfirmed", "I confirm every gas installation and Type A appliance is recorded", "checkbox", { required: true }),
  field("assessorDeclaration", "I authenticate this gas safety-check record", "checkbox", { required: true }),
]);

const gasSafetySections = Object.freeze([
  Object.freeze({
    key: "gas_installation",
    title: "Gas installation and supply",
    summary: "Inspect the complete gas supply and installation before appliance servicing.",
    checks: Object.freeze([
      check("supply_components", "LPG components, isolation valves, service access, clearances, ventilation and installation certification are satisfactory or recorded as defects.", { credentialGate: "licensed_gasfitter", repeatBy: "gas_supply_or_installation", photoGuidance: "Photograph the meter or LPG supply, isolation points, pipework, ventilation and any defect in context and close up." }),
      check("gas_tightness", "The installation gas-tightness test result is recorded and satisfactory.", { credentialGate: "licensed_gasfitter", responseType: "test_result", photoGuidance: "Record the test method, pressures, duration, instrument and result. Attach a legible test record or instrument display." }),
    ]),
  }),
  Object.freeze({
    key: "type_a_appliances",
    title: "Type A appliance servicing",
    summary: "Create one complete record for every Type A gas appliance.",
    checks: Object.freeze([
      check("appliance_identity_condition", "The appliance identity, certification, condition, clearances, restraint and electrical safety are recorded.", { credentialGate: "licensed_gasfitter", repeatBy: "type_a_appliance", photoGuidance: "Photograph the complete appliance, location, data plate, certification details, connections and any defect." }),
      check("appliance_combustion_flue", "Ventilation, flue or chimney, cowl, combustion, negative-pressure and carbon-monoxide spillage results are satisfactory or recorded as defects.", { credentialGate: "licensed_gasfitter", repeatBy: "type_a_appliance", responseType: "test_result", photoGuidance: "Record the appliance, test conditions, analyser, readings and result. Photograph the flue, ventilation and supporting test display." }),
      check("appliance_service_record", "The complete AS 4575 service record and required actions are recorded for this appliance.", { credentialGate: "licensed_gasfitter", repeatBy: "type_a_appliance", responseType: "action_record", photoGuidance: "Attach the complete service record and photograph repairs, isolation or disconnection work before and after." }),
    ]),
  }),
  Object.freeze({
    key: "gas_safety_actions",
    title: "Safety faults and notifications",
    summary: "Safety-critical faults must be repaired or isolated and the responsible people notified.",
    checks: Object.freeze([
      check("critical_fault_actions", "Every safety-critical fault, make-safe action, notification and outstanding repair is recorded.", { credentialGate: "licensed_gasfitter", repeatBy: "fault_or_action", responseType: "action_record", photoGuidance: "Photograph the unsafe condition, isolation or repair and final safe state. Record who was notified and when." }),
    ]),
  }),
]);

const smokeAlarmMetadata = Object.freeze([
  field("inspectionDate", "Smoke alarm check date", "date", { required: true }),
  field("workerName", "Qualified worker name", "text", { required: true, help: "Must match the assigned assessor's TLink profile." }),
  field("qualificationType", "Qualification or authority", "text", { required: true }),
  field("qualificationNumber", "Qualification or licence number", "text", { required: true }),
  field("areasExcluded", "Areas excluded from the check", "textarea"),
  field("credentialConfirmed", "I confirm my qualification details are current and accurate", "checkbox", { required: true }),
  field("coverageConfirmed", "I confirm every smoke alarm at the property is recorded", "checkbox", { required: true }),
  field("assessorDeclaration", "I authenticate this annual smoke alarm service record", "checkbox", { required: true }),
]);

const smokeAlarmSections = Object.freeze([
  Object.freeze({
    key: "smoke_alarm_inventory",
    title: "Smoke alarm inventory and service",
    summary: "Add every alarm separately so its location, power source, age and test result remain traceable.",
    checks: Object.freeze([
      check("alarm_identity_location", "The alarm location, type, power source, make, model, serial and manufacture or replacement date are recorded.", { credentialGate: "suitably_qualified_smoke_alarm_worker", repeatBy: "smoke_alarm", photoGuidance: "Photograph the alarm in its room or passage, then the alarm face, rear label or data plate and power arrangement." }),
      check("alarm_operation", "The alarm passed the required visual, power, sound and function tests.", { credentialGate: "suitably_qualified_smoke_alarm_worker", repeatBy: "smoke_alarm", responseType: "test_result", photoGuidance: "Record the test method and result. Photograph the operating indicator and any test equipment used without obscuring the alarm location." }),
      check("alarm_interconnection", "Interconnection and required communication with other alarms operates correctly, or is not applicable.", { credentialGate: "suitably_qualified_smoke_alarm_worker", repeatBy: "smoke_alarm", responseType: "test_result", photoGuidance: "Record which alarms activated together and attach clear supporting evidence. Select Not applicable only when interconnection is not required or provided." }),
      check("alarm_repairs_replacement", "Required cleaning, battery work, repair or replacement and the final serviceable state are recorded.", { credentialGate: "suitably_qualified_smoke_alarm_worker", repeatBy: "smoke_alarm", responseType: "action_record", photoGuidance: "Photograph the alarm before work, the replacement label where relevant, and the final installed and tested state." }),
    ]),
  }),
]);

const optionalModuleTemplates = Object.freeze({
  electrical_safety_check: Object.freeze({
    key: "electrical_safety_check",
    title: "Electrical safety check",
    credentialGate: "licensed_electrician",
    reportBoundary: "Separate two-year electrical safety-check record. It is included only when selected and completed by a licensed electrician.",
    metadataFields: electricalSafetyMetadata,
    sections: electricalSafetySections,
  }),
  gas_safety_check: Object.freeze({
    key: "gas_safety_check",
    title: "Gas safety check",
    credentialGate: "licensed_gasfitter",
    reportBoundary: "Separate two-year gas safety-check record. It is included only when selected and completed by an appropriately licensed or supervised gasfitter.",
    metadataFields: gasSafetyMetadata,
    sections: gasSafetySections,
  }),
  smoke_alarm_check: Object.freeze({
    key: "smoke_alarm_check",
    title: "Smoke alarm service and check",
    credentialGate: "suitably_qualified_smoke_alarm_worker",
    reportBoundary: "Separate annual smoke alarm service record. It is not part of the two-year electrical or gas check cycle.",
    metadataFields: smokeAlarmMetadata,
    sections: smokeAlarmSections,
  }),
});

export const VIC_RENTAL_ASSESSMENT_TEMPLATE = Object.freeze({
  contract: "tlink-rental-assessment-template-v1",
  key: RENTAL_ASSESSMENT_TEMPLATE_KEY,
  version: RENTAL_ASSESSMENT_TEMPLATE_VERSION,
  jurisdiction: "VIC",
  effectiveFrom: RENTAL_ASSESSMENT_TEMPLATE_EFFECTIVE_FROM,
  reviewedOn: "2026-08-24",
  title: "Victorian rental minimum standards assessment",
  sources: currentSources,
  modules: Object.freeze({
    minimum_standards: Object.freeze({
      key: "minimum_standards",
      title: "Rental minimum standards assessment",
      credentialGate: "qualified_assessor",
      reportBoundary: "This assessment records the current Victorian rental minimum standards. It does not by itself issue the separate electrical, gas or smoke alarm safety-check records.",
      metadataFields: minimumStandardsMetadata,
      sections: minimumStandardsSections,
    }),
    ...optionalModuleTemplates,
  }),
});

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function normalizeRentalAssessmentModules(value) {
  const source = parseMaybeJson(value);
  const requested = Array.isArray(source) ? source.map(String) : [];
  const optional = RENTAL_ASSESSMENT_OPTIONAL_MODULE_KEYS.filter((key) => requested.includes(key));
  return ["minimum_standards", ...optional];
}

export function rentalAssessmentTemplateSnapshot(value) {
  const moduleKeys = normalizeRentalAssessmentModules(value);
  return structuredClone({
    ...VIC_RENTAL_ASSESSMENT_TEMPLATE,
    selectedModules: moduleKeys,
    modules: Object.fromEntries(moduleKeys.map((key) => [key, {
      ...VIC_RENTAL_ASSESSMENT_TEMPLATE.modules[key],
      templateKey: VIC_RENTAL_ASSESSMENT_TEMPLATE.key,
      templateVersion: VIC_RENTAL_ASSESSMENT_TEMPLATE.version,
      effectiveFrom: VIC_RENTAL_ASSESSMENT_TEMPLATE.effectiveFrom,
      reviewedOn: VIC_RENTAL_ASSESSMENT_TEMPLATE.reviewedOn,
      sources: VIC_RENTAL_ASSESSMENT_TEMPLATE.sources,
    }])),
  });
}

export function rentalAssessmentModule(key) {
  return RENTAL_ASSESSMENT_MODULES.find((module) => module.key === key) || null;
}

export function rentalAssessmentCheck(moduleTemplate, sectionKey, checkKey) {
  if (!moduleTemplate || typeof moduleTemplate !== "object" || Array.isArray(moduleTemplate)) return null;
  const sections = Array.isArray(moduleTemplate.sections) ? moduleTemplate.sections : [];
  const section = sections.find((candidate) => candidate?.key === sectionKey);
  if (!section || !Array.isArray(section.checks)) return null;
  const assessmentCheck = section.checks.find((candidate) => candidate?.key === checkKey);
  return assessmentCheck ? { section, check: assessmentCheck } : null;
}

export function rentalAssessmentItemKey(moduleKey, sectionKey, checkKey, instanceKey = "property") {
  const parts = [moduleKey, sectionKey, checkKey, instanceKey].map((value) => String(value || "").trim());
  if (parts.some((value) => !value || value.length > 120 || !/^[A-Za-z0-9_-]+$/.test(value))) {
    throw new Error("INVALID_RENTAL_ITEM_KEY");
  }
  return parts.join(":");
}

function parsedObject(value) {
  const parsed = parseMaybeJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function requiredMetadataBlockers(moduleTemplate, answers) {
  const fields = Array.isArray(moduleTemplate?.metadataFields) ? moduleTemplate.metadataFields : [];
  return fields.flatMap((metadataField) => {
    if (!metadataField?.required) return [];
    const value = answers[metadataField.key];
    if (metadataField.type === "checkbox" ? value === true : String(value || "").trim()) return [];
    return [{ key: `metadata:${metadataField.key}`, label: `${metadataField.label} is required.` }];
  });
}

export function rentalAssessmentCompletion(input) {
  const moduleTemplate = input?.moduleTemplate && typeof input.moduleTemplate === "object"
    ? input.moduleTemplate
    : {};
  const items = Array.isArray(input?.items) ? input.items : [];
  const findings = Array.isArray(input?.findings) ? input.findings : [];
  const evidenceCounts = parsedObject(input?.evidenceCounts);
  const answers = parsedObject(input?.answers);
  const blockers = [...requiredMetadataBlockers(moduleTemplate, answers)];

  const sections = Array.isArray(moduleTemplate.sections) ? moduleTemplate.sections : [];
  for (const section of sections) {
    for (const assessmentCheck of Array.isArray(section?.checks) ? section.checks : []) {
      if (assessmentCheck?.required === false) continue;
      const checkItems = items.filter((item) => item?.sectionKey === section.key && item?.checkKey === assessmentCheck.key);
      if (!checkItems.length) {
        blockers.push({ key: `check:${section.key}:${assessmentCheck.key}`, label: `${section.title}: ${assessmentCheck.prompt} has not been assessed.` });
        continue;
      }
      for (const item of checkItems) {
        const itemLabel = String(item.locationLabel || section.title || assessmentCheck.prompt);
        if (assessmentCheck.repeatBy !== "property" && !String(item.locationLabel || "").trim()) {
          blockers.push({ key: `location:${item.itemKey}`, label: `${section.title}: add the location for every repeated item.` });
        }
        const outcome = String(item.outcome || "not_assessed");
        if (outcome === "not_assessed") {
          blockers.push({ key: `outcome:${item.itemKey}`, label: `${itemLabel} needs an assessment result.` });
          continue;
        }
        if (outcome === "not_applicable" && !String(item.publicNotes || "").trim()) {
          blockers.push({ key: `not-applicable:${item.itemKey}`, label: `${itemLabel} needs a clear public reason before it can be marked Not applicable.` });
        }
        const requiredEvidenceCount = Math.max(0, Number(item.requiredEvidenceCount ?? assessmentCheck.requiredEvidenceCount ?? 0));
        const suppliedEvidenceCount = Math.max(0, Number(evidenceCounts[item.id] ?? evidenceCounts[item.itemKey] ?? 0));
        if (suppliedEvidenceCount < requiredEvidenceCount) {
          blockers.push({ key: `evidence:${item.itemKey}`, label: `${itemLabel} needs ${requiredEvidenceCount - suppliedEvidenceCount} more evidence file${requiredEvidenceCount - suppliedEvidenceCount === 1 ? "" : "s"}.` });
        }
        const response = parsedObject(item.responseJson);
        if (outcome === "meets" && assessmentCheck.credentialGate && assessmentCheck.credentialGate !== moduleTemplate.credentialGate
          && (response.credentialVerified !== true || !String(response.credentialNumber || "").trim())) {
          blockers.push({ key: `credential:${item.itemKey}`, label: `${itemLabel} needs the specialist credential and verification used for this result.` });
        }
        if (["does_not_meet", "specialist_verification_required", "not_accessible", "exemption_evidence_pending"].includes(outcome)) {
          const finding = findings.find((candidate) => candidate?.itemId === item.id || candidate?.itemKey === item.itemKey);
          if (!finding || !String(finding.title || "").trim() || !String(finding.description || "").trim()
            || !String(finding.tradeCategory || "").trim() || !String(finding.scopeSummary || "").trim()) {
            blockers.push({ key: `finding:${item.itemKey}`, label: `${itemLabel} needs a clear finding, responsible trade and quote-ready scope.` });
          }
          if (finding?.severity === "immediate_safety_risk") {
            const details = parsedObject(finding.details);
            if (!String(details.immediateAction || "").trim() || details.responsiblePeopleNotified !== true) {
              blockers.push({ key: `safety:${item.itemKey}`, label: `${itemLabel} is an immediate safety risk. Record the make-safe action and confirm the responsible people were notified.` });
            }
          }
        }
      }
    }
  }
  return { complete: blockers.length === 0, blockers };
}

export function rentalReportExpiresAt(issuedAt) {
  const issued = new Date(issuedAt);
  if (!Number.isFinite(issued.getTime())) throw new Error("INVALID_ISSUED_AT");
  issued.setUTCDate(issued.getUTCDate() + RENTAL_REPORT_LINK_DAYS);
  return issued.toISOString();
}

export function publicRentalFinding(finding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) return {};
  return publicRentalReportValue(finding);
}

export function publicRentalReportValue(value) {
  if (Array.isArray(value)) return value.map(publicRentalReportValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "internalNotes" && key !== "internal_notes")
    .map(([key, nested]) => [key, publicRentalReportValue(nested)]));
}

export function canonicalRentalJson(value) {
  function canonical(candidate) {
    if (Array.isArray(candidate)) return candidate.map(canonical);
    if (!candidate || typeof candidate !== "object") return candidate;
    return Object.fromEntries(Object.keys(candidate).sort().map((key) => [key, canonical(candidate[key])]));
  }
  return JSON.stringify(canonical(value));
}
