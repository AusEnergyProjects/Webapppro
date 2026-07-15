export const HANDOVER_DOCUMENT_CATEGORIES = [
  ["compliance-certificate", "Compliance certificate"],
  ["commissioning-report", "Commissioning report"],
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

const CATEGORY_ITEMS = {
  assessment: [
    ["final-assessment-ready", "Final assessment or advisory report attached", "Include the completed report and practical next actions."],
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
  "insulation-draughts": [
    ["fabric-installation-recorded", "Installed areas, products and coverage recorded", "Record what was installed and any areas that were excluded."],
    ["fabric-safety-evidence", "Clearance and safety checks recorded", "Include relevant installation evidence or mark not applicable."],
    ["fabric-care-guidance", "Care, access and future-work guidance attached", "Note practical considerations for future building or electrical work."],
  ],
  other: [
    ["completion-evidence-ready", "Completion and quality evidence attached", "Include the documents relevant to the completed scope."],
  ],
};

export function complianceTemplateFor(serviceCategory) {
  const selected = CATEGORY_ITEMS[serviceCategory] || CATEGORY_ITEMS.other;
  return [
    ...COMMON_ITEMS,
    ...selected.map(([key, label, guidance]) => ({ key, label, guidance })),
  ];
}

export function handoverReadiness({
  assets = [],
  complianceItems = [],
  documents = [],
  workStage = "",
  customerProjectId = "",
} = {}) {
  const blockers = [];
  if (!customerProjectId) blockers.push("Convert an eligible platform project before requesting a customer handover review.");
  if (workStage !== "completed") blockers.push("Move the work record to Handover complete.");
  if (!assets.length) blockers.push("Add at least one installed asset or completed deliverable.");
  if (!complianceItems.length || complianceItems.some((item) => !["complete", "not_applicable"].includes(item.status))) {
    blockers.push("Resolve every compliance and handover checklist item.");
  }
  if (!documents.some((item) => item.customerVisible === true || item.customer_visible === 1)) {
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
