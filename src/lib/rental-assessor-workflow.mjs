/** Presentation and evidence policy for the assessor workflow, not a legal certification rule. */
export const RENTAL_ASSESSOR_TITLE = "Rental assessment + 2027";

/** @typedef {{id: string, label: string, type: string}} RentalRoom */
/** @typedef {{sectionKey: string, checkKey: string}} RentalRoomCheck */

export const RENTAL_ROOM_TYPES = Object.freeze([
  { value: "bedroom", label: "Bedroom" },
  { value: "living_room", label: "Living room" },
  { value: "dining_room", label: "Dining room" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bathroom", label: "Bathroom" },
  { value: "toilet", label: "Toilet" },
  { value: "laundry", label: "Laundry" },
  { value: "hallway", label: "Hallway or passage" },
  { value: "study", label: "Study" },
  { value: "other", label: "Other room" },
  { value: "exterior", label: "Outside area" },
].map((type) => Object.freeze(type)));

/** @type {ReadonlyArray<Readonly<RentalRoomCheck>>} */
export const RENTAL_ROOM_CHECKS = Object.freeze([
  Object.freeze({ sectionKey: "lighting", checkKey: "artificial_lighting" }),
  Object.freeze({ sectionKey: "lighting", checkKey: "habitable_daylight" }),
  Object.freeze({ sectionKey: "mould_damp", checkKey: "mould_damp_observation" }),
  Object.freeze({ sectionKey: "structural_soundness", checkKey: "structure_weatherproofing" }),
  Object.freeze({ sectionKey: "ventilation", checkKey: "room_ventilation" }),
]);

export const RENTAL_WINDOW_CHECKS = Object.freeze([
  { sectionKey: "windows", checkKey: "window_operation_security" },
  { sectionKey: "window_coverings", checkKey: "window_covering" },
  { sectionKey: "window_covering_cords", checkKey: "cord_anchor" },
  { sectionKey: "draughtproofing", checkKey: "windows_2027_readiness" },
].map((check) => Object.freeze(check)));

/** Prefer the operation record, retaining a window even when another check was saved first.
 * @template {{checkKey?:string,instanceKey?:string,locationLabel?:string,response?:Record<string,unknown>}} T
 * @param {RentalRoom} room @param {readonly T[]} items
 * @returns {T[]}
 */
export function rentalRoomWindowItems(room, items) {
  const candidates = items.filter((item) => RENTAL_WINDOW_CHECKS.some((check) => check.checkKey === checkKey(item))
    && (record(item.response).roomId === room.id || (checkKey(item) === "window_operation_security" && !record(item.response).roomId && normalizedLabel(item.locationLabel) === normalizedLabel(room.label))));
  const primary = candidates.filter((item) => checkKey(item) === "window_operation_security");
  const windows = [...primary];
  for (const item of candidates) {
    if (!windows.some((window) => rentalRoomItemInstance({ id: window.instanceKey || "", label: window.locationLabel || "", type: "other" }, checkKey(item), items) === item.instanceKey)) windows.push(item);
  }
  return windows;
}

/** @param {RentalRoom} room @param {unknown} items */
export function rentalNextRoomWindowLabel(room, items) {
  const labels = new Set((Array.isArray(items) ? items : []).map((item) => normalizedLabel(record(item).locationLabel)));
  let number = 1;
  while (labels.has(normalizedLabel(`${room.label} - Window ${number}`))) number++;
  return `${room.label} - Window ${number}`;
}

const fixedWindowNote = "Fixed glazing; this window is not designed to open.";
/** @param {unknown} outcome @param {unknown} publicNotes */
export function rentalWindowIsFixed(outcome, publicNotes) {
  return outcome === "not_applicable" && String(publicNotes || "").includes(fixedWindowNote);
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

const roomTypeKeys = new Set(RENTAL_ROOM_TYPES.map((type) => type.value));
const roomCheckKeys = new Set(RENTAL_ROOM_CHECKS.map((check) => check.checkKey));
const daylightRoomTypes = new Set(["bedroom", "living_room", "dining_room", "kitchen", "study", "other"]);
const identityPattern = /^[A-Za-z0-9_-]{1,120}$/;

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
/** @param {unknown} value */
function normalizedLabel(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}
/** @param {unknown} check */
function checkKey(check) {
  return typeof check === "string" ? check : String(record(check).key || record(check).checkKey || "");
}
/** @param {string} label */
function legacyRoomId(label) {
  let hash = 2166136261;
  for (const character of normalizedLabel(label)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return `legacy_room_${hash.toString(36)}`;
}
function invalidRoster() {
  return Object.assign(new Error("RENTAL_ROOM_ROSTER_INVALID"), { code: "RENTAL_ROOM_ROSTER_INVALID" });
}

/** Validate the persisted roster. Omission handling belongs to the save boundary.
 * @param {unknown} value
 * @returns {RentalRoom[]}
 */
export function normalizeRentalRoomRoster(value) {
  if (!Array.isArray(value) || value.length > 80) throw invalidRoster();
  const ids = new Set();
  const labels = new Set();
  return value.map((entry) => {
    const room = record(entry);
    const id = typeof room.id === "string" ? room.id.trim() : "";
    const label = typeof room.label === "string" ? room.label.trim().replace(/\s+/g, " ") : "";
    const type = typeof room.type === "string" ? room.type : "";
    const labelKey = normalizedLabel(label);
    if (!identityPattern.test(id) || !label || label.length > 120 || !roomTypeKeys.has(type)
      || ids.has(id) || labels.has(labelKey)) throw invalidRoster();
    ids.add(id);
    labels.add(labelKey);
    return { id, label, type };
  });
}

/** Unknown room types do not silently create or exempt any checks.
 * Other room is deliberately inclusive until its use is confirmed by the assessor.
 * @param {unknown} type
 * @returns {RentalRoomCheck[]}
 */
export function rentalRoomChecks(type) {
  if (typeof type !== "string" || !roomTypeKeys.has(type)) return [];
  return RENTAL_ROOM_CHECKS.filter((check) => {
    if (type === "exterior") return check.checkKey === "structure_weatherproofing";
    if (check.checkKey === "habitable_daylight") return daylightRoomTypes.has(type);
    if (check.checkKey === "room_ventilation") return type !== "hallway";
    return true;
  }).map((check) => ({ ...check }));
}

/** @param {unknown} check @param {unknown} roster @returns {RentalRoom[]} */
export function rentalRoomsForCheck(check, roster) {
  if (!Array.isArray(roster)) return [];
  const key = checkKey(check);
  return roster.filter((room) => rentalRoomChecks(record(room).type).some((entry) => entry.checkKey === key));
}

/** Reuse the actual existing check identity, never another check's saved result.
 * Callers must pass items from the target module only.
 * @param {RentalRoom} room @param {string} key @param {unknown} items
 * @returns {string}
 */
export function rentalRoomItemInstance(room, key, items) {
  const candidates = (Array.isArray(items) ? items : []).map(record).filter((item) => checkKey(item) === key);
  const location = normalizedLabel(room.label);
  const exact = candidates.find((item) => item.instanceKey === room.id && normalizedLabel(item.locationLabel) === location);
  if (exact) return room.id;
  const sameLocation = candidates.filter((item) => normalizedLabel(item.locationLabel) === location
    && identityPattern.test(String(item.instanceKey || "")));
  // Ambiguous duplicate legacy locations must not silently select one assessment.
  if (sameLocation.length === 1) return String(sameLocation[0].instanceKey);
  if (!candidates.some((item) => item.instanceKey === room.id)) return room.id;
  const usedIds = new Set((Array.isArray(items) ? items : []).map((item) => String(record(item).instanceKey || "")));
  const base = `room_${room.id.slice(0, 100)}`;
  let suffix = 1;
  let fresh = `${base}_${suffix}`;
  while (usedIds.has(fresh)) fresh = `${base}_${++suffix}`;
  return fresh;
}

/** Build a display roster without rewriting historical item identities or outcomes.
 * Legacy room types remain Other until the assessor records their actual use.
 * Callers must pass items from the target module only.
 * @param {unknown} roster @param {unknown} items @returns {RentalRoom[]}
 */
export function rentalRoomsFromItems(roster, items) {
  /** @type {RentalRoom[]} */
  const rooms = [];
  const labels = new Set();
  const ids = new Set();
  for (const value of Array.isArray(roster) ? roster : []) {
    try {
      const [room] = normalizeRentalRoomRoster([value]);
      if (ids.has(room.id) || labels.has(normalizedLabel(room.label))) continue;
      rooms.push(room);
      ids.add(room.id);
      labels.add(normalizedLabel(room.label));
    } catch { /* Malformed saved display data is not a new authorised room. */ }
  }
  const candidates = (Array.isArray(items) ? items : []).map(record);
  for (const item of candidates) {
    if (!roomCheckKeys.has(checkKey(item))) continue;
    const label = typeof item.locationLabel === "string" ? item.locationLabel.trim().replace(/\s+/g, " ") : "";
    if (!label || label.length > 120 || labels.has(normalizedLabel(label))) continue;
    // A historical instance ID belongs to one check, not to a room. Give the
    // room its own stable identity and continue resolving old checks by location.
    const base = legacyRoomId(label);
    let id = base;
    let suffix = 1;
    const occupied = (candidate) => ids.has(candidate) || candidates.some((entry) => entry.instanceKey === candidate
      && normalizedLabel(entry.locationLabel) !== normalizedLabel(label));
    while (occupied(id)) id = `${base}_${suffix++}`;
    rooms.push({ id, label, type: "other" });
    ids.add(id);
    labels.add(normalizedLabel(label));
  }
  return rooms;
}

const ordinaryClearChecks = new Set([
  "bathroom_facilities", "bathroom_water", "kitchen_preparation", "kitchen_sink_water",
  "cooktop_function", "oven_function", "laundry_connections", "artificial_lighting",
  "habitable_daylight", "external_door_lock", "mould_damp_observation", "structure_weatherproofing",
  "bins", "window_operation_security", "window_covering",
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
  const specialist = credential !== "assigned_assessor" || ["test_result", "action_record"].includes(String(definition.responseType));
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
  showerhead_rating: { prompt: "Is this showerhead's water rating confirmed?", meets: "Required rating or permitted alternative verified", adverse: "Does not meet the required rating" },
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
  artificial_lighting: { prompt: "Do the lights work in this space?", meets: "Lights work", adverse: "A light is missing or not working", help: "Check the lights safely. No photo is needed when they work; photograph any issue." },
  habitable_daylight: { prompt: "Does this room get natural daylight?", meets: "Daylight reaches the room", adverse: "No natural daylight", help: "Daylight can come through a window or from an adjoining room. Record if you could not check in daylight." },
  mould_damp_observation: { prompt: "Can you see mould or damp in this space?", meets: "No mould or damp seen", adverse: "Mould or damp seen", help: "Look at accessible walls, ceilings and other surfaces. Photograph any affected area. You do not need to diagnose its cause." },
  structure_weatherproofing: { prompt: "Can you see damage, leaks or another building issue here?", meets: "No visible issue seen", adverse: "Visible issue needs attention", help: "Look for visible damage, cracks, water entry or deterioration. Record what you can see; a specialist determines the cause where needed." },
  external_door_lock: { prompt: "Does this entry door have the required working lock?", meets: "Required lock works", adverse: "Lock is missing or not working" },
  toilet_function: { prompt: "Does this toilet work and have the required enclosure and waste connection?", meets: "Operation, enclosure and waste connection confirmed", adverse: "A required part needs attention" },
  room_ventilation: { prompt: "What can you confirm about ventilation in this room?", meets: "Ventilation requirement verified with evidence", adverse: "A ventilation problem is confirmed", specialist: "Needs ventilation verification", help: "Record the window, vent or fan you can see. A working fan or opening window does not by itself prove the room meets the requirement. Use Needs ventilation verification if you do not have a supporting assessment." },
  bins: { prompt: "Are suitable rubbish and recycling bins provided with lids that keep vermin out?", meets: "Both suitable bins are provided", adverse: "A bin is missing or unsuitable" },
  window_operation_security: { prompt: "Does this window open and close properly?", meets: "Works properly", adverse: "Something is wrong", help: "Open and close it. Check it stays open safely and the latch or lock works. Choose Fixed window if it is not designed to open." },
  window_covering: { prompt: "Do the curtains or blinds close properly?", meets: "Yes, privacy and light blocking are adequate", adverse: "Missing, broken or inadequate", help: "In bedrooms and living areas, close the curtains or blinds and check they provide privacy and block light. Measure only when a replacement is needed." },
  cord_anchor: { prompt: "Are this covering's cord and safety fittings confirmed safe?", meets: "Cord and fitting requirements verified", adverse: "Cord or fitting does not meet requirements" },
  heating_2027_readiness: { prompt: "Is the main living room heater ready for the 2027 requirement?" },
  cooling_2027_readiness: { prompt: "Is the main living room cooling ready for the 2027 requirement?" },
  hot_water_2027_readiness: { prompt: "Is the hot water system ready for its 2027 replacement requirement?" },
  shower_2027_readiness: { prompt: "Is this showerhead ready for the 2027 water rating requirement?" },
  ceiling_2027_readiness: { prompt: "Is insulation present throughout this accessible ceiling area?", meets: "Insulation covers the accessible area", adverse: "An area has no insulation" },
  doors_2027_readiness: { prompt: "Are the outside doors sealed around every edge?", meets: "Yes, all edges are sealed", adverse: "Seals are missing or damaged", specialist: "Not sure", help: "Close each outside door. Look along the top, sides and bottom for gaps or damaged seals. If work is needed, record the doors, total seal length and photos. Doors must still open and close normally." },
  windows_2027_readiness: { prompt: "Is this window sealed around every edge?", meets: "Yes, all edges are sealed", adverse: "Seals are missing or damaged", specialist: "Not sure", help: "Close the window and check around its edges. If a seal is missing or damaged, measure the length needing a seal and photograph it. The window must still work normally." },
  vents_2027_readiness: { prompt: "Are there any unsealed wall vents?", meets: "The wall vents are already sealed", adverse: "Unsealed wall vents seen", specialist: "Not sure what the vent is for", help: "Look for open wall grilles or air bricks. Record their locations, count and sizes, with photos. Choose No wall vents if none are present. Do not block vents during the assessment; the installer must check gas and ventilation requirements first." },
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
  if (checkKey(check) === "window_operation_security") outcomeOptions[4].label = options.outcome === "not_applicable" && !rentalWindowIsFixed(options.outcome, options.publicNotes)
    ? "Does not apply (saved answer)" : "Fixed window (does not open)";
  if (checkKey(check) === "window_covering") outcomeOptions[4].label = "Not required in this room";
  if (checkKey(check) === "vents_2027_readiness") outcomeOptions[4].label = "No wall vents";
  return {
    prompt: wording?.prompt || String(definition.prompt || "Record the assessment result"),
    help: wording?.help || String(definition.help || "Record what you can confirm. Choose Needs verification when the result is not established."),
    phaseLabel: future ? "2027 readiness" : "Current requirement",
    outcomeOptions: outcomeOptions.filter((option) => !simpleWindow || !["specialist_verification_required", "exemption_evidence_pending"].includes(option.value) || option.value === options.outcome),
  };
}
