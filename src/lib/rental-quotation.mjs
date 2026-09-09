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

export function rentalObservationFields(checkKey) {
  const measurements = {
    cooktop_function: "Cooktop width and depth (mm), and how many burners worked",
    oven_function: "Oven and accessible opening width, height and depth (mm)",
    ceiling_2027_readiness: "Bare ceiling area (m2) and how you measured it; visible insulation depth and hatch width (mm), if accessible",
    windows_2027_readiness: "Which windows have gaps? Record their width, height and affected edge lengths (mm or metres)",
    doors_2027_readiness: "Which doors have gaps? Record door width and affected edge lengths (mm or metres)",
    vents_2027_readiness: "Vent locations, number and opening width and height (mm)",
    shower_2027_readiness: "Water flow (litres/minute), collected water volume and timed seconds, if tested",
    heating_2027_readiness: "Living room length, width and height (metres)",
    cooling_2027_readiness: "Living room length, width and height (metres)",
    hot_water_2027_readiness: "Existing unit width and height, nearby clear space and access width (mm), if accessible",
    window_covering: "Window location, width and height (mm)",
  };
  if (checkKey === "switchboard_observation") return [
    { key: "model", label: "Board location and any readable labels. Write Unknown for hidden or unreadable details; leave covers in place.", required: false },
    { key: "limitationReason", label: "Anything you could not safely see, and why", required: false },
  ];
  if (["main_living_heater", "heater_operation", "heater_efficiency", "showerhead_rating", "appliance_identity_condition", "alarm_identity_location", "fixed_special_equipment"].includes(checkKey)) return [
    { key: "model", label: "Equipment type, make, model and any readable rating or date from its label, or Unknown. Add a label photo when readable.", required: false },
    { key: "serialNumber", label: "Serial number, if readable", required: false },
    { key: "limitationReason", label: "Anything you could not safely see or check, and why", required: false },
  ];
  if (!measurements[checkKey]) return [];
  return [
    ...(/^(heating|cooling|hot_water|shower|cooktop|oven)_/.test(checkKey) ? [{ key: "model", label: "Existing equipment type, make and model from its label, or Unknown. Add a label photo when readable.", required: false }] : []),
    { key: "measurement", label: measurements[checkKey], required: false, requiredForAdverse: true },
    ...(/^(heating|cooling|hot_water)_/.test(checkKey) ? [{ key: "actionTaken", label: "Where is the equipment? Note visible access obstacles, such as steps or a narrow gate.", required: false }] : []),
    ...(checkKey === "ceiling_2027_readiness" ? [{ key: "model", label: "Visible insulation material and any readable product or R-value label, or Unknown. Depth alone does not prove R-value.", required: false }] : []),
    { key: "limitationReason", label: "Anything you could not safely identify or measure, and why", required: false },
  ];
}

/**
 * Use current capture wording for drafts, without replacing licensed test/action requirements.
 * @param {{ key: string, responseType?: string, responseFields?: Array<{ key: string, label: string, required: boolean }> }} assessmentCheck
 * @returns {Array<{ key: string, label: string, required: boolean, requiredForAdverse?: boolean }>}
 */
export function rentalAssessorFields(assessmentCheck) {
  if (["test_result", "action_record"].includes(assessmentCheck?.responseType)) return assessmentCheck.responseFields || [];
  const fields = rentalObservationFields(assessmentCheck?.key);
  return fields.length ? fields : (assessmentCheck?.responseFields || []);
}

export function rentalFindingDescriptionLabel(outcome) {
  if (outcome === "not_accessible") return "What could not be checked, and why?";
  if (outcome === "specialist_verification_required") return "What could you see, and what needs checking?";
  if (outcome === "exemption_evidence_pending") return "What evidence is missing?";
  return "What did you notice?";
}

export function rentalObservationBlockers({ checkKey, outcome, response, finding, photoCount }) {
  const blockers = [];
  if (!(Number(photoCount) >= 2)) blockers.push("Add an overview photo and a close photo of the affected area before completing the assessment.");
  const measurementNeeded = outcome === "does_not_meet"
    && rentalObservationFields(checkKey).some((field) => field.requiredForAdverse);
  if (measurementNeeded && !String(response?.measurement || "").trim()
    && !String(response?.limitationReason || "").trim()
    && !rentalQuotation(finding?.details?.quotation).measurements.trim()) {
    blockers.push("Record the basic measurements, or explain what you could not safely measure.");
  }
  return blockers;
}
