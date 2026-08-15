import {
  CREDITEX_CURRENT_ACTIVITY_CODES,
  CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES as GOVERNED_VEU_SOURCE_CONTENT,
  type CreditexCurrentVeuActivityCode,
  type CreditexVeuEvidenceRequirement,
  type CreditexVeuFinalDocumentNeed,
  type CreditexVeuPromptRequirement,
  type CreditexVeuSignatureRequirement,
  type CreditexVeuSourceBinding,
} from "./creditex-veu-work-pack-content.ts";
import {
  CREDITEX_PRODUCT_KIND_REGISTRY,
  officialProductKindsForVeuActivity,
  officialVeuProductCategoryNumbersForActivity,
  type CreditexOfficialProductKind,
} from "../lib/creditex-official-product-registry.ts";
import {
  CREDITEX_VEU_PART_6_CATEGORIES,
  CREDITEX_VEU_PART_6_SCENARIOS,
} from "../lib/creditex-veu-calculator-catalogue.ts";

export const CREDITEX_VEU_PUBLISHABLE_WORK_PACK_SCHEMA =
  "creditex-veu-publishable-work-pack-content/v1" as const;

export type CreditexVeuCapturedGuideSource = {
  sourceId: string;
  expectedSha256: string;
  title: string;
  version: string;
  officialUrl: string;
  expectedContentType: "application/pdf";
  expectedSizeBytes: number;
  publicationDate: string;
  citation: string;
};

const GUIDE_LIBRARY = {
  applianceV36: {
    sourceId: "source-392cad3e2cf206ac1b14",
    expectedSha256: "392cad3e2cf206ac1b14f70d1bc12a4426ad837de5bc5308a6ff8f96cd9ebdff",
    title: "Appliance Activity Guide",
    version: "3.6",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Appliance%20Activity%20Guide%20-%20V%203.6%20-%2020250901_0.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 1173897,
    publicationDate: "2025-09-01",
    citation: "sections 2-5, pp. 6-40",
  },
  buildingLightingV29: {
    sourceId: "source-45b12c342b2a312592b8",
    expectedSha256: "45b12c342b2a312592b81d4c153add26f29d708b5909c017cc389a3df2fe2117",
    title: "Building Based Lighting Upgrades Activity Guide",
    version: "2.9",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20Building%20Based%20Lighting%20Upgrade%20Activity%20Guide%20-%20V%202.9%20-%2020250603%20%281%29.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 1428503,
    publicationDate: "2025-06-03",
    citation: "sections 1-5, pp. 3-30",
  },
  coldRoomV19: {
    sourceId: "source-cae09abaded8905f3ec7",
    expectedSha256: "cae09abaded8905f3ec763d652f27218ae53c0e8b2cf78ef45563f9722806abe",
    title: "Cold Room Activity Guide",
    version: "1.9",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Cold%20Room%20activity%20guide%20-%20V%201.9%20-%2020250901.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 461624,
    publicationDate: "2025-09-01",
    citation: "sections 1-5, pp. 3-19",
  },
  commercialIndustrialHeatPumpV22: {
    sourceId: "source-3d22dcfdd733b93661ab",
    expectedSha256: "3d22dcfdd733b93661ab743dd4e1a9b22003040177f49674171182ad81df4433",
    title: "Commercial and Industrial Heat Pump Water Heater Activity Guide",
    version: "2.2",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Commercial%20and%20Industrial%20Heat%20Pump%20Water%20Heater%20Activity%20Guide%20-%20V%202.2%20-%2020260331.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 663084,
    publicationDate: "2026-03-31",
    citation: "sections 1-5, pp. 3-29 and Appendix A, pp. 34-43",
  },
  commercialIndustrialSolarV12: {
    sourceId: "source-2a75cf2bc3a25b1561ae",
    expectedSha256: "2a75cf2bc3a25b1561ae06db2d08bd7a235e54dfc32935876d9cb75cca7916b0",
    title: "Commercial and Industrial Solar Photovoltaic Systems Activity Guide",
    version: "1.2",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Commercial%20and%20Industrial%20Solar%20Photovoltaic%20Systems%20Activity%20Guide%20V%201.2%20-%2020260324%20%282%29.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 506549,
    publicationDate: "2026-03-24",
    citation: "sections 1-6, pp. 6-34 and Appendices A-B, pp. 35-39",
  },
  gasEfficiencyV27: {
    sourceId: "source-022b85f0d0c93cb2432b",
    expectedSha256: "022b85f0d0c93cb2432ba900b684c07e85d2deec1b6b73c2ab2213ae155bdee5",
    title: "Gas Efficiency Activity Guide",
    version: "2.7",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Gas%20Efficiency%20activity%20guide%20-%20V%202.7%20-%2020260318.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 598769,
    publicationDate: "2026-03-18",
    citation: "sections 1-5, pp. 3-25",
  },
  nonBuildingLightingV27: {
    sourceId: "source-11b389128ffedbbeb41c",
    expectedSha256: "11b389128ffedbbeb41cfe2dd91258a7f48c49bdce606e2b0b96bacf909dc7d5",
    title: "Non-Building Based Lighting Upgrade Activity Guide",
    version: "2.7",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Non-Building%20Based%20Lighting%20Upgrade%20Activity%20Guide%20-%20V%202.7%20-%2020260324.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 971742,
    publicationDate: "2026-03-24",
    citation: "sections 1-5, pp. 3-29",
  },
  publicLightingV24: {
    sourceId: "source-3989f415fb446f5c9fc1",
    expectedSha256: "3989f415fb446f5c9fc188f681ac92c2be2e557a1f3f588e6557667e8dec7e1a",
    title: "Public Lighting Upgrade Activity Guide",
    version: "2.4",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Public%20Lighting%20Upgrade%20Activity%20Guide%20-%20V%202.4%2020260318.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 600613,
    publicationDate: "2026-03-18",
    citation: "sections 1-5, pp. 3-20",
  },
  spaceConditioningShowerRoseV40: {
    sourceId: "source-beb3ed4f291a02d2f54b",
    expectedSha256: "beb3ed4f291a02d2f54b71bdbf82b831a2d0e38f2dfc13006fa7a7629460148a",
    title: "Space Conditioning and Shower Rose Activity Guide",
    version: "4.0",
    officialUrl: "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Space%20Conditioning%20and%20Shower%20Rose%20Activity%20Guide%20V%204.0%20-%2020260318.pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 908069,
    publicationDate: "2026-03-18",
    citation: "sections 1-4, pp. 3-24 and Appendices A-D, pp. 26-39",
  },
} as const satisfies Record<string, CreditexVeuCapturedGuideSource>;

export const CREDITEX_VEU_CAPTURED_ACTIVITY_GUIDES = GUIDE_LIBRARY;

type GuideKey = keyof typeof GUIDE_LIBRARY;

const GUIDE_FOR_ACTIVITY = {
  "1": null,
  "3": null,
  "6": null,
  "13": "spaceConditioningShowerRoseV40",
  "14": "spaceConditioningShowerRoseV40",
  "15": "spaceConditioningShowerRoseV40",
  "17": "spaceConditioningShowerRoseV40",
  "22": "applianceV36",
  "24": "applianceV36",
  "25": "applianceV36",
  "26": "applianceV36",
  "27": "publicLightingV24",
  "28": null,
  "30": "applianceV36",
  "31": "applianceV36",
  "32": "applianceV36",
  "33": "applianceV36",
  "34": "buildingLightingV29",
  "35": "nonBuildingLightingV27",
  "36": "applianceV36",
  "37": "gasEfficiencyV27",
  "38": "gasEfficiencyV27",
  "39": "gasEfficiencyV27",
  "40": "gasEfficiencyV27",
  "41": "gasEfficiencyV27",
  "42": "gasEfficiencyV27",
  "43": "coldRoomV19",
  "44": "commercialIndustrialHeatPumpV22",
  "46": "applianceV36",
  "47": "commercialIndustrialSolarV12",
  "48": null,
} as const satisfies Record<CreditexCurrentVeuActivityCode, GuideKey | null>;

type ProductResolution = {
  scenarioCode: string;
  contractActivityCode: string;
  productKinds: readonly CreditexOfficialProductKind[];
  registryCodes: readonly string[];
  veuProductCategoryNumbers: readonly string[];
  resolutionDateField: "installation_date" | "purchase_date";
};

export type CreditexVeuPublishableWorkPackContent = {
  schema: typeof CREDITEX_VEU_PUBLISHABLE_WORK_PACK_SCHEMA;
  programCode: "VEU";
  templateId: string;
  activityCode: CreditexCurrentVeuActivityCode;
  title: string;
  catalogueState: "current" | "limited";
  guidedCaptureContentState: "publishable";
  statutoryAssignmentDocumentState: "blocked_exact_provider_template_required";
  certificateCreationSchemaState: "blocked_exact_provider_schema_required";
  governancePublicationState: "publishable";
  operationalApprovalState: "pending_independent_creditex_review";
  identityBindings: {
    accreditedPerson: "creditex_provider_for_job";
    installerBusiness: "assigned_trade_business_for_job";
    assignedTechnician: "assigned_trade_technician_for_appointment";
    consumer: "job_customer_or_authorised_signatory";
  };
  effectivePeriods: readonly {
    effectiveFrom: string;
    effectiveTo: string | null;
    ruleLabel: string;
    source: CreditexVeuSourceBinding;
  }[];
  sourceBindings: readonly CreditexVeuSourceBinding[];
  activityGuide: CreditexVeuCapturedGuideSource | null;
  prompts: readonly CreditexVeuPromptRequirement[];
  evidenceRequirements: readonly CreditexVeuEvidenceRequirement[];
  productRequirements: {
    requiredAttributes: readonly string[];
    registrySnapshotRequired: boolean;
    source: CreditexVeuSourceBinding;
    scenarioResolution: readonly ProductResolution[];
  };
  scenarios: {
    codes: readonly string[];
    source: CreditexVeuSourceBinding;
  };
  calculator: {
    engineId: "creditex-veu-calculator-estimator" | "creditex-veu-part-47-equation-47.1";
    executionState: "executable_with_complete_case_inputs";
    outputUnit: "VEEC";
    formulas: readonly {
      formulaKey: string;
      scenarioCodes: readonly string[];
      inputKeys: readonly string[];
      source: CreditexVeuSourceBinding;
    }[];
  };
  signatures: readonly CreditexVeuSignatureRequirement[];
  referenceDocuments: readonly CreditexVeuSourceBinding[];
  finalDocumentNeeds: readonly CreditexVeuFinalDocumentNeed[];
  tlinkDocumentContract: {
    governedEvidencePack: "renderable_from_published_obligations";
    statutoryAssignmentForm: "blocked_exact_provider_template_required";
    statutorySignatureCollection: "blocked_until_exact_declarations_are_imported";
    certificateCreationRecord: "blocked_exact_provider_schema_required";
    visibleSignatureBoxesAfterTemplateImport: true;
    signerRoles: readonly CreditexVeuSignatureRequirement["signerRole"][];
  };
  publicationRequirements: readonly {
    requirementCode:
      | "INDEPENDENT_CREDITEX_REVIEW"
      | "EXACT_PROVIDER_PORTAL_ASSIGNMENT_TEMPLATE"
      | "EXACT_PROVIDER_PORTAL_CREATION_SCHEMA";
    owner: "creditex_compliance" | "authorised_provider_portal";
    detail: string;
  }[];
};

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function contractActivityCode(
  activityCode: CreditexCurrentVeuActivityCode,
  scenarioCode: string,
) {
  if (activityCode === "1") return scenarioCode.startsWith("1D") ? "1D" : "1C";
  if (activityCode === "3") return scenarioCode.startsWith("3D") ? "3D" : "3C";
  return activityCode;
}

function productResolution(
  activityCode: CreditexCurrentVeuActivityCode,
  scenarios: readonly string[],
): ProductResolution[] {
  return scenarios.map((scenarioCode) => {
    const contractCode = contractActivityCode(activityCode, scenarioCode);
    const resolutionDate = activityCode === "46" ? "2026-07-21" : undefined;
    const productKinds = officialProductKindsForVeuActivity(
      contractCode,
      scenarioCode,
      resolutionDate,
    );
    return {
      scenarioCode,
      contractActivityCode: contractCode,
      productKinds,
      registryCodes: unique(
        productKinds.map((kind) => CREDITEX_PRODUCT_KIND_REGISTRY[kind]),
      ),
      veuProductCategoryNumbers:
        officialVeuProductCategoryNumbersForActivity(contractCode, scenarioCode),
      resolutionDateField:
        activityCode === "46" ? "purchase_date" : "installation_date",
    };
  });
}

function effectivePeriods(
  activityCode: CreditexCurrentVeuActivityCode,
  source: CreditexVeuSourceBinding,
) {
  if (activityCode === "6") {
    return [
      {
        effectiveFrom: "2026-07-21",
        effectiveTo: "2026-09-29",
        ruleLabel: "Version 25 Part 6 transition period before the 30 September capacity and co-payment changes",
        source,
      },
      {
        effectiveFrom: "2026-09-30",
        effectiveTo: null,
        ruleLabel: "Version 25 Part 6 rules with the 20 kW residential multi-split cap and revised minimum co-payments",
        source,
      },
    ] as const;
  }
  return [{
    effectiveFrom: "2026-07-21",
    effectiveTo: null,
    ruleLabel: "Victorian Energy Upgrades Specifications 2018 Version 25.0",
    source,
  }] as const;
}

function buildPublishableContent(
  sourceContent: (typeof GOVERNED_VEU_SOURCE_CONTENT)[number],
): CreditexVeuPublishableWorkPackContent {
  const guideKey = GUIDE_FOR_ACTIVITY[sourceContent.activityCode];
  return {
    schema: CREDITEX_VEU_PUBLISHABLE_WORK_PACK_SCHEMA,
    programCode: "VEU",
    templateId: sourceContent.templateId,
    activityCode: sourceContent.activityCode,
    title: sourceContent.title,
    catalogueState: sourceContent.catalogueState,
    guidedCaptureContentState: "publishable",
    statutoryAssignmentDocumentState: "blocked_exact_provider_template_required",
    certificateCreationSchemaState: "blocked_exact_provider_schema_required",
    governancePublicationState: "publishable",
    operationalApprovalState: "pending_independent_creditex_review",
    identityBindings: sourceContent.identityBindings,
    effectivePeriods: effectivePeriods(
      sourceContent.activityCode,
      sourceContent.statusDecision.source,
    ),
    sourceBindings: sourceContent.sourceBindings,
    activityGuide: guideKey === null ? null : GUIDE_LIBRARY[guideKey],
    prompts: sourceContent.prompts,
    evidenceRequirements: sourceContent.evidenceRequirements,
    productRequirements: {
      requiredAttributes: sourceContent.product.requiredAttributes,
      registrySnapshotRequired: sourceContent.product.registrySnapshotRequired,
      source: sourceContent.product.source,
      scenarioResolution: productResolution(
        sourceContent.activityCode,
        sourceContent.scenarios.codes,
      ),
    },
    scenarios: {
      codes: sourceContent.scenarios.codes,
      source: sourceContent.scenarios.source,
    },
    calculator: {
      engineId: sourceContent.activityCode === "47"
        ? "creditex-veu-part-47-equation-47.1"
        : "creditex-veu-calculator-estimator",
      executionState: "executable_with_complete_case_inputs",
      outputUnit: "VEEC",
      formulas: sourceContent.calculator.formulas,
    },
    signatures: sourceContent.signatures,
    referenceDocuments: sourceContent.referenceDocuments,
    finalDocumentNeeds: sourceContent.finalDocumentNeeds,
    tlinkDocumentContract: {
      governedEvidencePack: "renderable_from_published_obligations",
      statutoryAssignmentForm: "blocked_exact_provider_template_required",
      statutorySignatureCollection: "blocked_until_exact_declarations_are_imported",
      certificateCreationRecord: "blocked_exact_provider_schema_required",
      visibleSignatureBoxesAfterTemplateImport: true,
      signerRoles: unique(
        sourceContent.signatures.map((signature) => signature.signerRole),
      ),
    },
    publicationRequirements: [
      {
        requirementCode: "INDEPENDENT_CREDITEX_REVIEW",
        owner: "creditex_compliance",
        detail: `Creditex compliance must independently review and approve activity ${sourceContent.activityCode} before operational certificate use.`,
      },
      {
        requirementCode: "EXACT_PROVIDER_PORTAL_ASSIGNMENT_TEMPLATE",
        owner: "authorised_provider_portal",
        detail: `Import the exact current activity ${sourceContent.activityCode} VEEC assignment template from the authorised provider portal without reconstructing declaration text.`,
      },
      {
        requirementCode: "EXACT_PROVIDER_PORTAL_CREATION_SCHEMA",
        owner: "authorised_provider_portal",
        detail: `Import the exact current activity ${sourceContent.activityCode} certificate-creation fields and upload schema from the authorised provider portal.`,
      },
    ],
  };
}

export const CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT:
readonly CreditexVeuPublishableWorkPackContent[] =
  GOVERNED_VEU_SOURCE_CONTENT.map(buildPublishableContent);

export type CreditexVeuPublishableContentValidation = {
  valid: boolean;
  errors: readonly string[];
  total: number;
  guidedCapturePublishableCount: number;
  statutoryAssignmentDocumentReadyCount: number;
  governancePublishableCount: number;
};

function sourceErrors(label: string, source: CreditexVeuSourceBinding) {
  const errors: string[] = [];
  if (!/^source-[a-f0-9]{20}$/.test(source.sourceId)) {
    errors.push(`${label} has an invalid source ID.`);
  }
  if (!/^[a-f0-9]{64}$/.test(source.expectedSha256)) {
    errors.push(`${label} has an invalid SHA-256.`);
  }
  if (!source.officialUrl.startsWith("https://")) {
    errors.push(`${label} does not use an HTTPS official URL.`);
  }
  if (!source.citation.trim()) errors.push(`${label} has no exact citation.`);
  return errors;
}

export function validateCreditexVeuPublishableWorkPackContent(
  rows: readonly CreditexVeuPublishableWorkPackContent[] =
    CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT,
): CreditexVeuPublishableContentValidation {
  const errors: string[] = [];
  const codes = rows.map((row) => row.activityCode);
  if (rows.length !== CREDITEX_CURRENT_ACTIVITY_CODES.length) {
    errors.push(`Expected ${CREDITEX_CURRENT_ACTIVITY_CODES.length} rows, received ${rows.length}.`);
  }
  if (new Set(codes).size !== codes.length) errors.push("Activity codes are not unique.");
  if (codes.join("|") !== CREDITEX_CURRENT_ACTIVITY_CODES.join("|")) {
    errors.push("Activity codes do not match the current VEU catalogue order.");
  }

  for (const row of rows) {
    const prefix = `VEU ${row.activityCode}`;
    if (row.guidedCaptureContentState !== "publishable") {
      errors.push(`${prefix} guided capture content is not publishable.`);
    }
    if (
      row.statutoryAssignmentDocumentState
        !== "blocked_exact_provider_template_required"
      || row.tlinkDocumentContract.statutoryAssignmentForm
        !== "blocked_exact_provider_template_required"
      || row.tlinkDocumentContract.statutorySignatureCollection
        !== "blocked_until_exact_declarations_are_imported"
    ) {
      errors.push(`${prefix} incorrectly claims a complete statutory assignment workflow.`);
    }
    if (
      row.certificateCreationSchemaState
        !== "blocked_exact_provider_schema_required"
      || row.tlinkDocumentContract.certificateCreationRecord
        !== "blocked_exact_provider_schema_required"
    ) {
      errors.push(`${prefix} incorrectly claims a complete provider creation schema.`);
    }
    if (
      row.tlinkDocumentContract.governedEvidencePack
        !== "renderable_from_published_obligations"
      || row.tlinkDocumentContract.visibleSignatureBoxesAfterTemplateImport !== true
    ) {
      errors.push(`${prefix} does not expose the bounded TLink document contract.`);
    }
    if (row.governancePublicationState !== "publishable") {
      errors.push(`${prefix} is not governance-publishable.`);
    }
    if (row.operationalApprovalState !== "pending_independent_creditex_review") {
      errors.push(`${prefix} does not preserve independent Creditex review.`);
    }
    if (row.prompts.length < 8 || row.evidenceRequirements.length < 1) {
      errors.push(`${prefix} has incomplete field workflow content.`);
    }
    if (row.scenarios.codes.length < 1 || row.calculator.formulas.length < 1) {
      errors.push(`${prefix} has no governed scenario or formula contract.`);
    }
    if (row.signatures.length < 3 || row.signatures.some((item) => !item.visibleSignatureBox)) {
      errors.push(`${prefix} has incomplete visible signature requirements.`);
    }
    if (row.productRequirements.scenarioResolution.length !== row.scenarios.codes.length) {
      errors.push(`${prefix} product resolution does not cover every scenario.`);
    }
    if (row.publicationRequirements.length !== 3) {
      errors.push(`${prefix} does not expose all review and portal publication requirements.`);
    }
    for (const source of [
      ...row.sourceBindings,
      row.scenarios.source,
      row.productRequirements.source,
      ...row.effectivePeriods.map((period) => period.source),
      ...row.calculator.formulas.map((formula) => formula.source),
    ]) {
      errors.push(...sourceErrors(prefix, source));
    }
    const serialized = JSON.stringify(row);
    if (/\b(candidate|placeholder|guess)\b/i.test(serialized)) {
      errors.push(`${prefix} contains provisional placeholder language.`);
    }
  }

  const part6 = rows.find((row) => row.activityCode === "6");
  if (!part6) {
    errors.push("VEU 6 is missing.");
  } else {
    if (part6.scenarios.codes.join("|") !== CREDITEX_VEU_PART_6_SCENARIOS.join("|")) {
      errors.push("VEU 6 does not carry all eleven scenarios.");
    }
    const categories = unique(
      part6.productRequirements.scenarioResolution.flatMap(
        (resolution) => resolution.veuProductCategoryNumbers,
      ),
    );
    if (categories.join("|") !== CREDITEX_VEU_PART_6_CATEGORIES.join("|")) {
      errors.push("VEU 6 does not bind all nine approved-product categories.");
    }
    if (!part6.productRequirements.scenarioResolution.every((resolution) =>
      resolution.productKinds.length === 1
      && resolution.productKinds[0] === "veu_air_conditioner"
      && resolution.registryCodes[0] === "veu-approved-products"
    )) {
      errors.push("VEU 6 is not bound to the automatic VEU air-conditioner register.");
    }
    if (part6.effectivePeriods.length !== 2) {
      errors.push("VEU 6 does not expose both Version 25 effective periods.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    total: rows.length,
    guidedCapturePublishableCount:
      rows.filter((row) => row.guidedCaptureContentState === "publishable").length,
    statutoryAssignmentDocumentReadyCount: rows.filter((row) =>
      row.statutoryAssignmentDocumentState !== "blocked_exact_provider_template_required"
    ).length,
    governancePublishableCount:
      rows.filter((row) => row.governancePublicationState === "publishable").length,
  };
}

export const CREDITEX_VEU_PUBLISHABLE_WORK_PACK_VALIDATION =
  validateCreditexVeuPublishableWorkPackContent();

if (!CREDITEX_VEU_PUBLISHABLE_WORK_PACK_VALIDATION.valid) {
  throw new Error(
    `Invalid publishable VEU work-pack content: ${CREDITEX_VEU_PUBLISHABLE_WORK_PACK_VALIDATION.errors.join(" ")}`,
  );
}
