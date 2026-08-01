import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  type GovernmentActivityTemplate,
} from "./australian-government-program-catalogue";

export const CREDITEX_VEU_PILOT_CONFIRMATION =
  "CREATE SYNTHETIC VEU PILOT";
export const CREDITEX_VEU_PILOT_SEED_VERSION =
  "veu-v25-2026-08-01-synthetic-v2";
export const CREDITEX_VEU_PILOT_INSTALLER_COUNT = 10;
export const CREDITEX_VEU_PILOT_TECHNICIANS_PER_INSTALLER = 3;
export const CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN = 10;
export const CREDITEX_VEU_PILOT_JOB_COUNT =
  CREDITEX_VEU_PILOT_INSTALLER_COUNT
  * CREDITEX_VEU_PILOT_TECHNICIANS_PER_INSTALLER
  * CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN;

export const CREDITEX_VEU_PILOT_JOB_DETAIL_SECTIONS = [
  { key: "customer_details", group: "customer", label: "Customer details" },
  { key: "customer_jobs", group: "customer", label: "Jobs for customer" },
  { key: "customer_files", group: "customer", label: "Customer files" },
  {
    key: "customer_create_job",
    group: "customer",
    label: "Create new job for this customer",
  },
  { key: "job_summary", group: "job", label: "Job summary" },
  { key: "job_appointments", group: "job", label: "Job appointments" },
  { key: "job_actions", group: "job", label: "Job actions" },
  { key: "job_questions", group: "job", label: "Job questions" },
  { key: "job_quote_invoice", group: "job", label: "Job quote and invoice" },
  { key: "job_calculations", group: "job", label: "Job calculations" },
  { key: "job_transactions", group: "job", label: "Job transactions" },
  { key: "job_files", group: "job", label: "Job files and photos" },
  { key: "job_issues", group: "job", label: "Job issues" },
  { key: "job_emails", group: "job", label: "Job emails" },
  { key: "job_history", group: "job", label: "Job history" },
  {
    key: "appointment_summary",
    group: "appointment",
    label: "Appointment summary",
  },
  {
    key: "appointment_actions",
    group: "appointment",
    label: "Appointment actions",
  },
  {
    key: "appointment_questions",
    group: "appointment",
    label: "Appointment questions",
  },
  {
    key: "appointment_certificate_submissions",
    group: "appointment",
    label: "Appointment certificate submissions",
  },
  {
    key: "appointment_decommissioning",
    group: "appointment",
    label: "Appointment decommissioning summary",
  },
  {
    key: "appointment_correspondence",
    group: "appointment",
    label: "Appointment correspondence",
  },
  {
    key: "appointment_audit",
    group: "appointment",
    label: "Appointment audit",
  },
  {
    key: "appointment_history",
    group: "appointment",
    label: "Appointment history",
  },
  { key: "copy_row", group: "utility", label: "Copy row" },
  { key: "copy_selection", group: "utility", label: "Copy selection" },
  { key: "print", group: "utility", label: "Print" },
  { key: "print_preview", group: "utility", label: "Print preview" },
  { key: "compliance_rules", group: "compliance", label: "Rules and sources" },
  {
    key: "compliance_lookups",
    group: "compliance",
    label: "Authoritative lookups",
  },
  {
    key: "compliance_evidence",
    group: "compliance",
    label: "Evidence requirements",
  },
  {
    key: "compliance_calculations",
    group: "compliance",
    label: "VEEC calculations",
  },
  {
    key: "compliance_submission",
    group: "compliance",
    label: "Certificate submission",
  },
] as const;

export type CreditexVeuPilotJobDetailSection =
  typeof CREDITEX_VEU_PILOT_JOB_DETAIL_SECTIONS[number];

export type CreditexVeuPilotJobDetailSectionKey =
  CreditexVeuPilotJobDetailSection["key"];

export type CreditexVeuPilotJobDetailCapability =
  CreditexVeuPilotJobDetailSection & {
    available: boolean;
    count: number;
    readOnly: boolean;
    reason: string;
  };

export const CREDITEX_VEU_PILOT_ACTIVITIES =
  GOVERNMENT_ACTIVITY_TEMPLATES.filter(
    (activity) => activity.programCode === "VEU",
  );

export type PilotSourceInstrument = {
  sourceKey: string;
  sourceKind:
    | "act"
    | "regulations"
    | "specification"
    | "guideline"
    | "activity_guide"
    | "registry"
    | "program_document";
  title: string;
  officialSourceUrl: string;
  officialVersion: string;
  effectiveFrom: string;
  effectiveTo: string;
  officialSourceSha256: string;
  hashStatus:
    | "research_hashed_bytes_not_retained"
    | "download_blocked_pending_hash"
    | "dynamic_registry";
  sourcePriority: number;
};

export const CREDITEX_VEU_PILOT_SOURCES:
  readonly PilotSourceInstrument[] = [
    {
      sourceKey: "veu-act-2007",
      sourceKind: "act",
      title: "Victorian Energy Efficiency Target Act 2007",
      officialSourceUrl:
        "https://www.legislation.vic.gov.au/in-force/acts/victorian-energy-efficiency-target-act-2007",
      officialVersion: "In-force landing record",
      effectiveFrom: "",
      effectiveTo: "",
      officialSourceSha256: "",
      hashStatus: "dynamic_registry",
      sourcePriority: 1,
    },
    {
      sourceKey: "veu-regulations-2018-v020",
      sourceKind: "regulations",
      title: "Victorian Energy Efficiency Target Regulations 2018",
      officialSourceUrl:
        "https://www.legislation.vic.gov.au/in-force/statutory-rules/victorian-energy-efficiency-target-regulations-2018/020",
      officialVersion: "Authorised version 020",
      effectiveFrom: "2026-06-30",
      effectiveTo: "",
      officialSourceSha256: "",
      hashStatus: "download_blocked_pending_hash",
      sourcePriority: 2,
    },
    {
      sourceKey: "veu-specifications-v25",
      sourceKind: "specification",
      title: "Victorian Energy Upgrades Specifications 2018 Version 25.0",
      officialSourceUrl:
        "https://www.energy.vic.gov.au/__data/assets/pdf_file/0041/795488/Victorian-Energy-Upgrades-Specifications-2018-Version-25.pdf",
      officialVersion: "25.0",
      effectiveFrom: "2026-07-21",
      effectiveTo: "",
      officialSourceSha256: "",
      hashStatus: "download_blocked_pending_hash",
      sourcePriority: 3,
    },
    {
      sourceKey: "veu-guidelines-v16",
      sourceKind: "guideline",
      title: "Victorian Energy Efficiency Target Guidelines Version 16",
      officialSourceUrl:
        "https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20VEET%20guidelines%20v16%20-%2020260416.pdf",
      officialVersion: "16",
      effectiveFrom: "2026-04-16",
      effectiveTo: "",
      officialSourceSha256:
        "5e2da3c09ee351170ff7aadbe5ce00106626b63245d888a0854301ddfd1771c5",
      hashStatus: "research_hashed_bytes_not_retained",
      sourcePriority: 4,
    },
    {
      sourceKey: "veu-obligations-guide-2025-10",
      sourceKind: "guideline",
      title: "Obligations and Program Guide for Accredited Persons",
      officialSourceUrl:
        "https://www.esc.vic.gov.au/sites/default/files/documents/Final%20Obligations%20and%20Program%20guide%20for%20Accredited%20Persons%2020251001.pdf",
      officialVersion: "1 October 2025",
      effectiveFrom: "2025-10-01",
      effectiveTo: "",
      officialSourceSha256:
        "30f78ce41ad58ce7184989a9316aeb7aef642ca638a000eb11d44dc8652389ad",
      hashStatus: "research_hashed_bytes_not_retained",
      sourcePriority: 5,
    },
    {
      sourceKey: "veu-part46-transition-2026-06-30",
      sourceKind: "program_document",
      title: "Changes to the VEU induction cooktop activity Part 46",
      officialSourceUrl:
        "https://www.energy.vic.gov.au/victorian-energy-upgrades/installers/veu-industry-latest-news/veu-news/changes-to-the-victorian-energy-upgrades-induction-cooktop-activity-part-46",
      officialVersion: "30 June 2026",
      effectiveFrom: "2026-06-30",
      effectiveTo: "",
      officialSourceSha256: "",
      hashStatus: "download_blocked_pending_hash",
      sourcePriority: 4,
    },
    {
      sourceKey: "veu-measurement-verification-v8",
      sourceKind: "specification",
      title: "Measurement and Verification Specifications Version 8.0",
      officialSourceUrl:
        "https://www.energy.vic.gov.au/__data/assets/pdf_file/0036/755487/Measurement-and-Verification-Specifications-Version-8.0.pdf",
      officialVersion: "8.0",
      effectiveFrom: "2025-06-20",
      effectiveTo: "",
      officialSourceSha256: "",
      hashStatus: "download_blocked_pending_hash",
      sourcePriority: 3,
    },
    {
      sourceKey: "veu-benchmark-rating-v2",
      sourceKind: "specification",
      title: "Benchmark Rating Specifications Version 2.0",
      officialSourceUrl:
        "https://www.energy.vic.gov.au/__data/assets/pdf_file/0034/755485/Benchmark-Rating-Specifications-Version-2.0.pdf",
      officialVersion: "2.0",
      effectiveFrom: "2025-06-20",
      effectiveTo: "",
      officialSourceSha256: "",
      hashStatus: "download_blocked_pending_hash",
      sourcePriority: 3,
    },
    {
      sourceKey: "veu-public-registry",
      sourceKind: "registry",
      title: "Victorian Energy Upgrades public registry",
      officialSourceUrl: "https://veu.esc.vic.gov.au/vpr/s/public-registry",
      officialVersion: "Live public registry",
      effectiveFrom: "",
      effectiveTo: "",
      officialSourceSha256: "",
      hashStatus: "dynamic_registry",
      sourcePriority: 5,
    },
    {
      sourceKey: "veu-program-documents",
      sourceKind: "program_document",
      title: "Victorian Energy Upgrades industry program documents",
      officialSourceUrl:
        "https://www.energy.vic.gov.au/victorian-energy-upgrades/installers/veu-industry-program-documents",
      officialVersion: "Live document index",
      effectiveFrom: "",
      effectiveTo: "",
      officialSourceSha256: "",
      hashStatus: "dynamic_registry",
      sourcePriority: 5,
    },
  ];

export type PilotControlOption = {
  controlType:
    | "participant_status"
    | "accreditation_status"
    | "licence_status"
    | "product_status"
    | "recall_status"
    | "suspension_status"
    | "evidence_status"
    | "review_status"
    | "activity_status";
  optionCode: string;
  label: string;
  optionOrder: number;
  sourceKey: string;
};

function controlOptions(
  controlType: PilotControlOption["controlType"],
  sourceKey: string,
  labels: readonly [string, string][],
) {
  return labels.map(([optionCode, label], optionOrder) => ({
    controlType,
    optionCode,
    label,
    optionOrder,
    sourceKey,
  }));
}

export const CREDITEX_VEU_PILOT_CONTROL_OPTIONS:
  readonly PilotControlOption[] = [
    ...controlOptions("participant_status", "veu-obligations-guide-2025-10", [
      ["not_checked", "Not checked"],
      ["pending", "Pending authoritative check"],
      ["verified", "Verified for the activity date"],
      ["suspended", "Suspended"],
      ["revoked", "Revoked"],
    ]),
    ...controlOptions("accreditation_status", "veu-public-registry", [
      ["not_checked", "Not checked"],
      ["current", "Current"],
      ["suspended", "Suspended"],
      ["cancelled", "Cancelled"],
      ["expired", "Expired"],
    ]),
    ...controlOptions("licence_status", "veu-guidelines-v16", [
      ["not_checked", "Not checked"],
      ["current", "Current and activity-compatible"],
      ["expired", "Expired"],
      ["suspended", "Suspended"],
      ["wrong_class", "Wrong licence class"],
    ]),
    ...controlOptions("product_status", "veu-public-registry", [
      ["not_checked", "Not checked"],
      ["listed", "Listed for the activity date"],
      ["not_listed", "Not listed"],
      ["expired", "Listing expired"],
      ["suspended", "Suspended"],
    ]),
    ...controlOptions("recall_status", "veu-public-registry", [
      ["not_checked", "Not checked"],
      ["clear", "No current recall found"],
      ["recalled", "Recalled"],
    ]),
    ...controlOptions("suspension_status", "veu-public-registry", [
      ["not_checked", "Not checked"],
      ["clear", "No current suspension found"],
      ["suspended", "Suspended"],
    ]),
    ...controlOptions("evidence_status", "veu-guidelines-v16", [
      ["not_started", "Not started"],
      ["in_progress", "In progress"],
      ["transport_complete", "Capture transport checks complete"],
      ["changes_required", "Changes required"],
    ]),
    ...controlOptions("review_status", "veu-guidelines-v16", [
      ["test_ready", "Ready for synthetic review"],
      ["in_review", "In synthetic review"],
      ["changes_required", "Changes required"],
      ["test_complete", "Synthetic review complete"],
      ["archived", "Archived"],
    ]),
    ...controlOptions("activity_status", "veu-specifications-v25", [
      ["current", "Current activity family"],
      ["specialist", "Specialist project-based method"],
      ["closed", "Closed to new regulated jobs"],
      ["transition", "Effective-date transition applies"],
    ]),
  ];

export const CREDITEX_VEU_PILOT_EVIDENCE_CONTRACTS = [
  {
    requirementCode: "transport-before-overview",
    title: "Before-installation overview",
    evidenceKind: "photo",
    captureTiming: "before",
    originalRequired: true,
    metadataRequired: true,
    gpsRequired: true,
    minimumCount: 1,
    maximumCount: 3,
    allowedContentTypes: ["image/jpeg"],
    sourceKey: "veu-guidelines-v16",
  },
  {
    requirementCode: "transport-existing-product-label",
    title: "Existing product identity and condition",
    evidenceKind: "photo",
    captureTiming: "before",
    originalRequired: true,
    metadataRequired: true,
    gpsRequired: true,
    minimumCount: 1,
    maximumCount: 3,
    allowedContentTypes: ["image/jpeg"],
    sourceKey: "veu-guidelines-v16",
  },
  {
    requirementCode: "transport-after-overview",
    title: "After-installation overview",
    evidenceKind: "photo",
    captureTiming: "after",
    originalRequired: true,
    metadataRequired: true,
    gpsRequired: true,
    minimumCount: 1,
    maximumCount: 3,
    allowedContentTypes: ["image/jpeg"],
    sourceKey: "veu-guidelines-v16",
  },
  {
    requirementCode: "transport-installed-product-label",
    title: "Installed product label and serial",
    evidenceKind: "photo",
    captureTiming: "after",
    originalRequired: true,
    metadataRequired: true,
    gpsRequired: true,
    minimumCount: 1,
    maximumCount: 3,
    allowedContentTypes: ["image/jpeg"],
    sourceKey: "veu-guidelines-v16",
  },
  {
    requirementCode: "transport-compliance-document",
    title: "Installation compliance document",
    evidenceKind: "document",
    captureTiming: "any",
    originalRequired: true,
    metadataRequired: true,
    gpsRequired: false,
    minimumCount: 1,
    maximumCount: 5,
    allowedContentTypes: ["application/pdf", "image/jpeg"],
    sourceKey: "veu-guidelines-v16",
  },
  {
    requirementCode: "transport-installer-declaration",
    title: "Installer declaration and signature capability",
    evidenceKind: "signature",
    captureTiming: "after",
    originalRequired: true,
    metadataRequired: true,
    gpsRequired: false,
    minimumCount: 1,
    maximumCount: 1,
    allowedContentTypes: ["application/json"],
    sourceKey: "veu-guidelines-v16",
  },
] as const;

export function calculatorInputSchema(activity: GovernmentActivityTemplate) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "activityDate",
      "activityTemplateId",
      "productRegisterSnapshotId",
      "methodInputs",
    ],
    properties: {
      activityDate: { type: "string", format: "date" },
      activityTemplateId: {
        type: "string",
        const: activity.templateId,
      },
      productRegisterSnapshotId: {
        type: "string",
        minLength: 1,
      },
      scenarioCode: { type: "string" },
      methodInputs: {
        type: "object",
        additionalProperties: false,
        description:
          "Blocked until every official formula input, unit, factor, cap and rounding rule is independently verified.",
      },
    },
  };
}

export function calculatorOutputSchema(activity: GovernmentActivityTemplate) {
  return {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "scheme", "activityTemplateId", "reason"],
        properties: {
          kind: { const: "blocked" },
          scheme: { const: "VEU" },
          activityTemplateId: { const: activity.templateId },
          reason: { type: "string", minLength: 1 },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "scheme",
          "unit",
          "quantity",
          "activityTemplateId",
          "calculatorVersionId",
          "sourcePackageSha256",
          "inputSha256",
          "roundingPolicy",
          "warnings",
        ],
        properties: {
          kind: { const: "certificate_estimate" },
          scheme: { const: "VEU" },
          unit: { const: "VEEC" },
          quantity: { type: "integer", minimum: 0 },
          activityTemplateId: { const: activity.templateId },
          calculatorVersionId: { type: "string", minLength: 1 },
          sourcePackageSha256: {
            type: "string",
            pattern: "^[0-9a-f]{64}$",
          },
          inputSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          roundingPolicy: { type: "string", minLength: 1 },
          warnings: { type: "array", items: { type: "string" } },
        },
      },
    ],
  };
}
