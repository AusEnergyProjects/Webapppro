/** Public, assessor-recorded information needed to price a finding. Stored with the finding snapshot. */
export const RENTAL_QUOTATION_FIELDS = Object.freeze([
  { key: "measurements", label: "Measurements and quantity basis", help: "Measured area, length or dimensions, with units and the method used. Identify each affected location." },
  { key: "specification", label: "Existing equipment and proposed specification", help: "Record make/model, condition, label photo references and the required replacement performance or materials. For testing work, define the tests and deliverables." },
  { key: "access", label: "Access and installation requirements", help: "Access opening, working height, roof or wall construction, services, isolation, obstructions and occupant arrangements. Record checks needed before work." },
  { key: "exclusions", label: "Inclusions, exclusions and allowances", maxLength: 8192, help: "Include removal, disposal, making good and certificates. Define allowances and assumptions for concealed conditions so the work can be priced from this report." },
]);

export function rentalQuotation(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fields = Object.fromEntries(RENTAL_QUOTATION_FIELDS.map((field) => field.key)
    .map((key) => [key, typeof source[key] === "string" ? source[key] : ""]));
  // Keep earlier assessment notes visible when old drafts/reports use the retired workflow.
  if (typeof source.missingInformation === "string" && source.missingInformation.trim()) {
    fields.exclusions = [fields.exclusions, `Recorded assessment limitation: ${source.missingInformation.trim()}`].filter(Boolean).join("\n");
  }
  return fields;
}

export const RENTAL_OBSERVATION_NUMBER_FIELDS = Object.freeze({
  roomLengthMetres: "m", roomWidthMetres: "m", roomHeightMetres: "m", widthMm: "mm", heightMm: "mm", depthMm: "mm",
  areaSquareMetres: "m2", sealLengthMetres: "m", flowLitresPerMinute: "L/min", collectedLitres: "L", flowSeconds: "seconds",
  count: "", workingBurners: "", insulationDepthMm: "mm", hatchWidthMm: "mm", accessWidthMm: "mm",
  cabinetWidthMm: "mm", cabinetHeightMm: "mm", cabinetDepthMm: "mm",
});
export function rentalObservationNumberIsValid(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value !== "string") return false;
  const text = value.trim();
  return !text || (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) && Number.isFinite(Number(text)));
}
export function rentalObservationResponseLabel(key) {
  const names = { roomLengthMetres: "Room length", roomWidthMetres: "Room width", roomHeightMetres: "Ceiling height", widthMm: "Width", heightMm: "Height", depthMm: "Depth", areaSquareMetres: "Total insulation area required", sealLengthMetres: "Total draughtproofing length", flowLitresPerMinute: "Water flow", collectedLitres: "Water collected", flowSeconds: "Collection time", count: "Count", workingBurners: "Working burners", insulationDepthMm: "Insulation depth", hatchWidthMm: "Hatch width", accessWidthMm: "Clear access width", cabinetWidthMm: "Cabinet opening width", cabinetHeightMm: "Cabinet opening height", cabinetDepthMm: "Cabinet opening depth", model: "Equipment and labels", measurement: "Measurements", limitationReason: "Observation limitation" };
  const name = names[key] || String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^\w/, (character) => character.toUpperCase());
  const unit = RENTAL_OBSERVATION_NUMBER_FIELDS[key];
  return unit ? `${name} (${unit})` : name;
}
/** @param {string[]} labels @returns {Array<{value: string, label: string}>} */
const choices = (labels) => labels.map((label) => ({ value: label, label }));
export const RENTAL_OBSERVATION_SELECT_OPTIONS = Object.freeze({
  accessStatus: choices(["Clear access", "Narrow or obstructed", "Not accessed"]),
  limitationStatus: choices(["No limitation", "Not accessible", "Unsafe to measure", "Label unreadable", "Other"]),
  insulationType: choices(["Batts", "Loose fill", "Foil", "None visible", "Unknown", "Other"]),
  insulationRating: choices(["None", "Below R5", "R5 or above", "Unknown"]),
  ventType: choices(["Wall grille", "Air brick", "Covered / sealed vent", "Mixed types", "Not sure"]),
  welsRating: choices(["Not labelled / unknown", "Below 3 stars", "3 stars", "4 stars or above"]),
});
const heaterOptions = choices(["Split system", "Ducted", "Gas heater", "Wood / solid fuel", "Other", "No heater", "Unknown"]);
const coolingOptions = choices(["Split system", "Ducted", "Evaporative", "Other", "No fixed cooling", "Unknown"]);
const hotWaterOptions = choices(["Heat pump", "Electric storage", "Gas storage", "Instant gas", "Solar", "Other", "Unknown"]);

/** @typedef {{ key: string, label: string, required: boolean, input: 'text'|'number'|'select'|'textarea', unit?: string, options?: Array<{value:string,label:string}>, showIf?: {key:string,values:string[]}, showForOutcomes?: string[], shared?: boolean, legacy?: boolean, requiredForAdverse?: boolean }} RentalObservationField */
/** @returns {RentalObservationField} */
const shortText = (key, label, extra = {}) => ({ key, label, required: false, input: "text", ...extra });
/** @returns {RentalObservationField} */
const selectField = (key, label, options, extra = {}) => ({ key, label, required: false, input: "select", options, ...extra });
/** @returns {RentalObservationField} */
const numberField = (key, label) => ({ key, label, required: false, input: "number", unit: RENTAL_OBSERVATION_NUMBER_FIELDS[key], requiredForAdverse: true });
const identityFields = () => [shortText("model", "Make / model from label (optional)", { shared: true }), shortText("serialNumber", "Serial number (optional)", { shared: true })];
const limitationFields = () => [selectField("limitationStatus", "Anything you could not check?", RENTAL_OBSERVATION_SELECT_OPTIONS.limitationStatus), shortText("limitationReason", "Brief reason", { showIf: { key: "limitationStatus", values: ["Other"] } })];
const roomFields = () => [numberField("roomLengthMetres", "Room length"), numberField("roomWidthMetres", "Room width"), numberField("roomHeightMetres", "Ceiling height")];
const heatingChecks = ["main_living_heater", "heater_operation", "heater_efficiency", "heating_2027_readiness"];

/** Explicit asset groups; heating and cooling are never assumed to be the same unit. */
export function rentalObservationGroup(checkKey) {
  if (heatingChecks.includes(checkKey)) return "primary_heater";
  if (["showerhead_rating", "shower_2027_readiness"].includes(checkKey)) return "showerhead";
  return "";
}

/** @returns {RentalObservationField[]} */
export function rentalObservationFields(checkKey) {
  if (heatingChecks.includes(checkKey)) return [
    selectField("applianceType", "Heater type", heaterOptions, { shared: true }), ...identityFields(),
    ...(checkKey === "heating_2027_readiness" ? [...roomFields(), selectField("accessStatus", "Access to heater", RENTAL_OBSERVATION_SELECT_OPTIONS.accessStatus), ...limitationFields()] : []),
    shortText("measurement", "Earlier measurement notes", { legacy: true }), shortText("actionTaken", "Earlier location notes", { legacy: true }),
    ...(checkKey !== "heating_2027_readiness" ? [shortText("limitationReason", "Earlier observation limitation", { legacy: true })] : []),
  ];
  if (checkKey === "switchboard_observation") return [shortText("model", "Board location / readable labels (optional)"), ...limitationFields()];
  if (checkKey === "showerhead_rating") return [selectField("welsRating", "Confirmed WELS rating", RENTAL_OBSERVATION_SELECT_OPTIONS.welsRating, { shared: true }), { ...numberField("flowLitresPerMinute", "Main shower flow (litres per minute)"), shared: true }, shortText("model", "Make / model from label (optional)", { shared: true }), ...limitationFields()];
  if (["appliance_identity_condition", "alarm_identity_location", "fixed_special_equipment"].includes(checkKey)) return [...identityFields(), ...limitationFields()];
  /** @type {Record<string, RentalObservationField[]>} */
  const specific = {
    cooktop_function: [...identityFields(), numberField("widthMm", "Cooktop width"), numberField("depthMm", "Cooktop depth"), numberField("workingBurners", "Working burners")],
    oven_function: [...identityFields(),
      ...[numberField("cabinetWidthMm", "Cabinet opening width, if safely visible"), numberField("cabinetHeightMm", "Cabinet opening height, if safely visible"), numberField("cabinetDepthMm", "Cabinet opening depth, if safely visible")]
        .map((field) => ({ ...field, showForOutcomes: ["does_not_meet"], requiredForAdverse: false })),
      ...[numberField("widthMm", "Earlier oven width"), numberField("heightMm", "Earlier oven height"), numberField("depthMm", "Earlier oven depth")].map((field) => ({ ...field, legacy: true, requiredForAdverse: false }))],
    ceiling_2027_readiness: [selectField("insulationRating", "Existing roof insulation", RENTAL_OBSERVATION_SELECT_OPTIONS.insulationRating), numberField("areaSquareMetres", "Total insulation required (square metres)"), shortText("model", "Product / R-value label, if readable")],
    windows_2027_readiness: [{ ...numberField("sealLengthMetres", "Total window draughtproofing length (metres)"), showForOutcomes: ["does_not_meet"] }],
    doors_2027_readiness: [numberField("count", "Total doors needing seals"), numberField("sealLengthMetres", "Total door draughtproofing length (metres)")].map((field) => ({ ...field, showForOutcomes: ["does_not_meet"] })),
    vents_2027_readiness: [selectField("ventType", "Wall vent type", RENTAL_OBSERVATION_SELECT_OPTIONS.ventType, { showForOutcomes: ["meets", "does_not_meet", "specialist_verification_required"] }), { ...numberField("count", "Total wall vents needing sealing"), showForOutcomes: ["does_not_meet", "specialist_verification_required"] }],
    shower_2027_readiness: [selectField("welsRating", "Confirmed WELS rating", RENTAL_OBSERVATION_SELECT_OPTIONS.welsRating, { shared: true }), { ...numberField("flowLitresPerMinute", "Main shower flow (litres per minute)"), shared: true }, shortText("model", "Make / model from label (optional)", { shared: true })],
    cooling_2027_readiness: [selectField("applianceType", "Cooling type", coolingOptions), ...identityFields(), ...roomFields(), selectField("accessStatus", "Access to equipment", RENTAL_OBSERVATION_SELECT_OPTIONS.accessStatus)],
    hot_water_2027_readiness: [selectField("applianceType", "Hot-water type", hotWaterOptions), ...identityFields(), numberField("widthMm", "Unit width"), numberField("heightMm", "Unit height"), numberField("accessWidthMm", "Clear access width"), selectField("accessStatus", "Access to equipment", RENTAL_OBSERVATION_SELECT_OPTIONS.accessStatus)],
    window_covering: [{ ...numberField("count", "Total coverings needing attention"), showForOutcomes: ["does_not_meet"] }],
  };
  if (!specific[checkKey]) return [];
  return [...specific[checkKey], ...limitationFields(), shortText("measurement", "Earlier measurement notes", { legacy: true }), ...(specific[checkKey].some((field) => field.key === "actionTaken") ? [] : [shortText("actionTaken", "Earlier location notes", { legacy: true })])];
}

/**
 * @param {{ key: string, responseType?: string, responseFields?: Array<{ key: string, label: string, required: boolean }> }} assessmentCheck
 * @returns {RentalObservationField[]}
 */
export function rentalAssessorFields(assessmentCheck) {
  if (["test_result", "action_record"].includes(assessmentCheck?.responseType)) return (assessmentCheck.responseFields || []).map((field) => ({ ...field, input: "textarea" }));
  const fields = rentalObservationFields(assessmentCheck?.key);
  return fields.length ? fields : (assessmentCheck?.responseFields || []).map((field) => ({ ...field, input: "text" }));
}

const normalizedLocation = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
/**
 * Candidate order is oldest to newest: server, queued, then local. Only safe identity fields carry.
 * @param {{target:{moduleId:string,sectionKey?:string,checkKey:string,instanceKey:string,locationLabel?:string},candidates:Array<{moduleId:string,sectionKey?:string,checkKey:string,instanceKey:string,locationLabel?:string,outcome?:string,response?:Record<string,unknown>}>,currentResponse?:Record<string,unknown>}} input
 */
export function rentalSharedObservationResponse({ target, candidates, currentResponse = {} }) {
  const response = { ...currentResponse };
  const group = rentalObservationGroup(target.checkKey);
  const inheritedKeys = [], recordedKeys = [];
  let sourceCheckKey = "";
  if (!group || !target.moduleId || !target.instanceKey) return { response, inheritedKeys, recordedKeys, sourceCheckKey };
  const location = normalizedLocation(target.locationLabel);
  if (!location && target.instanceKey !== "property") return { response, inheritedKeys, recordedKeys, sourceCheckKey };
  const sharedKeys = rentalObservationFields(target.checkKey).filter((field) => field.shared).map((field) => field.key);
  const seenChecks = new Set();
  for (const candidate of [...candidates].reverse()) {
    if (candidate.moduleId !== target.moduleId || candidate.instanceKey !== target.instanceKey
      || candidate.checkKey === target.checkKey || seenChecks.has(candidate.checkKey)) continue;
    seenChecks.add(candidate.checkKey);
    if (normalizedLocation(candidate.locationLabel) !== location || rentalObservationGroup(candidate.checkKey) !== group
      || !candidate.outcome || candidate.outcome === "not_assessed"
      || sharedKeys.some((key) => normalizedLocation(currentResponse[key]) && normalizedLocation(candidate.response?.[key])
        && normalizedLocation(currentResponse[key]) !== normalizedLocation(candidate.response[key]))) continue;
    for (const key of sharedKeys) {
      if (recordedKeys.includes(key) || !rentalObservationFields(candidate.checkKey).some((field) => field.shared && field.key === key)) continue;
      const value = candidate.response?.[key];
      // Older shower records did not capture these fields. A saved blank must
      // not hide the first opportunity to record the rating and flow.
      if (["welsRating", "flowLitresPerMinute"].includes(key) && (value === undefined || value === null || String(value).trim() === "")) continue;
      recordedKeys.push(key);
      sourceCheckKey ||= candidate.checkKey;
      if (!Object.hasOwn(currentResponse, key) && (typeof value === "string" && value.trim() || typeof value === "number" && Number.isFinite(value))) {
        response[key] = value;
        inheritedKeys.push(key);
      }
    }
  }
  return { response, inheritedKeys, recordedKeys, sourceCheckKey };
}

export function rentalFindingDescriptionLabel(outcome) {
  if (outcome === "not_accessible") return "What could not be checked, and why?";
  if (outcome === "specialist_verification_required") return "What could you see, and what needs checking?";
  if (outcome === "exemption_evidence_pending") return "What evidence is missing?";
  return "What did you notice?";
}

export function rentalObservationBlockers({ checkKey, outcome, response, finding }) {
  const blockers = [];
  const numericFields = rentalObservationFields(checkKey).filter((field) => field.input === "number");
  const numericValues = numericFields.filter((field) => String(response?.[field.key] ?? "").trim());
  const validNumber = (field) => rentalObservationNumberIsValid(response[field.key]);
  for (const field of numericValues.filter((field) => !validNumber(field))) blockers.push(`Enter a valid number for ${field.label.toLowerCase()}.`);
  const measurementNeeded = outcome === "does_not_meet"
    && numericFields.some((field) => field.requiredForAdverse);
  if (measurementNeeded && !String(response?.measurement || "").trim()
    && !numericValues.some(validNumber)
    && !String(response?.limitationReason || "").trim()
    && !["Not accessible", "Unsafe to measure"].includes(response?.limitationStatus)
    && !rentalQuotation(finding?.details?.quotation).measurements.trim()) {
    blockers.push("Record the basic measurements, or explain what you could not safely measure.");
  }
  return blockers;
}
