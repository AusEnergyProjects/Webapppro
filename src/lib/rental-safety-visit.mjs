/** Versioned visit scope. A visit records performed work, never future plan entitlements. */
export const RENTAL_SAFETY_TEMPLATE_VERSION = 4;
/** @typedef {'minimum_standards'|'electrical_safety_check'|'gas_safety_check'|'smoke_alarm_check'} RentalModuleKey */
/** @type {ReadonlyArray<{key:string,label:string,moduleKeys:ReadonlyArray<RentalModuleKey>}>} */
export const RENTAL_VISIT_PRESETS = Object.freeze([
  { key: "smoke_blinds_visit", label: "Smoke alarm and blind safety visit", moduleKeys: Object.freeze(["smoke_alarm_check"]) },
  { key: "electrical_smoke_blinds_visit", label: "Electrical, smoke alarm and blind safety visit", moduleKeys: Object.freeze(["electrical_safety_check", "smoke_alarm_check"]) },
  { key: "gas_smoke_blinds_visit", label: "Gas, smoke alarm and blind safety visit", moduleKeys: Object.freeze(["gas_safety_check", "smoke_alarm_check"]) },
].map(Object.freeze));
export const rentalVisitPreset = (key) => RENTAL_VISIT_PRESETS.find((entry) => entry.key === key) || null;
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = (key, label) => ({ key, label, required: false });
const prompts = {
  mains_switchboards_earthing: "Are the mains, switchboard, protection, earthing and bonding satisfactory?",
  wiring_outlets_lighting: "Are the inspected wiring, outlets, switches and lights satisfactory?",
  fixed_special_equipment: "Is the inspected fixed or special equipment satisfactory?",
  polarity_connections: "Did the polarity and connection tests pass?",
  earth_continuity: "Did the protective earthing continuity tests pass?",
  rcd_testing: "Did this circuit's RCD button and timed tests pass?",
  defects_and_actions: "Have defects, actions and any repair certificates been recorded?",
  supply_components: "Are the inspected gas supply and installation components satisfactory?",
  gas_tightness: "Did the gas installation tightness test pass?",
  appliance_identity_condition: "Are this appliance's identity, installation and condition satisfactory?",
  appliance_combustion_flue: "Did the applicable ventilation, flue, combustion and spillage checks pass?",
  appliance_service_record: "Is this appliance's complete authenticated AS 4575 service record attached?",
  critical_fault_actions: "Have gas faults, make-safe actions and notifications been recorded?",
  alarm_identity_location: "Is this alarm's identity, location, age and condition satisfactory?",
  alarm_operation: "Did the alarm pass the manufacturer's prescribed test?",
  alarm_interconnection: "Did the required alarm interconnection test pass?",
  alarm_repairs_replacement: "Have cleaning, battery work, repairs and the final test been recorded?",
};
/** Only called when creating a NEW frozen safety snapshot. */
export function rentalSafetyVisitTemplate(module, cordCheck) {
  const next = structuredClone(module);
  next.safetyVisitVersion = 1;
  next.sections = next.sections.map((section) => ({ ...section, checks: section.checks.map((check) => ({
    ...check, presentationStyle: "safety-summary", prompt: prompts[check.key] || check.prompt,
  })) }));
  const checks = next.sections.flatMap((section) => section.checks);
  if (next.key === "electrical_safety_check") {
    next.reportBoundary = "Summary of this visit, with the complete authenticated electrical safety report covering AS/NZS 3019:2022 section 4 retained as evidence. This short checklist does not replace the full inspection record. A COES for repair work is separate.";
    next.metadataFields = next.metadataFields.map((field) => field.key === "areasExcluded"
      ? { ...field, required: true, label: "Parts not inspected and reasons (enter None if complete)" } : field);
    const rcd = checks.find((check) => check.key === "rcd_testing");
    rcd.responseFields.push({ key: "circuitIdentifier", label: "Circuit / RCD identifier", required: true },
      { key: "rcdButtonResult", label: "RCD button-test result", required: true },
      { key: "tripTime", label: "Timed test results and units", required: true });
    next.sections.push({ key: "professional_record", title: "Professional inspection report",
      summary: "Attach the complete report authenticated by the inspecting electrician, including scope, results, limitations and required repairs.",
      checks: [{ ...checks[0], key: "electrical_professional_record", repeatBy: "property", responseType: "outcome",
        responseFields: [], requiredEvidenceCount: 0, requiredPdfCount: 1, presentationStyle: "safety-summary",
        prompt: "Is the complete authenticated electrical safety report attached?",
        help: "Attach the full AS/NZS 3019:2022 section 4 report as a PDF. A repair COES alone is not this report. If no inspection could be performed, record the access limitation.",
        photoGuidance: "Attach the complete professional PDF, including electrician identity, licence, date, tests and limitations." }] });
  }
  if (next.key === "gas_safety_check") {
    next.reportBoundary = "Summary of this visit. Each inspected Type A appliance retains its complete AS 4575 Appendix E service record authenticated by the licensed issuer. This summary does not replace that record or submit it to the BPC.";
    const identity = checks.find((check) => check.key === "appliance_identity_condition");
    identity.responseFields = [text("make", "Make"), text("model", "Model"), text("modelNumber", "Model number"),
      text("gasType", "Gas type"), text("serialNumber", "Serial number"), text("manufactureDate", "Manufacture date, if serial unavailable"),
      text("certificationNumber", "Acceptance / certification number"), text("limitationReason", "Missing or unreadable identifiers and supporting evidence")];
    checks.find((check) => check.key === "appliance_service_record").requiredPdfCount = 1;
    next.metadataFields.push({ key: "licensedIssuerDetails", label: "Licensed issuer name and licence number shown on the service record",
      type: "text", required: true, help: "For supervised work, record the licensed issuer. The uploaded service record must show their authentication.", placeholder: "", options: [], phase: "setup", source: "assessment" });
    next.metadataFields.push({ key: "recordDutiesConfirmed", label: "I have arranged the complete customer record and prescribed BPC submission within 5 days, and retention for at least 10 years",
      type: "checkbox", required: true, help: "This attestation records responsibility. TLink does not submit the BPC record or claim it has been sent.", placeholder: "", options: [], phase: "final", source: "assessment" });
  }
  if (next.key === "smoke_alarm_check") {
    next.title = "Smoke alarm and blind cord safety check";
    next.reportBoundary = "Annual smoke alarm service and the included blind cord safety check performed on this visit. Annual blind attendance is a service inclusion, not a prescribed annual legal interval. Electrical installation or repair requires the appropriate licence.";
    checks.find((check) => check.key === "alarm_identity_location").responseFields = [text("make", "Manufacturer"), text("model", "Model"),
      text("powerSource", "Power supply / battery type"), text("manufactureDate", "Manufacture or replacement date"),
      text("limitationReason", "Missing label or date details and supporting evidence")];
    next.sections.push({ key: "window_covering_cords", title: "Blind cord safety",
      summary: "Check all corded coverings. Record no corded coverings explicitly, or record each location and any unsafe cord or fitting.",
      checks: [{ ...structuredClone(cordCheck), credentialGate: next.credentialGate, presentationStyle: "safety-summary",
        prompt: "Are this covering's blind cords and safety fittings secure and satisfactory?" }] });
  }
  return next;
}
/** New snapshots only. MIME counts come from owned active server-side evidence. */
export function rentalSafetyVisitBlockers({ moduleTemplate, items, pdfCounts = {} }) {
  if (moduleTemplate.safetyVisitVersion !== 1) return [];
  const blockers = [];
  const performed = (item) => ["meets", "does_not_meet"].includes(item.outcome);
  const location = (item) => String(item.locationLabel || "").trim().replace(/\s+/g, " ").toLowerCase();
  const response = (item) => object(item.responseJson || item.response);
  const groups = moduleTemplate.key === "gas_safety_check"
    ? ["appliance_identity_condition", "appliance_combustion_flue", "appliance_service_record"]
    : moduleTemplate.key === "smoke_alarm_check"
      ? ["alarm_identity_location", "alarm_operation", "alarm_interconnection", "alarm_repairs_replacement"] : [];
  if (groups.length) {
    const inventory = items.filter((item) => item.checkKey === groups[0]);
    const locations = new Set(inventory.map(location));
    for (const key of groups) {
      const entries = items.filter((item) => item.checkKey === key);
      for (const asset of inventory) if (!entries.some((item) => location(item) === location(asset))) {
        blockers.push({ key: `inventory:${asset.itemKey}:${key}`, label: `${asset.locationLabel}: finish every alarm or appliance check using this same location name.` });
      }
      for (const item of entries) if (!locations.has(location(item))) blockers.push({ key: `inventory:${item.itemKey}`, label: `${item.locationLabel}: add this item to the alarm or appliance inventory first.` });
      if (new Set(entries.map(location)).size !== entries.length) blockers.push({ key: `inventory-duplicate:${key}`, label: "Give every separate alarm or appliance a distinct location name." });
    }
    for (const item of inventory.filter(performed)) {
      const values = response(item);
      const required = moduleTemplate.key === "gas_safety_check"
        ? ["make", "model", "modelNumber", "gasType", "certificationNumber"] : ["make", "model", "powerSource", "manufactureDate"];
      const missing = required.some((key) => !String(values[key] || "").trim())
        || (moduleTemplate.key === "gas_safety_check" && !values.serialNumber && !values.manufactureDate);
      if (missing && !String(values.limitationReason || "").trim()) blockers.push({ key: `identity:${item.itemKey}`, label: `${item.locationLabel}: record the identifying details or explain missing labels with supporting evidence.` });
    }
  }
  if (moduleTemplate.key === "electrical_safety_check" && items.some((item) => item.checkKey !== "electrical_professional_record" && performed(item))) {
    const record = items.find((item) => item.checkKey === "electrical_professional_record");
    if (!record || !performed(record) || Number(pdfCounts[record.id] || 0) < 1) blockers.push({ key: "professional:electrical_professional_record", label: "Attach the complete authenticated electrical safety PDF before issuing a performed inspection." });
  }
  if (moduleTemplate.key === "gas_safety_check") {
    for (const asset of items.filter((item) => item.checkKey === "appliance_identity_condition")) {
      if (!items.some((item) => groups.includes(item.checkKey) && location(item) === location(asset) && performed(item))) continue;
      const record = items.find((item) => item.checkKey === "appliance_service_record" && location(item) === location(asset));
      if (!record || !performed(record) || Number(pdfCounts[record.id] || 0) < 1) blockers.push({ key: `professional:${asset.itemKey}`, label: `${asset.locationLabel}: attach the complete authenticated AS 4575 service record for this appliance.` });
    }
  }
  return blockers;
}
