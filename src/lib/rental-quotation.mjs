/** Public, assessor-recorded information needed to price a finding. Stored with the finding snapshot. */
export const RENTAL_QUOTATION_FIELDS = Object.freeze([
  { key: "measurements", label: "Measurements and quantity basis", help: "Measured area, length or dimensions, with units and the method used. Identify each affected location." },
  { key: "specification", label: "Existing equipment and proposed specification", help: "Make/model, condition and required replacement performance or materials. State what is verified and what needs confirmation." },
  { key: "access", label: "Access and installation requirements", help: "Access opening, working height, roof or wall construction, services, isolation, obstructions and occupant arrangements. Record checks needed before work." },
  { key: "exclusions", label: "Inclusions, exclusions and allowances", help: "Include removal, disposal, making good and certificates. State any provisional allowance or work by another trade; enter None only when confirmed." },
]);

export function rentalQuotation(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(["status", ...RENTAL_QUOTATION_FIELDS.map((field) => field.key), "missingInformation"]
    .map((key) => [key, typeof source[key] === "string" ? source[key] : ""]));
}

export function rentalQuotationBlockers(finding, outcome, evidenceCount) {
  const quote = rentalQuotation(finding?.details?.quotation);
  if (quote.status === "further_information") {
    return quote.missingInformation.trim() ? [] : ["Record the missing information and who needs to confirm it."];
  }
  if (quote.status !== "ready") return ["Confirm whether this work can be quoted from the report or needs more information."];
  const blockers = [];
  if (quote.missingInformation.trim()) blockers.push("Resolve or clear the recorded missing information before marking this scope ready to quote.");
  if (["not_accessible", "specialist_verification_required", "exemption_evidence_pending"].includes(outcome)) {
    blockers.push("Unverified or inaccessible work needs further information before it can be marked ready to quote.");
  }
  for (const field of RENTAL_QUOTATION_FIELDS) if (!quote[field.key].trim()) blockers.push(`${field.label} is required for a quote-ready scope.`);
  if (!(Number(finding?.quantityMilli) > 0) || !String(finding?.unitLabel || "").trim()) blockers.push("Record the measured quantity and unit for the work.");
  if (evidenceCount < 2) blockers.push("Add at least two evidence files covering the work location and its detail before marking it ready to quote.");
  return blockers;
}

export function rentalQuotationGuidance(checkKey) {
  if (checkKey === "ceiling_2027_readiness") return "Insulation: measure each uninsulated area in m2; record existing coverage/depth, target R-value, hatch dimensions, roof clearance, downlights, wiring and obstructions. Include overview, measurement/sketch and close photos. Identify the required pre-installation electrical check.";
  if (/heater|heating|cooling/.test(checkKey)) return "Heating/cooling: record room dimensions and ceiling height, existing make/model and rating, proposed indoor/outdoor locations, pipe/cable route and length, drainage, access and electrical supply. Capacity and circuit suitability need qualified confirmation.";
  if (/hot_water/.test(checkKey)) return "Hot water: record existing make/model/capacity, connections, proposed location and clearances, pipe/cable distances, drainage, access and removal route. Record plumbing and electrical prerequisites.";
  if (/window|door|cord/.test(checkKey)) return "Openings: identify each room and opening; measure width/height or seal length, record material, frame/lock/covering type and mounting position. Photograph the whole opening and detail with a scale.";
  return "Capture an overview, close detail and measured scope. Record the equipment/materials, access, work included and anything a contractor must verify before pricing.";
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
