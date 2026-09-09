/** Presentation and evidence policy for the assessor workflow, not a legal certification rule. */
export const RENTAL_ASSESSOR_TITLE = "Rental assessment + 2027";

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
  showerhead_rating: { prompt: "Does the main shower have a WELS water-efficiency rating?", meets: "3 stars or higher confirmed", adverse: "Below 3 stars", specialist: "Rating not confirmed", help: "Read the WELS label or confirmed model rating. Record the main shower's flow in litres per minute. Flow alone does not prove its WELS rating. Note any other shower that needs attention." },
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
  shower_2027_readiness: { prompt: "Do the showers meet the 2027 WELS requirement?", meets: "4 stars or higher confirmed", adverse: "A showerhead needs replacement", specialist: "Rating not confirmed", help: "Use the recorded WELS rating and label photos. From 1 March 2027, the new-agreement or periodic-conversion requirement is 4 stars. Include any other shower needing replacement in the report." },
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
