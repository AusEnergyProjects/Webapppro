export const HANDOVER_DOCUMENT_CATEGORIES = [
  ["compliance-certificate", "Compliance certificate"],
  ["commissioning-report", "Commissioning report"],
  ["blower-door-report", "Blower door test report"],
  ["thermal-imaging-report", "Thermal imaging inspection report"],
  ["warranty-certificate", "Warranty certificate"],
  ["product-manual", "Product manual"],
  ["product-datasheet", "Product datasheet"],
  ["installation-evidence", "Installation evidence"],
];

export const HANDOVER_ASSET_CATEGORIES = [
  ["solar-panel", "Solar panels"],
  ["inverter", "Inverter"],
  ["battery", "Battery system"],
  ["heat-pump-water-heater", "Heat pump water heater"],
  ["air-conditioner", "Heating and cooling unit"],
  ["ev-charger", "EV charger"],
  ["insulation", "Insulation product"],
  ["controls", "Controls or monitoring"],
  ["switchboard", "Switchboard equipment"],
  ["assessment-report", "Assessment deliverable"],
  ["other", "Other installed product"],
];

const DIAGNOSTIC_REPORT_CATEGORY = {
  "blower-door-testing": "blower-door-report",
  "thermal-imaging": "thermal-imaging-report",
};

const COMMON_ITEMS = [
  {
    key: "installed-products-recorded",
    label: "Installed products, models and serial details recorded",
    guidance: "Confirm the asset register matches the products actually installed.",
  },
  {
    key: "warranty-path-confirmed",
    label: "Warranty provider, reference and coverage dates confirmed",
    guidance: "Record the available warranty path for each installed asset.",
  },
  {
    key: "customer-guidance-ready",
    label: "Operating, maintenance and support guidance prepared",
    guidance: "Attach the guidance the household should keep after completion.",
  },
  {
    key: "customer-documents-privacy-checked",
    label: "Customer-visible documents checked for privacy-safe content",
    guidance: "Use redacted copies when direct contact details or unrelated household information are not required.",
  },
];

const DIAGNOSTIC_COMMON_ITEMS = [
  {
    key: "diagnostic-scope-confirmed",
    label: "Test scope and property areas confirmed",
    guidance: "Record which building areas were tested or inspected and any access exclusions.",
  },
  {
    key: "diagnostic-guidance-ready",
    label: "Findings and practical follow-up guidance prepared",
    guidance: "Explain the findings, their limitations and the next checks or improvements the household should consider.",
  },
  {
    key: "customer-documents-privacy-checked",
    label: "Customer-visible documents checked for privacy-safe content",
    guidance: "Use redacted copies when direct contact details or unrelated household information are not required.",
  },
];

const CATEGORY_ITEMS = {
  assessment: [
    ["final-assessment-ready", "Final assessment or advisory report attached", "Include the completed report and practical next actions."],
  ],
  "blower-door-testing": [
    ["blower-door-configuration-recorded", "Building configuration and test conditions recorded", "Include the tested area, openings, ventilation, combustion appliances and operating conditions."],
    ["blower-door-method-recorded", "Equipment, calibration reference, method, result and units recorded", "Include enough detail for the measured result to be understood and checked."],
    ["blower-door-report-ready", "Blower door report, findings and limitations attached", "Include identified leakage priorities and any safety or ventilation follow-up."],
  ],
  "thermal-imaging": [
    ["thermal-conditions-recorded", "Camera details and inspection conditions recorded", "Include indoor and outdoor conditions, temperature difference and relevant heating or cooling operation."],
    ["thermal-images-ready", "Paired visible and thermal images identified", "Label the locations and keep visible-light context with each interpreted thermal image."],
    ["thermal-report-ready", "Interpretation, limitations and follow-up attached", "Do not present a thermal pattern as a diagnosis on its own."],
  ],
  solar: [
    ["solar-commissioning-recorded", "Solar commissioning results recorded", "Attach the final commissioning or test record used for this installation."],
    ["solar-compliance-evidence", "Relevant electrical and installation evidence attached", "Confirm the evidence required for the completed scope is included."],
    ["solar-network-evidence", "Network or connection evidence included where relevant", "Mark not applicable when the completed work did not require it."],
  ],
  battery: [
    ["battery-commissioning-recorded", "Battery commissioning and operating settings recorded", "Include usable capacity, reserve and backup settings where relevant."],
    ["battery-compliance-evidence", "Relevant electrical and installation evidence attached", "Confirm the evidence required for the completed scope is included."],
    ["battery-safety-guidance", "Safety and emergency operating guidance attached", "Include shutdown and support guidance for the installed system."],
  ],
  "heating-cooling": [
    ["hvac-commissioning-recorded", "Heating and cooling commissioning checks recorded", "Include the completed commissioning or performance check."],
    ["hvac-compliance-evidence", "Relevant trade compliance evidence attached", "Confirm the evidence required for the completed scope is included."],
    ["hvac-controls-guidance", "Controls, schedules and filter guidance attached", "Give the household practical settings and maintenance guidance."],
  ],
  "hot-water": [
    ["hot-water-commissioning-recorded", "Hot water commissioning checks recorded", "Include temperature, controls and operating checks where relevant."],
    ["hot-water-compliance-evidence", "Relevant plumbing and electrical evidence attached", "Confirm the evidence required for the completed scope is included."],
    ["hot-water-settings-guidance", "Tariff, timer and operating guidance attached", "Record the final control approach used for the installation."],
  ],
  "ev-charging": [
    ["ev-commissioning-recorded", "EV charger commissioning checks recorded", "Include charging, protection and load settings where relevant."],
    ["ev-compliance-evidence", "Relevant electrical evidence attached", "Confirm the evidence required for the completed scope is included."],
    ["ev-load-guidance", "Charging schedule and load-management guidance attached", "Record practical settings for the household."],
  ],
  "draught-proofing": [
    ["draught-installation-recorded", "Treated openings, seals and exclusions recorded", "Record what was sealed, the products used and any areas that were excluded."],
    ["draught-ventilation-checked", "Required ventilation and combustion safety checked", "Confirm fixed ventilation, exhaust and combustion-air requirements were not obstructed."],
    ["draught-care-guidance", "Seal care and future-adjustment guidance attached", "Explain inspection, cleaning and adjustment needs for the completed work."],
  ],
  insulation: [
    ["insulation-installation-recorded", "Installed areas, products and coverage recorded", "Record product details, coverage and any areas that were excluded."],
    ["insulation-safety-evidence", "Clearance and safety checks recorded", "Include electrical, heat-source and access-clearance evidence where relevant."],
    ["insulation-care-guidance", "Access and future-work guidance attached", "Note practical considerations for future building, electrical or roof-space work."],
  ],
  glazing: [
    ["glazing-installation-recorded", "Glazed openings, frame and glass specifications recorded", "Record each completed opening and the installed performance and safety-glazing details."],
    ["glazing-compliance-evidence", "Relevant glazing and installation evidence attached", "Include the evidence required for the completed scope and location."],
    ["glazing-care-guidance", "Operation, cleaning and warranty guidance attached", "Explain safe operation, care and the available support path."],
  ],
  "window-coverings": [
    ["covering-installation-recorded", "Installed coverings, controls and openings recorded", "Record the completed openings, covering type and control arrangement."],
    ["covering-safety-evidence", "Fixings, clearances and control safety checked", "Confirm secure fixing and applicable cord, chain, electrical or access safety requirements."],
    ["covering-care-guidance", "Operation, care and adjustment guidance attached", "Explain safe operation, cleaning and seasonal adjustment where relevant."],
  ],
  other: [
    ["completion-evidence-ready", "Completion and quality evidence attached", "Include the documents relevant to the completed scope."],
  ],
};

export function complianceTemplateFor(serviceCategory) {
  const selected = CATEGORY_ITEMS[serviceCategory] || CATEGORY_ITEMS.other;
  const common = ["blower-door-testing", "thermal-imaging"].includes(serviceCategory)
    ? DIAGNOSTIC_COMMON_ITEMS
    : COMMON_ITEMS;
  return [
    ...common,
    ...selected.map(([key, label, guidance]) => ({ key, label, guidance })),
  ];
}

/**
 * @param {{assets?: Array<Record<string, unknown>>, complianceItems?: Array<Record<string, unknown>>, documents?: Array<Record<string, unknown>>, serviceCategory?: string, workStage?: string, customerProjectId?: unknown}} input
 */
export function handoverReadiness({
  assets = [],
  complianceItems = [],
  documents = [],
  serviceCategory = "",
  workStage = "",
  customerProjectId = "",
} = {}) {
  const blockers = [];
  const diagnosticReportCategory = DIAGNOSTIC_REPORT_CATEGORY[serviceCategory];
  if (!customerProjectId) blockers.push("Convert an eligible platform project before requesting a customer handover review.");
  if (workStage !== "completed") blockers.push("Move the work record to Handover complete.");
  if (!diagnosticReportCategory && !assets.length) blockers.push("Add at least one installed asset or completed deliverable.");
  if (!complianceItems.length || complianceItems.some((item) => !["complete", "not_applicable"].includes(item.status))) {
    blockers.push("Resolve every compliance and handover checklist item.");
  }
  const visibleDocuments = documents.filter((item) => item.customerVisible === true || item.customer_visible === 1);
  if (diagnosticReportCategory) {
    if (!visibleDocuments.some((item) => item.category === diagnosticReportCategory)) {
      blockers.push("Add the completed diagnostic report to the customer pack.");
    }
  } else if (!visibleDocuments.length) {
    blockers.push("Add at least one document that can be included in the customer pack.");
  }
  return {
    ready: blockers.length === 0,
    blockers,
  };
}

export function isIsoDate(value) {
  return value === "" || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}
