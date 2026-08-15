import {
  GOVERNMENT_PROGRAM_TEMPLATES,
  governmentActivityTemplates,
  type GovernmentActivityTemplate,
} from "../lib/australian-government-program-catalogue.ts";
import {
  governmentActivityCalculationMethods,
  type GovernmentActivityCalculationMethod,
} from "../lib/australian-certificate-calculation-catalogue.ts";
import {
  CREDITEX_NSW_PROGRAM_DEFINITIONS,
  type CreditexNswActivityDefinition,
  type CreditexNswInputDefinition,
} from "../lib/creditex-nsw-program-catalogue.ts";

export const CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_SCHEMA =
  "creditex-nsw-certificate-work-pack-content/v1" as const;

export const CREDITEX_NSW_CERTIFICATE_PROGRAM_CODES = [
  "NSW-ESS",
  "NSW-PDRS",
] as const;

export type CreditexNswCertificateProgramCode =
  (typeof CREDITEX_NSW_CERTIFICATE_PROGRAM_CODES)[number];

type NswSourceKey =
  | "essRule"
  | "essRulePage"
  | "heerGuide"
  | "iheabGuide"
  | "essReferenceTable"
  | "generalAcpGuide"
  | "nominationForm"
  | "siteAssessorDeclaration"
  | "postImplementationDeclaration"
  | "iheabHeatPumpFactsheet"
  | "pdrsRule"
  | "pdrsRulePage"
  | "pdrsMethodGuide"
  | "pdrsReferenceTable";

export type CreditexNswCertificateOfficialSource = {
  sourceId: string;
  programCode: CreditexNswCertificateProgramCode;
  sourceTitle: string;
  sourceVersion: string;
  statedEffectiveDate: string;
  officialUrl: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  observedOn: "2026-08-15";
  pendingIndependentCreditexReview: true;
  operationallyApproved: false;
};

export type CreditexNswCertificateSourceBinding =
  CreditexNswCertificateOfficialSource & {
    citation: string;
  };

export const CREDITEX_NSW_CERTIFICATE_OFFICIAL_SOURCE_LIBRARY = {
  essRule: {
    sourceId: "source-3b6ef9deb78a7aeeee20",
    programCode: "NSW-ESS",
    sourceTitle: "Energy Savings Scheme Rule of 2009",
    sourceVersion: "1 July 2026",
    statedEffectiveDate: "2026-07-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Energy-Savings-Scheme-Rule-of-2009-1-July-2026.PDF",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 2_118_820,
    expectedSha256:
      "de5e1badf45a19b2a8903b2fd29ad62d64db04fbf2fdb2e8a2d68dea3296ac51",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  essRulePage: {
    sourceId: "source-637d2bcd8d95a966fb45",
    programCode: "NSW-ESS",
    sourceTitle: "ESS rule and changes",
    sourceVersion: "",
    statedEffectiveDate: "",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/ess-rule-and-changes",
    expectedContentType: "text/html",
    expectedSizeBytes: 128_669,
    expectedSha256:
      "c23db9d7a3955d1ef2e925afa773cb6e1cb47417557ea3611e4454478f495048",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  heerGuide: {
    sourceId: "source-04f2c53900614e2d5bef",
    programCode: "NSW-ESS",
    sourceTitle: "Home Energy Efficiency Retrofits Method Guide",
    sourceVersion: "4.8",
    statedEffectiveDate: "2026-07-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/HEER-Method-Guide-V4.8.PDF",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 526_283,
    expectedSha256:
      "dd8c5b7bc532606fdd399689b82151c15f4120f69f4d8b69c33f9a61aaab3ad1",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  iheabGuide: {
    sourceId: "source-7854c57a3f80a628198d",
    programCode: "NSW-ESS",
    sourceTitle: "Installation of High Efficiency Appliances for Businesses Method Guide",
    sourceVersion: "4.3",
    statedEffectiveDate: "2026-07-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/IHEAB-Method-Guide-V4.3.PDF",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 620_637,
    expectedSha256:
      "226b5a77a8e2e16d047d4ecf3e29ecda10d0e372a7bc048bfbe244a68f9d5fcd",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  essReferenceTable: {
    sourceId: "source-2b81e7363e6e06a4e9a6",
    programCode: "NSW-ESS",
    sourceTitle: "ESS Reference Table",
    sourceVersion: "1.1",
    statedEffectiveDate: "2026-07-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/ESS-Reference-Table-V1.1-ESS-Rule-Change-23-July-2026.PDF",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 188_522,
    expectedSha256:
      "73b444e7a8754d536ad139ec4c7099526c4218b022cfd2efe5c03b85fca5009a",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  generalAcpGuide: {
    sourceId: "source-e291ade10bc2627bcd4f",
    programCode: "NSW-ESS",
    sourceTitle: "General Requirements Guide for Accredited Certificate Providers",
    sourceVersion: "1.3",
    statedEffectiveDate: "2023-04-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/ess_documents//General-Requirements-Guide-ACPs-V1.3.PDF",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 298_346,
    expectedSha256:
      "f2aba5552c6735ef692827dffc16a20730b8bbdc954a381ace85636c4112383b",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  nominationForm: {
    sourceId: "source-873ea7abb7bfaffe054f",
    programCode: "NSW-ESS",
    sourceTitle: "Nomination Form for Accredited Certificate Providers",
    sourceVersion: "1.1",
    statedEffectiveDate: "",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/ess_documents//Template-Nomination-form-ACPs-V1.1.DOCX",
    expectedContentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    expectedSizeBytes: 485_004,
    expectedSha256:
      "f28033e2f501c3a7573dbf585c260aac64f927fa6a404d65e5d2c54159f957bb",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  siteAssessorDeclaration: {
    sourceId: "source-3dc8e5de69410fc013ab",
    programCode: "NSW-ESS",
    sourceTitle: "Site Assessor Declaration",
    sourceVersion: "2.2",
    statedEffectiveDate: "2026-06-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Template-Site-Assessor-Declaration-V2.2-June-2026.DOCX",
    expectedContentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    expectedSizeBytes: 60_262,
    expectedSha256:
      "5e3cc0061d158f8868f4a7997f8a5ee7aaa9ad38abeda85890d8e74a81535307",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  postImplementationDeclaration: {
    sourceId: "source-4376f548f1696c0f7020",
    programCode: "NSW-ESS",
    sourceTitle: "Post Implementation Declaration",
    sourceVersion: "2.2",
    statedEffectiveDate: "2026-06-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Template-Post-Implementation-Declaration-V2.2-June-2026.DOCX",
    expectedContentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    expectedSizeBytes: 59_980,
    expectedSha256:
      "902a2f4d41ad2416fd3bd28a75535a3c6363b689015afea476c0f6023b028a23",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  iheabHeatPumpFactsheet: {
    sourceId: "source-c3b05dc4dfca712a61cf",
    programCode: "NSW-ESS",
    sourceTitle: "IHEAB heat pump water heaters fact sheet",
    sourceVersion: "2.2",
    statedEffectiveDate: "2026-08-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/IHEAB-heat-pump-water-heaters-fact-sheet-V2.2-August-2026.PDF",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 182_933,
    expectedSha256:
      "34719fd903648610163f54412d95c3784fc4e714927801e877bcdfea109520c8",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  pdrsRule: {
    sourceId: "source-0a1a5fc61e7370069d0d",
    programCode: "NSW-PDRS",
    sourceTitle: "Peak Demand Reduction Scheme Rule of 2022",
    sourceVersion: "1 July 2026",
    statedEffectiveDate: "2026-07-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Peak-Demand-Reduction-Scheme-Rule-of-2022-1-July-2026.PDF",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 710_172,
    expectedSha256:
      "0af5ccd5c431853c1b339d0887512ab0daf25335b129295b47a9cbca0da86c77",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  pdrsRulePage: {
    sourceId: "source-0d72d0c8d0e56d9822b6",
    programCode: "NSW-PDRS",
    sourceTitle: "PDRS Rule and changes | IPART",
    sourceVersion: "",
    statedEffectiveDate: "",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/pdrs-rule-and-changes",
    expectedContentType: "text/html",
    expectedSizeBytes: 130_729,
    expectedSha256:
      "61dd96698ba2f30fa15f56a4718c85a70af73a29d795041a710f98adf200c4f8",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  pdrsMethodGuide: {
    sourceId: "source-0e96373a9f46c944aab3",
    programCode: "NSW-PDRS",
    sourceTitle: "Peak Demand Reduction Scheme Method Guide",
    sourceVersion: "3.0",
    statedEffectiveDate: "2026-07-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/PDRS-Method-Guide-V3.0.PDF",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 972_333,
    expectedSha256:
      "e7b1229595c0d7b38c397ae09b315b95ff074dae840c69b6538f8d5d9b6f6943",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
  pdrsReferenceTable: {
    sourceId: "source-49c7663c720ce9d819a2",
    programCode: "NSW-PDRS",
    sourceTitle: "PDRS Reference Table",
    sourceVersion: "2026-07-01",
    statedEffectiveDate: "2026-07-01",
    officialUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/PDRS-Quick-Reference-Guide-%25232-2026.PDF",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 156_495,
    expectedSha256:
      "7bf1a6a29b86e150d6b61702342c577cdb6d389d1957a87ecc5d3ef9d6d05aef",
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  },
} as const satisfies Record<NswSourceKey, CreditexNswCertificateOfficialSource>;

const PROGRAM_SOURCE_KEYS = {
  "NSW-ESS": [
    "essRule",
    "essRulePage",
    "heerGuide",
    "iheabGuide",
    "essReferenceTable",
    "generalAcpGuide",
    "nominationForm",
    "siteAssessorDeclaration",
    "postImplementationDeclaration",
    "iheabHeatPumpFactsheet",
  ],
  "NSW-PDRS": [
    "pdrsRule",
    "pdrsRulePage",
    "pdrsMethodGuide",
    "pdrsReferenceTable",
  ],
} as const satisfies Record<CreditexNswCertificateProgramCode, readonly NswSourceKey[]>;

function bindSource(
  sourceKey: NswSourceKey,
  citation: string,
): CreditexNswCertificateSourceBinding {
  return {
    ...CREDITEX_NSW_CERTIFICATE_OFFICIAL_SOURCE_LIBRARY[sourceKey],
    citation,
  };
}

function ruleSourceKey(programCode: CreditexNswCertificateProgramCode) {
  return programCode === "NSW-ESS" ? "essRule" : "pdrsRule";
}

function programSourceBindings(
  programCode: CreditexNswCertificateProgramCode,
  activityCode: string,
) {
  return PROGRAM_SOURCE_KEYS[programCode].map((sourceKey) =>
    bindSource(
      sourceKey,
      `${activityCode}: retained programme source candidate. Exact activity incorporation and operational approval remain pending independent Creditex review.`,
    ),
  );
}

export type CreditexNswPromptRequirement = {
  key: string;
  label: string;
  kind:
    | "identity"
    | "site"
    | "implementation"
    | "calculation_input"
    | "governance_blocker";
  fieldType: CreditexNswInputDefinition["type"] | "text" | "date" | "record";
  unit: string;
  requiredWhenPublished: boolean;
  valueSource:
    | "job"
    | "creditex_provider"
    | "assigned_trade_business"
    | "assigned_trade_technician"
    | "operator"
    | "official_registry"
    | "governance_admin";
  collectionState: "candidate_not_approved";
  source: CreditexNswCertificateSourceBinding;
};

export type CreditexNswEvidenceRequirement = {
  requirementId: string;
  kind:
    | "original_activity_evidence_set"
    | "activity_specific_declaration_set"
    | "product_registry_snapshot"
    | "calculation_execution_receipt";
  label: string;
  exactRequirementState: "unresolved_pending_transcription_and_review";
  captureEnabled: false;
  preserveOriginalBytes: true;
  preserveOriginalMetadataForMedia: true;
  source: CreditexNswCertificateSourceBinding;
};

export type CreditexNswExternalReferenceSignal = {
  title: string;
  url: string;
  clauses: string;
  pages: string;
  custodyState: "local_catalogue_reference_only_not_in_tracked_nsw_manifest";
};

export type CreditexNswFormulaSignal = {
  activityCode: string;
  officialActivityCode: string;
  formulaKey: string;
  supportedScenario: string;
  effectiveFrom: string;
  effectiveTo: string;
  calculationStatus: CreditexNswActivityDefinition["calculationStatus"];
  productKinds: readonly string[];
  inputs: readonly CreditexNswInputDefinition[];
  productRegistryRequirements: readonly string[];
  source: CreditexNswCertificateSourceBinding;
  externalReferences: readonly CreditexNswExternalReferenceSignal[];
};

export type CreditexNswWorkPackGapCode =
  | "NSW_ACTIVITY_STATUS_REVIEW_REQUIRED"
  | "NSW_ACTIVITY_FORM_SCHEMA_NOT_APPROVED"
  | "NSW_ACTIVITY_EVIDENCE_POLICY_NOT_APPROVED"
  | "NSW_EXACT_SIGNER_MAPPING_NOT_APPROVED"
  | "NSW_FINAL_DOCUMENT_MAPPING_NOT_APPROVED"
  | "NSW_PRODUCT_APPLICABILITY_NOT_APPROVED"
  | "NSW_PRODUCT_REGISTRY_SNAPSHOT_MISSING"
  | "NSW_SCENARIO_APPLICABILITY_NOT_APPROVED"
  | "NSW_CALCULATOR_GOLDEN_VECTORS_MISSING"
  | "NSW_GOVERNED_CALCULATOR_CONTRACT_MISSING"
  | "NSW_EXTERNAL_SOURCE_NOT_IN_CUSTODY"
  | "NSW_PROVIDER_SUBMISSION_SCHEMA_MISSING"
  | "NSW_INDEPENDENT_CREDITEX_REVIEW_REQUIRED";

export type CreditexNswCertificateWorkPackContentCandidate = {
  schema: typeof CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_SCHEMA;
  programCode: CreditexNswCertificateProgramCode;
  templateId: string;
  registryActivityCode: string;
  title: string;
  serviceCategory: GovernmentActivityTemplate["serviceCategory"];
  catalogueState: "current" | "limited";
  statusDecision: {
    state: "candidate_not_approved";
    localCatalogueSignal: "current" | "limited";
    source: CreditexNswCertificateSourceBinding;
  };
  identityBindings: {
    accreditedCertificateProvider: "creditex_provider_for_job";
    installerBusiness: "assigned_trade_business_for_job";
    assignedTechnician: "assigned_trade_technician_for_appointment";
    purchaserOrSiteContact: "job_customer_or_authorised_site_contact";
  };
  output: {
    outcomeClass: "tradable_certificate";
    claimOutputCode: "ESC" | "PRC";
    claimOutputLabel: string;
    outputUnit: "ESC" | "PRC";
    actionOwner: "creditex_accredited_certificate_provider_for_job";
    actionState: "blocked_until_all_governance_gaps_resolved";
    providerOutcomeReceiptRequired: true;
  };
  sourceBindings: readonly CreditexNswCertificateSourceBinding[];
  prompts: readonly CreditexNswPromptRequirement[];
  evidenceRequirements: readonly CreditexNswEvidenceRequirement[];
  productKind: {
    decisionState: "unresolved";
    officialValues: readonly [];
    localCalculationSignals: readonly string[];
    source: CreditexNswCertificateSourceBinding;
  };
  product: {
    selectionState: "blocked_pending_exact_registry_and_review";
    registryApplicabilityDecision: "unresolved";
    registrySnapshotRequired: null;
    localRegistryRequirementSignals: readonly string[];
    source: CreditexNswCertificateSourceBinding;
  };
  scenario: {
    decisionState: "unresolved";
    officialCodes: readonly [];
    localCalculationSignals: readonly string[];
    source: CreditexNswCertificateSourceBinding;
  };
  calculator: {
    outputUnit: "ESC" | "PRC";
    localCatalogueState: GovernmentActivityCalculationMethod["state"];
    localCataloguePathway: GovernmentActivityCalculationMethod["pathway"];
    localCatalogueFormulaKeySignal: string;
    formulaSignals: readonly CreditexNswFormulaSignal[];
    exactOfficialGoldenVectorState: "missing";
    independentReviewState: "missing";
    executionState: "blocked";
  };
  signers: readonly [{
    signerRole: "activity_signer_roles_unresolved";
    decisionState: "unresolved";
    visibleSignatureBoxWhenPublished: true;
    signingEnabled: false;
    source: CreditexNswCertificateSourceBinding;
  }];
  referenceDocuments: readonly CreditexNswCertificateSourceBinding[];
  externalReferenceSignals: readonly CreditexNswExternalReferenceSignal[];
  finalDocumentNeeds: readonly [{
    documentType: "creditex_governed_activity_work_pack_pdf";
    label: string;
    format: "pdf";
    immutableAfterFinalisation: true;
    mappingState: "blocked_pending_exact_form_and_signer_review";
    source: CreditexNswCertificateSourceBinding;
  }, {
    documentType: "nsw_certificate_provider_submission_packet";
    label: string;
    format: "original_evidence_and_json";
    immutableAfterFinalisation: true;
    mappingState: "blocked_pending_authorised_provider_schema";
    source: CreditexNswCertificateSourceBinding;
  }];
  gaps: readonly {
    code: CreditexNswWorkPackGapCode;
    blocksActivation: true;
    detail: string;
  }[];
  candidateOnly: true;
  independentlyApproved: false;
  published: false;
  activationReady: false;
};

function programmeDefinition(programCode: CreditexNswCertificateProgramCode) {
  const definition = CREDITEX_NSW_PROGRAM_DEFINITIONS.find(
    (candidate) => candidate.programCode === `${programCode}-2026`,
  );
  if (!definition) {
    throw new Error(`Missing local NSW programme definition for ${programCode}.`);
  }
  return definition;
}

function calculationMethod(
  programCode: CreditexNswCertificateProgramCode,
  templateId: string,
) {
  const method = governmentActivityCalculationMethods(programCode).find(
    (candidate) => candidate.activityTemplateId === templateId,
  );
  if (!method) {
    throw new Error(`Missing calculation catalogue row for ${templateId}.`);
  }
  return method;
}

function exactRuleCitation(
  programCode: CreditexNswCertificateProgramCode,
  activityCode: string,
  definition?: CreditexNswActivityDefinition,
) {
  const ruleUrl = CREDITEX_NSW_CERTIFICATE_OFFICIAL_SOURCE_LIBRARY[
    ruleSourceKey(programCode)
  ].officialUrl;
  const references = definition?.sourceReferences.filter(
    (reference) => reference.url === ruleUrl,
  ) ?? [];
  const detail = references.length > 0
    ? references
        .map(
          (reference) =>
            `${reference.title}; ${reference.clauses}; ${reference.pages}`,
        )
        .join(" | ")
    : `${activityCode}: exact activity clauses still require transcription and independent review.`;
  return bindSource(ruleSourceKey(programCode), detail);
}

function externalReferences(
  programCode: CreditexNswCertificateProgramCode,
  definitions: readonly CreditexNswActivityDefinition[],
) {
  const retainedUrls = new Set<string>(
    PROGRAM_SOURCE_KEYS[programCode].map(
      (key) => CREDITEX_NSW_CERTIFICATE_OFFICIAL_SOURCE_LIBRARY[key].officialUrl,
    ),
  );
  const byIdentity = new Map<string, CreditexNswExternalReferenceSignal>();
  for (const definition of definitions) {
    for (const reference of definition.sourceReferences) {
      if (retainedUrls.has(reference.url)) continue;
      const identity = [
        reference.title,
        reference.url,
        reference.clauses,
        reference.pages,
      ].join("|");
      byIdentity.set(identity, {
        ...reference,
        custodyState:
          "local_catalogue_reference_only_not_in_tracked_nsw_manifest",
      });
    }
  }
  return [...byIdentity.values()].sort((left, right) =>
    `${left.url}|${left.title}`.localeCompare(`${right.url}|${right.title}`),
  );
}

function formulaSignals(
  programCode: CreditexNswCertificateProgramCode,
  definitions: readonly CreditexNswActivityDefinition[],
) {
  return definitions.map((definition) => ({
    activityCode: definition.activityCode,
    officialActivityCode: definition.officialActivityCode,
    formulaKey: definition.formulaKey,
    supportedScenario: definition.supportedScenario,
    effectiveFrom: definition.effectiveFrom,
    effectiveTo: definition.effectiveTo,
    calculationStatus: definition.calculationStatus,
    productKinds: definition.productKinds,
    inputs: definition.inputDefinitions,
    productRegistryRequirements: definition.productRegistryRequirements,
    source: exactRuleCitation(
      programCode,
      definition.officialActivityCode,
      definition,
    ),
    externalReferences: externalReferences(programCode, [definition]),
  }));
}

function commonPrompts(
  programCode: CreditexNswCertificateProgramCode,
  activityCode: string,
  definitions: readonly CreditexNswActivityDefinition[],
): CreditexNswPromptRequirement[] {
  const source = exactRuleCitation(programCode, activityCode, definitions[0]);
  const prompts: CreditexNswPromptRequirement[] = [
    {
      key: "creditex_accredited_certificate_provider",
      label: "Creditex accredited certificate provider identity for this job",
      kind: "identity",
      fieldType: "record",
      unit: "record",
      requiredWhenPublished: true,
      valueSource: "creditex_provider",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "installer_business",
      label: "Assigned installer business and relevant licence details",
      kind: "identity",
      fieldType: "record",
      unit: "record",
      requiredWhenPublished: true,
      valueSource: "assigned_trade_business",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "assigned_technician",
      label: "Assigned technician identity and relevant accreditation details",
      kind: "identity",
      fieldType: "record",
      unit: "record",
      requiredWhenPublished: true,
      valueSource: "assigned_trade_technician",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "purchaser_or_site_contact",
      label: "Purchaser or authorised site contact identity",
      kind: "identity",
      fieldType: "record",
      unit: "record",
      requiredWhenPublished: true,
      valueSource: "job",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "implementation_site",
      label: "Implementation site address and NSW location evidence",
      kind: "site",
      fieldType: "record",
      unit: "record",
      requiredWhenPublished: true,
      valueSource: "job",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "implementation_date",
      label: "Implementation or onboarding date required by the applicable Rule",
      kind: "implementation",
      fieldType: "date",
      unit: "date",
      requiredWhenPublished: true,
      valueSource: "operator",
      collectionState: "candidate_not_approved",
      source,
    },
  ];
  for (const definition of definitions) {
    const formulaSource = exactRuleCitation(programCode, activityCode, definition);
    for (const input of definition.inputDefinitions) {
      prompts.push({
        key: `${definition.activityCode}:${input.key}`,
        label: input.label,
        kind: "calculation_input",
        fieldType: input.type,
        unit: input.unit,
        requiredWhenPublished: true,
        valueSource: input.key.includes("registry")
          ? "official_registry"
          : "operator",
        collectionState: "candidate_not_approved",
        source: formulaSource,
      });
    }
  }
  if (definitions.length === 0) {
    prompts.push({
      key: "governed_activity_input_contract",
      label: "Activity-specific input contract requires exact-source transcription",
      kind: "governance_blocker",
      fieldType: "record",
      unit: "record",
      requiredWhenPublished: true,
      valueSource: "governance_admin",
      collectionState: "candidate_not_approved",
      source,
    });
  }
  return prompts;
}

function evidenceRequirements(
  programCode: CreditexNswCertificateProgramCode,
  activityCode: string,
  definitions: readonly CreditexNswActivityDefinition[],
): CreditexNswEvidenceRequirement[] {
  const source = exactRuleCitation(programCode, activityCode, definitions[0]);
  return [
    {
      requirementId: `${activityCode}:original-activity-evidence-set`,
      kind: "original_activity_evidence_set",
      label: "Exact activity-specific minimum records and implementation evidence",
      exactRequirementState: "unresolved_pending_transcription_and_review",
      captureEnabled: false,
      preserveOriginalBytes: true,
      preserveOriginalMetadataForMedia: true,
      source,
    },
    {
      requirementId: `${activityCode}:activity-specific-declarations`,
      kind: "activity_specific_declaration_set",
      label: "Exact applicable purchaser, installer, assessor and ACP declarations",
      exactRequirementState: "unresolved_pending_transcription_and_review",
      captureEnabled: false,
      preserveOriginalBytes: true,
      preserveOriginalMetadataForMedia: true,
      source,
    },
    {
      requirementId: `${activityCode}:product-status-snapshot`,
      kind: "product_registry_snapshot",
      label: "Exact implementation-date product status and restriction evidence",
      exactRequirementState: "unresolved_pending_transcription_and_review",
      captureEnabled: false,
      preserveOriginalBytes: true,
      preserveOriginalMetadataForMedia: true,
      source,
    },
    {
      requirementId: `${activityCode}:calculation-execution-receipt`,
      kind: "calculation_execution_receipt",
      label: "Exact approved formula, source identities, inputs, output and execution time",
      exactRequirementState: "unresolved_pending_transcription_and_review",
      captureEnabled: false,
      preserveOriginalBytes: true,
      preserveOriginalMetadataForMedia: true,
      source,
    },
  ];
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function candidateGaps(
  programCode: CreditexNswCertificateProgramCode,
  activityCode: string,
  definitions: readonly CreditexNswActivityDefinition[],
  external: readonly CreditexNswExternalReferenceSignal[],
) {
  const gaps: Array<{
    code: CreditexNswWorkPackGapCode;
    blocksActivation: true;
    detail: string;
  }> = [
    {
      code: "NSW_ACTIVITY_STATUS_REVIEW_REQUIRED",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} needs an effective-date-specific active, suspended, withdrawn or expired decision from the retained sources.`,
    },
    {
      code: "NSW_ACTIVITY_FORM_SCHEMA_NOT_APPROVED",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} has no independently approved guided field form schema.`,
    },
    {
      code: "NSW_ACTIVITY_EVIDENCE_POLICY_NOT_APPROVED",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} minimum records have not been transcribed and independently approved.`,
    },
    {
      code: "NSW_EXACT_SIGNER_MAPPING_NOT_APPROVED",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} signer capacities and signature placement remain unresolved.`,
    },
    {
      code: "NSW_FINAL_DOCUMENT_MAPPING_NOT_APPROVED",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} final PDF and original-document mappings remain unresolved.`,
    },
    {
      code: "NSW_PRODUCT_APPLICABILITY_NOT_APPROVED",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} product-kind and product eligibility decisions are not independently approved.`,
    },
    {
      code: "NSW_PRODUCT_REGISTRY_SNAPSHOT_MISSING",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} has no approved implementation-date product/status snapshot bound to the work pack.`,
    },
    {
      code: "NSW_SCENARIO_APPLICABILITY_NOT_APPROVED",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} has no source-cited independently approved scenario decision.`,
    },
    {
      code: "NSW_CALCULATOR_GOLDEN_VECTORS_MISSING",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} has no independently approved exact-source calculation vectors bound to this content version.`,
    },
    {
      code: "NSW_PROVIDER_SUBMISSION_SCHEMA_MISSING",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} has no authorised provider submission schema and provider outcome receipt contract.`,
    },
    {
      code: "NSW_INDEPENDENT_CREDITEX_REVIEW_REQUIRED",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} requires a named Creditex reviewer who is not the author.`,
    },
  ];
  if (definitions.length === 0) {
    gaps.push({
      code: "NSW_GOVERNED_CALCULATOR_CONTRACT_MISSING",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} has no typed formula contract in the tracked NSW calculation catalogue.`,
    });
  }
  if (external.length > 0) {
    gaps.push({
      code: "NSW_EXTERNAL_SOURCE_NOT_IN_CUSTODY",
      blocksActivation: true,
      detail: `${programCode} ${activityCode} references ${external.length} external source identity or identities that are not part of the tracked NSW custody-candidate manifest.`,
    });
  }
  return gaps.sort((left, right) => left.code.localeCompare(right.code));
}

function createCandidate(
  template: GovernmentActivityTemplate,
): CreditexNswCertificateWorkPackContentCandidate {
  if (
    template.programCode !== "NSW-ESS" &&
    template.programCode !== "NSW-PDRS"
  ) {
    throw new Error(`Unsupported NSW certificate programme ${template.programCode}.`);
  }
  if (template.catalogueState !== "current" && template.catalogueState !== "limited") {
    throw new Error(`Inactive NSW activity ${template.templateId} cannot enter the candidate set.`);
  }
  const programCode = template.programCode;
  const program = GOVERNMENT_PROGRAM_TEMPLATES.find(
    (candidate) => candidate.programCode === programCode,
  );
  if (!program || program.outcomeClass !== "tradable_certificate") {
    throw new Error(`Missing tradable-certificate programme definition for ${programCode}.`);
  }
  const localProgramme = programmeDefinition(programCode);
  const definitions = localProgramme.activities.filter(
    (activity) => activity.officialActivityCode === template.registryActivityCode,
  );
  const method = calculationMethod(programCode, template.templateId);
  const source = exactRuleCitation(
    programCode,
    template.registryActivityCode,
    definitions[0],
  );
  const external = externalReferences(programCode, definitions);
  const productKinds = uniqueSorted(
    definitions.flatMap((definition) => definition.productKinds),
  );
  const productRegistrySignals = uniqueSorted(
    definitions.flatMap((definition) => definition.productRegistryRequirements),
  );
  const scenarioSignals = uniqueSorted(
    definitions.map((definition) => definition.supportedScenario),
  );
  const outputUnit = programCode === "NSW-ESS" ? "ESC" : "PRC";

  return {
    schema: CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_SCHEMA,
    programCode,
    templateId: template.templateId,
    registryActivityCode: template.registryActivityCode,
    title: template.title,
    serviceCategory: template.serviceCategory,
    catalogueState: template.catalogueState,
    statusDecision: {
      state: "candidate_not_approved",
      localCatalogueSignal: template.catalogueState,
      source,
    },
    identityBindings: {
      accreditedCertificateProvider: "creditex_provider_for_job",
      installerBusiness: "assigned_trade_business_for_job",
      assignedTechnician: "assigned_trade_technician_for_appointment",
      purchaserOrSiteContact: "job_customer_or_authorised_site_contact",
    },
    output: {
      outcomeClass: "tradable_certificate",
      claimOutputCode: outputUnit,
      claimOutputLabel: program.claimOutputLabel,
      outputUnit,
      actionOwner: "creditex_accredited_certificate_provider_for_job",
      actionState: "blocked_until_all_governance_gaps_resolved",
      providerOutcomeReceiptRequired: true,
    },
    sourceBindings: programSourceBindings(
      programCode,
      template.registryActivityCode,
    ),
    prompts: commonPrompts(
      programCode,
      template.registryActivityCode,
      definitions,
    ),
    evidenceRequirements: evidenceRequirements(
      programCode,
      template.registryActivityCode,
      definitions,
    ),
    productKind: {
      decisionState: "unresolved",
      officialValues: [],
      localCalculationSignals: productKinds,
      source,
    },
    product: {
      selectionState: "blocked_pending_exact_registry_and_review",
      registryApplicabilityDecision: "unresolved",
      registrySnapshotRequired: null,
      localRegistryRequirementSignals: productRegistrySignals,
      source,
    },
    scenario: {
      decisionState: "unresolved",
      officialCodes: [],
      localCalculationSignals: scenarioSignals,
      source,
    },
    calculator: {
      outputUnit,
      localCatalogueState: method.state,
      localCataloguePathway: method.pathway,
      localCatalogueFormulaKeySignal: method.formulaKey,
      formulaSignals: formulaSignals(programCode, definitions),
      exactOfficialGoldenVectorState: "missing",
      independentReviewState: "missing",
      executionState: "blocked",
    },
    signers: [{
      signerRole: "activity_signer_roles_unresolved",
      decisionState: "unresolved",
      visibleSignatureBoxWhenPublished: true,
      signingEnabled: false,
      source,
    }],
    referenceDocuments: programSourceBindings(
      programCode,
      template.registryActivityCode,
    ),
    externalReferenceSignals: external,
    finalDocumentNeeds: [
      {
        documentType: "creditex_governed_activity_work_pack_pdf",
        label: `${programCode} ${template.registryActivityCode} governed work-pack PDF`,
        format: "pdf",
        immutableAfterFinalisation: true,
        mappingState: "blocked_pending_exact_form_and_signer_review",
        source,
      },
      {
        documentType: "nsw_certificate_provider_submission_packet",
        label: `${outputUnit} provider submission evidence packet`,
        format: "original_evidence_and_json",
        immutableAfterFinalisation: true,
        mappingState: "blocked_pending_authorised_provider_schema",
        source,
      },
    ],
    gaps: candidateGaps(
      programCode,
      template.registryActivityCode,
      definitions,
      external,
    ),
    candidateOnly: true,
    independentlyApproved: false,
    published: false,
    activationReady: false,
  };
}

export const CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES =
  CREDITEX_NSW_CERTIFICATE_PROGRAM_CODES.flatMap((programCode) =>
    governmentActivityTemplates(programCode)
      .filter(
        (template) =>
          template.catalogueState === "current" ||
          template.catalogueState === "limited",
      )
      .map(createCandidate),
  ) as readonly CreditexNswCertificateWorkPackContentCandidate[];

export type CreditexNswCertificateWorkPackValidation = {
  valid: boolean;
  errors: readonly string[];
  total: number;
  programCounts: Readonly<Record<CreditexNswCertificateProgramCode, number>>;
  candidateContentCompleteCount: number;
  activationReadyCount: number;
};

function candidateContentComplete(
  candidate: CreditexNswCertificateWorkPackContentCandidate,
) {
  return candidate.sourceBindings.length > 0 &&
    candidate.prompts.length > 0 &&
    candidate.evidenceRequirements.length > 0 &&
    candidate.signers.length > 0 &&
    candidate.referenceDocuments.length > 0 &&
    candidate.finalDocumentNeeds.length > 0 &&
    candidate.gaps.length > 0;
}

export function validateCreditexNswCertificateWorkPackContent(
  candidates: readonly CreditexNswCertificateWorkPackContentCandidate[] =
    CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES,
): CreditexNswCertificateWorkPackValidation {
  const errors: string[] = [];
  const expectedTemplates = CREDITEX_NSW_CERTIFICATE_PROGRAM_CODES.flatMap(
    (programCode) =>
      governmentActivityTemplates(programCode).filter(
        (template) =>
          template.catalogueState === "current" ||
          template.catalogueState === "limited",
      ),
  );
  const expectedIds = expectedTemplates.map((template) => template.templateId);
  const actualIds = candidates.map((candidate) => candidate.templateId);
  const programCounts = {
    "NSW-ESS": candidates.filter(
      (candidate) => candidate.programCode === "NSW-ESS",
    ).length,
    "NSW-PDRS": candidates.filter(
      (candidate) => candidate.programCode === "NSW-PDRS",
    ).length,
  };

  if (candidates.length !== 48) {
    errors.push(`Expected 48 NSW certificate candidates, received ${candidates.length}.`);
  }
  if (programCounts["NSW-ESS"] !== 42 || programCounts["NSW-PDRS"] !== 6) {
    errors.push("NSW candidate coverage must be exactly 42 ESS and 6 PDRS rows.");
  }
  if (new Set(actualIds).size !== candidates.length) {
    errors.push("NSW candidate template IDs must be unique.");
  }
  if (actualIds.join("|") !== expectedIds.join("|")) {
    errors.push("NSW candidates do not exactly match the ordered current/limited catalogue.");
  }
  for (const candidate of candidates) {
    const prefix = `${candidate.programCode} ${candidate.registryActivityCode}`;
    if (candidate.schema !== CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_SCHEMA) {
      errors.push(`${prefix} has an invalid schema.`);
    }
    if (!candidateContentComplete(candidate)) {
      errors.push(`${prefix} is missing required candidate-content sections.`);
    }
    if (
      candidate.candidateOnly !== true ||
      candidate.independentlyApproved !== false ||
      candidate.published !== false ||
      candidate.activationReady !== false
    ) {
      errors.push(`${prefix} must remain unapproved, unpublished and activation-blocked.`);
    }
    if (
      candidate.output.outcomeClass !== "tradable_certificate" ||
      candidate.output.claimOutputCode !== candidate.calculator.outputUnit ||
      candidate.output.actionState !== "blocked_until_all_governance_gaps_resolved"
    ) {
      errors.push(`${prefix} has an invalid output classification or action state.`);
    }
    if (
      candidate.productKind.decisionState !== "unresolved" ||
      candidate.productKind.officialValues.length !== 0 ||
      candidate.product.registryApplicabilityDecision !== "unresolved" ||
      candidate.scenario.decisionState !== "unresolved" ||
      candidate.scenario.officialCodes.length !== 0
    ) {
      errors.push(`${prefix} must keep product and scenario decisions unresolved.`);
    }
    if (
      candidate.calculator.exactOfficialGoldenVectorState !== "missing" ||
      candidate.calculator.independentReviewState !== "missing" ||
      candidate.calculator.executionState !== "blocked"
    ) {
      errors.push(`${prefix} has an invalid fail-closed calculator state.`);
    }
    if (candidate.gaps.some((gap) => gap.blocksActivation !== true)) {
      errors.push(`${prefix} contains a gap that does not block activation.`);
    }
    if (new Set(candidate.gaps.map((gap) => gap.code)).size !== candidate.gaps.length) {
      errors.push(`${prefix} contains duplicate gap codes.`);
    }
    if (!candidate.signers.every((signer) =>
      signer.visibleSignatureBoxWhenPublished === true &&
      signer.signingEnabled === false
    )) {
      errors.push(`${prefix} has an invalid unresolved signer contract.`);
    }
    if (!candidate.evidenceRequirements.every((evidence) =>
      evidence.captureEnabled === false &&
      evidence.preserveOriginalBytes === true &&
      evidence.preserveOriginalMetadataForMedia === true
    )) {
      errors.push(`${prefix} has an invalid evidence custody boundary.`);
    }
    const definitions = programmeDefinition(candidate.programCode).activities.filter(
      (definition) =>
        definition.officialActivityCode === candidate.registryActivityCode,
    );
    if (
      definitions.length === 0 &&
      !candidate.gaps.some(
        (gap) => gap.code === "NSW_GOVERNED_CALCULATOR_CONTRACT_MISSING",
      )
    ) {
      errors.push(`${prefix} is missing its governed-calculator gap.`);
    }
    if (candidate.calculator.formulaSignals.length !== definitions.length) {
      errors.push(`${prefix} does not match the tracked local formula-signal count.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    total: candidates.length,
    programCounts,
    candidateContentCompleteCount: candidates.filter(candidateContentComplete).length,
    activationReadyCount: candidates.filter((candidate) => candidate.activationReady).length,
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalCreditexNswCertificateWorkPackContent(
  candidates: readonly CreditexNswCertificateWorkPackContentCandidate[] =
    CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES,
) {
  return JSON.stringify(canonicalValue(candidates));
}

export const CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANONICAL_SHA256 =
  "e23fd51c1d3b8d8f3b32207cb276238d7e852f86416f112fd509ad5ba01335a8" as const;

export const CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION =
  validateCreditexNswCertificateWorkPackContent();

if (!CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION.valid) {
  throw new Error(
    `Invalid Creditex NSW certificate work-pack candidate content: ${CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION.errors.join(" ")}`,
  );
}

export const CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_COMPLETENESS = {
  expectedCurrentOrLimitedTemplates: 48,
  machineReadableCandidateTemplates:
    CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION
      .candidateContentCompleteCount,
  independentlyApprovedActivationTemplates:
    CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION.activationReadyCount,
  publicationState: "candidate_not_approved" as const,
} as const;
