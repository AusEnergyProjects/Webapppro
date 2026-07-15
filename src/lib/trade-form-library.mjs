const sharedFields = [
  { key: "work_date", label: "Work date", type: "date", required: true },
  { key: "technician", label: "Responsible technician", type: "text", required: true, maxLength: 100 },
  { key: "site_safe", label: "The work area was checked and made safe", type: "checkbox", required: true },
  { key: "scope_checked", label: "The completed work was checked against the approved scope", type: "checkbox", required: true },
  { key: "exceptions", label: "Exceptions, defects or follow-up work", type: "textarea", required: false, maxLength: 1200 },
];

const templates = [
  {
    key: "pre-start-risk-readiness",
    version: 1,
    name: "Pre-start risk and site readiness",
    jurisdiction: "AU",
    categories: ["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "other"],
    description: "A practical pre-start record for site conditions, access, hazards and the agreed work area.",
    guidance: "Use this as a supporting business record. Apply the licences, permits, safety documents and formal certificates required for the actual work and location.",
    fields: [
      ...sharedFields.slice(0, 2),
      { key: "access_confirmed", label: "Safe access and work boundaries confirmed", type: "checkbox", required: true },
      { key: "isolation_confirmed", label: "Required isolation or shutdown controls confirmed", type: "checkbox", required: true },
      { key: "hazards", label: "Hazards and controls", type: "textarea", required: true, maxLength: 1200 },
      { key: "changes", label: "Scope changes requiring approval", type: "textarea", required: false, maxLength: 1200 },
    ],
  },
  {
    key: "electrical-commissioning-support",
    version: 1,
    name: "Electrical commissioning support record",
    jurisdiction: "AU",
    categories: ["solar", "battery", "ev-charging"],
    description: "Records product settings, protection checks, operating tests and evidence references for electrical energy work.",
    guidance: "This supports the job file and does not replace a certificate of electrical safety, network approval, scheme evidence or manufacturer commissioning requirements.",
    fields: [
      ...sharedFields,
      { key: "protection_checks", label: "Protection and isolation checks completed", type: "checkbox", required: true },
      { key: "operating_test", label: "Operating test completed successfully", type: "checkbox", required: true },
      { key: "settings", label: "Final operating, export, reserve or load settings", type: "textarea", required: true, maxLength: 1200 },
      { key: "certificate_reference", label: "Certificate or formal evidence reference", type: "text", required: false, maxLength: 160 },
    ],
  },
  {
    key: "hot-water-commissioning-support",
    version: 1,
    name: "Hot water commissioning support record",
    jurisdiction: "AU",
    categories: ["hot-water"],
    description: "Records plumbing, electrical, temperature, control and operating checks for a completed hot water installation.",
    guidance: "This supports the job file and does not replace required plumbing, electrical, rebate or manufacturer documents.",
    fields: [
      ...sharedFields,
      { key: "leak_check", label: "Connections and valves checked for leaks", type: "checkbox", required: true },
      { key: "temperature_check", label: "Temperature and tempering operation checked", type: "checkbox", required: true },
      { key: "control_settings", label: "Timer, tariff and control settings", type: "textarea", required: true, maxLength: 1000 },
      { key: "certificate_reference", label: "Certificate or formal evidence reference", type: "text", required: false, maxLength: 160 },
    ],
  },
  {
    key: "heating-cooling-commissioning-support",
    version: 1,
    name: "Heating and cooling commissioning support record",
    jurisdiction: "AU",
    categories: ["heating-cooling"],
    description: "Records installation, drainage, controls, airflow and operating checks for a completed heating or cooling system.",
    guidance: "This supports the job file and does not replace required refrigeration, electrical, plumbing or manufacturer records.",
    fields: [
      ...sharedFields,
      { key: "drainage_check", label: "Drainage and condensate path checked", type: "checkbox", required: true },
      { key: "airflow_check", label: "Airflow and operating modes checked", type: "checkbox", required: true },
      { key: "control_settings", label: "Final controls, schedules and user settings", type: "textarea", required: true, maxLength: 1000 },
      { key: "licence_reference", label: "Licence or formal evidence reference", type: "text", required: false, maxLength: 160 },
    ],
  },
  {
    key: "building-fabric-completion-support",
    version: 1,
    name: "Building fabric completion support record",
    jurisdiction: "AU",
    categories: ["insulation-draughts"],
    description: "Records installed areas, exclusions, clearances, coverage and quality checks for insulation and draught work.",
    guidance: "This supports the job file and does not replace product instructions, electrical clearance requirements, permits or formal scheme evidence.",
    fields: [
      ...sharedFields,
      { key: "installed_areas", label: "Installed areas and coverage", type: "textarea", required: true, maxLength: 1200 },
      { key: "clearances_checked", label: "Required clearances and access points checked", type: "checkbox", required: true },
      { key: "excluded_areas", label: "Excluded or inaccessible areas", type: "textarea", required: false, maxLength: 1000 },
      { key: "evidence_reference", label: "Photo or evidence reference", type: "text", required: false, maxLength: 160 },
    ],
  },
  {
    key: "service-visit-support",
    version: 1,
    name: "Scheduled service visit record",
    jurisdiction: "AU",
    categories: ["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "other"],
    description: "A concise record for planned maintenance, observed condition, work completed and the next action.",
    guidance: "Record technical service information only. Formal testing, certificates and manufacturer procedures remain the responsibility of the service provider.",
    fields: [
      ...sharedFields,
      { key: "condition", label: "Observed asset condition", type: "select", required: true, options: ["Serviceable", "Attention required", "Unsafe or isolated"] },
      { key: "work_completed", label: "Service work completed", type: "textarea", required: true, maxLength: 1200 },
      { key: "measurements", label: "Measurements or test summary", type: "textarea", required: false, maxLength: 1200 },
      { key: "next_action", label: "Recommended next action", type: "textarea", required: false, maxLength: 1000 },
    ],
  },
];

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function tradeFormTemplatesFor(serviceCategory) {
  return templates.filter((template) => template.categories.includes(String(serviceCategory || "other")))
    .map((template) => structuredClone(template));
}

export function tradeFormTemplate(key, version, serviceCategory) {
  return tradeFormTemplatesFor(serviceCategory).find((template) => template.key === key && template.version === Number(version)) || null;
}

export function normalizeTradeFormAnswers(template, value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(template.fields.map((field) => {
    if (field.type === "checkbox") return [field.key, source[field.key] === true];
    const limit = Number(field.maxLength || 240);
    const clean = String(source[field.key] || "").trim().slice(0, limit);
    return [field.key, field.type === "date" && !validIsoDate(clean) ? "" : clean];
  }));
}

export function tradeFormCompletion(template, answers) {
  const missing = template.fields.filter((field) => field.required && (field.type === "checkbox" ? answers[field.key] !== true : !String(answers[field.key] || "").trim()));
  return { ready: missing.length === 0, missing: missing.map((field) => field.label) };
}
