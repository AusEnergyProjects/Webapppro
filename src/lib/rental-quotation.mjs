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
  cabinetWidthMm: "mm", cabinetHeightMm: "mm", cabinetDepthMm: "mm", joistClearWidthMm: "mm",
  hotWaterCableRunMetres: "m", airconTotalCableMetres: "m", airconSwitchboardToOutdoorMetres: "m", airconOutdoorToIndoorMetres: "m", cooktopCableRunMetres: "m", nonIc4DownlightCount: "",
});
// A practical input bound for a clear joist gap, not a compliance threshold.
const joistClearWidthRange = Object.freeze({ min: 1, max: 5000, step: 1 });
export function rentalObservationNumberIsValid(value, key = "") {
  if (value === undefined || value === null) return true;
  if (key === "nonIc4DownlightCount") {
    if (typeof value !== "string" && typeof value !== "number") return false;
    const text = String(value).trim();
    return !text || (/^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) >= 0);
  }
  if (key === "joistClearWidthMm") {
    if (typeof value !== "string" && typeof value !== "number") return false;
    const text = String(value).trim();
    const number = Number(text);
    return !text || (/^\d+$/.test(text) && Number.isInteger(number)
      && number >= joistClearWidthRange.min && number <= joistClearWidthRange.max);
  }
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value !== "string") return false;
  const text = value.trim();
  return !text || (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) && Number.isFinite(Number(text)));
}
export function rentalObservationResponseLabel(key, checkKey = "") {
  if (key === "welsRating") return "Existing showerhead WELS rating";
  if (checkKey === "vents_2027_readiness") {
    if (key === "ventType") return "Wall vent type";
    if (key === "count") return "Number of wall vents needing sealing";
  }
  const names = { roomLengthMetres: "Room length", roomWidthMetres: "Room width", roomHeightMetres: "Ceiling height", widthMm: "Width", heightMm: "Height", depthMm: "Depth", areaSquareMetres: "Total insulation area required", sealLengthMetres: "Total draughtproofing length", flowLitresPerMinute: "Water flow", collectedLitres: "Water collected", flowSeconds: "Collection time", count: "Count", workingBurners: "Working burners", insulationDepthMm: "Insulation depth", hatchWidthMm: "Hatch width", accessWidthMm: "Clear access width", cabinetWidthMm: "Cabinet opening width", cabinetHeightMm: "Cabinet opening height", cabinetDepthMm: "Cabinet opening depth", joistClearWidthMm: "Clear gap between ceiling joists", model: "Equipment and labels", measurement: "Measurements", limitationReason: "Observation limitation" };
  const quotationNames = { hotWaterCableRunMetres: "Hot-water system to switchboard cable run", airconTotalCableMetres: "Earlier combined RCAC cable run", airconSwitchboardToOutdoorMetres: "Switchboard to proposed outdoor RCAC unit cable run", airconOutdoorToIndoorMetres: "Proposed outdoor RCAC unit to indoor unit distance", cooktopCableRunMetres: "Cooktop to switchboard cable run", cableMeasurementStatus: "Cable length basis", cableRouteBasis: "Cable route and measurement basis", cableLimitationReason: "Cable measurement limitation", nonIc4DownlightCount: "Confirmed non-IC4 downlight count", downlightCountStatus: "Non-IC4 downlight count status", downlightEvidence: "Downlight label / count evidence", downlightCountLimitation: "Downlight count limitation" };
  for (const mode of ["heating", "cooling"]) {
    const title = mode === "heating" ? "Heating" : "Cooling";
    Object.assign(quotationNames, { [`${mode}GemsStatus`]: `${title} energy-rating status`, [`${mode}EnergyRating`]: `${title} recorded rating or stars`, [`${mode}GemsReference`]: `${title} model / GEMS reference`, [`${mode}RatingZone`]: `${title} rating climate zone`, [`${mode}RatingBasis`]: `${title} rating evidence basis`, [`${mode}RatingLimitation`]: `${title} rating limitation` });
  }
  const name = names[key] || quotationNames[key] || String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^\w/, (character) => character.toUpperCase());
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
  cableMeasurementStatus: choices(["Measured", "Estimated", "Unable to determine"]),
  downlightCountStatus: choices(["Counted", "No downlights", "Unknown", "Unverified"]),
  heatingGemsStatus: choices(["Label recorded", "Not available", "Unreadable", "Unverified", "Not applicable"]),
  coolingGemsStatus: choices(["Label recorded", "Not available", "Unreadable", "Unverified", "Not applicable"]),
  heatingRatingZone: choices(["Hot", "Average", "Cold", "Multiple zones (record each rating)", "Not shown / legacy label"]),
  coolingRatingZone: choices(["Hot", "Average", "Cold", "Multiple zones (record each rating)", "Not shown / legacy label"]),
  heatingRatingBasis: choices(["Appliance label", "GEMS registration", "Other evidence"]),
  coolingRatingBasis: choices(["Appliance label", "GEMS registration", "Other evidence"]),
  hotWaterSupplyType: choices(["Individual unit", "Shared building system", "Unknown"]),
  sharedHotWaterServiceStatus: choices(["Hot water supplied when checked", "No hot water when checked", "Not checked"]),
});
const heaterOptions = choices(["Split system", "Ducted", "Gas heater", "Wood / solid fuel", "Other", "No heater", "Unknown"]);
const coolingOptions = choices(["Split system", "Ducted", "Evaporative", "Other", "No fixed cooling", "Unknown"]);
const hotWaterOptions = choices(["Heat pump", "Electric storage", "Gas storage", "Instant gas", "Solar", "Other", "Unknown"]);

/** @typedef {{ key: string, label: string, required: boolean, input: 'text'|'number'|'select'|'textarea', captureVersion?: number, help?: string, unit?: string, min?: number, max?: number, step?: number, options?: Array<{value:string,label:string}>, showIf?: {key:string,values:string[]}, showIfAll?: Array<{key:string,values:string[]}>, showForOutcomes?: string[], shared?: boolean, legacy?: boolean, requiredForAdverse?: boolean }} RentalObservationField */
/** @returns {RentalObservationField} */
const shortText = (key, label, extra = {}) => ({ key, label, required: false, input: "text", ...extra });
/** @returns {RentalObservationField} */
const selectField = (key, label, options, extra = {}) => ({ key, label, required: false, input: "select", options, ...extra });
/** @returns {RentalObservationField} */
const numberField = (key, label) => ({ key, label, required: false, input: "number", unit: RENTAL_OBSERVATION_NUMBER_FIELDS[key], requiredForAdverse: true });
const identityFields = () => [shortText("model", "Make / model from label (optional)", { shared: true }), shortText("serialNumber", "Serial number (optional)", { shared: true })];
const limitationFields = (reasonStatuses = ["Other"]) => [selectField("limitationStatus", "Anything you could not check?", RENTAL_OBSERVATION_SELECT_OPTIONS.limitationStatus), shortText("limitationReason", "Brief reason", { showIf: { key: "limitationStatus", values: reasonStatuses } })];
const roomFields = () => [numberField("roomLengthMetres", "Room length"), numberField("roomWidthMetres", "Room width"), numberField("roomHeightMetres", "Ceiling height")];
const heatingChecks = ["main_living_heater", "heater_operation", "heater_efficiency", "heating_2027_readiness"];
const rcacCableKeys = ["cableMeasurementStatus", "airconTotalCableMetres", "airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres", "cableRouteBasis", "cableLimitationReason"];
const cableLengthKey = (checkKey) => checkKey === "hot_water_2027_readiness" ? "hotWaterCableRunMetres"
  : checkKey === "cooktop_function" ? "cooktopCableRunMetres"
    : checkKey === "heating_2027_readiness" ? "airconSwitchboardToOutdoorMetres"
      : checkKey === "main_living_heater" ? "airconTotalCableMetres" : "";
/** @returns {RentalObservationField[]} */
const cableFields = (checkKey) => {
  const appliance = checkKey === "hot_water_2027_readiness" ? "hot-water system" : checkKey === "cooktop_function" ? "cooktop" : "RCAC";
  const rcac = ["main_living_heater", "heating_2027_readiness"].includes(checkKey);
  const earlierHeater = checkKey === "main_living_heater";
  return [
    selectField("cableMeasurementStatus", rcac ? "Are the proposed RCAC distances measured or estimated?" : `Can you measure or estimate the cable run from the ${appliance} to the switchboard?`, RENTAL_OBSERVATION_SELECT_OPTIONS.cableMeasurementStatus, { help: rcac ? "For quoting a future installation, use the proposed unit positions even if no RCAC is installed." : "Record a safe observation for quoting. An electrician must confirm the route, cable size and circuit before installation." }),
    { ...numberField(cableLengthKey(checkKey), rcac ? earlierHeater ? "Earlier combined RCAC cable run" : "Estimated cable run from the switchboard to the proposed outdoor RCAC unit" : `How far is the cable run from the ${appliance} to the switchboard?`), requiredForAdverse: false, showIf: { key: "cableMeasurementStatus", values: ["Measured", "Estimated"] } },
    ...(!rcac || earlierHeater ? [] : [
      { ...numberField("airconOutdoorToIndoorMetres", "Estimated distance from the proposed outdoor RCAC unit to the indoor unit"), requiredForAdverse: false, showIf: { key: "cableMeasurementStatus", values: ["Measured", "Estimated"] }, help: "Use the proposed connection route, including rises and drops." },
      { ...numberField("airconTotalCableMetres", "Earlier combined RCAC cable run"), requiredForAdverse: false, legacy: true, showIf: { key: "cableMeasurementStatus", values: ["Measured", "Estimated"] } },
    ]),
    shortText("cableRouteBasis", "Where would the cable run?", { showIf: { key: "cableMeasurementStatus", values: ["Measured", "Estimated"] }, help: rcac ? "Describe the proposed switchboard-to-outdoor-unit route and the separate outdoor-to-indoor connection route. Include rises and drops in each distance." : "State the proposed switchboard-to-appliance route, rises and drops, and how the length was measured or estimated." }),
    shortText("cableLimitationReason", "Why could the cable length not be determined?", { showIf: { key: "cableMeasurementStatus", values: ["Unable to determine"] } }),
  ].map((field) => ({ ...field, captureVersion: 4, ...(rcac ? { shared: true } : {}), ...(earlierHeater ? { legacy: true } : {}) }));
};
const gemsAppliances = { heating: ["Split system", "Ducted", "Other", "Unknown"], cooling: ["Split system", "Ducted", "Evaporative", "Other", "Unknown"] };
/** @param {'heating'|'cooling'} mode @returns {RentalObservationField[]} */
const legacyEnergyRatingFields = (mode) => {
  const statusKey = `${mode}GemsStatus`;
  const applianceCondition = { key: "applianceType", values: gemsAppliances[mode] };
  const extra = { showIfAll: [applianceCondition], legacy: true };
  return [
    selectField(statusKey, `${mode === "heating" ? "Heating" : "Cooling"} GEMS / energy-rating label status`, RENTAL_OBSERVATION_SELECT_OPTIONS[statusKey], { ...extra, help: "Record the actual appliance label or registration evidence. Leave the rating unknown when it is unavailable; this observation does not determine legal compliance." }),
    shortText(`${mode}EnergyRating`, `${mode === "heating" ? "Heating" : "Cooling"} rating or stars from the label`, { ...extra, showIf: { key: statusKey, values: ["Label recorded"] }, help: "Copy the rating and its units or stars exactly. State the climate zone where the label distinguishes zones." }),
    selectField(`${mode}RatingZone`, "Rating climate zone", RENTAL_OBSERVATION_SELECT_OPTIONS[`${mode}RatingZone`], { ...extra, showIf: { key: statusKey, values: ["Label recorded"] } }),
    selectField(`${mode}RatingBasis`, "Rating evidence basis", RENTAL_OBSERVATION_SELECT_OPTIONS[`${mode}RatingBasis`], { ...extra, showIf: { key: statusKey, values: ["Label recorded"] } }),
    shortText(`${mode}GemsReference`, "Model / GEMS registration reference (optional)", { ...extra, showIf: { key: statusKey, values: ["Label recorded"] } }),
    shortText(`${mode}RatingLimitation`, "Why was the rating not recorded or not applicable?", { ...extra, showIf: { key: statusKey, values: ["Not available", "Unreadable", "Unverified", "Not applicable"] } }),
  ].map((field) => ({ ...field, captureVersion: 4 }));
};
/** @returns {RentalObservationField[]} */
const hotWaterFields = () => [
  selectField("hotWaterSupplyType", "Hot-water supply", RENTAL_OBSERVATION_SELECT_OPTIONS.hotWaterSupplyType, { captureVersion: 4, help: "A shared building plant is separate from checking hot-water supply at this apartment. Shared supply alone does not confirm the plant's efficiency or create an exemption." }),
  selectField("sharedHotWaterServiceStatus", "Hot-water supply observed in this apartment", RENTAL_OBSERVATION_SELECT_OPTIONS.sharedHotWaterServiceStatus, { captureVersion: 4, showIf: { key: "hotWaterSupplyType", values: ["Shared building system"] } }),
  shortText("sharedHotWaterLimitation", "Shared plant inspection limitation", { captureVersion: 4, showIf: { key: "hotWaterSupplyType", values: ["Shared building system"] }, help: "Record that the building plant was not inspected and what access or information is needed. Describe only the apartment supply you actually checked." }),
  ...[selectField("applianceType", "Hot-water type", hotWaterOptions), ...identityFields(), numberField("widthMm", "Unit width"), numberField("heightMm", "Unit height"), numberField("accessWidthMm", "Clear access width"), selectField("accessStatus", "Access to equipment", RENTAL_OBSERVATION_SELECT_OPTIONS.accessStatus), ...cableFields("hot_water_2027_readiness")]
    .map((field) => ({ ...field, showIfAll: [...(field.showIfAll || []), { key: "hotWaterSupplyType", values: ["", "Individual unit", "Unknown"] }] })),
];

/** Current answer controls visibility; retained earlier values do not reopen an inactive branch. */
export function rentalObservationFieldIsVisible(field, { outcome, response = {} }) {
  return (!field.showForOutcomes || field.showForOutcomes.includes(outcome))
    && (!field.showIf || field.showIf.values.includes(String(response[field.showIf.key] || "")))
    && (!field.showIfAll || field.showIfAll.every((condition) => condition.values.includes(String(response[condition.key] || ""))));
}

/** Split current observations from retained inactive answers without deleting either. */
export function rentalObservationResponseProjection(checkKey, outcome, response = {}, visibilityResponse = response) {
  const fields = rentalObservationFields(checkKey);
  const inactiveKeys = new Set(fields.filter((field) => !rentalObservationFieldIsVisible(field, { outcome, response: visibilityResponse })).map((field) => field.key));
  return {
    response: Object.fromEntries(Object.entries(response).filter(([key]) => !inactiveKeys.has(key))),
    retainedResponse: Object.fromEntries(Object.entries(response).filter(([key]) => inactiveKeys.has(key))),
  };
}

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
    ...(["main_living_heater", "heating_2027_readiness"].includes(checkKey) ? cableFields(checkKey) : []),
    ...(["heater_efficiency", "heating_2027_readiness"].includes(checkKey) ? legacyEnergyRatingFields("heating") : []),
    shortText("measurement", "Earlier measurement notes", { legacy: true }), shortText("actionTaken", "Earlier location notes", { legacy: true }),
    ...(checkKey !== "heating_2027_readiness" ? [shortText("limitationReason", "Earlier observation limitation", { legacy: true })] : []),
  ];
  if (checkKey === "switchboard_observation") return [shortText("model", "Board location / readable labels (optional)"), ...limitationFields()];
  if (checkKey === "showerhead_rating") return [selectField("welsRating", "Confirmed WELS rating", RENTAL_OBSERVATION_SELECT_OPTIONS.welsRating, { shared: true }), { ...numberField("flowLitresPerMinute", "Main shower flow (litres per minute)"), shared: true }, shortText("model", "Make / model from label (optional)", { shared: true }), ...limitationFields()];
  if (["appliance_identity_condition", "alarm_identity_location", "fixed_special_equipment"].includes(checkKey)) return [...identityFields(), ...limitationFields()];
  /** @type {Record<string, RentalObservationField[]>} */
  const specific = {
    cooktop_function: [...identityFields(), numberField("widthMm", "Cooktop width"), numberField("depthMm", "Cooktop depth"), numberField("workingBurners", "Working burners"), ...cableFields(checkKey)],
    artificial_lighting: [selectField("downlightCountStatus", "Non-IC4 downlight count status", RENTAL_OBSERVATION_SELECT_OPTIONS.downlightCountStatus),
      { ...numberField("nonIc4DownlightCount", "Confirmed non-IC4 downlight count"), min: 0, max: Number.MAX_SAFE_INTEGER, step: 1, requiredForAdverse: false, showIf: { key: "downlightCountStatus", values: ["Counted"] }, help: "Count only downlights confirmed as non-IC4 from readable labels or reliable evidence. Enter 0 only when none are confirmed; an unknown rating is not a confirmed count." },
      shortText("downlightEvidence", "Downlight label / count evidence", { legacy: true, showIf: { key: "downlightCountStatus", values: ["Counted"] } }),
      shortText("downlightCountLimitation", "Why is the non-IC4 count unknown or unverified?", { showIf: { key: "downlightCountStatus", values: ["Unknown", "Unverified"] } })].map((field) => ({ ...field, captureVersion: 4 })),
    oven_function: [...identityFields(),
      ...[numberField("cabinetWidthMm", "Cabinet opening width, if safely visible"), numberField("cabinetHeightMm", "Cabinet opening height, if safely visible"), numberField("cabinetDepthMm", "Cabinet opening depth, if safely visible")]
        .map((field) => ({ ...field, showForOutcomes: ["does_not_meet"], requiredForAdverse: false })),
      ...[numberField("widthMm", "Earlier oven width"), numberField("heightMm", "Earlier oven height"), numberField("depthMm", "Earlier oven depth")].map((field) => ({ ...field, legacy: true, requiredForAdverse: false }))],
    ceiling_2027_readiness: [selectField("insulationRating", "Existing roof insulation", RENTAL_OBSERVATION_SELECT_OPTIONS.insulationRating), numberField("areaSquareMetres", "Total insulation required (square metres)"), { ...numberField("joistClearWidthMm", "Clear gap between ceiling joists"), ...joistClearWidthRange, requiredForAdverse: false }, shortText("model", "Product / R-value label, if readable")],
    windows_2027_readiness: [{ ...numberField("sealLengthMetres", "Total window draughtproofing length (metres)"), showForOutcomes: ["does_not_meet"] }],
    doors_2027_readiness: [numberField("count", "Total doors needing seals"), numberField("sealLengthMetres", "Total door draughtproofing length (metres)")].map((field) => ({ ...field, showForOutcomes: ["does_not_meet"] })),
    vents_2027_readiness: [selectField("ventType", "Wall vent type", RENTAL_OBSERVATION_SELECT_OPTIONS.ventType, { showForOutcomes: ["meets", "does_not_meet", "specialist_verification_required"] }), { ...numberField("count", "Total wall vents needing sealing"), showForOutcomes: ["does_not_meet", "specialist_verification_required"] }],
    shower_2027_readiness: [selectField("welsRating", "Confirmed WELS rating", RENTAL_OBSERVATION_SELECT_OPTIONS.welsRating, { shared: true }), { ...numberField("flowLitresPerMinute", "Main shower flow (litres per minute)"), shared: true }, shortText("model", "Make / model from label (optional)", { shared: true })],
    cooling_2027_readiness: [selectField("applianceType", "Cooling type", coolingOptions), ...identityFields(), ...legacyEnergyRatingFields("cooling"), ...roomFields(), selectField("accessStatus", "Access to equipment", RENTAL_OBSERVATION_SELECT_OPTIONS.accessStatus)],
    hot_water_2027_readiness: hotWaterFields(),
    window_covering: [{ ...numberField("count", "Total coverings needing attention"), showForOutcomes: ["does_not_meet"] }],
  };
  if (!specific[checkKey]) return [];
  const limitations = limitationFields(checkKey === "ceiling_2027_readiness" ? ["Not accessible", "Unsafe to measure", "Other"] : undefined)
    .map((field) => checkKey === "hot_water_2027_readiness" ? { ...field, showIfAll: [{ key: "hotWaterSupplyType", values: ["", "Individual unit", "Unknown"] }] } : field);
  return [...specific[checkKey], ...limitations, shortText("measurement", "Earlier measurement notes", { legacy: true }), ...(specific[checkKey].some((field) => field.key === "actionTaken") ? [] : [shortText("actionTaken", "Earlier location notes", { legacy: true })])];
}

/**
 * @param {{ key: string, responseType?: string, responseFields?: Array<{ key: string, label: string, required: boolean }> }} assessmentCheck
 * @returns {RentalObservationField[]}
 */
export function rentalAssessorFields(assessmentCheck, { templateVersion = 4 } = {}) {
  if (["test_result", "action_record"].includes(assessmentCheck?.responseType)) return (assessmentCheck.responseFields || []).map((field) => ({ ...field, input: "textarea" }));
  const fields = rentalObservationFields(assessmentCheck?.key);
  // Earlier active assessments may record quoting measurements without replacing their frozen template or completion contract.
  const lengthKey = cableLengthKey(assessmentCheck?.key);
  const cableKeys = new Set(lengthKey ? heatingChecks.includes(assessmentCheck?.key) ? rcacCableKeys : ["cableMeasurementStatus", lengthKey, "cableRouteBasis", "cableLimitationReason"] : []);
  return fields.length ? fields.filter((field) => !field.captureVersion || templateVersion >= field.captureVersion || cableKeys.has(field.key))
    : (assessmentCheck?.responseFields || []).map((field) => ({ ...field, input: "text" }));
}

const normalizedLocation = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
/**
 * Candidate order is oldest to newest: server, queued, then local. Only shared observations carry; assessment results remain independent.
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
  const sharedCableKeys = group === "primary_heater" ? rcacCableKeys : [];
  const seenChecks = new Set();
  for (const candidate of [...candidates].reverse()) {
    if (candidate.moduleId !== target.moduleId || candidate.instanceKey !== target.instanceKey
      || candidate.checkKey === target.checkKey || seenChecks.has(candidate.checkKey)) continue;
    seenChecks.add(candidate.checkKey);
    if (normalizedLocation(candidate.locationLabel) !== location || rentalObservationGroup(candidate.checkKey) !== group
      || !candidate.outcome || candidate.outcome === "not_assessed"
      || sharedKeys.some((key) => !sharedCableKeys.includes(key) && normalizedLocation(currentResponse[key]) && normalizedLocation(candidate.response?.[key])
        && normalizedLocation(currentResponse[key]) !== normalizedLocation(candidate.response[key]))) continue;
    for (const key of sharedKeys) {
      if (recordedKeys.includes(key) || !rentalObservationFields(candidate.checkKey).some((field) => field.shared && field.key === key)) continue;
      const value = candidate.response?.[key];
      // Earlier records did not capture these observations. A saved blank must
      // not hide the first opportunity to record the rating, flow or cable run.
      if (["welsRating", "flowLitresPerMinute", ...sharedCableKeys].includes(key) && (value === undefined || value === null || String(value).trim() === "")) continue;
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

export function rentalObservationBlockers({ checkKey, outcome, response, finding, enforceQuoteCapture = false }) {
  const blockers = [];
  const recordedResponse = response || {};
  const currentResponse = rentalObservationResponseProjection(checkKey, outcome, response || {}).response;
  response = currentResponse;
  const numericFields = rentalObservationFields(checkKey).filter((field) => field.input === "number" && rentalObservationFieldIsVisible(field, { outcome, response }));
  const numericValues = numericFields.filter((field) => String(response?.[field.key] ?? "").trim());
  const validNumber = (field) => rentalObservationNumberIsValid(response[field.key], field.key);
  for (const field of numericValues.filter((field) => !validNumber(field))) blockers.push(field.step === 1
    ? `Enter a whole number between ${field.min} and ${field.max} ${field.unit} for ${field.label.toLowerCase()}.`
    : `Enter a valid number for ${field.label.toLowerCase()}.`);
  const measurementNeeded = outcome === "does_not_meet"
    && numericFields.some((field) => field.requiredForAdverse);
  if (measurementNeeded && !String(response?.measurement || "").trim()
    // The optional joist gap is quoting information, not a substitute for the existing area observation.
    && !numericValues.some((field) => field.requiredForAdverse && validNumber(field))
    && !String(response?.limitationReason || "").trim()
    && !(recordedResponse.limitationStatus === undefined && String(recordedResponse.limitationReason || "").trim())
    && !["Not accessible", "Unsafe to measure"].includes(response?.limitationStatus)
    && !rentalQuotation(finding?.details?.quotation).measurements.trim()) {
    blockers.push("Record the basic measurements, or explain what you could not safely measure.");
  }
  if (enforceQuoteCapture && !["not_assessed", "not_applicable"].includes(outcome)) {
    const lengthKey = cableLengthKey(checkKey);
    const sharedHotWater = checkKey === "hot_water_2027_readiness" && response.hotWaterSupplyType === "Shared building system";
    const cableNeeded = lengthKey && checkKey !== "main_living_heater" && !sharedHotWater;
    if (cableNeeded) {
      const status = response.cableMeasurementStatus;
      if (!RENTAL_OBSERVATION_SELECT_OPTIONS.cableMeasurementStatus.some((option) => option.value === status)) blockers.push("Record whether the cable length was measured, estimated or unable to be determined.");
      else if (status === "Unable to determine") {
        if (!String(response.cableLimitationReason || "").trim()) blockers.push("Explain why the cable length could not be determined.");
      } else {
        // Preserve the completion contract of saved v4 assessments. The earlier
        // combined total is never inferred as either newly separated segment.
        const legacyRcacLength = checkKey === "heating_2027_readiness" && String(response.airconTotalCableMetres ?? "").trim();
        if (!String(response[lengthKey] ?? "").trim() && !legacyRcacLength) blockers.push("Record the cable length in metres.");
        if (!String(response.cableRouteBasis || "").trim()) blockers.push("State the cable route and measurement or estimate basis.");
      }
    }
    if (checkKey === "artificial_lighting") {
      const status = response.downlightCountStatus;
      if (!RENTAL_OBSERVATION_SELECT_OPTIONS.downlightCountStatus.some((option) => option.value === status)) blockers.push("Record the confirmed non-IC4 downlight count, or its unknown or unverified status.");
      else if (status === "Counted") {
        if (!String(response.nonIc4DownlightCount ?? "").trim()) blockers.push("Record the whole non-IC4 downlight count, including zero when confirmed.");
      } else if (["Unknown", "Unverified"].includes(status) && !String(response.downlightCountLimitation || "").trim()) blockers.push("Explain why the non-IC4 downlight count is unknown or unverified.");
    }
    if (sharedHotWater) {
      if (!RENTAL_OBSERVATION_SELECT_OPTIONS.sharedHotWaterServiceStatus.some((option) => option.value === response.sharedHotWaterServiceStatus)) blockers.push("Record only the hot-water supply observed in this apartment.");
      if (!String(response.sharedHotWaterLimitation || "").trim()) blockers.push("Record that the shared building plant was not inspected and what needs confirmation.");
      if (outcome === "meets" && response.sharedHotWaterServiceStatus === "No hot water when checked") blockers.push("No hot water was supplied when checked. Record the apartment supply as needing action.");
      if (outcome === "meets" && response.sharedHotWaterServiceStatus === "Not checked") blockers.push("The apartment hot-water supply was not checked. Record that it could not be checked or needs verification.");
    }
  }
  return blockers;
}
