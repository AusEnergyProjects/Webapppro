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

export function rentalQuotationBlockers(finding, evidenceCount) {
  const quote = rentalQuotation(finding?.details?.quotation);
  const blockers = [];
  for (const field of RENTAL_QUOTATION_FIELDS) if (!quote[field.key].trim()) blockers.push(`${field.label} is required so the work can be quoted from this assessment.`);
  if (!(Number(finding?.quantityMilli) > 0) || !String(finding?.unitLabel || "").trim()) blockers.push("Record the quantity and unit for the measured work or defined testing service.");
  if (!(Number(evidenceCount) >= 2)) blockers.push("Add at least two photos showing the work location and close detail before finalising the assessment.");
  return blockers;
}

export function rentalQuotationGuidance(checkKey) {
  if (checkKey === "ceiling_2027_readiness") return "Insulation: measure each uninsulated area in m2; record existing coverage/depth, target R-value, hatch dimensions, roof clearance, downlights, wiring and obstructions. Include overview, measurement/sketch and close photos. Identify the required pre-installation electrical check.";
  if (/heater|heating|cooling/.test(checkKey)) return "Heating/cooling: record room dimensions and ceiling height, existing make/model and rating, proposed indoor/outdoor locations, pipe/cable route and length, drainage, access and electrical supply. Capacity and circuit suitability need qualified confirmation.";
  if (/hot_water/.test(checkKey)) return "Hot water: record existing make/model/capacity, connections, proposed location and clearances, pipe/cable distances, drainage, access and removal route. Record plumbing and electrical prerequisites.";
  if (/window|door|cord/.test(checkKey)) return "Openings: identify each room and opening; measure width/height or seal length, record material, frame/lock/covering type and mounting position. Photograph the whole opening and detail with a scale.";
  return "Capture an overview, close detail and measured scope. Record the equipment/materials, access, work included and explicit allowances for concealed conditions. The report must contain the information needed to quote.";
}

export function rentalObservationFields(checkKey) {
  const measurements = {
    switchboard_observation: "Visible main-switch rating and phase label, board location and readable circuit schedule photo. Unknown if not labelled; do not remove covers.",
    cooktop_function: "Appliance/recess width, height and depth (mm), working burner count, visible socket/isolator and any cabinetry changes",
    oven_function: "Appliance/recess width, height and depth (mm), visible connection/isolator and approximate accessible service route",
    ceiling_2027_readiness: "Uninsulated area (m2), how measured, existing insulation depth and hatch size (mm)",
    windows_2027_readiness: "Window locations, total seal/tape length (metres) and gap sizes (mm)",
    doors_2027_readiness: "Door locations and widths (mm), perimeter seal length (metres) and number of door-bottom seals",
    vents_2027_readiness: "Vent locations, count and opening dimensions (mm)",
    shower_2027_readiness: "Measured water flow (litres/minute), collected volume and timed seconds",
    heating_2027_readiness: "Equipment width/height/depth (mm), room length/width/height (metres) and possible replacement location",
    cooling_2027_readiness: "Equipment dimensions (mm), room dimensions (metres) and possible indoor/outdoor locations",
    hot_water_2027_readiness: "Cylinder/equipment dimensions (mm), label capacity (litres), available space and access width (mm)",
  };
  if (!measurements[checkKey]) return [];
  return [
    ...( /^(heating|cooling|hot_water|shower|cooktop|oven)_/.test(checkKey) ? [{ key: "model", label: "Existing equipment: fuel/type, make/model/serial and readable label photo reference", required: false }] : []),
    { key: "measurement", label: measurements[checkKey], required: false },
    ...(/^(heating|cooling|hot_water)_/.test(checkKey) ? [{ key: "actionTaken", label: checkKey.startsWith("hot_water") ? "Proposed location and delivery/removal route: steps, narrow points, fencing, vegetation, ground works and nearby windows/neighbours. Photograph the route." : "Equipment to retain/remove, visible flues or penetrations and making good. Photograph affected walls and the proposed locations.", required: false }] : []),
    ...(checkKey === "ceiling_2027_readiness" ? [{ key: "model", label: "Existing insulation material and readable R-value/product-label evidence, or Unknown. Depth alone does not prove R-value.", required: false }] : []),
    { key: "limitationReason", label: "Anything you could not safely identify or measure, and why", required: false },
  ];
}
