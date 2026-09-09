/** Presentation and evidence policy for the assessor workflow, not a legal certification rule. */
export const RENTAL_ASSESSOR_TITLE = "Rental assessment + 2027";

export const RENTAL_SHOWER_CHOICES = Object.freeze([
  { value: "4 stars or above", label: "4 stars or above" },
  { value: "3 stars", label: "3 stars" },
  { value: "Below 3 stars", label: "Below 3 stars" },
  { value: "Not labelled / unknown", label: "Rating not confirmed" },
  { value: "not_accessible", label: "Could not check" },
  { value: "not_applicable", label: "No shower" },
]);

/** One observed rating supports two different standards. Flow alone never establishes a WELS rating. */
export function rentalShowerChoicePatch(check, value, currentResponse = {}, currentPublicNotes = "") {
  if (!RENTAL_SHOWER_CHOICES.some((choice) => choice.value === value)) throw new Error("INVALID_SHOWER_CHOICE");
  const readiness = checkKey(check) === "shower_2027_readiness";
  const rating = ["not_accessible", "not_applicable"].includes(value) ? "" : value;
  const outcome = value === "not_accessible" || value === "not_applicable" ? value
    : value === "Not labelled / unknown" ? "specialist_verification_required"
      : value === "Below 3 stars" || (readiness && value === "3 stars") ? "does_not_meet" : "meets";
  const absent = "No shower is installed at the property.";
  return { outcome, response: { ...currentResponse, welsRating: rating, showerCaptureVersion: 1 },
    publicNotes: value === "not_applicable" ? currentPublicNotes.trim() || absent : currentPublicNotes === absent ? "" : currentPublicNotes };
}

export function rentalShowerChoiceValue(item) {
  if (["not_accessible", "not_applicable"].includes(item?.outcome)) return item.outcome;
  const value = record(item?.response || parseResponse(item?.responseJson)).welsRating;
  return RENTAL_SHOWER_CHOICES.some((choice) => choice.value === value) ? String(value) : "";
}

/** Keep standards in the frozen template, while asking for the shared shower observation only once.
 * @template {{key:string,checks:Array<{key:string}>}} T
 * @param {{key?:string,sections?:T[]}|null|undefined} moduleTemplate
 * @returns {T[]}
 */
export function rentalAssessorSections(moduleTemplate) {
  const sections = Array.isArray(moduleTemplate?.sections) ? moduleTemplate.sections : [];
  if (moduleTemplate?.key !== "minimum_standards" || !sections.some((section) => section.checks?.some((check) => check.key === "showerhead_rating"))) return sections;
  return sections.map((section) => ({ ...section, checks: section.checks.filter((check) => check.key !== "shower_2027_readiness") })).filter((section) => section.checks.length);
}

function parseResponse(value) {
  if (typeof value !== "string") return record(value);
  try { return record(JSON.parse(value)); } catch { return {}; }
}

/**
 * Read-only projection. Original saved answers and evidence remain untouched.
 * A future result references the single main-shower observation and its evidence.
 * @param {{moduleTemplate: any, items: any[], findings?: any[]}} input
 */
export function rentalShowerAssessmentProjection({ moduleTemplate, items, findings = [] }) {
  if (moduleTemplate?.key !== "minimum_standards") return { items, findings };
  const sections = Array.isArray(moduleTemplate.sections) ? moduleTemplate.sections : [];
  const futureSection = sections.find((section) => section.checks?.some((check) => check.key === "shower_2027_readiness"));
  if (!futureSection) return { items, findings };
  const main = items.find((item) => item.checkKey === "showerhead_rating" && item.instanceKey === "property" && item.outcome && item.outcome !== "not_assessed");
  if (!main) return { items, findings };
  const response = record(main.response || parseResponse(main.responseJson));
  const choice = rentalShowerChoiceValue({ ...main, response });
  // Older answers without an observed rating must not be promoted to either WELS threshold.
  if (!choice || (["not_accessible", "not_applicable"].includes(choice) && response.showerCaptureVersion !== 1)) return { items, findings };
  const patch = rentalShowerChoicePatch("shower_2027_readiness", choice, response, main.publicNotes || "");
  if (["specialist_verification_required", "exemption_evidence_pending"].includes(main.outcome)) patch.outcome = main.outcome;
  const existing = items.find((item) => item.checkKey === "shower_2027_readiness" && item.instanceKey === "property");
  const id = existing?.id || `${main.id}-shower-2027`;
  const itemKey = `${moduleTemplate.key}:${futureSection.key}:shower_2027_readiness:property`;
  const projected = { ...main, ...existing, ...patch, id, itemKey, checkKey: "shower_2027_readiness", sectionKey: futureSection.key,
    moduleId: main.moduleId, instanceKey: "property", locationLabel: "Main shower", responseJson: patch.response,
    derived: true, evidenceSourceItemId: main.id, evidenceSourceItemKey: main.itemKey, requiredEvidenceCount: main.requiredEvidenceCount || 0 };
  const originalFinding = findings.find((finding) => finding.itemId === main.id || finding.itemKey === main.itemKey);
  const projectedFindings = findings.filter((finding) => !existing || (finding.itemId !== existing.id && finding.itemKey !== existing.itemKey));
  if (["does_not_meet", "specialist_verification_required", "not_accessible", "exemption_evidence_pending"].includes(patch.outcome)) {
    const flow = response.flowLitresPerMinute;
    const measuredFlow = (typeof flow === "number" && Number.isFinite(flow) || typeof flow === "string" && /^\d+(?:\.\d+)?$/.test(flow.trim())) ? ` Main shower flow recorded: ${flow} L/min.` : "";
    projectedFindings.push({ ...(originalFinding || {}), id: `${id}-finding`, moduleId: main.moduleId, itemId: id, itemKey,
      findingKey: `${itemKey}:finding`, category: "showers", title: patch.outcome === "does_not_meet" ? "Showerhead upgrade for 2027" : "Shower WELS rating not established",
      description: patch.outcome === "does_not_meet" ? `The main shower is recorded as ${choice.toLowerCase()}.${measuredFlow} Use the main-shower photographs in this report for the existing fitting. The 4-star requirement applies on a new agreement or conversion to periodic from 1 March 2027; any permitted plumbing exception needs supporting evidence.`
        : originalFinding?.description || "The main shower's WELS rating could not be established from the assessment. Refer to the main-shower observation and evidence.",
      status: "recommendation", severity: "recommended", locationLabel: "Main shower", derived: true,
      recommendedAction: patch.outcome === "does_not_meet" ? "Quote a qualifying showerhead replacement using the recorded fitting and photographs." : originalFinding?.recommendedAction || "Review the recorded shower model and evidence to establish its WELS rating.",
      scopeSummary: "Main shower", unitLabel: "each", quantityMilli: 1000,
      details: { ...record(originalFinding?.details), evidenceSourceItemId: main.id },
    });
  }
  return { items: [...items.filter((item) => item !== existing), projected], findings: projectedFindings };
}

/** Normalize older frozen forms without asking the assessor to re-enter identity or today's date.
 * @template {{key:string,type?:string,phase?:string,source?:string}} T
 * @param {T} field
 * @returns {T & {phase:string,source:string}}
 */
export function rentalAssessorMetadataField(field) {
  if (field.key === "inspectionDate") return { ...field, phase: "setup", source: "automatic" };
  if (["assessorName", "electricianName", "gasfitterName", "workerName", "licenceNumber", "qualificationType", "qualificationNumber"].includes(field.key)) {
    return { ...field, phase: "profile", source: "team_profile" };
  }
  return { ...field, phase: field.phase || (field.type === "checkbox" ? "final" : "setup"), source: field.source || "assessment" };
}

const fixedWindowNote = "No openable windows at the property; fixed glazing only.";
/** @param {unknown} outcome @param {unknown} publicNotes */
export function rentalWindowIsFixed(outcome, publicNotes) {
  return outcome === "not_applicable" && (String(publicNotes || "").includes(fixedWindowNote) || String(publicNotes || "").includes("Fixed glazing; this window is not designed to open."));
}
/** Keep the existing outcome contract and an honest public reason, without asking the assessor to type it.
 * @param {unknown} check @param {string} outcome @param {string} [currentPublicNotes]
 */
export function rentalAssessorOutcomePatch(check, outcome, currentPublicNotes = "") {
  if (checkKey(check) === "vents_2027_readiness") {
    const note = "No wall vents were observed during the assessment.";
    if (outcome === "not_applicable") return { outcome, publicNotes: currentPublicNotes.trim() || note };
    return { outcome, publicNotes: currentPublicNotes === note ? "" : currentPublicNotes };
  }
  if (checkKey(check) !== "window_operation_security") return { outcome };
  if (outcome === "not_applicable") return { outcome, publicNotes: currentPublicNotes.includes(fixedWindowNote) ? currentPublicNotes
    : [currentPublicNotes.trim(), fixedWindowNote].filter(Boolean).join("\n") };
  return { outcome, publicNotes: currentPublicNotes === fixedWindowNote ? "" : currentPublicNotes };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
/** @param {unknown} check */
function checkKey(check) {
  return typeof check === "string" ? check : String(record(check).key || record(check).checkKey || "");
}

const ordinaryClearChecks = new Set([
  "bathroom_facilities", "bathroom_water", "kitchen_preparation", "kitchen_sink_water",
  "cooktop_function", "oven_function", "laundry_connections", "artificial_lighting",
  "habitable_daylight", "external_door_lock", "mould_damp_observation", "structure_weatherproofing",
  "bins", "window_operation_security", "window_covering", "toilet_function",
]);
const equipmentChecks = new Set([
  "showerhead_rating", "switchboard_observation", "main_living_heater", "heater_operation", "heater_efficiency",
  "heating_2027_readiness", "cooling_2027_readiness", "hot_water_2027_readiness", "shower_2027_readiness",
  "ceiling_2027_readiness", "doors_2027_readiness", "windows_2027_readiness", "vents_2027_readiness",
]);

/** App evidence policy. Counts are not represented as statutory photo requirements.
 * @param {unknown} check @param {unknown} outcome
 * @returns {{minimumFiles:number, minimumPhotos:number, reason:string}}
 */
export function rentalAssessorEvidenceRequirement(check, outcome) {
  const definition = record(check);
  const key = checkKey(check);
  const requested = Number(definition.requiredEvidenceCount);
  const requiredFiles = Number.isInteger(requested) && requested >= 0 ? requested : 1;
  const credential = String(definition.credentialGate || "assigned_assessor");
  const specialist = !["assigned_assessor", "qualified_assessor"].includes(credential) || ["test_result", "action_record"].includes(String(definition.responseType));
  const sealOrVent = ["doors_2027_readiness", "windows_2027_readiness", "vents_2027_readiness"].includes(key);
  if (sealOrVent && ["meets", "does_not_meet", "specialist_verification_required"].includes(String(outcome))) {
    const vent = key === "vents_2027_readiness";
    return { minimumFiles: outcome === "does_not_meet" ? Math.max(2, requiredFiles) : Math.max(1, requiredFiles),
      minimumPhotos: outcome === "does_not_meet" ? 2 : 1,
      reason: vent
        ? "Photograph each wall vent type, including the grille or air brick and any existing cover or seal. Add an overview and close photo where work is needed."
        : "Photograph the existing door or window weather seals close up and show their condition. Include missing or damaged sections where work is needed." };
  }
  if (outcome === "does_not_meet") return { minimumFiles: Math.max(2, requiredFiles), minimumPhotos: 2, reason: "Add an overview and a close photo of the issue, where safe. If it cannot be inspected safely, record that it could not be checked." };
  if (outcome === "not_accessible") return { minimumFiles: 0, minimumPhotos: 0, reason: "Describe what could not be reached and why. Add any safe supporting evidence available." };
  if (outcome === "specialist_verification_required" || outcome === "exemption_evidence_pending") return { minimumFiles: 0, minimumPhotos: 0, reason: "Record what is known and what needs verification. Attach any available photo or document; do not invent missing evidence." };
  if (outcome !== "meets" && outcome !== "not_applicable") return { minimumFiles: 0, minimumPhotos: 0, reason: "Choose an answer before adding supporting evidence." };
  if (specialist) return { minimumFiles: Math.max(1, requiredFiles), minimumPhotos: 0, reason: "Attach the test, service or verification record needed to support this result. A photo alone does not certify the result." };
  if (outcome === "not_applicable") return { minimumFiles: 0, minimumPhotos: 0, reason: "Explain why this check does not apply. No photo is required just to show an absent item." };
  if (ordinaryClearChecks.has(key)) return { minimumFiles: 0, minimumPhotos: 0, reason: "No photo is required for this clear observation. Add one if it would help explain the record." };
  if (equipmentChecks.has(key)) return { minimumFiles: Math.max(1, requiredFiles), minimumPhotos: 1, reason: "Add a clear photo identifying the equipment or measured area, with any label or document supporting the result." };
  return { minimumFiles: requiredFiles, minimumPhotos: 0, reason: "Attach the evidence supporting this result. Record a need for verification when it cannot be established." };
}

/** @type {Record<string, {prompt:string, meets?:string, adverse?:string, specialist?:string, help?:string}>} */
const presentation = {
  bathroom_facilities: { prompt: "Is there a basin and a shower or bath?", meets: "Yes, both are present", adverse: "A required fixture is missing" },
  bathroom_water: { prompt: "Do the bathroom fixtures have hot and cold water?", meets: "Yes, water works", adverse: "Water supply problem" },
  showerhead_rating: { prompt: "What WELS rating is confirmed for the main shower?", meets: "3 stars or higher confirmed", adverse: "Below 3 stars", specialist: "Rating not confirmed", help: "Choose the rating once and measure the flow in litres per minute. TLink records today's 3-star requirement and the 2027 4-star requirement from this answer. Use a WELS label or confirmed model rating. Flow alone does not prove its WELS rating. Note any other shower needing attention." },
  switchboard_observation: { prompt: "Can you record the switchboard and its labels?", meets: "Board and labels recorded", adverse: "A visible issue needs attention" },
  outlet_lighting_protection: { prompt: "Has an electrician verified the required circuit protection?", meets: "Required protection verified", adverse: "Protection does not meet requirements" },
  main_living_heater: { prompt: "Is the required fixed heater in the main living room?", meets: "Qualifying heater is present", adverse: "Required heater missing or unsuitable" },
  heater_operation: { prompt: "Does the main living room heater work?", meets: "Heater works", adverse: "Heater does not work" },
  heater_efficiency: { prompt: "Is the heater's required energy rating confirmed?", meets: "Applicable efficiency requirement verified", adverse: "Does not meet the applicable requirement" },
  kitchen_preparation: { prompt: "Is there a dedicated food preparation and cooking area?", meets: "Yes, an area is provided", adverse: "Required area is missing" },
  kitchen_sink_water: { prompt: "Does the kitchen sink have hot and cold water?", meets: "Yes, both work", adverse: "Water supply problem" },
  cooktop_function: { prompt: "Do at least two cooktop burners work?", meets: "At least two burners work", adverse: "Fewer than two work" },
  oven_function: { prompt: "If there is an oven, does it work?", meets: "Oven works", adverse: "Oven does not work" },
  laundry_connections: { prompt: "If there is a laundry, are hot and cold water connections available?", meets: "Required connections are available", adverse: "A required connection is missing" },
  artificial_lighting: { prompt: "Do the lights work throughout the property?", meets: "Lights work", adverse: "A light is missing or not working", help: "Check the lights in the rooms, corridors and hallways. Photograph problems only." },
  habitable_daylight: { prompt: "Do the living spaces and bedrooms receive natural daylight?", meets: "Daylight reaches the living spaces", adverse: "A living space has no natural daylight", help: "Check the property once. Daylight can come through a window or from an adjoining room. Choose Could not check if daylight was unavailable." },
  mould_damp_observation: { prompt: "Is mould or damp present in the property?", meets: "No mould or damp seen", adverse: "Mould or damp seen", help: "Look at accessible walls, ceilings and other surfaces. Photograph affected areas only. You do not need to diagnose the cause." },
  structure_weatherproofing: { prompt: "Are there visible leaks, damage or building problems?", meets: "No visible issue seen", adverse: "Visible issue needs attention", help: "Look for water entry, cracks or visible deterioration. Photograph problems and briefly describe what you see." },
  external_door_lock: { prompt: "Do the outside entry doors have working locks?", meets: "Required locks work", adverse: "A lock is missing or not working", help: "Check the entry doors once. Confirm the deadlock or permitted locking device works. Photograph any problem." },
  toilet_function: { prompt: "Does the property have a working toilet?", meets: "Yes, a working toilet is provided", adverse: "No working toilet", help: "Flush the toilet and check for an obvious problem. It must be in an enclosed space and connected to wastewater. Record only what you can see; no plumbing test is required here." },
  room_ventilation: { prompt: "Is the property adequately ventilated?", meets: "Ventilation requirement verified with evidence", adverse: "A ventilation problem is confirmed", specialist: "Needs ventilation verification", help: "Look at opening windows, vents and exhaust fans across the property. A working fan or opening window does not by itself prove compliance. Record visible issues, or use Needs ventilation verification when the required assessment is unavailable." },
  bins: { prompt: "Are suitable rubbish and recycling bins provided with lids that keep vermin out?", meets: "Both suitable bins are provided", adverse: "A bin is missing or unsuitable" },
  window_operation_security: { prompt: "Do the openable windows work and latch securely?", meets: "All openable windows work and latch", adverse: "A window or latch needs attention", help: "Check all openable windows once. They must open, close, stay in place and latch or lock securely. Fixed glass does not need an opening check." },
  window_covering: { prompt: "Do bedroom and living-area windows have suitable curtains or blinds?", meets: "Yes, privacy and light blocking are adequate", adverse: "Missing, broken or inadequate", help: "Close the coverings and check privacy and light blocking. Photograph any that need attention. No separate window entries or dimensions are needed." },
  cord_anchor: { prompt: "Are blind cords secured with the required safety fittings?", meets: "Cord and fitting requirements verified", adverse: "A cord or fitting needs attention", help: "Check accessible cords and anchors across the property. Choose Does not apply if there are no corded blinds. Keep measurements or fitting evidence where required to confirm safety." },
  heating_2027_readiness: { prompt: "Is the main living room heater ready for the 2027 requirement?" },
  cooling_2027_readiness: { prompt: "Is the main living room cooling ready for the 2027 requirement?" },
  hot_water_2027_readiness: { prompt: "Is the hot water system ready for its 2027 replacement requirement?" },
  shower_2027_readiness: { prompt: "What WELS rating is confirmed for the main shower?", meets: "4 stars or higher confirmed", adverse: "A showerhead needs replacement", specialist: "Rating not confirmed", help: "Choose the rating and measure the flow in litres per minute. From 1 March 2027 the new-agreement or periodic-conversion requirement is 4 stars. Use a WELS label or confirmed model rating; flow alone does not prove the rating." },
  ceiling_2027_readiness: { prompt: "Is roof insulation present?", meets: "Present throughout the accessible ceiling", adverse: "None, or some bare areas", help: "Choose the existing R-value if known and record the total area needing insulation. Existing insulation need not be upgraded solely because it is below R5. Bare ceiling areas require R5 insulation when the new rule applies. Only inspect from a safe access point." },
  doors_2027_readiness: { prompt: "Are the outside doors sealed around every edge?", meets: "Yes, all edges are sealed", adverse: "Seals are missing or damaged", specialist: "Not sure", help: "Close each outside door. Look along the top, sides and bottom for gaps or damaged seals. If work is needed, record the doors, total seal length and photos. Doors must still open and close normally." },
  windows_2027_readiness: { prompt: "Are the outside windows sealed around every edge?", meets: "Yes, all edges are sealed", adverse: "Seals are missing or damaged", specialist: "Not sure", help: "Close the windows and check their edges. Photograph the existing seals. If work is needed, add the total length needing tape or caulking in metres. No window widths or heights are needed." },
  vents_2027_readiness: { prompt: "Are there wall vents that need sealing?", meets: "Wall vents are already sealed", adverse: "Unsealed wall vents seen", specialist: "Not sure what the vent is for", help: "Count the unsealed wall vents and photograph each vent type. Choose No wall vents if none are present. Do not block them; the installer must check gas and ventilation requirements first." },
};

/** Plain labels preserve every stored outcome's direction and current/future distinction.
 * Existing legal help remains available wherever a short observation cannot state all criteria.
 * @param {unknown} check
 * @param {{assessmentScope?:unknown,outcome?:unknown,publicNotes?:unknown}} [options]
 */
export function rentalAssessorCheckPresentation(check, options = {}) {
  const definition = record(check);
  const wording = presentation[checkKey(check)];
  const future = definition.assessmentPhase === "energy_readiness_2027" || checkKey(check).includes("_2027_readiness");
  const observationsOnly = options.assessmentScope === "observations_only";
  const meets = observationsOnly ? "Observation recorded; compliance not assessed"
    : wording?.meets || (future ? "Ready for the applicable 2027 requirement" : "Requirement verified");
  const outcomeOptions = [
    { value: "meets", label: meets },
    { value: "does_not_meet", label: wording?.adverse || (future ? "Work needed for the applicable 2027 requirement" : "Requirement not met") },
    { value: "specialist_verification_required", label: wording?.specialist || "Needs verification" },
    { value: "not_accessible", label: "Could not check" },
    { value: "not_applicable", label: "Does not apply" },
    { value: "exemption_evidence_pending", label: "Possible exception; evidence needed" },
  ];
  const simpleWindow = ["window_operation_security", "window_covering"].includes(checkKey(check));
  if (checkKey(check) === "window_operation_security") outcomeOptions[4].label = "No openable windows";
  if (checkKey(check) === "vents_2027_readiness") outcomeOptions[4].label = "No wall vents";
  return {
    prompt: wording?.prompt || String(definition.prompt || "Record the assessment result"),
    help: wording?.help || String(definition.help || "Record what you can confirm. Choose Needs verification when the result is not established."),
    phaseLabel: future ? "2027 readiness" : "Current requirement",
    outcomeOptions: outcomeOptions.filter((option) => !simpleWindow || !["specialist_verification_required", "exemption_evidence_pending"].includes(option.value) || option.value === options.outcome),
  };
}
