import {
  governmentActivityTemplates,
  type GovernmentActivityTemplate,
} from "../lib/australian-government-program-catalogue.ts";
import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
  CREDITEX_VEU_PART_6_SCENARIOS,
  type CreditexVeuActivityDefinition,
} from "../lib/creditex-veu-calculator-catalogue.ts";

export const CREDITEX_VEU_WORK_PACK_CONTENT_SCHEMA =
  "creditex-veu-work-pack-content/v1" as const;

export const CREDITEX_CURRENT_ACTIVITY_CODES = [
  "1",
  "3",
  "6",
  "13",
  "14",
  "15",
  "17",
  "22",
  "24",
  "25",
  "26",
  "27",
  "28",
  "30",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
  "43",
  "44",
  "46",
  "47",
  "48",
] as const;

export type CreditexCurrentVeuActivityCode =
  (typeof CREDITEX_CURRENT_ACTIVITY_CODES)[number];

type VeuSourceKey =
  | "act"
  | "regulations"
  | "specificationV25"
  | "guidelinesV16"
  | "obligationsV38"
  | "codeOfConductV13"
  | "activityGuideV320"
  | "productGuideV30"
  | "productApplicantGuideV20"
  | "schemeFactsheet"
  | "waterHeatingFactsheet"
  | "spaceHeatingFactsheet"
  | "cooktopFactsheet"
  | "solarFaq";

export type CreditexVeuOfficialSource = {
  sourceId: string;
  expectedSha256: string;
  title: string;
  version: string;
  officialUrl: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  statedEffectiveDate: string | null;
  pendingIndependentCreditexReview: true;
  operationallyApproved: false;
};

export type CreditexVeuSourceBinding = CreditexVeuOfficialSource & {
  citation: string;
};

export const CREDITEX_VEU_OFFICIAL_SOURCE_LIBRARY = {
  act: {
    sourceId: "source-4c051342f4f1555f5c14",
    expectedSha256: "dc9408bb0f66cb5fa955cc24feb1e7353db81063f86b1e062dd549330cc6fd23",
    title: "Victorian Energy Efficiency Target Act 2007",
    version: "Authorised Version 023",
    officialUrl: "https://content.legislation.vic.gov.au/sites/default/files/2025-07/07-70aa023-authorised.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 976976,
    statedEffectiveDate: "2025-07-01",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  regulations: {
    sourceId: "source-bff6a473d0b5d247f722",
    expectedSha256: "6524a36510e770acafae023406f4331b5302e715ff0313852fee47f7b514f20f",
    title: "Victorian Energy Efficiency Target Regulations 2018",
    version: "Authorised Version 020",
    officialUrl: "https://content.legislation.vic.gov.au/sites/default/files/2026-06/18-145sra020-authorised.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 1276076,
    statedEffectiveDate: "2026-06-30",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  specificationV25: {
    sourceId: "source-bae06fe94f599b437f41",
    expectedSha256: "01d7f1725754a6d7a93058d844269ba88da4c5f7a054938e59f7e07e28d09fcd",
    title: "Victorian Energy Upgrades Specifications 2018",
    version: "25.0",
    officialUrl: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0041/795488/Victorian-Energy-Upgrades-Specifications-2018-Version-25.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 2545202,
    statedEffectiveDate: "2026-07-21",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  guidelinesV16: {
    sourceId: "source-ee6625a2ea78cbe10180",
    expectedSha256: "5e2da3c09ee351170ff7aadbe5ce00106626b63245d888a0854301ddfd1771c5",
    title: "Victorian Energy Efficiency Target Guidelines",
    version: "16",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20VEET%20guidelines%20v16%20-%2020260416.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 1016020,
    statedEffectiveDate: "2026-04-16",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  obligationsV38: {
    sourceId: "source-d4439b9f48fca3974e46",
    expectedSha256: "ae5bc56b6c4d8faef088419dc5073d9ebb46232c9e7fdfe82ce3890bf9ac8038",
    title: "Obligations and Program Guide for Accredited Persons",
    version: "3.8",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Obligations%20and%20Program%20Guide%20for%20Accredited%20Persons%20-%20V%203.8%20-%2020260324.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 491316,
    statedEffectiveDate: "2026-03-24",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  codeOfConductV13: {
    sourceId: "source-198657a66dffbe61219a",
    expectedSha256: "633800b64cc4942afb1d302e46f3e87c4502203eb2dd1e51b1c791462af61e4c",
    title: "VEET Code of Conduct Guideline",
    version: "1.3",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20VEU%20code%20of%20conduct%20-%20Code%20of%20Conduct%20Guideline%201.3%2020240801.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 367803,
    statedEffectiveDate: "2024-08-01",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  activityGuideV320: {
    sourceId: "source-222b2c5c4057bd58a590",
    expectedSha256: "1958486c768c780fb1db59944c1320b76a1a0e40d652b97053f958e10aef9e2a",
    title: "Water Heating and Space Heating and Cooling Activity Guide",
    version: "3.20",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/C%2021%2028378%20%20FINAL%20-%20Water%20Heating%20and%20Space%20Heating%20Cooling%20Activity%20Guide%20-%20V.%203.20%20-%2020260415.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 928606,
    statedEffectiveDate: "2026-04-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  productGuideV30: {
    sourceId: "source-3c4cf5bd7028018cd8b3",
    expectedSha256: "aa7e9445751510f232795067263083df076385ee1d34b9e660a2d00d61dcf267",
    title: "Water Heating and Space Heating and Cooling Product Application Guide",
    version: "3.0",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20Water%20Heating%20and%20Space%20Heating%20Cooling%20Product%20Application%20Guide%20-%20V%203.0%20-%2020250603.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 459823,
    statedEffectiveDate: "2025-06-03",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  productApplicantGuideV20: {
    sourceId: "source-69ae4c5fa689ce132e47",
    expectedSha256: "1bf3b88ead976534f96f37d71ee46135838c7c5c4596d2c5084329e22dc439de",
    title: "Application Guide for Product Applicants",
    version: "2.0",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20Application%20Guide%20for%20Product%20Applicants%20-%20V%202.0%20-%2020250603.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 664632,
    statedEffectiveDate: "2025-06-03",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  schemeFactsheet: {
    sourceId: "source-996e39a8cd6f604cc0be",
    expectedSha256: "a03fcbc5233ce4094df4f174ee77cb87a1fc9290da2fbfa850c8f1c1229d28ab",
    title: "Victorian Energy Efficiency Target scheme consumer factsheet",
    version: "current captured artifact",
    officialUrl: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0028/585154/Victorian-Energy-Efficiency-Target-scheme-consumer-factsheet.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 182306,
    statedEffectiveDate: null,
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  waterHeatingFactsheet: {
    sourceId: "source-a511269509c624c5f8ca",
    expectedSha256: "195e84a1aed1e969b49e2ed5d92de469d78b7ff1aa4ffe86daed3cd06802cbd7",
    title: "VEU water heating consumer factsheet",
    version: "current mandatory document linked 30 June 2026",
    officialUrl: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0018/710280/VEU-water-heating-consumer-factsheet.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 632794,
    statedEffectiveDate: null,
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  spaceHeatingFactsheet: {
    sourceId: "source-e10a938d90a793ff9ad3",
    expectedSha256: "331f544417981ee6ba9f86c0e74bd3f39734010651a3ebf6799497e46ded82e4",
    title: "VEU space heating and cooling consumer factsheet",
    version: "current captured artifact",
    officialUrl: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0027/712809/VEU-space-heating-and-cooling-consumer-factsheet.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 422387,
    statedEffectiveDate: null,
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  cooktopFactsheet: {
    sourceId: "source-83ec578028f4f90f6d9f",
    expectedSha256: "848b32ac9233e86481ef0485d694afd479c7be241d07cbb2bb3c7e0b419ae4f7",
    title: "VEU cooktop consumer factsheet",
    version: "current mandatory document linked 30 June 2026",
    officialUrl: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0030/775560/Information-about-purchasing-an-induction-cooktop_V2.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 319767,
    statedEffectiveDate: null,
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  solarFaq: {
    sourceId: "source-3381eac89d05d03cdaeb",
    expectedSha256: "069babb7d7703a1bf879ebdb0be115a3aa4bf6d5db9103d9cd39ff18db48669e",
    title: "Victorian Energy Upgrades Commercial and Industrial solar FAQs",
    version: "current Part 47 FAQ linked 30 June 2026",
    officialUrl: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0032/779108/Victorian-Energy-Upgrades-Commercial-and-Industrial-solar-FAQs.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 811563,
    statedEffectiveDate: null,
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
} as const satisfies Record<VeuSourceKey, CreditexVeuOfficialSource>;

function bindSource(sourceKey: VeuSourceKey, citation: string): CreditexVeuSourceBinding {
  return {
    ...CREDITEX_VEU_OFFICIAL_SOURCE_LIBRARY[sourceKey],
    citation,
  };
}

type ActivitySourcePages = {
  specification: string;
  minimumRecords: string;
};

const ACTIVITY_SOURCE_PAGES = {
  "1": { specification: "Part 1, pp. 16-20", minimumRecords: "Annexure C, pp. 79-80" },
  "3": { specification: "Part 3, pp. 21-24", minimumRecords: "Annexure C, pp. 79-80" },
  "6": { specification: "Part 6, pp. 25-37", minimumRecords: "Annexure C, pp. 80-81" },
  "13": { specification: "Part 13, pp. 38-39", minimumRecords: "Annexure C, p. 83" },
  "14": { specification: "Part 14, pp. 40-41", minimumRecords: "Annexure C, p. 83" },
  "15": { specification: "Part 15, pp. 42-52", minimumRecords: "Annexure C, p. 83" },
  "17": { specification: "Part 17, pp. 53-54", minimumRecords: "Annexure C, p. 83" },
  "22": { specification: "Part 22, pp. 55-57", minimumRecords: "Annexure C, p. 84" },
  "24": { specification: "Part 24, pp. 58-59", minimumRecords: "Annexure C, p. 84" },
  "25": { specification: "Part 25, pp. 60-61", minimumRecords: "Annexure C, p. 84" },
  "26": { specification: "Part 26, pp. 62-63", minimumRecords: "Annexure C, p. 84" },
  "27": { specification: "Part 27, pp. 64-68", minimumRecords: "Annexure C, pp. 84-85" },
  "28": { specification: "Part 28, pp. 69-71", minimumRecords: "Annexure C, p. 82" },
  "30": { specification: "Part 30, pp. 72-75", minimumRecords: "Annexure C, pp. 85-86" },
  "31": { specification: "Part 31, pp. 76-80", minimumRecords: "Annexure C, p. 86" },
  "32": { specification: "Part 32, pp. 81-87", minimumRecords: "Annexure C, p. 87" },
  "33": { specification: "Part 33, pp. 88-90", minimumRecords: "Annexure C, pp. 87-88" },
  "34": { specification: "Part 34, pp. 91-97", minimumRecords: "Annexure C, pp. 88-89" },
  "35": { specification: "Part 35, pp. 98-103", minimumRecords: "Annexure C, pp. 89-92" },
  "36": { specification: "Part 36, pp. 103-105", minimumRecords: "Annexure C, p. 92" },
  "37": { specification: "Part 37, pp. 105-107", minimumRecords: "Annexure C, pp. 92-93" },
  "38": { specification: "Part 38, pp. 108-110", minimumRecords: "Annexure C, pp. 92-93" },
  "39": { specification: "Part 39, pp. 111-112", minimumRecords: "Annexure C, pp. 92-93" },
  "40": { specification: "Part 40, pp. 113-114", minimumRecords: "Annexure C, pp. 92-93" },
  "41": { specification: "Part 41, pp. 115-116", minimumRecords: "Annexure C, pp. 92-93" },
  "42": { specification: "Part 42, pp. 117-119", minimumRecords: "Annexure C, pp. 92-93" },
  "43": { specification: "Part 43, pp. 119-124", minimumRecords: "Annexure C, pp. 93-94" },
  "44": { specification: "Part 44, pp. 124-131", minimumRecords: "Annexure C, pp. 81-82" },
  "46": { specification: "Part 46, pp. 133-135", minimumRecords: "Annexure C, p. 95" },
  "47": { specification: "Part 47, pp. 136-138", minimumRecords: "Annexure C, pp. 95-96; Annexure D, pp. 99-104" },
  "48": { specification: "Part 48, pp. 139-144", minimumRecords: "Annexure C, pp. 96-98" },
} as const satisfies Record<CreditexCurrentVeuActivityCode, ActivitySourcePages>;

export type CreditexVeuPromptRequirement = {
  key: string;
  label: string;
  kind: "identity" | "assignment" | "calculation" | "eligibility" | "product";
  required: boolean;
  valueSource:
    | "job"
    | "assigned_trade"
    | "creditex_provider"
    | "operator"
    | "approved_product"
    | "postcode_lookup"
    | "official_registry"
    | "derived_from_formula";
  unit: string | null;
  when: string;
  source: CreditexVeuSourceBinding;
};

export type CreditexVeuEvidenceRequirement = {
  requirementId: string;
  kind:
    | "geotagged_photograph"
    | "invoice_or_proof_of_purchase"
    | "certificate"
    | "declaration"
    | "record"
    | "technical_document"
    | "diagram_or_plan"
    | "video";
  label: string;
  details: readonly string[];
  when: string;
  preserveOriginalMetadata: boolean;
  source: CreditexVeuSourceBinding;
};

export type CreditexVeuSignatureRequirement = {
  signatureId: string;
  documentType: string;
  signerRole:
    | "consumer_or_authorised_signatory"
    | "installer"
    | "creditex_accredited_person_assignee"
    | "lighting_designer"
    | "licensed_electrical_inspector"
    | "lead_installer"
    | "applicable_electrician";
  required: boolean;
  when: string;
  visibleSignatureBox: true;
  source: CreditexVeuSourceBinding;
};

export type CreditexVeuFinalDocumentNeed = {
  documentType: string;
  label: string;
  required: boolean;
  when: string;
  format: "pdf" | "original_evidence" | "external_record";
  immutableAfterFinalisation: true;
  source: CreditexVeuSourceBinding;
};

export type CreditexVeuProductRequirement = {
  applicability: "required";
  productKind:
    | "veu_register"
    | "gems_register"
    | "veu_register_or_aemo_approved"
    | "manufacturer_documented_gas_equipment"
    | "installed_cold_room_component_set"
    | "clean_energy_council_approved_solar_components";
  requiredAttributes: readonly string[];
  registrySnapshotRequired: boolean;
  source: CreditexVeuSourceBinding;
};

export type CreditexVeuCalculatorRequirement = {
  outputUnit: "VEEC";
  formulas: readonly {
    formulaKey: string;
    scenarioCodes: readonly string[];
    inputKeys: readonly string[];
    source: CreditexVeuSourceBinding;
  }[];
  activationStatus: "candidate_not_approved";
  officialGoldenVectorStatus: "missing";
};

export type CreditexVeuWorkPackGapCode =
  | "VEU_EXACT_ASSIGNMENT_FORM_TEMPLATE_MISSING"
  | "VEU_REGISTRY_CREATION_SCHEMA_MISSING"
  | "VEU_INDEPENDENT_CREDITEX_REVIEW_REQUIRED"
  | "VEU_OFFICIAL_CALCULATOR_GOLDEN_VECTOR_MISSING"
  | "VEU_PRODUCT_REGISTER_SNAPSHOT_MISSING"
  | "VEU_ACTIVITY_GUIDE_NOT_IN_CUSTODY"
  | "VEU_ACTIVITY_PRODUCT_GUIDE_NOT_IN_CUSTODY"
  | "VEU_PARTICIPANT_REGISTRATION_GUIDANCE_MISSING"
  | "VEU_PART_6_TRANSITION_CONTRACT_INCOMPLETE"
  | "VEU_PART_44_PRODUCT_GUIDE_NOT_IN_CUSTODY"
  | "VEU_PART_47_SOLAR_REGISTRY_AND_DNSP_CONTRACT_INCOMPLETE";

export type CreditexVeuWorkPackContentCandidate = {
  schema: typeof CREDITEX_VEU_WORK_PACK_CONTENT_SCHEMA;
  programCode: "VEU";
  templateId: string;
  activityCode: CreditexCurrentVeuActivityCode;
  title: string;
  specificationPart: string;
  catalogueState: "current" | "limited";
  statusDecision: {
    state: "current" | "limited";
    specificationEffectiveFrom: "2026-07-21";
    effectiveTo: null;
    transitionDates: readonly string[];
    source: CreditexVeuSourceBinding;
  };
  identityBindings: {
    accreditedPerson: "creditex_provider_for_job";
    installerBusiness: "assigned_trade_business_for_job";
    assignedTechnician: "assigned_trade_technician_for_appointment";
    consumer: "job_customer_or_authorised_signatory";
  };
  sourceBindings: readonly CreditexVeuSourceBinding[];
  prompts: readonly CreditexVeuPromptRequirement[];
  evidenceRequirements: readonly CreditexVeuEvidenceRequirement[];
  product: CreditexVeuProductRequirement;
  scenarios: {
    applicability: "required";
    codes: readonly string[];
    source: CreditexVeuSourceBinding;
  };
  calculator: CreditexVeuCalculatorRequirement;
  signatures: readonly CreditexVeuSignatureRequirement[];
  referenceDocuments: readonly CreditexVeuSourceBinding[];
  finalDocumentNeeds: readonly CreditexVeuFinalDocumentNeed[];
  gaps: readonly {
    code: CreditexVeuWorkPackGapCode;
    blocksActivation: true;
    detail: string;
  }[];
  candidateOnly: true;
  independentlyApproved: false;
  published: false;
  activationReady: false;
};

type EvidenceSeed = Omit<CreditexVeuEvidenceRequirement, "source" | "preserveOriginalMetadata">;

const ev = (
  requirementId: string,
  kind: CreditexVeuEvidenceRequirement["kind"],
  label: string,
  details: readonly string[],
  when = "always",
): EvidenceSeed => ({ requirementId, kind, label, details, when });

const GEO_PHOTO_POLICY = [
  "clear and in focus",
  "relevant product or equipment markings visible",
  "date stamp present",
  "GPS-derived latitude and longitude retained in device-generated metadata",
] as const;

const EVIDENCE_1_3 = [
  ev("existing-installed-decommissioned-photos", "geotagged_photograph", "Existing, installed and decommissioned water-heater evidence", [
    ...GEO_PHOTO_POLICY,
    "existing product before the upgrade showing gas and/or electricity connection",
    "installed product details and installation in accordance with VEU requirements",
    "existing product decommissioned in accordance with VEU requirements where applicable",
  ]),
  ev("water-heater-invoice", "invoice_or_proof_of_purchase", "Water-heater invoice or proof of purchase", [
    "installed product details",
    "purchase or installation date",
    "consumer and installer business",
    "price and consumer amount paid for each installed product",
  ]),
  ev("water-heater-plumbing-certificate", "certificate", "BPC compliance certificate", ["nature of work carried out"], "when required by law"),
  ev("water-heater-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work carried out"], "when required by law"),
] as const;

const EVIDENCE_6 = [
  ev("air-conditioner-photos", "geotagged_photograph", "Existing, installed and decommissioned air-conditioner evidence", [
    ...GEO_PHOTO_POLICY,
    "existing product before upgrade showing gas or electricity connection",
    "existing product details and decommissioning where applicable",
    "installed product details and installation in accordance with VEU requirements",
  ]),
  ev("air-conditioner-invoice", "invoice_or_proof_of_purchase", "Air-conditioner invoice or proof of purchase", [
    "installed product details",
    "purchase or installation date",
    "consumer and installer business",
    "price and consumer amount paid for each installed product",
  ]),
  ev("air-conditioner-plumbing-certificate", "certificate", "BPC compliance certificate", ["nature of work carried out"], "when required by law"),
  ev("air-conditioner-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work carried out"], "when required by law"),
  ev("refrigerant-recovery-record", "record", "Refrigerant recovery and disposal record", ["refrigerant recovered by a refrigerant-handling licence holder"], "when required under Commonwealth ozone legislation"),
  ev("residential-multisplit-sizing-record", "record", "Residential multi-split sizing record", ["sizing shows products are suitable for the premises heating and cooling needs"], "residential multi-split installations only"),
] as const;

const EVIDENCE_13_14 = [
  ev("window-invoice", "invoice_or_proof_of_purchase", "Window product invoice or proof of purchase", [
    "installed product details",
    "upgrade address, consumer and installer business for business or non-residential upgrades",
  ]),
] as const;

const EVIDENCE_15 = [
  ev("weather-sealing-photos", "geotagged_photograph", "Weather-sealing installation evidence", [
    ...GEO_PHOTO_POLICY,
    "installed products installed in accordance with VEU requirements",
    "each fireplace with an unsealed chimney or flue for scenarios 15F and 15G",
  ]),
  ev("weather-sealing-invoice", "invoice_or_proof_of_purchase", "Weather-sealing invoice or proof of purchase", ["installed product details"]),
  ev("weather-sealing-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work carried out"], "scenarios 15C and 15D when required by law"),
] as const;

const EVIDENCE_17 = [
  ev("shower-rose-existing-photos", "geotagged_photograph", "Existing shower-rose eligibility evidence", [...GEO_PHOTO_POLICY, "existing product eligibility before removal"]),
  ev("shower-rose-invoice", "invoice_or_proof_of_purchase", "Low-flow shower-rose invoice or proof of purchase", ["installed product details"]),
  ev("shower-rose-stock-reconciliation", "record", "Stock reconciliation", ["installed and removed product quantities reconcile"]),
  ev("shower-rose-decommission-record", "record", "Decommissioned product record", ["decommissioned product evidenced, for example by recycling invoice"]),
] as const;

const EVIDENCE_22_24_25 = [
  ev("retail-product-invoice", "invoice_or_proof_of_purchase", "Retail product invoice or proof of purchase", [
    "sold or installed product details",
    "purchase or installation date",
    "consumer and retailer or supplier business",
    "price and consumer amount paid for each product",
  ]),
] as const;

const EVIDENCE_26 = [
  ev("pool-pump-invoice", "invoice_or_proof_of_purchase", "Pool-pump invoice or proof of purchase", ["installed product details", "purchase or installation date", "consumer and installer business", "consumer amount paid"]),
  ev("pool-pump-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work and installation address"], "when required by law"),
  ev("pool-pump-plumbing-certificate", "certificate", "BPC compliance certificate", ["nature of work and installation address"], "when required by law"),
] as const;

const EVIDENCE_27 = [
  ev("public-lighting-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work and installation address"], "when required by law"),
  ev("public-lighting-authority-contract", "record", "Consumer and asset-owner authority contract", ["consumer", "luminaire ownership", "asset-owner approval where consumer is not owner"]),
  ev("public-lighting-recycling", "record", "Baseline lighting recycling invoice", ["decommissioned baseline lighting equipment"]),
  ev("public-lighting-inventory", "record", "Public-lighting inventory", ["location and details of existing and installed lighting equipment"]),
  ev("public-lighting-design", "diagram_or_plan", "Public-lighting design and compliance declaration", ["existing and upgraded equipment location and details", "AS/NZS 1158 compliance or justified deviation", "lighting-designer declaration signed by energy consumer"]),
] as const;

const EVIDENCE_28 = [
  ev("ductwork-photos", "geotagged_photograph", "Gas ductwork evidence", [...GEO_PHOTO_POLICY, "existing products before upgrade", "installed products installed to VEU requirements", "decommissioned existing products where applicable"]),
  ev("ductwork-invoice", "invoice_or_proof_of_purchase", "Gas ductwork invoice or proof of purchase", ["installed product details", "purchase or installation date", "consumer and installer business", "price and consumer amount paid"]),
  ev("ductwork-plumbing-certificate", "certificate", "BPC compliance certificate", ["nature of work"], "when required by law"),
  ev("ductwork-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work"], "when required by law"),
] as const;

const EVIDENCE_30 = [
  ev("display-photos", "geotagged_photograph", "In-home display installation evidence", [...GEO_PHOTO_POLICY, "installed product details and compliant installation", "paired consumer app for scenario 30B", "consumer energy bill"]),
  ev("display-invoice", "invoice_or_proof_of_purchase", "In-home display invoice or proof of purchase", ["installed product details", "purchase or installation date", "consumer and installer business", "consumer amount paid"]),
  ev("display-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work and installation address"], "when required by law"),
  ev("display-dnsp-report", "record", "DNSP installation report", ["successful product installation"], "scenario 30A only"),
] as const;

const EVIDENCE_31 = [
  ev("motor-invoice", "invoice_or_proof_of_purchase", "Motor invoice or proof of purchase", ["installed product details", "purchase or installation date", "consumer and installer business", "price and consumer amount paid"]),
  ev("motor-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work"], "when required by law"),
  ev("motor-fit-declaration", "declaration", "Motor installation fit-for-purpose declaration", ["installer declaration signed by consumer", "work complies with VEU requirements and is fit for purpose"]),
] as const;

const EVIDENCE_32 = [
  ev("cabinet-photos", "geotagged_photograph", "Refrigerated-cabinet installation evidence", [...GEO_PHOTO_POLICY, "pre-installation environment", "installed products after successful installation"]),
  ev("cabinet-invoice", "invoice_or_proof_of_purchase", "Refrigerated-cabinet invoice or proof of purchase", ["installed product details", "purchase or installation date", "consumer and installer business", "consumer amount paid"]),
  ev("cabinet-certificates", "certificate", "Applicable plumbing and electrical certificates", ["nature of work and installation address"], "when required by law"),
  ev("cabinet-product-sheet", "technical_document", "Product specification sheet", ["one specification sheet for each installed product"]),
  ev("cabinet-fit-declaration", "declaration", "Refrigerated-cabinet fit-for-purpose declaration", ["installer declaration signed by consumer", "work complies with VEU requirements and is fit for purpose"]),
] as const;

const EVIDENCE_33 = [
  ev("fan-motor-invoice", "invoice_or_proof_of_purchase", "Fan-motor invoice or proof of purchase", ["installed product details", "purchase or installation date", "consumer and installer business", "consumer amount paid"]),
  ev("fan-motor-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work and installation address"], "when required by law"),
  ev("fan-motor-plumbing-certificate", "certificate", "BPC compliance certificate", ["nature of work", "installation address", "licensed refrigeration technician where refrigerant is handled"], "when required by law"),
  ev("fan-motor-fit-declaration", "declaration", "Fan-motor fit-for-purpose declaration", ["installer declaration signed by consumer", "work complies with VEU requirements and is fit for purpose"]),
] as const;

const EVIDENCE_34 = [
  ev("building-lighting-photos", "geotagged_photograph", "Building-lighting installation evidence", [...GEO_PHOTO_POLICY, "space types and baseline lighting arrangement", "baseline and upgrade lighting configuration", "decommissioned lighting", "air-conditioning status where applicable"]),
  ev("building-lighting-space-evidence", "record", "High-operating-hours space evidence", ["space type or building classification"], "spaces claimed above 4,500 annual operating hours"),
  ev("building-lighting-invoice", "invoice_or_proof_of_purchase", "Building-lighting invoice or proof of purchase", ["installed products", "purchase or installation date", "consumer and installer business"]),
  ev("building-lighting-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work and installation address"], "when required by law"),
  ev("building-lighting-electricity-invoice", "record", "Retailer electricity invoice", ["power connected to upgrade site before activity date"]),
  ev("building-lighting-recycling", "record", "Baseline lighting decommissioning and recycling record", ["existing equipment disposed of at recycling facilities"]),
  ev("building-lighting-plan", "diagram_or_plan", "Reflective ceiling plan or site plan", ["all upgraded areas and dimensions", "space types", "baseline and upgrade equipment"]),
  ev("building-lighting-compliance", "declaration", "AS/NZS 1680 compliance or exemption record", ["compliance declaration and optional design or lux output for upgrades below 100 VEECs", "qualified lighting-designer signed exemption report where the upgrade does not comply", "AS/NZS 2293.1 evidence for maintained emergency lighting"]),
] as const;

const EVIDENCE_35 = [
  ev("nonbuilding-lighting-photos", "geotagged_photograph", "Non-building lighting installation evidence", [...GEO_PHOTO_POLICY, "baseline equipment in original position with lights on", "upgrade equipment after installation", "decommissioned equipment"]),
  ev("nonbuilding-lighting-invoice", "invoice_or_proof_of_purchase", "Non-building lighting invoice or proof of purchase", ["installed products", "purchase or installation date", "consumer and installer business"]),
  ev("nonbuilding-lighting-consumer", "record", "Consumer of premises evidence", ["electricity invoice, land title, council rates notice or equivalent evidence"]),
  ev("nonbuilding-lighting-electrical-certificate", "certificate", "Certificate of electrical safety", ["upgrade address and nature of work"], "when required by law"),
  ev("nonbuilding-lighting-recycling", "record", "Baseline lighting decommissioning and recycling record", ["existing equipment disposed of at recycling facilities"]),
  ev("nonbuilding-lighting-design", "diagram_or_plan", "Non-building lighting design and declaration", ["AS/NZS 1158 or AS/NZS 2560 compliance, justified deviation or commission-approved illuminance standard", "existing and installed lighting location and specification", "lighting-designer declaration signed by consumer"]),
] as const;

const EVIDENCE_36 = [
  ev("spray-valve-invoice", "invoice_or_proof_of_purchase", "Pre-rinse spray-valve invoice or proof of purchase", ["installed product details", "purchase or installation date", "consumer and installer business"]),
  ev("spray-valve-photos", "geotagged_photograph", "Pre-rinse spray-valve installation evidence", [...GEO_PHOTO_POLICY, "pre-installation environment", "installed product after installation"]),
  ev("spray-valve-plumbing-certificate", "certificate", "BPC compliance certificate", ["installation address and nature of work"], "when required by law"),
  ev("spray-valve-decommissioning", "record", "Removed pre-rinse spray-valve decommissioning evidence", ["all removed valves decommissioned"], "scenario 36A(i) only"),
] as const;

const EVIDENCE_37_42 = [
  ev("gas-efficiency-invoice", "invoice_or_proof_of_purchase", "Gas-efficiency invoice or proof of purchase", ["installed equipment", "energy consumer", "purchase or installation date", "installation address", "installer business"]),
  ev("type-b-acceptance", "certificate", "Type B appliance acceptance records", ["application to ESV and/or BPC", "ESV compliance plate and final acceptance letter"]),
  ev("gas-efficiency-photos", "geotagged_photograph", "Gas-efficiency installation evidence", [...GEO_PHOTO_POLICY, "baseline appliance in situ and connected", "baseline and upgrade equipment details", "baseline decommissioning for activities 37, 38 and 42", "upgrade installation"]),
  ev("gas-baseline-specification", "technical_document", "Baseline appliance manufacturer specification", ["baseline appliance details when nameplate is insufficient"]),
  ev("gas-upgrade-specification", "technical_document", "Upgrade equipment manufacturer specification", ["upgrade appliance or equipment details"]),
  ev("gas-type-b-schematic", "diagram_or_plan", "Type B appliance schematic", ["appliances upgraded in the VEU activity"]),
  ev("gas-thermal-efficiency", "technical_document", "Thermal-efficiency evidence", ["appliance thermal-efficiency requirement"], "activities 37 and 38 only"),
] as const;

const EVIDENCE_43 = [
  ev("cold-room-invoice", "invoice_or_proof_of_purchase", "Cold-room invoice or proof of purchase", ["installed products", "purchase or installation date", "installation address", "consumer and installer business", "consumer amount paid"]),
  ev("cold-room-certificates", "certificate", "Applicable plumbing and electrical certificates", ["nature of work"], "when required by law"),
  ev("cold-room-data-sheets", "technical_document", "Installed-part technical data sheets", ["details of all installed parts"]),
  ev("cold-room-schematic", "diagram_or_plan", "Refrigeration-system schematic", ["shared compressors and/or condensers"], "multiple cold rooms share compressors or condensers"),
  ev("cold-room-dimensions", "record", "Cold-room internal-dimensions record", ["internal floor area"]),
  ev("cold-room-43a-photos", "geotagged_photograph", "Scenario 43A installation evidence", [...GEO_PHOTO_POLICY, "installed parts", "all parts connected to refrigeration system", "room set point or actual controller temperature"], "scenario 43A"),
  ev("cold-room-43b-evidence", "geotagged_photograph", "Scenario 43B installed-part evidence", [...GEO_PHOTO_POLICY, "installed-part details or manufacturer document", "all parts connected to refrigeration system"], "scenario 43B(i) or 43B(ii)"),
] as const;

const EVIDENCE_44 = [
  ev("ci-water-heater-photos", "geotagged_photograph", "Commercial or industrial heat-pump water-heater evidence", [...GEO_PHOTO_POLICY, "installed product details and compliant installation", "existing product before upgrade for scenarios 44A(i) and 44A(ii)"]),
  ev("ci-water-heater-existing-product", "record", "Existing water-heater product record", ["geotagged product detail or manufacturer document when compliance plate is unreadable"], "scenarios 44A(i) and 44A(ii)"),
  ev("ci-water-heater-invoice", "invoice_or_proof_of_purchase", "Commercial or industrial water-heater invoice", ["installed product details", "purchase or installation date", "consumer and upgrade manager business", "installation address", "price and consumer amount paid"]),
  ev("ci-water-heater-certificates", "certificate", "Applicable plumbing and electrical certificates", ["nature of work including decommissioning where applicable", "upgrade address"], "when required by law"),
] as const;

const EVIDENCE_46 = [
  ev("cooktop-invoice", "invoice_or_proof_of_purchase", "Induction-cooking invoice or proof of purchase", ["sold product details", "purchase date", "consumer and retailer or supplier business", "consumer amount paid"]),
  ev("cooktop-gas-connection", "record", "Residential gas or LPG connection evidence", ["consumer residential premises has a gas or LPG connection"]),
] as const;

const EVIDENCE_47 = [
  ev("solar-quote-design", "technical_document", "Consumer quote and site-specific design and performance documents", ["system components", "product and installation warranties", "expected performance", "system price and consumer amount payable"]),
  ev("solar-invoice", "invoice_or_proof_of_purchase", "Commercial or industrial solar invoice", ["installed components", "installation address and invoice date", "consumer and retailer or supplier", "system price", "VEEC and other incentives", "consumer amount paid"]),
  ev("solar-component-data", "technical_document", "Solar component technical data sheets", ["inverters", "PV modules", "batteries where applicable"]),
  ev("solar-stage-photos", "geotagged_photograph", "Solar installation stage and identity evidence", [...GEO_PHOTO_POLICY, "lead installer identity at pre-installation, mid-installation and post-installation", "installed inverter and PV panel details", "components installed at the location"]),
  ev("solar-monitoring-portal", "record", "Monitoring portal record", ["portal interface meets VEU requirements"]),
  ev("solar-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of work"]),
  ev("solar-lei-checklist", "declaration", "Licensed Electrical Inspector assessment checklist", ["Annexure D checklist completed and signed by the LEI"]),
  ev("solar-single-line-diagram", "diagram_or_plan", "Solar single-line diagram", ["designer and site address", "layout and system details", "electrical configuration", "existing and new components"]),
  ev("solar-dnsp-approval", "record", "DNSP connection approval", ["documented connection approval"]),
] as const;

const EVIDENCE_48 = [
  ev("insulation-tax-invoice", "invoice_or_proof_of_purchase", "Ceiling-insulation tax invoice", ["invoice date", "consumer and installer business", "installed products", "product price and consumer amount paid"]),
  ev("insulation-identity-and-product-photos", "geotagged_photograph", "Ceiling-insulation identity, safety and product evidence", [...GEO_PHOTO_POLICY, "applicable electrician identity during pre-installation assessment", "licensed electrician identity on installation day where required", "each insulation installer identity", "existing R-value where under-insulated", "installed product R-value", "power isolation", "installed product details"]),
  ev("insulation-life-support-consent", "record", "Life-support consent or medical plan", ["written consent or medical plan permits installation"], "resident depends on life-support equipment"),
  ev("insulation-installer-safety-form", "declaration", "VEU pre-installation installer safety assessment", ["completed and signed by lead installer"]),
  ev("insulation-electrical-safety-form", "declaration", "VEU pre-installation electrical safety assessment", ["completed and signed by applicable electrician"]),
  ev("insulation-electrical-certificate", "certificate", "Certificate of electrical safety", ["nature of rectification work"], "electrical rectification requiring a certificate was completed before insulation"),
  ev("insulation-video", "video", "Ceiling-insulation pre- and post-installation video", ["pre-installation environment and existing insulation", "post-installation coverage and depth", "all eligible practical areas insulated", "waste removed from roof space"]),
  ev("insulation-floorplan", "diagram_or_plan", "Insulated roof-space floorplan", ["total installed area in square metres", "installed product details"]),
] as const;

const ACTIVITY_EVIDENCE = {
  "1": EVIDENCE_1_3,
  "3": EVIDENCE_1_3,
  "6": EVIDENCE_6,
  "13": EVIDENCE_13_14,
  "14": EVIDENCE_13_14,
  "15": EVIDENCE_15,
  "17": EVIDENCE_17,
  "22": EVIDENCE_22_24_25,
  "24": EVIDENCE_22_24_25,
  "25": EVIDENCE_22_24_25,
  "26": EVIDENCE_26,
  "27": EVIDENCE_27,
  "28": EVIDENCE_28,
  "30": EVIDENCE_30,
  "31": EVIDENCE_31,
  "32": EVIDENCE_32,
  "33": EVIDENCE_33,
  "34": EVIDENCE_34,
  "35": EVIDENCE_35,
  "36": EVIDENCE_36,
  "37": EVIDENCE_37_42,
  "38": EVIDENCE_37_42,
  "39": EVIDENCE_37_42,
  "40": EVIDENCE_37_42,
  "41": EVIDENCE_37_42,
  "42": EVIDENCE_37_42,
  "43": EVIDENCE_43,
  "44": EVIDENCE_44,
  "46": EVIDENCE_46,
  "47": EVIDENCE_47,
  "48": EVIDENCE_48,
} as const satisfies Record<CreditexCurrentVeuActivityCode, readonly EvidenceSeed[]>;

type PromptSeed = Omit<CreditexVeuPromptRequirement, "source">;

const COMMON_ASSIGNMENT_PROMPTS = [
  {
    key: "consumer_rights_information",
    label: "Consumer rights information from the applicable activity assignment form template",
    kind: "assignment",
    required: true,
    valueSource: "operator",
    unit: null,
    when: "before the assignment is completed",
  },
  {
    key: "consumer_details",
    label: "Consumer details from the applicable activity assignment form template",
    kind: "identity",
    required: true,
    valueSource: "job",
    unit: null,
    when: "always",
  },
  {
    key: "consumer_or_authorised_signatory_declaration",
    label: "Consumer or authorised signatory declaration from the applicable activity assignment form template",
    kind: "assignment",
    required: true,
    valueSource: "operator",
    unit: null,
    when: "at assignment",
  },
  {
    key: "installer_details_company_and_licences",
    label: "Installer details, company, licences and registrations from the applicable activity assignment form template",
    kind: "identity",
    required: true,
    valueSource: "assigned_trade",
    unit: null,
    when: "always",
  },
  {
    key: "installer_declaration",
    label: "Installer declaration from the applicable activity assignment form template",
    kind: "assignment",
    required: true,
    valueSource: "operator",
    unit: null,
    when: "at assignment",
  },
  {
    key: "installed_product_details",
    label: "Installed product details from the applicable activity assignment form template",
    kind: "product",
    required: true,
    valueSource: "approved_product",
    unit: null,
    when: "always",
  },
  {
    key: "creditex_accredited_person",
    label: "Accredited person receiving the VEEC assignment",
    kind: "identity",
    required: true,
    valueSource: "creditex_provider",
    unit: null,
    when: "always",
  },
] as const satisfies readonly PromptSeed[];

const CERTIFICATE_DETAIL_ACTIVITY_CODES = new Set<CreditexCurrentVeuActivityCode>([
  "1",
  "3",
  "6",
  "15",
  "27",
  "28",
  "30",
  "31",
  "32",
  "33",
  "34",
  "35",
  "43",
  "44",
  "47",
]);

const DECOMMISSIONING_DETAIL_ACTIVITY_CODES = new Set<CreditexCurrentVeuActivityCode>([
  "1",
  "3",
  "6",
  "36",
  "37",
  "38",
]);

const PREINSTALL_DETAIL_ACTIVITY_CODES = new Set<CreditexCurrentVeuActivityCode>([
  "1",
  "3",
  "6",
  "43",
]);

const SCOPE_AGREEMENT_ACTIVITY_CODES = new Set<CreditexCurrentVeuActivityCode>([
  "1",
  "3",
  "6",
]);

const COPAYMENT_DETAIL_ACTIVITY_CODES = new Set<CreditexCurrentVeuActivityCode>([
  "1",
  "3",
  "6",
  "44",
  "46",
  "48",
]);

type ProductSeed = Omit<CreditexVeuProductRequirement, "source" | "requiredAttributes"> & {
  additionalRequiredAttributes: readonly string[];
};

const VEU_REGISTER_PRODUCT_CODES = new Set<CreditexCurrentVeuActivityCode>([
  "1",
  "3",
  "6",
  "13",
  "14",
  "15",
  "17",
  "26",
  "28",
  "30",
  "33",
  "34",
  "35",
  "36",
  "44",
  "46",
  "48",
]);

const GEMS_REGISTER_PRODUCT_CODES = new Set<CreditexCurrentVeuActivityCode>([
  "22",
  "24",
  "25",
  "31",
  "32",
]);

function productSeed(activityCode: CreditexCurrentVeuActivityCode): ProductSeed {
  if (VEU_REGISTER_PRODUCT_CODES.has(activityCode)) {
    return {
      applicability: "required",
      productKind: "veu_register",
      additionalRequiredAttributes: [
        "installation-date VEU product approval",
        "manufacturer",
        "model",
      ],
      registrySnapshotRequired: true,
    };
  }

  if (GEMS_REGISTER_PRODUCT_CODES.has(activityCode)) {
    return {
      applicability: "required",
      productKind: "gems_register",
      additionalRequiredAttributes: [
        "installation-date GEMS registration",
        "manufacturer",
        "model",
      ],
      registrySnapshotRequired: true,
    };
  }

  if (activityCode === "27") {
    return {
      applicability: "required",
      productKind: "veu_register_or_aemo_approved",
      additionalRequiredAttributes: [
        "VEU register status by certificate creation or AEMO NEM load-table status at installation",
        "manufacturer",
        "model",
      ],
      registrySnapshotRequired: true,
    };
  }

  if (["37", "38", "39", "40", "41", "42"].includes(activityCode)) {
    return {
      applicability: "required",
      productKind: "manufacturer_documented_gas_equipment",
      additionalRequiredAttributes: [
        "manufacturer",
        "model",
        "serial number",
        "manufacturer technical specification",
      ],
      registrySnapshotRequired: false,
    };
  }

  if (activityCode === "43") {
    return {
      applicability: "required",
      productKind: "installed_cold_room_component_set",
      additionalRequiredAttributes: [
        "installed-part details",
        "manufacturer technical data sheets",
        "refrigeration-system configuration",
      ],
      registrySnapshotRequired: false,
    };
  }

  return {
    applicability: "required",
    productKind: "clean_energy_council_approved_solar_components",
    additionalRequiredAttributes: [
      "installation-date Clean Energy Council approved module listing",
      "installation-date Clean Energy Council approved inverter listing",
      "Solar Panel Validation Initiative participating brand for scenario 47A",
      "total rated solar photovoltaic module power output in kW",
      "total connected inverter capacity in kVA",
      "module warranty years",
      "inverter warranty years",
    ],
    registrySnapshotRequired: true,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function calculatorDefinitionsForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
): readonly CreditexVeuActivityDefinition[] {
  if (activityCode === "1") {
    return CREDITEX_VEU_ACTIVITY_DEFINITIONS.filter((definition) =>
      ["1C", "1D"].includes(definition.activityCode),
    );
  }

  if (activityCode === "3") {
    return CREDITEX_VEU_ACTIVITY_DEFINITIONS.filter((definition) =>
      ["3C", "3D"].includes(definition.activityCode),
    );
  }

  return CREDITEX_VEU_ACTIVITY_DEFINITIONS.filter(
    (definition) => definition.activityCode === activityCode,
  );
}

function promptValueSource(
  value: "operator" | "approved_product" | "postcode_lookup",
): CreditexVeuPromptRequirement["valueSource"] {
  return value;
}

function inputCondition(
  definition: CreditexVeuActivityDefinition["inputDefinitions"][number],
): string {
  const condition = definition.showWhen;
  if (!condition) return "always";
  if (condition.oneOf) return `${condition.key} is one of ${condition.oneOf.join(", ")}`;
  if (condition.notOneOf) return `${condition.key} is not one of ${condition.notOneOf.join(", ")}`;
  return `conditional on ${condition.key}`;
}

function inputPromptKind(
  definition: CreditexVeuActivityDefinition["inputDefinitions"][number],
): CreditexVeuPromptRequirement["kind"] {
  if (definition.source === "approved_product") return "product";
  if (
    definition.key.includes("confirmed") ||
    definition.key.includes("requirements") ||
    definition.key.includes("prior_")
  ) {
    return "eligibility";
  }
  return "calculation";
}

function activitySpecificAssignmentPrompts(
  activityCode: CreditexCurrentVeuActivityCode,
): PromptSeed[] {
  const prompts: PromptSeed[] = [];
  if (CERTIFICATE_DETAIL_ACTIVITY_CODES.has(activityCode)) {
    prompts.push({
      key: "issued_certificate_details",
      label: "Certificate details from the applicable activity assignment form template",
      kind: "assignment",
      required: true,
      valueSource: "operator",
      unit: null,
      when: "certificates are issued for the activity",
    });
  }
  if (DECOMMISSIONING_DETAIL_ACTIVITY_CODES.has(activityCode)) {
    prompts.push({
      key: "decommissioning_scenario_method_and_product_details",
      label: "Decommissioning scenario, method and decommissioned product details from the applicable activity assignment form template",
      kind: "assignment",
      required: true,
      valueSource: "operator",
      unit: null,
      when: "the activity includes decommissioning",
    });
  }
  if (PREINSTALL_DETAIL_ACTIVITY_CODES.has(activityCode)) {
    prompts.push({
      key: "preinstallation_environment_and_sizing_details",
      label: "Pre-installation environment and installation sizing details from the applicable activity assignment form template",
      kind: "eligibility",
      required: true,
      valueSource: "operator",
      unit: null,
      when: "always",
    });
  }
  if (SCOPE_AGREEMENT_ACTIVITY_CODES.has(activityCode)) {
    prompts.push({
      key: "decommissioning_scope_agreement",
      label: "Installer and consumer agreement on decommissioning scope",
      kind: "assignment",
      required: true,
      valueSource: "operator",
      unit: null,
      when: "before installation",
    });
  }
  if (COPAYMENT_DETAIL_ACTIVITY_CODES.has(activityCode)) {
    prompts.push({
      key: "consumer_copayment_details",
      label: "Consumer co-payment details from the applicable activity assignment form template",
      kind: "assignment",
      required: true,
      valueSource: "operator",
      unit: "AUD including GST",
      when: "always",
    });
  }
  return prompts;
}

function part47CalculatorPrompts(): PromptSeed[] {
  const promptRows: readonly [
    key: string,
    label: string,
    unit: string,
    valueSource: CreditexVeuPromptRequirement["valueSource"],
  ][] = [
    ["scenario", "Commercial and industrial solar photovoltaic system scenario", "scenario", "operator"],
    ["system_size_kw", "Total rated solar photovoltaic module power output", "kW", "approved_product"],
    ["input_factor", "System-size input factor", "factor", "derived_from_formula"],
    ["lifetime_years", "Lifetime", "years", "derived_from_formula"],
    ["regional_factor", "Regional factor", "factor", "postcode_lookup"],
    ["total_connected_inverter_capacity_kva", "Total connected inverter capacity", "kVA", "approved_product"],
    ["solar_panel_validation_participating_brand", "Solar Panel Validation Initiative participating brand", "confirmation", "official_registry"],
    ["monitoring_portal_requirements_confirmed", "Monitoring portal requirements", "confirmation", "operator"],
    ["saa_system_sizing_requirements_confirmed", "Solar Accreditation Australia system sizing requirements", "confirmation", "operator"],
    ["module_warranty_years", "Solar photovoltaic module warranty", "years", "approved_product"],
    ["inverter_warranty_years", "Inverter warranty", "years", "approved_product"],
  ];
  return promptRows.map(([key, label, unit, valueSource]) => ({
    key,
    label,
    kind: key === "scenario" || key.endsWith("confirmed") ? "eligibility" : key.includes("warranty") ? "product" : "calculation",
    required: true,
    valueSource,
    unit,
    when: key === "solar_panel_validation_participating_brand" ? "scenario 47A" : "always",
  }));
}

function promptsForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
  definitions: readonly CreditexVeuActivityDefinition[],
): CreditexVeuPromptRequirement[] {
  const source = bindSource("guidelinesV16", "clauses 8.3-8.6, pp. 40-42");
  const specificationSource = bindSource(
    "specificationV25",
    ACTIVITY_SOURCE_PAGES[activityCode].specification,
  );
  const seeds: PromptSeed[] = [
    ...COMMON_ASSIGNMENT_PROMPTS,
    ...activitySpecificAssignmentPrompts(activityCode),
  ];

  if (activityCode === "47") {
    seeds.push(...part47CalculatorPrompts());
  } else {
    for (const definition of definitions) {
      for (const input of definition.inputDefinitions) {
        if (seeds.some((seed) => seed.key === input.key)) continue;
        seeds.push({
          key: input.key,
          label: input.label,
          kind: inputPromptKind(input),
          required: input.required,
          valueSource: promptValueSource(input.source),
          unit: input.unit || null,
          when: inputCondition(input),
        });
      }
    }
  }

  return seeds.map((seed) => ({
    ...seed,
    source: COMMON_ASSIGNMENT_PROMPTS.some((prompt) => prompt.key === seed.key) ||
      activitySpecificAssignmentPrompts(activityCode).some((prompt) => prompt.key === seed.key)
      ? source
      : specificationSource,
  }));
}

function productForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
  definitions: readonly CreditexVeuActivityDefinition[],
): CreditexVeuProductRequirement {
  const seed = productSeed(activityCode);
  const calculatorAttributes = definitions.flatMap(
    (definition) => definition.productPerformanceInputs,
  );
  const sourceCitation = activityCode === "47"
    ? "Part 47, pp. 136-138, Tables 47.1-47.3"
    : ACTIVITY_SOURCE_PAGES[activityCode].specification;
  return {
    applicability: seed.applicability,
    productKind: seed.productKind,
    requiredAttributes: uniqueStrings([
      ...calculatorAttributes,
      ...seed.additionalRequiredAttributes,
    ]),
    registrySnapshotRequired: seed.registrySnapshotRequired,
    source: bindSource("specificationV25", sourceCitation),
  };
}

function scenarioCodesForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
  definitions: readonly CreditexVeuActivityDefinition[],
): readonly string[] {
  if (activityCode === "47") return ["47A", "47B"];
  return uniqueStrings(definitions.flatMap((definition) => definition.scenarios));
}

function calculatorForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
  definitions: readonly CreditexVeuActivityDefinition[],
): CreditexVeuCalculatorRequirement {
  if (activityCode === "47") {
    return {
      outputUnit: "VEEC",
      formulas: [
        {
          formulaKey: "veu-part-47-equation-47.1/v1",
          scenarioCodes: ["47A", "47B"],
          inputKeys: [
            "system_size_kw",
            "input_factor",
            "lifetime_years",
            "regional_factor",
          ],
          source: bindSource(
            "specificationV25",
            "Part 47, p. 138, Equation 47.1 and Table 47.3",
          ),
        },
      ],
      activationStatus: "candidate_not_approved",
      officialGoldenVectorStatus: "missing",
    };
  }

  return {
    outputUnit: "VEEC",
    formulas: definitions.map((definition) => ({
      formulaKey: definition.formulaKey,
      scenarioCodes: definition.scenarios,
      inputKeys: definition.inputDefinitions.map((input) => input.key),
      source: bindSource(
        "specificationV25",
        activityCode === "6"
          ? "Part 6, pp. 25-37, Equations 6.1-6.5 and Tables 6.2-6.11"
          : activityCode === "44"
            ? "Part 44, pp. 124-131, Equations 44.1-44.3 and Tables 44.2-44.6"
            : definition.sourcePages,
      ),
    })),
    activationStatus: "candidate_not_approved",
    officialGoldenVectorStatus: "missing",
  };
}

function signaturesForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
): CreditexVeuSignatureRequirement[] {
  const assignmentSource = bindSource(
    "guidelinesV16",
    "clauses 8.4 and 8.6, pp. 40-42",
  );
  const evidenceSource = bindSource(
    "guidelinesV16",
    ACTIVITY_SOURCE_PAGES[activityCode].minimumRecords,
  );
  const signatures: CreditexVeuSignatureRequirement[] = [
    {
      signatureId: "consumer-assignment-signature",
      documentType: "VEEC assignment form",
      signerRole: "consumer_or_authorised_signatory",
      required: true,
      when: "at assignment",
      visibleSignatureBox: true,
      source: assignmentSource,
    },
    {
      signatureId: "installer-declaration-signature",
      documentType: "VEEC assignment form",
      signerRole: "installer",
      required: true,
      when: "at assignment",
      visibleSignatureBox: true,
      source: assignmentSource,
    },
    {
      signatureId: "assignee-paper-assignment-signature",
      documentType: "VEEC assignment form",
      signerRole: "creditex_accredited_person_assignee",
      required: true,
      when: "paper assignment form",
      visibleSignatureBox: true,
      source: assignmentSource,
    },
  ];

  if (["31", "32", "33"].includes(activityCode)) {
    signatures.push({
      signatureId: `activity-${activityCode}-fit-declaration-consumer-signature`,
      documentType: "Installation fit-for-purpose declaration",
      signerRole: "consumer_or_authorised_signatory",
      required: true,
      when: "at completion of the declaration",
      visibleSignatureBox: true,
      source: evidenceSource,
    });
  }

  if (activityCode === "27" || activityCode === "35") {
    signatures.push(
      {
        signatureId: `activity-${activityCode}-lighting-designer-signature`,
        documentType: "Lighting design and compliance declaration",
        signerRole: "lighting_designer",
        required: true,
        when: "at completion of the lighting design declaration",
        visibleSignatureBox: true,
        source: evidenceSource,
      },
      {
        signatureId: `activity-${activityCode}-lighting-consumer-signature`,
        documentType: "Lighting design and compliance declaration",
        signerRole: "consumer_or_authorised_signatory",
        required: true,
        when: "at completion of the lighting design declaration",
        visibleSignatureBox: true,
        source: evidenceSource,
      },
    );
  }

  if (activityCode === "34") {
    signatures.push({
      signatureId: "activity-34-lighting-exemption-signature",
      documentType: "AS/NZS 1680 exemption report",
      signerRole: "lighting_designer",
      required: true,
      when: "the upgrade does not comply with AS/NZS 1680",
      visibleSignatureBox: true,
      source: evidenceSource,
    });
  }

  if (activityCode === "47") {
    signatures.push({
      signatureId: "activity-47-lei-checklist-signature",
      documentType: "Licensed Electrical Inspector assessment checklist",
      signerRole: "licensed_electrical_inspector",
      required: true,
      when: "at completion of the Annexure D checklist",
      visibleSignatureBox: true,
      source: evidenceSource,
    });
  }

  if (activityCode === "48") {
    signatures.push(
      {
        signatureId: "activity-48-lead-installer-safety-signature",
        documentType: "VEU pre-installation installer safety assessment",
        signerRole: "lead_installer",
        required: true,
        when: "before installation",
        visibleSignatureBox: true,
        source: evidenceSource,
      },
      {
        signatureId: "activity-48-electrician-safety-signature",
        documentType: "VEU pre-installation electrical safety assessment",
        signerRole: "applicable_electrician",
        required: true,
        when: "an applicable electrician undertakes the assessment",
        visibleSignatureBox: true,
        source: evidenceSource,
      },
    );
  }

  return signatures;
}

function referenceDocumentsForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
): CreditexVeuSourceBinding[] {
  const references = [
    bindSource("schemeFactsheet", "whole document"),
  ];
  if (activityCode === "1" || activityCode === "3") {
    references.push(bindSource("waterHeatingFactsheet", "whole document"));
  }
  if (activityCode === "6") {
    references.push(bindSource("spaceHeatingFactsheet", "whole document"));
  }
  if (activityCode === "46") {
    references.push(bindSource("cooktopFactsheet", "whole document"));
  }
  if (activityCode === "47") {
    references.push(bindSource("solarFaq", "whole document"));
  }
  return references;
}

function sourceBindingsForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
  product: CreditexVeuProductRequirement,
): CreditexVeuSourceBinding[] {
  const sources = [
    bindSource("act", "sections 16 and 72, pp. 38-39 and 119"),
    bindSource("regulations", `Schedules 1 and 2, prescribed activity ${activityCode}`),
    bindSource("specificationV25", ACTIVITY_SOURCE_PAGES[activityCode].specification),
    bindSource(
      "guidelinesV16",
      `clauses 8.3-8.6 and 9.1, pp. 40-43; ${ACTIVITY_SOURCE_PAGES[activityCode].minimumRecords}`,
    ),
    bindSource(
      "obligationsV38",
      activityCode === "46" || activityCode === "48"
        ? `Appendix B, pp. 25-28; version 3.8 has no activity ${activityCode} row`
        : `Appendix B, prescribed activity ${activityCode}, pp. 25-28`,
    ),
    bindSource("codeOfConductV13", "Introduction and general responsibilities, pp. 1-8"),
  ];

  if (["1", "3", "6", "28"].includes(activityCode)) {
    const activityGuideCitation = activityCode === "1" || activityCode === "3"
      ? "water-heating activity requirements, pp. 7-17; activity process and VEEC calculation, pp. 36-42"
      : "space-heating and cooling activity requirements, pp. 18-35; activity process and VEEC calculation, pp. 36-42";
    const productGuideCitation = activityCode === "1" || activityCode === "3"
      ? "water-heating product performance and documentation, pp. 7-16"
      : activityCode === "6"
        ? "high-efficiency air-conditioner product requirements, pp. 17-20"
        : "gas-heating ductwork product requirements, pp. 21-23";
    sources.push(
      bindSource("activityGuideV320", activityGuideCitation),
      bindSource("productGuideV30", productGuideCitation),
    );
  }
  if (product.productKind === "veu_register") {
    sources.push(
      bindSource("productApplicantGuideV20", "VEU Register and product application process, pp. 3-16"),
    );
  }
  sources.push(...referenceDocumentsForActivity(activityCode));

  return sources;
}

function finalDocumentNeedsForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
  evidenceRequirements: readonly CreditexVeuEvidenceRequirement[],
): CreditexVeuFinalDocumentNeed[] {
  const assignmentSource = bindSource(
    "guidelinesV16",
    "clauses 8.3-8.6, pp. 40-42",
  );
  const creationSource = bindSource(
    "guidelinesV16",
    "clause 9.1, pp. 42-43",
  );
  return [
    {
      documentType: "veu_assignment_form",
      label: `Completed and signed activity ${activityCode} VEEC assignment form`,
      required: true,
      when: "after the prescribed activity is undertaken and at assignment",
      format: "pdf",
      immutableAfterFinalisation: true,
      source: assignmentSource,
    },
    {
      documentType: "consumer_assignment_copy",
      label: "Consumer copy of the assignment form or compliant equivalent document",
      required: true,
      when: "at paper signing or within ten business days after electronic assignment",
      format: "pdf",
      immutableAfterFinalisation: true,
      source: assignmentSource,
    },
    ...evidenceRequirements.map((evidence) => ({
      documentType: `evidence:${evidence.requirementId}`,
      label: evidence.label,
      required: true,
      when: evidence.when,
      format: "original_evidence" as const,
      immutableAfterFinalisation: true as const,
      source: evidence.source,
    })),
    {
      documentType: "veu_registry_creation_record",
      label: "VEU Registry online creation-form record and certificate registration outcome",
      required: true,
      when: "certificate creation is authorised after independent review",
      format: "external_record",
      immutableAfterFinalisation: true,
      source: creationSource,
    },
  ];
}

function gapsForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
  product: CreditexVeuProductRequirement,
): CreditexVeuWorkPackContentCandidate["gaps"] {
  const gaps: CreditexVeuWorkPackContentCandidate["gaps"][number][] = [
    {
      code: "VEU_EXACT_ASSIGNMENT_FORM_TEMPLATE_MISSING",
      blocksActivation: true,
      detail: `The exact commission-published activity ${activityCode} assignment form template is not present with a captured source ID and SHA-256 in the current custody manifest.`,
    },
    {
      code: "VEU_REGISTRY_CREATION_SCHEMA_MISSING",
      blocksActivation: true,
      detail: `The exact current VEU Registry online creation-form schema for activity ${activityCode} is not present with a captured source ID and SHA-256.`,
    },
    {
      code: "VEU_OFFICIAL_CALCULATOR_GOLDEN_VECTOR_MISSING",
      blocksActivation: true,
      detail: `No independently approved official golden input and VEEC-output vector is bound to every formula branch for activity ${activityCode}.`,
    },
    {
      code: "VEU_INDEPENDENT_CREDITEX_REVIEW_REQUIRED",
      blocksActivation: true,
      detail: `Creditex has not independently approved and published this activity ${activityCode} candidate content.`,
    },
  ];

  if (product.registrySnapshotRequired) {
    gaps.push({
      code: "VEU_PRODUCT_REGISTER_SNAPSHOT_MISSING",
      blocksActivation: true,
      detail: `No installation-date product-listing snapshot with a captured source ID and SHA-256 is attached for activity ${activityCode}.`,
    });
  }
  if (!["1", "3", "6", "28"].includes(activityCode)) {
    gaps.push({
      code: "VEU_ACTIVITY_GUIDE_NOT_IN_CUSTODY",
      blocksActivation: true,
      detail: `No activity-${activityCode}-specific operational guide is present with a captured source ID and SHA-256 in the current custody manifest.`,
    });
  }
  if (
    product.registrySnapshotRequired &&
    product.productKind !== "clean_energy_council_approved_solar_components" &&
    !["1", "3", "6", "28"].includes(activityCode)
  ) {
    gaps.push({
      code: "VEU_ACTIVITY_PRODUCT_GUIDE_NOT_IN_CUSTODY",
      blocksActivation: true,
      detail: `No activity-${activityCode}-specific product application guide is present with a captured source ID and SHA-256 in the current custody manifest.`,
    });
  }
  if (activityCode === "46" || activityCode === "48") {
    gaps.push({
      code: "VEU_PARTICIPANT_REGISTRATION_GUIDANCE_MISSING",
      blocksActivation: true,
      detail: `Obligations and Program Guide v3.8 Appendix B does not contain an activity ${activityCode} scheme-participant row, and no later exact participant-registration artifact is present in custody.`,
    });
  }
  if (activityCode === "6") {
    gaps.push({
      code: "VEU_PART_6_TRANSITION_CONTRACT_INCOMPLETE",
      blocksActivation: true,
      detail: "The 21 July 2026 to 29 September 2026 rules and the 30 September 2026 capacity and co-payment transition have not been independently approved as separate effective-dated runtime contracts.",
    });
  }
  if (activityCode === "44") {
    gaps.push({
      code: "VEU_PART_44_PRODUCT_GUIDE_NOT_IN_CUSTODY",
      blocksActivation: true,
      detail: "Commercial and Industrial Air Source Heat Pump Water Heater Product Application Guide v2.2 is cited by the calculator catalogue but is not present with a captured source ID and SHA-256 in the current custody manifest.",
    });
  }
  if (activityCode === "47") {
    gaps.push({
      code: "VEU_PART_47_SOLAR_REGISTRY_AND_DNSP_CONTRACT_INCOMPLETE",
      blocksActivation: true,
      detail: "The installation-date approved-component lists, Solar Panel Validation record, DNSP negotiated connection contract and monitoring-portal verification are not represented by independently approved executable source contracts.",
    });
  }
  return gaps;
}

const CURRENT_ACTIVITY_CODE_SET: ReadonlySet<string> = new Set(
  CREDITEX_CURRENT_ACTIVITY_CODES,
);

function isCurrentActivityCode(
  value: string,
): value is CreditexCurrentVeuActivityCode {
  return CURRENT_ACTIVITY_CODE_SET.has(value);
}

type CurrentVeuTemplate = GovernmentActivityTemplate & {
  registryActivityCode: CreditexCurrentVeuActivityCode;
  catalogueState: "current" | "limited";
};

function isCurrentVeuTemplate(
  template: GovernmentActivityTemplate,
): template is CurrentVeuTemplate {
  return template.programCode === "VEU" &&
    isCurrentActivityCode(template.registryActivityCode) &&
    (template.catalogueState === "current" || template.catalogueState === "limited");
}

function transitionDatesForActivity(
  activityCode: CreditexCurrentVeuActivityCode,
): readonly string[] {
  if (activityCode === "6") return ["2026-07-21", "2026-09-30"];
  if (activityCode === "46") return ["2026-06-30", "2026-07-21"];
  return ["2026-07-21"];
}

function buildContentCandidate(
  template: CurrentVeuTemplate,
): CreditexVeuWorkPackContentCandidate {
  const activityCode = template.registryActivityCode;
  const definitions = calculatorDefinitionsForActivity(activityCode);
  if (activityCode !== "47" && definitions.length === 0) {
    throw new Error(`Missing VEU calculator definition for current activity ${activityCode}.`);
  }

  const product = productForActivity(activityCode, definitions);
  const evidenceSource = bindSource(
    "guidelinesV16",
    ACTIVITY_SOURCE_PAGES[activityCode].minimumRecords,
  );
  const evidenceRequirements = ACTIVITY_EVIDENCE[activityCode].map((evidence) => ({
    ...evidence,
    preserveOriginalMetadata:
      evidence.kind === "geotagged_photograph" || evidence.kind === "video",
    source: evidenceSource,
  }));
  const scenarios = scenarioCodesForActivity(activityCode, definitions);

  return {
    schema: CREDITEX_VEU_WORK_PACK_CONTENT_SCHEMA,
    programCode: "VEU",
    templateId: template.templateId,
    activityCode,
    title: template.title,
    specificationPart: template.specificationPart,
    catalogueState: template.catalogueState,
    statusDecision: {
      state: template.catalogueState,
      specificationEffectiveFrom: "2026-07-21",
      effectiveTo: null,
      transitionDates: transitionDatesForActivity(activityCode),
      source: bindSource(
        "specificationV25",
        activityCode === "6"
          ? "version-control table, p. 2; Part 6, pp. 25-37; 30 September 2026 transition"
          : "version-control table, p. 2; effective 21 July 2026",
      ),
    },
    identityBindings: {
      accreditedPerson: "creditex_provider_for_job",
      installerBusiness: "assigned_trade_business_for_job",
      assignedTechnician: "assigned_trade_technician_for_appointment",
      consumer: "job_customer_or_authorised_signatory",
    },
    sourceBindings: sourceBindingsForActivity(activityCode, product),
    prompts: promptsForActivity(activityCode, definitions),
    evidenceRequirements,
    product,
    scenarios: {
      applicability: "required",
      codes: scenarios,
      source: bindSource(
        "specificationV25",
        ACTIVITY_SOURCE_PAGES[activityCode].specification,
      ),
    },
    calculator: calculatorForActivity(activityCode, definitions),
    signatures: signaturesForActivity(activityCode),
    referenceDocuments: referenceDocumentsForActivity(activityCode),
    finalDocumentNeeds: finalDocumentNeedsForActivity(
      activityCode,
      evidenceRequirements,
    ),
    gaps: gapsForActivity(activityCode, product),
    candidateOnly: true,
    independentlyApproved: false,
    published: false,
    activationReady: false,
  };
}

const currentVeuTemplates = governmentActivityTemplates("VEU")
  .filter(isCurrentVeuTemplate)
  .sort(
    (left, right) =>
      CREDITEX_CURRENT_ACTIVITY_CODES.indexOf(left.registryActivityCode) -
      CREDITEX_CURRENT_ACTIVITY_CODES.indexOf(right.registryActivityCode),
  );

export const CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES:
readonly CreditexVeuWorkPackContentCandidate[] = currentVeuTemplates.map(
  buildContentCandidate,
);

export type CreditexVeuWorkPackContentValidation = {
  valid: boolean;
  errors: readonly string[];
  total: number;
  candidateContentCompleteCount: number;
  candidateContentCoveragePercent: number;
  activationReadyCount: number;
  activationCoveragePercent: number;
};

function sourceBindingErrors(
  label: string,
  source: CreditexVeuSourceBinding,
): string[] {
  const errors: string[] = [];
  if (!/^source-[a-f0-9]{20}$/.test(source.sourceId)) {
    errors.push(`${label} has an invalid source ID.`);
  }
  if (!/^[a-f0-9]{64}$/.test(source.expectedSha256)) {
    errors.push(`${label} has an invalid SHA-256.`);
  }
  if (!source.citation.trim()) {
    errors.push(`${label} is missing an exact citation.`);
  }
  if (source.operationallyApproved !== false) {
    errors.push(`${label} must remain operationally unapproved.`);
  }
  return errors;
}

function candidateSourceBindings(
  candidate: CreditexVeuWorkPackContentCandidate,
): readonly { label: string; source: CreditexVeuSourceBinding }[] {
  return [
    { label: "status decision", source: candidate.statusDecision.source },
    ...candidate.sourceBindings.map((source) => ({ label: "source binding", source })),
    ...candidate.prompts.map((prompt) => ({ label: `prompt ${prompt.key}`, source: prompt.source })),
    ...candidate.evidenceRequirements.map((evidence) => ({
      label: `evidence ${evidence.requirementId}`,
      source: evidence.source,
    })),
    { label: "product requirement", source: candidate.product.source },
    { label: "scenario requirement", source: candidate.scenarios.source },
    ...candidate.calculator.formulas.map((formula) => ({
      label: `formula ${formula.formulaKey}`,
      source: formula.source,
    })),
    ...candidate.signatures.map((signature) => ({
      label: `signature ${signature.signatureId}`,
      source: signature.source,
    })),
    ...candidate.referenceDocuments.map((source) => ({ label: "reference document", source })),
    ...candidate.finalDocumentNeeds.map((document) => ({
      label: `final document ${document.documentType}`,
      source: document.source,
    })),
  ];
}

function hasCompleteCandidateContent(
  candidate: CreditexVeuWorkPackContentCandidate,
): boolean {
  return candidate.sourceBindings.length > 0 &&
    candidate.prompts.length > 0 &&
    candidate.evidenceRequirements.length > 0 &&
    candidate.product.requiredAttributes.length > 0 &&
    candidate.scenarios.codes.length > 0 &&
    candidate.calculator.formulas.length > 0 &&
    candidate.calculator.formulas.every(
      (formula) => formula.scenarioCodes.length > 0 && formula.inputKeys.length > 0,
    ) &&
    candidate.signatures.length > 0 &&
    candidate.referenceDocuments.length > 0 &&
    candidate.finalDocumentNeeds.length > 0 &&
    candidate.gaps.length > 0;
}

export function validateCreditexVeuWorkPackContentCandidate(
  candidates: readonly CreditexVeuWorkPackContentCandidate[] =
    CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES,
): CreditexVeuWorkPackContentValidation {
  const errors: string[] = [];
  const expectedCodes = [...CREDITEX_CURRENT_ACTIVITY_CODES];
  const actualCodes = candidates.map((candidate) => candidate.activityCode);
  const uniqueCodes = new Set(actualCodes);
  const uniqueTemplateIds = new Set(candidates.map((candidate) => candidate.templateId));

  if (candidates.length !== expectedCodes.length) {
    errors.push(`Expected ${expectedCodes.length} current VEU candidates, received ${candidates.length}.`);
  }
  if (uniqueCodes.size !== candidates.length) {
    errors.push("VEU candidate activity codes must be unique.");
  }
  if (uniqueTemplateIds.size !== candidates.length) {
    errors.push("VEU candidate template IDs must be unique.");
  }
  if (actualCodes.join("|") !== expectedCodes.join("|")) {
    errors.push("VEU candidate activity codes do not exactly match the current ordered catalogue.");
  }
  if (candidates.some((candidate) => String(candidate.activityCode) === "45")) {
    errors.push("Closed activity 45 must not be present.");
  }

  for (const candidate of candidates) {
    const prefix = `VEU ${candidate.activityCode}`;
    if (candidate.schema !== CREDITEX_VEU_WORK_PACK_CONTENT_SCHEMA) {
      errors.push(`${prefix} has an invalid schema.`);
    }
    if (!hasCompleteCandidateContent(candidate)) {
      errors.push(`${prefix} is missing one or more required candidate-content sections.`);
    }
    if (
      candidate.candidateOnly !== true ||
      candidate.independentlyApproved !== false ||
      candidate.published !== false ||
      candidate.activationReady !== false
    ) {
      errors.push(`${prefix} must remain an unapproved, unpublished, activation-blocked candidate.`);
    }
    if (candidate.gaps.some((gap) => gap.blocksActivation !== true)) {
      errors.push(`${prefix} contains a gap that does not fail closed.`);
    }
    if (new Set(candidate.gaps.map((gap) => gap.code)).size !== candidate.gaps.length) {
      errors.push(`${prefix} contains duplicate gap codes.`);
    }
    if (
      !candidate.signatures.every((signature) => signature.visibleSignatureBox === true)
    ) {
      errors.push(`${prefix} must render every required signature as a visible signature box.`);
    }
    if (
      candidate.identityBindings.accreditedPerson !== "creditex_provider_for_job" ||
      candidate.identityBindings.installerBusiness !== "assigned_trade_business_for_job" ||
      candidate.identityBindings.assignedTechnician !== "assigned_trade_technician_for_appointment"
    ) {
      errors.push(`${prefix} has invalid provider, installer-business or technician identity bindings.`);
    }
    for (const binding of candidateSourceBindings(candidate)) {
      errors.push(...sourceBindingErrors(`${prefix} ${binding.label}`, binding.source));
    }
  }

  const part6 = candidates.find((candidate) => candidate.activityCode === "6");
  if (!part6) {
    errors.push("VEU 6 candidate is missing.");
  } else {
    if (part6.scenarios.codes.join("|") !== CREDITEX_VEU_PART_6_SCENARIOS.join("|")) {
      errors.push("VEU 6 must contain all 11 exact scenario codes in order.");
    }
    if (
      part6.product.productKind !== "veu_register" ||
      !part6.product.registrySnapshotRequired ||
      !part6.product.requiredAttributes.includes("HSPF") ||
      !part6.product.requiredAttributes.includes("TCSPF") ||
      !part6.product.requiredAttributes.includes("GWP") ||
      !part6.product.requiredAttributes.includes("configuration")
    ) {
      errors.push("VEU 6 product and calculator dependencies are incomplete.");
    }
    const formula = part6.calculator.formulas.find(
      (candidateFormula) =>
        candidateFormula.formulaKey === "veu-part-6-equations-6.1-to-6.5/v2",
    );
    if (!formula || !formula.inputKeys.includes("scenario") || !formula.inputKeys.includes("category")) {
      errors.push("VEU 6 formula or its scenario and category inputs are incomplete.");
    }
  }

  const part47 = candidates.find((candidate) => candidate.activityCode === "47");
  const part47Formula = part47?.calculator.formulas[0];
  if (
    !part47 ||
    part47.scenarios.codes.join("|") !== "47A|47B" ||
    part47.product.productKind !== "clean_energy_council_approved_solar_components" ||
    part47Formula?.formulaKey !== "veu-part-47-equation-47.1/v1" ||
    part47Formula.inputKeys.join("|") !==
      "system_size_kw|input_factor|lifetime_years|regional_factor"
  ) {
    errors.push("VEU 47 scenarios, product dependency or Equation 47.1 inputs are incomplete.");
  }

  const candidateContentCompleteCount = candidates.filter(
    hasCompleteCandidateContent,
  ).length;
  const activationReadyCount = candidates.filter(
    (candidate) => candidate.activationReady,
  ).length;
  const total = candidates.length;
  return {
    valid: errors.length === 0,
    errors,
    total,
    candidateContentCompleteCount,
    candidateContentCoveragePercent:
      total === 0 ? 0 : Math.round((candidateContentCompleteCount / total) * 100),
    activationReadyCount,
    activationCoveragePercent:
      total === 0 ? 0 : Math.round((activationReadyCount / total) * 100),
  };
}

export const CREDITEX_VEU_WORK_PACK_CONTENT_VALIDATION =
  validateCreditexVeuWorkPackContentCandidate();

if (!CREDITEX_VEU_WORK_PACK_CONTENT_VALIDATION.valid) {
  throw new Error(
    `Invalid Creditex VEU work-pack candidate content: ${CREDITEX_VEU_WORK_PACK_CONTENT_VALIDATION.errors.join(" ")}`,
  );
}

export const CREDITEX_VEU_WORK_PACK_CONTENT_COMPLETENESS = {
  expectedCurrentActivityTemplates: CREDITEX_CURRENT_ACTIVITY_CODES.length,
  machineReadableCandidateTemplates:
    CREDITEX_VEU_WORK_PACK_CONTENT_VALIDATION.candidateContentCompleteCount,
  machineReadableCandidateCoveragePercent:
    CREDITEX_VEU_WORK_PACK_CONTENT_VALIDATION.candidateContentCoveragePercent,
  independentlyApprovedActivationTemplates:
    CREDITEX_VEU_WORK_PACK_CONTENT_VALIDATION.activationReadyCount,
  independentlyApprovedActivationCoveragePercent:
    CREDITEX_VEU_WORK_PACK_CONTENT_VALIDATION.activationCoveragePercent,
  publicationState: "candidate_not_approved" as const,
} as const;
