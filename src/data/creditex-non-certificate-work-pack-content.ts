import custodyManifestJson from "./creditex-official-source-custody-candidates-2026-08-15.json" with { type: "json" };
import {
  GOVERNMENT_PROGRAM_TEMPLATES,
  governmentActivityTemplates,
  type ComplianceClaimOutputCode,
  type GovernmentActivityTemplate,
  type GovernmentProgramTemplate,
} from "../lib/australian-government-program-catalogue.ts";
import {
  governmentActivityCalculationMethods,
  type GovernmentActivityCalculationMethod,
} from "../lib/australian-certificate-calculation-catalogue.ts";
import {
  creditexLocalActivityDefinition,
  creditexLocalProgramDefinition,
  type CreditexLocalActivityDefinition,
  type CreditexLocalInputDefinition,
} from "../lib/creditex-local-program-catalogue.ts";
import {
  officialProductKindsForLocalActivity,
} from "../lib/creditex-official-product-registry.ts";

export const CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_SCHEMA =
  "creditex-non-certificate-work-pack-content/v1" as const;

export const CREDITEX_NON_CERTIFICATE_PROGRAM_CODES = [
  "SOLAR-VIC-PV",
  "SOLAR-VIC-HW",
  "SOLAR-VIC-RENTAL",
  "SOLAR-VIC-CH",
  "SOLAR-VIC-APT",
  "NSW-HES",
  "NSW-SAR",
  "ACT-EEIS",
  "ACT-SHS",
  "ACT-HES",
  "ACT-SBP",
  "ACT-SFA",
  "SA-REPS",
  "QLD-SSR",
  "QLD-QCHEU",
  "QLD-HER",
  "QLD-FIT",
  "WA-RBS",
  "WA-DEBS",
  "WA-BATTERY-REWARDS",
  "WA-HORIZON-BUYBACK",
  "TAS-NILS-ES",
  "TAS-POWERSMART",
  "TAS-FIT",
  "NT-SMD",
  "NT-FIT",
] as const;

export type CreditexNonCertificateProgramCode =
  (typeof CREDITEX_NON_CERTIFICATE_PROGRAM_CODES)[number];

export type CreditexNonCertificateOutcomeClass =
  | "retailer_obligation_credit"
  | "rebate"
  | "grant"
  | "loan"
  | "tariff_only"
  | "procurement_only";

export type CreditexNonCertificateClaimOutputCode = Extract<
  ComplianceClaimOutputCode,
  | "EEIS_BENEFIT"
  | "REPS_BENEFIT"
  | "REBATE"
  | "GRANT"
  | "FINANCE"
  | "TARIFF"
  | "PROCUREMENT"
>;

export type CreditexNonCertificateActionClass =
  | "retailer_obligation_claim"
  | "rebate_application_or_claim"
  | "grant_application_or_acquittal"
  | "finance_application_or_settlement"
  | "tariff_enrolment_or_metered_credit"
  | "procurement_delivery_or_acceptance";

export type CreditexNonCertificateOfficialSourceCustodyCandidate = {
  sourceId: string;
  programCodes: string[];
  authorityClass: "government_or_regulator";
  authorityHost: string;
  officialUrl: string;
  expectedFinalAuthorityHost: string;
  expectedFinalUrl: string;
  sourceTitle: string;
  sourceVersion: string;
  statedEffectiveDate: string;
  originalFileName: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  observedOn: "2026-08-15";
  pendingIndependentCreditexReview: true;
  operationallyApproved: false;
};

type CreditexOfficialSourceCustodyManifest = {
  contract: "creditex-official-source-custody-import/v1";
  observedOn: "2026-08-15";
  sourceAuditManifestSha256: string;
  candidateCount: 167;
  authorityBoundary: "australian_government_or_regulator_https_only";
  custodyBoundary: string;
  candidates: CreditexNonCertificateOfficialSourceCustodyCandidate[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOfficialSourceCustodyManifest(
  value: unknown,
): asserts value is CreditexOfficialSourceCustodyManifest {
  if (!isRecord(value)) {
    throw new Error("Official-source custody manifest must be an object.");
  }
  if (
    value.contract !== "creditex-official-source-custody-import/v1" ||
    value.observedOn !== "2026-08-15" ||
    value.candidateCount !== 167 ||
    value.authorityBoundary !==
      "australian_government_or_regulator_https_only" ||
    typeof value.custodyBoundary !== "string" ||
    !Array.isArray(value.candidates) ||
    value.candidates.length !== 167 ||
    typeof value.sourceAuditManifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceAuditManifestSha256)
  ) {
    throw new Error("Official-source custody manifest audit identity is invalid.");
  }
  const sourceIds = new Set<string>();
  for (const candidate of value.candidates) {
    if (
      !isRecord(candidate) ||
      typeof candidate.sourceId !== "string" ||
      sourceIds.has(candidate.sourceId) ||
      !Array.isArray(candidate.programCodes) ||
      !candidate.programCodes.every((code) => typeof code === "string") ||
      candidate.authorityClass !== "government_or_regulator" ||
      typeof candidate.authorityHost !== "string" ||
      typeof candidate.officialUrl !== "string" ||
      !candidate.officialUrl.startsWith("https://") ||
      typeof candidate.expectedFinalAuthorityHost !== "string" ||
      typeof candidate.expectedFinalUrl !== "string" ||
      !candidate.expectedFinalUrl.startsWith("https://") ||
      typeof candidate.sourceTitle !== "string" ||
      typeof candidate.sourceVersion !== "string" ||
      typeof candidate.statedEffectiveDate !== "string" ||
      typeof candidate.originalFileName !== "string" ||
      typeof candidate.expectedContentType !== "string" ||
      typeof candidate.expectedSizeBytes !== "number" ||
      candidate.expectedSizeBytes <= 0 ||
      typeof candidate.expectedSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.expectedSha256) ||
      candidate.observedOn !== "2026-08-15" ||
      candidate.pendingIndependentCreditexReview !== true ||
      candidate.operationallyApproved !== false
    ) {
      throw new Error("Official-source custody manifest contains an invalid candidate.");
    }
    sourceIds.add(candidate.sourceId);
  }
}

assertOfficialSourceCustodyManifest(custodyManifestJson);

const custodyManifest = custodyManifestJson;
const nonCertificateProgramCodeSet = new Set<string>(
  CREDITEX_NON_CERTIFICATE_PROGRAM_CODES,
);

export const CREDITEX_NON_CERTIFICATE_SOURCE_CUSTODY_AUDIT = {
  contract: custodyManifest.contract,
  observedOn: custodyManifest.observedOn,
  sourceAuditManifestSha256: custodyManifest.sourceAuditManifestSha256,
  candidateCount: custodyManifest.candidateCount,
  authorityBoundary: custodyManifest.authorityBoundary,
  custodyBoundary: custodyManifest.custodyBoundary,
} as const;

export const CREDITEX_NON_CERTIFICATE_TRACKED_SOURCE_LIBRARY:
  readonly CreditexNonCertificateOfficialSourceCustodyCandidate[] =
    custodyManifest.candidates.filter((candidate) =>
      candidate.programCodes.some((programCode) =>
        nonCertificateProgramCodeSet.has(programCode)
      )
    );

export type CreditexNonCertificateAdministratorSourceDependency = {
  pointerId: string;
  programCodes: readonly CreditexNonCertificateProgramCode[];
  title: string;
  officialUrl: string;
  authorityHost: string;
  authorityClass: "programme_administrator_not_government_or_regulator";
  custodyIngestionCandidate: false;
  sourceId: null;
  expectedSha256: null;
  reviewState: "unresolved_pending_custody_and_independent_review";
};

export const CREDITEX_NON_CERTIFICATE_ADMINISTRATOR_SOURCE_DEPENDENCIES = [
  {
    pointerId: "administrator-qld-fit-ergon-retail",
    programCodes: ["QLD-FIT"],
    title: "Ergon Energy Retail solar feed-in tariff",
    officialUrl:
      "https://www.ergon.com.au/retail/business/tariffs-and-prices/solar-feed-in-tariff",
    authorityHost: "www.ergon.com.au",
    authorityClass: "programme_administrator_not_government_or_regulator",
    custodyIngestionCandidate: false,
    sourceId: null,
    expectedSha256: null,
    reviewState: "unresolved_pending_custody_and_independent_review",
  },
  {
    pointerId: "administrator-wa-synergy-battery-rewards",
    programCodes: ["WA-BATTERY-REWARDS"],
    title: "Synergy DER Battery Rewards terms and conditions",
    officialUrl:
      "https://www.synergy.net.au/-/media/Documents/Terms-and-conditions/DER-Battery-Rewards-Terms-and-conditions.pdf",
    authorityHost: "www.synergy.net.au",
    authorityClass: "programme_administrator_not_government_or_regulator",
    custodyIngestionCandidate: false,
    sourceId: null,
    expectedSha256: null,
    reviewState: "unresolved_pending_custody_and_independent_review",
  },
  {
    pointerId: "administrator-wa-horizon-pricing",
    programCodes: ["WA-DEBS", "WA-HORIZON-BUYBACK"],
    title: "Horizon Power pricing and buyback information",
    officialUrl: "https://www.horizonpower.com.au/utilities/pricing/",
    authorityHost: "www.horizonpower.com.au",
    authorityClass: "programme_administrator_not_government_or_regulator",
    custodyIngestionCandidate: false,
    sourceId: null,
    expectedSha256: null,
    reviewState: "unresolved_pending_custody_and_independent_review",
  },
  {
    pointerId: "administrator-nt-jacana-pricing",
    programCodes: ["NT-FIT"],
    title: "Jacana Energy residential pricing",
    officialUrl:
      "https://www.jacanaenergy.com.au/index.php/residential/pricing",
    authorityHost: "www.jacanaenergy.com.au",
    authorityClass: "programme_administrator_not_government_or_regulator",
    custodyIngestionCandidate: false,
    sourceId: null,
    expectedSha256: null,
    reviewState: "unresolved_pending_custody_and_independent_review",
  },
] as const satisfies readonly CreditexNonCertificateAdministratorSourceDependency[];

export type CreditexNonCertificateUntrackedGovernmentSourcePointer = {
  pointerId: string;
  programCodes: readonly CreditexNonCertificateProgramCode[];
  title: string;
  officialUrl: string;
  authorityHost: string;
  authorityClass: "government_or_regulator_pointer_not_in_custody";
  custodyIngestionCandidate: false;
  sourceId: null;
  expectedSha256: null;
  reviewState: "unresolved_pending_custody_and_independent_review";
};

export const CREDITEX_NON_CERTIFICATE_UNTRACKED_GOVERNMENT_SOURCE_POINTERS = [
  {
    pointerId: "government-tas-nils-energy-saver-landing",
    programCodes: ["TAS-NILS-ES"],
    title: "Energy Saver Loan Scheme programme information",
    officialUrl:
      "https://www.recfit.tas.gov.au/grants_programs/energy/energy_bill_relief",
    authorityHost: "www.recfit.tas.gov.au",
    authorityClass: "government_or_regulator_pointer_not_in_custody",
    custodyIngestionCandidate: false,
    sourceId: null,
    expectedSha256: null,
    reviewState: "unresolved_pending_custody_and_independent_review",
  },
  {
    pointerId: "government-nt-solar-multi-dwellings-landing",
    programCodes: ["NT-SMD"],
    title: "Solar for Multi Dwellings Grant Scheme",
    officialUrl:
      "https://nt.gov.au/industry/business-grants-funding/solar-for-multi-dwellings-grant-scheme",
    authorityHost: "nt.gov.au",
    authorityClass: "government_or_regulator_pointer_not_in_custody",
    custodyIngestionCandidate: false,
    sourceId: null,
    expectedSha256: null,
    reviewState: "unresolved_pending_custody_and_independent_review",
  },
] as const satisfies readonly CreditexNonCertificateUntrackedGovernmentSourcePointer[];

export type CreditexNonCertificateTrackedSourceBinding =
  CreditexNonCertificateOfficialSourceCustodyCandidate & {
    referenceKind: "tracked_government_or_regulator_custody_candidate";
    citation: string;
  };

type CreditexNonCertificateAdministratorReference =
  CreditexNonCertificateAdministratorSourceDependency & {
    referenceKind: "administrator_pointer_not_in_governed_custody";
    citation: string;
  };

type CreditexNonCertificateUntrackedGovernmentReference =
  CreditexNonCertificateUntrackedGovernmentSourcePointer & {
    referenceKind: "government_or_regulator_pointer_not_in_governed_custody";
    citation: string;
  };

export type CreditexNonCertificateReferenceDocument =
  | CreditexNonCertificateTrackedSourceBinding
  | CreditexNonCertificateAdministratorReference
  | CreditexNonCertificateUntrackedGovernmentReference;

export type CreditexNonCertificatePromptRequirement = {
  key: string;
  label: string;
  programCode: CreditexNonCertificateProgramCode;
  activityCode: string;
  kind:
    | "identity"
    | "site"
    | "implementation"
    | "calculation_input"
    | "outcome"
    | "governance_blocker";
  fieldType: CreditexLocalInputDefinition["type"] | "text" | "date" | "record";
  unit: string;
  requiredWhenPublished: boolean;
  valueSource:
    | "job"
    | "creditex_compliance"
    | "assigned_trade_business"
    | "assigned_trade_technician"
    | "operator"
    | "external_counterparty"
    | "governance_admin";
  signalOrigin:
    | "candidate_work_pack_scaffold"
    | "local_non_authoritative_calculation_catalogue";
  collectionState: "candidate_not_approved";
  source: CreditexNonCertificateReferenceDocument;
};

export type CreditexNonCertificateEvidenceRequirement = {
  requirementId: string;
  programCode: CreditexNonCertificateProgramCode;
  activityCode: string;
  kind:
    | "original_work_evidence_set"
    | "identity_and_authority_evidence"
    | "eligibility_evidence"
    | "product_or_service_status_evidence"
    | "calculation_or_method_receipt"
    | "external_outcome_receipt";
  label: string;
  exactRequirementState: "unresolved_pending_transcription_and_review";
  captureEnabled: false;
  preserveOriginalBytes: true;
  preserveOriginalMetadataForMedia: true;
  source: CreditexNonCertificateReferenceDocument;
};

export type CreditexNonCertificateFormulaSignal = {
  activityCode: string;
  title: string;
  scenario: string;
  formulaKey: string;
  inputs: readonly CreditexLocalInputDefinition[];
  productRegistryRequirements: readonly string[];
  sourceAuthority: "local_non_authoritative_signal";
  localProgramSource: {
    officialSourceUrl: string;
    officialSourceTitle: string;
    sourceVersion: string;
    effectiveFrom: string;
    effectiveTo: string;
  };
};

export type CreditexNonCertificateWorkPackGapCode =
  | "NONCERT_ACTIVITY_STATUS_REVIEW_REQUIRED"
  | "NONCERT_ACTIVITY_FORM_SCHEMA_NOT_APPROVED"
  | "NONCERT_ACTIVITY_EVIDENCE_POLICY_NOT_APPROVED"
  | "NONCERT_EXACT_SIGNER_MAPPING_NOT_APPROVED"
  | "NONCERT_FINAL_DOCUMENT_MAPPING_NOT_APPROVED"
  | "NONCERT_PRODUCT_APPLICABILITY_NOT_APPROVED"
  | "NONCERT_SCENARIO_APPLICABILITY_NOT_APPROVED"
  | "NONCERT_CALCULATION_APPLICABILITY_NOT_APPROVED"
  | "NONCERT_CALCULATION_VECTORS_AND_RECONCILIATION_MISSING"
  | "NONCERT_EXTERNAL_OUTCOME_SCHEMA_MISSING"
  | "NONCERT_SOURCE_ACTIVITY_INCORPORATION_REVIEW_REQUIRED"
  | "NONCERT_INDEPENDENT_CREDITEX_REVIEW_REQUIRED"
  | "NONCERT_GOVERNED_METHOD_CONTRACT_MISSING"
  | "NONCERT_NO_TRACKED_GOVERNMENT_SOURCE"
  | "NONCERT_ADMINISTRATOR_SOURCE_NOT_GOVERNED"
  | "NONCERT_PROGRAM_POINTER_NOT_IN_CUSTODY";

export type CreditexNonCertificateWorkPackContentCandidate = {
  schema: typeof CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_SCHEMA;
  programCode: CreditexNonCertificateProgramCode;
  templateId: string;
  registryActivityCode: string;
  title: string;
  serviceCategory: GovernmentActivityTemplate["serviceCategory"];
  catalogueState: "current" | "limited";
  statusDecision: {
    state: "candidate_not_approved";
    localCatalogueSignal: "current" | "limited";
    source: CreditexNonCertificateReferenceDocument;
  };
  identityBindings: {
    complianceController: "creditex_compliance_team_for_job";
    deliveryBusiness: "assigned_trade_business_for_job";
    assignedTechnician: "assigned_trade_technician_for_appointment";
    participantOrCustomer: "job_customer_or_authorised_site_contact";
    externalCounterparty: "program_administrator_or_delivery_counterparty_for_job";
  };
  output: {
    outcomeClass: CreditexNonCertificateOutcomeClass;
    claimOutputCode: CreditexNonCertificateClaimOutputCode;
    claimOutputLabel: string;
    actionClass: CreditexNonCertificateActionClass;
    actionOwner: "program_applicant_or_authorised_delivery_counterparty_for_job";
    actionState: "blocked_until_all_governance_gaps_resolved";
    externalOutcomeReceiptRequired: true;
  };
  sourceAudit: typeof CREDITEX_NON_CERTIFICATE_SOURCE_CUSTODY_AUDIT;
  trackedSourceBindings: readonly CreditexNonCertificateTrackedSourceBinding[];
  administratorSourceDependencies:
    readonly CreditexNonCertificateAdministratorSourceDependency[];
  untrackedGovernmentSourcePointers:
    readonly CreditexNonCertificateUntrackedGovernmentSourcePointer[];
  prompts: readonly CreditexNonCertificatePromptRequirement[];
  evidenceRequirements: readonly CreditexNonCertificateEvidenceRequirement[];
  productKind: {
    decisionState: "unresolved";
    officialValues: readonly [];
    localProductKindSignals: readonly string[];
    signalAuthority: "local_non_authoritative_signal";
    source: CreditexNonCertificateReferenceDocument;
  };
  product: {
    selectionState: "blocked_pending_exact_program_rules_and_review";
    applicabilityDecision: "unresolved";
    officialRegistrySnapshotRequired: null;
    localRegistryRequirementSignals: readonly string[];
    signalAuthority: "local_non_authoritative_signal";
    source: CreditexNonCertificateReferenceDocument;
  };
  scenario: {
    decisionState: "unresolved";
    officialCodes: readonly [];
    localCatalogueSignals: readonly string[];
    signalAuthority: "local_non_authoritative_signal";
    source: CreditexNonCertificateReferenceDocument;
  };
  calculator: {
    officialApplicabilityDecision: "unresolved";
    localCatalogueState: GovernmentActivityCalculationMethod["state"];
    localCataloguePathway: GovernmentActivityCalculationMethod["pathway"];
    localCatalogueFormulaKeySignal: string;
    localCatalogueUnitSignal: GovernmentActivityCalculationMethod["unit"];
    localCatalogueSourceSignal: {
      officialSourceUrl: string;
      officialSourceTitle: string;
      sourceVersion: string;
      sourceEffectiveFrom: string;
      sourceEffectiveTo: string;
      officialReconciliationRequired: boolean;
    };
    formulaSignals: readonly CreditexNonCertificateFormulaSignal[];
    exactOfficialGoldenVectorState: "missing";
    officialReconciliationState: "missing";
    independentReviewState: "missing";
    executionState: "blocked";
  };
  signers: readonly [{
    signerRole: "activity_signer_roles_unresolved";
    decisionState: "unresolved";
    visibleSignatureBoxWhenPublished: true;
    signingEnabled: false;
    source: CreditexNonCertificateReferenceDocument;
  }];
  referenceDocuments: readonly CreditexNonCertificateReferenceDocument[];
  finalDocumentNeeds: readonly [{
    documentType: "creditex_governed_activity_work_pack_pdf";
    label: string;
    format: "pdf";
    immutableAfterFinalisation: true;
    mappingState: "blocked_pending_exact_form_and_signer_review";
    source: CreditexNonCertificateReferenceDocument;
  }, {
    documentType:
      | "retailer_obligation_delivery_and_benefit_record"
      | "rebate_application_and_outcome_record"
      | "grant_application_and_acquittal_record"
      | "finance_application_and_settlement_record"
      | "tariff_enrolment_and_metered_credit_record"
      | "procurement_delivery_and_acceptance_record";
    label: string;
    format: "original_evidence_and_json";
    immutableAfterFinalisation: true;
    mappingState: "blocked_pending_external_outcome_schema";
    source: CreditexNonCertificateReferenceDocument;
  }];
  gaps: readonly {
    code: CreditexNonCertificateWorkPackGapCode;
    blocksActivation: true;
    detail: string;
  }[];
  candidateOnly: true;
  independentlyApproved: false;
  published: false;
  activationReady: false;
};

function isNonCertificateOutcomeClass(
  outcomeClass: GovernmentProgramTemplate["outcomeClass"],
): outcomeClass is CreditexNonCertificateOutcomeClass {
  return outcomeClass === "retailer_obligation_credit" ||
    outcomeClass === "rebate" ||
    outcomeClass === "grant" ||
    outcomeClass === "loan" ||
    outcomeClass === "tariff_only" ||
    outcomeClass === "procurement_only";
}

function isNonCertificateClaimOutputCode(
  claimOutputCode: ComplianceClaimOutputCode,
): claimOutputCode is CreditexNonCertificateClaimOutputCode {
  return claimOutputCode === "EEIS_BENEFIT" ||
    claimOutputCode === "REPS_BENEFIT" ||
    claimOutputCode === "REBATE" ||
    claimOutputCode === "GRANT" ||
    claimOutputCode === "FINANCE" ||
    claimOutputCode === "TARIFF" ||
    claimOutputCode === "PROCUREMENT";
}

function programDefinition(
  programCode: CreditexNonCertificateProgramCode,
): GovernmentProgramTemplate & {
  outcomeClass: CreditexNonCertificateOutcomeClass;
  claimOutputCode: CreditexNonCertificateClaimOutputCode;
} {
  const program = GOVERNMENT_PROGRAM_TEMPLATES.find(
    (candidate) => candidate.programCode === programCode,
  );
  if (
    !program ||
    !isNonCertificateOutcomeClass(program.outcomeClass) ||
    !isNonCertificateClaimOutputCode(program.claimOutputCode)
  ) {
    throw new Error(`Missing non-certificate programme definition for ${programCode}.`);
  }
  return {
    ...program,
    outcomeClass: program.outcomeClass,
    claimOutputCode: program.claimOutputCode,
  };
}

function calculationMethod(
  programCode: CreditexNonCertificateProgramCode,
  templateId: string,
) {
  const method = governmentActivityCalculationMethods(programCode).find(
    (candidate) => candidate.activityTemplateId === templateId,
  );
  if (!method || method.certificateActionEnabled !== false) {
    throw new Error(`Missing fail-closed calculation method for ${templateId}.`);
  }
  return method;
}

function actionClassFor(
  outcomeClass: CreditexNonCertificateOutcomeClass,
): CreditexNonCertificateActionClass {
  if (outcomeClass === "retailer_obligation_credit") {
    return "retailer_obligation_claim";
  }
  if (outcomeClass === "rebate") return "rebate_application_or_claim";
  if (outcomeClass === "grant") return "grant_application_or_acquittal";
  if (outcomeClass === "loan") return "finance_application_or_settlement";
  if (outcomeClass === "tariff_only") {
    return "tariff_enrolment_or_metered_credit";
  }
  return "procurement_delivery_or_acceptance";
}

function trackedSourceBindings(
  programCode: CreditexNonCertificateProgramCode,
  activityCode: string,
): CreditexNonCertificateTrackedSourceBinding[] {
  return CREDITEX_NON_CERTIFICATE_TRACKED_SOURCE_LIBRARY
    .filter((source) => source.programCodes.includes(programCode))
    .map((source) => ({
      ...source,
      referenceKind: "tracked_government_or_regulator_custody_candidate",
      citation: `${programCode} ${activityCode}: retained programme source candidate. Exact activity incorporation and operational approval remain pending independent Creditex review.`,
    }));
}

function administratorDependencies(
  programCode: CreditexNonCertificateProgramCode,
) {
  return CREDITEX_NON_CERTIFICATE_ADMINISTRATOR_SOURCE_DEPENDENCIES.filter(
    (dependency) => dependency.programCodes.some((code) => code === programCode),
  );
}

function untrackedGovernmentPointers(
  programCode: CreditexNonCertificateProgramCode,
) {
  return CREDITEX_NON_CERTIFICATE_UNTRACKED_GOVERNMENT_SOURCE_POINTERS.filter(
    (pointer) => pointer.programCodes.some((code) => code === programCode),
  );
}

function referenceDocuments(
  programCode: CreditexNonCertificateProgramCode,
  activityCode: string,
  tracked: readonly CreditexNonCertificateTrackedSourceBinding[],
  administrators: readonly CreditexNonCertificateAdministratorSourceDependency[],
  untracked: readonly CreditexNonCertificateUntrackedGovernmentSourcePointer[],
): CreditexNonCertificateReferenceDocument[] {
  return [
    ...tracked,
    ...untracked.map((pointer) => ({
      ...pointer,
      referenceKind:
        "government_or_regulator_pointer_not_in_governed_custody" as const,
      citation: `${programCode} ${activityCode}: programme pointer is not an exact-byte custody candidate and cannot govern activity content until acquired and independently reviewed.`,
    })),
    ...administrators.map((dependency) => ({
      ...dependency,
      referenceKind: "administrator_pointer_not_in_governed_custody" as const,
      citation: `${programCode} ${activityCode}: administrator dependency is not a government or regulator custody candidate and cannot govern activity content until separately acquired and independently reviewed.`,
    })),
  ];
}

function primaryReference(
  references: readonly CreditexNonCertificateReferenceDocument[],
  templateId: string,
) {
  const source = references[0];
  if (!source) {
    throw new Error(`No source or dependency pointer is available for ${templateId}.`);
  }
  return source;
}

function formulaSignals(
  programCode: CreditexNonCertificateProgramCode,
  definition: CreditexLocalActivityDefinition | undefined,
): CreditexNonCertificateFormulaSignal[] {
  if (!definition) return [];
  const localProgram = creditexLocalProgramDefinition(programCode);
  if (!localProgram) {
    throw new Error(`Missing local programme signal for ${programCode}.`);
  }
  return [{
    activityCode: definition.activityCode,
    title: definition.title,
    scenario: definition.scenario,
    formulaKey: definition.formulaKey,
    inputs: definition.inputDefinitions,
    productRegistryRequirements: definition.productRegistryRequirements,
    sourceAuthority: "local_non_authoritative_signal",
    localProgramSource: {
      officialSourceUrl: localProgram.officialSourceUrl,
      officialSourceTitle: localProgram.officialSourceTitle,
      sourceVersion: localProgram.sourceVersion,
      effectiveFrom: localProgram.effectiveFrom,
      effectiveTo: localProgram.effectiveTo,
    },
  }];
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function prompts(
  template: GovernmentActivityTemplate,
  programCode: CreditexNonCertificateProgramCode,
  outcomeClass: CreditexNonCertificateOutcomeClass,
  definition: CreditexLocalActivityDefinition | undefined,
  source: CreditexNonCertificateReferenceDocument,
): CreditexNonCertificatePromptRequirement[] {
  const activityCode = template.registryActivityCode;
  const base: CreditexNonCertificatePromptRequirement[] = [
    {
      key: "participant_or_customer_identity",
      label: `${programCode} ${activityCode}: participant or customer legal identity`,
      programCode,
      activityCode,
      kind: "identity",
      fieldType: "record",
      unit: "",
      requiredWhenPublished: true,
      valueSource: "job",
      signalOrigin: "candidate_work_pack_scaffold",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "delivery_business_identity",
      label: `${programCode} ${activityCode}: delivery business legal identity`,
      programCode,
      activityCode,
      kind: "identity",
      fieldType: "record",
      unit: "",
      requiredWhenPublished: true,
      valueSource: "assigned_trade_business",
      signalOrigin: "candidate_work_pack_scaffold",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "assigned_technician_identity",
      label: `${programCode} ${activityCode}: assigned technician identity`,
      programCode,
      activityCode,
      kind: "identity",
      fieldType: "record",
      unit: "",
      requiredWhenPublished: true,
      valueSource: "assigned_trade_technician",
      signalOrigin: "candidate_work_pack_scaffold",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "site_identity_and_address",
      label: `${programCode} ${activityCode}: site identity and service address`,
      programCode,
      activityCode,
      kind: "site",
      fieldType: "record",
      unit: "",
      requiredWhenPublished: true,
      valueSource: "job",
      signalOrigin: "candidate_work_pack_scaffold",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "implementation_date",
      label: `${programCode} ${activityCode}: implementation or service date`,
      programCode,
      activityCode,
      kind: "implementation",
      fieldType: "date",
      unit: "",
      requiredWhenPublished: true,
      valueSource: "operator",
      signalOrigin: "candidate_work_pack_scaffold",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "activity_delivery_record",
      label: `${programCode} ${activityCode}: ${template.title} delivery record`,
      programCode,
      activityCode,
      kind: "implementation",
      fieldType: "record",
      unit: "",
      requiredWhenPublished: true,
      valueSource: "operator",
      signalOrigin: "candidate_work_pack_scaffold",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "governed_eligibility_contract",
      label: `${programCode} ${activityCode}: governed eligibility questions pending exact source transcription`,
      programCode,
      activityCode,
      kind: "governance_blocker",
      fieldType: "record",
      unit: "",
      requiredWhenPublished: true,
      valueSource: "governance_admin",
      signalOrigin: "candidate_work_pack_scaffold",
      collectionState: "candidate_not_approved",
      source,
    },
    {
      key: "external_outcome_contract",
      label: `${programCode} ${activityCode}: ${actionClassFor(outcomeClass).replaceAll("_", " ")} pathway and receipt`,
      programCode,
      activityCode,
      kind: "outcome",
      fieldType: "record",
      unit: "",
      requiredWhenPublished: true,
      valueSource: "external_counterparty",
      signalOrigin: "candidate_work_pack_scaffold",
      collectionState: "candidate_not_approved",
      source,
    },
  ];
  if (!definition) {
    base.push({
      key: "governed_activity_input_contract",
      label: `${programCode} ${activityCode}: governed method inputs pending exact source transcription`,
      programCode,
      activityCode,
      kind: "governance_blocker",
      fieldType: "record",
      unit: "",
      requiredWhenPublished: true,
      valueSource: "governance_admin",
      signalOrigin: "candidate_work_pack_scaffold",
      collectionState: "candidate_not_approved",
      source,
    });
    return base;
  }
  return [
    ...base,
    ...definition.inputDefinitions.map((input) => ({
      key: `local_signal_${input.key}`,
      label: `${programCode} ${activityCode}: ${input.label}`,
      programCode,
      activityCode,
      kind: "calculation_input" as const,
      fieldType: input.type,
      unit: input.unit,
      requiredWhenPublished: true,
      valueSource: "operator" as const,
      signalOrigin: "local_non_authoritative_calculation_catalogue" as const,
      collectionState: "candidate_not_approved" as const,
      source,
    })),
  ];
}

function evidenceRequirements(
  template: GovernmentActivityTemplate,
  programCode: CreditexNonCertificateProgramCode,
  source: CreditexNonCertificateReferenceDocument,
): CreditexNonCertificateEvidenceRequirement[] {
  const activityCode = template.registryActivityCode;
  const evidence = (
    kind: CreditexNonCertificateEvidenceRequirement["kind"],
    label: string,
  ): CreditexNonCertificateEvidenceRequirement => ({
    requirementId: `${programCode.toLowerCase()}-${activityCode.toLowerCase()}-${kind.replaceAll("_", "-")}`,
    programCode,
    activityCode,
    kind,
    label: `${programCode} ${activityCode}: ${label}`,
    exactRequirementState: "unresolved_pending_transcription_and_review",
    captureEnabled: false,
    preserveOriginalBytes: true,
    preserveOriginalMetadataForMedia: true,
    source,
  });
  return [
    evidence(
      "original_work_evidence_set",
      `${template.title} original work evidence set`,
    ),
    evidence(
      "identity_and_authority_evidence",
      "participant, delivery business and technician authority evidence",
    ),
    evidence("eligibility_evidence", "activity eligibility evidence"),
    evidence(
      "product_or_service_status_evidence",
      "product or delivered-service status evidence",
    ),
    evidence(
      "calculation_or_method_receipt",
      "governed calculation or administrative method receipt",
    ),
    evidence(
      "external_outcome_receipt",
      "administrator or delivery counterparty outcome receipt",
    ),
  ];
}

function externalDocumentType(
  outcomeClass: CreditexNonCertificateOutcomeClass,
): CreditexNonCertificateWorkPackContentCandidate["finalDocumentNeeds"][1]["documentType"] {
  if (outcomeClass === "retailer_obligation_credit") {
    return "retailer_obligation_delivery_and_benefit_record";
  }
  if (outcomeClass === "rebate") {
    return "rebate_application_and_outcome_record";
  }
  if (outcomeClass === "grant") {
    return "grant_application_and_acquittal_record";
  }
  if (outcomeClass === "loan") {
    return "finance_application_and_settlement_record";
  }
  if (outcomeClass === "tariff_only") {
    return "tariff_enrolment_and_metered_credit_record";
  }
  return "procurement_delivery_and_acceptance_record";
}

function candidateGaps(
  template: GovernmentActivityTemplate,
  definition: CreditexLocalActivityDefinition | undefined,
  tracked: readonly CreditexNonCertificateTrackedSourceBinding[],
  administrators: readonly CreditexNonCertificateAdministratorSourceDependency[],
  untracked: readonly CreditexNonCertificateUntrackedGovernmentSourcePointer[],
): CreditexNonCertificateWorkPackContentCandidate["gaps"] {
  const prefix = `${template.programCode} ${template.registryActivityCode}`;
  const gaps: Array<{
    code: CreditexNonCertificateWorkPackGapCode;
    blocksActivation: true;
    detail: string;
  }> = [
    {
      code: "NONCERT_ACTIVITY_STATUS_REVIEW_REQUIRED",
      blocksActivation: true,
      detail: `${prefix} current or limited status and effective dates require exact-source independent review.`,
    },
    {
      code: "NONCERT_ACTIVITY_FORM_SCHEMA_NOT_APPROVED",
      blocksActivation: true,
      detail: `${prefix} prompts, branching and correction paths have not been transcribed and independently approved.`,
    },
    {
      code: "NONCERT_ACTIVITY_EVIDENCE_POLICY_NOT_APPROVED",
      blocksActivation: true,
      detail: `${prefix} evidence types, timing, quantity and acceptance rules have not been transcribed and independently approved.`,
    },
    {
      code: "NONCERT_EXACT_SIGNER_MAPPING_NOT_APPROVED",
      blocksActivation: true,
      detail: `${prefix} signer roles, declarations and visible signature placement remain unresolved.`,
    },
    {
      code: "NONCERT_FINAL_DOCUMENT_MAPPING_NOT_APPROVED",
      blocksActivation: true,
      detail: `${prefix} final PDF, original evidence and external record mappings remain unresolved.`,
    },
    {
      code: "NONCERT_PRODUCT_APPLICABILITY_NOT_APPROVED",
      blocksActivation: true,
      detail: `${prefix} product-kind, product and registry applicability decisions are not independently approved.`,
    },
    {
      code: "NONCERT_SCENARIO_APPLICABILITY_NOT_APPROVED",
      blocksActivation: true,
      detail: `${prefix} has no source-cited independently approved scenario decision.`,
    },
    {
      code: "NONCERT_CALCULATION_APPLICABILITY_NOT_APPROVED",
      blocksActivation: true,
      detail: `${prefix} calculation or administrative-method applicability has not been independently approved, including where the local catalogue says not applicable.`,
    },
    {
      code: "NONCERT_CALCULATION_VECTORS_AND_RECONCILIATION_MISSING",
      blocksActivation: true,
      detail: `${prefix} has no independently approved source-exact vectors and external outcome reconciliation.`,
    },
    {
      code: "NONCERT_EXTERNAL_OUTCOME_SCHEMA_MISSING",
      blocksActivation: true,
      detail: `${prefix} has no approved administrator or delivery-counterparty submission and outcome receipt schema.`,
    },
    {
      code: "NONCERT_SOURCE_ACTIVITY_INCORPORATION_REVIEW_REQUIRED",
      blocksActivation: true,
      detail: `${prefix} programme sources have not been mapped clause by clause to this activity.`,
    },
    {
      code: "NONCERT_INDEPENDENT_CREDITEX_REVIEW_REQUIRED",
      blocksActivation: true,
      detail: `${prefix} requires a named Creditex reviewer who is not the author.`,
    },
  ];
  if (!definition) {
    gaps.push({
      code: "NONCERT_GOVERNED_METHOD_CONTRACT_MISSING",
      blocksActivation: true,
      detail: `${prefix} has no typed local method signal. No formula, scenario or administrative decision may be inferred.`,
    });
  }
  if (tracked.length === 0) {
    gaps.push({
      code: "NONCERT_NO_TRACKED_GOVERNMENT_SOURCE",
      blocksActivation: true,
      detail: `${prefix} has no government or regulator source in the tracked 167-source custody manifest.`,
    });
  }
  if (administrators.length > 0) {
    gaps.push({
      code: "NONCERT_ADMINISTRATOR_SOURCE_NOT_GOVERNED",
      blocksActivation: true,
      detail: `${prefix} depends on ${administrators.length} programme-administrator pointer or pointers outside the government or regulator custody manifest.`,
    });
  }
  if (untracked.length > 0) {
    gaps.push({
      code: "NONCERT_PROGRAM_POINTER_NOT_IN_CUSTODY",
      blocksActivation: true,
      detail: `${prefix} depends on ${untracked.length} government programme pointer or pointers without an exact tracked custody identity.`,
    });
  }
  return gaps.sort((left, right) => left.code.localeCompare(right.code));
}

function createCandidate(
  template: GovernmentActivityTemplate,
): CreditexNonCertificateWorkPackContentCandidate {
  if (!nonCertificateProgramCodeSet.has(template.programCode)) {
    throw new Error(`Unsupported non-certificate programme ${template.programCode}.`);
  }
  if (template.catalogueState !== "current" && template.catalogueState !== "limited") {
    throw new Error(`Inactive activity ${template.templateId} cannot enter the candidate set.`);
  }
  const programCode = template.programCode as CreditexNonCertificateProgramCode;
  const program = programDefinition(programCode);
  const method = calculationMethod(programCode, template.templateId);
  const definition = creditexLocalActivityDefinition(
    programCode,
    template.registryActivityCode,
  );
  const tracked = trackedSourceBindings(
    programCode,
    template.registryActivityCode,
  );
  const administrators = administratorDependencies(programCode);
  const untracked = untrackedGovernmentPointers(programCode);
  const references = referenceDocuments(
    programCode,
    template.registryActivityCode,
    tracked,
    administrators,
    untracked,
  );
  const source = primaryReference(references, template.templateId);
  const productKinds = uniqueSorted(
    officialProductKindsForLocalActivity(
      programCode,
      template.registryActivityCode,
    ),
  );
  const localRegistrySignals = uniqueSorted(
    definition?.productRegistryRequirements ?? [],
  );
  const localScenarioSignals = uniqueSorted([
    template.scenarioCode,
    template.scenario,
    definition?.scenario ?? "",
  ]);

  return {
    schema: CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_SCHEMA,
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
      complianceController: "creditex_compliance_team_for_job",
      deliveryBusiness: "assigned_trade_business_for_job",
      assignedTechnician: "assigned_trade_technician_for_appointment",
      participantOrCustomer: "job_customer_or_authorised_site_contact",
      externalCounterparty:
        "program_administrator_or_delivery_counterparty_for_job",
    },
    output: {
      outcomeClass: program.outcomeClass,
      claimOutputCode: program.claimOutputCode,
      claimOutputLabel: program.claimOutputLabel,
      actionClass: actionClassFor(program.outcomeClass),
      actionOwner:
        "program_applicant_or_authorised_delivery_counterparty_for_job",
      actionState: "blocked_until_all_governance_gaps_resolved",
      externalOutcomeReceiptRequired: true,
    },
    sourceAudit: CREDITEX_NON_CERTIFICATE_SOURCE_CUSTODY_AUDIT,
    trackedSourceBindings: tracked,
    administratorSourceDependencies: administrators,
    untrackedGovernmentSourcePointers: untracked,
    prompts: prompts(
      template,
      programCode,
      program.outcomeClass,
      definition,
      source,
    ),
    evidenceRequirements: evidenceRequirements(template, programCode, source),
    productKind: {
      decisionState: "unresolved",
      officialValues: [],
      localProductKindSignals: productKinds,
      signalAuthority: "local_non_authoritative_signal",
      source,
    },
    product: {
      selectionState: "blocked_pending_exact_program_rules_and_review",
      applicabilityDecision: "unresolved",
      officialRegistrySnapshotRequired: null,
      localRegistryRequirementSignals: localRegistrySignals,
      signalAuthority: "local_non_authoritative_signal",
      source,
    },
    scenario: {
      decisionState: "unresolved",
      officialCodes: [],
      localCatalogueSignals: localScenarioSignals,
      signalAuthority: "local_non_authoritative_signal",
      source,
    },
    calculator: {
      officialApplicabilityDecision: "unresolved",
      localCatalogueState: method.state,
      localCataloguePathway: method.pathway,
      localCatalogueFormulaKeySignal: method.formulaKey,
      localCatalogueUnitSignal: method.unit,
      localCatalogueSourceSignal: {
        officialSourceUrl: method.officialSourceUrl,
        officialSourceTitle: method.officialSourceTitle,
        sourceVersion: method.sourceVersion,
        sourceEffectiveFrom: method.sourceEffectiveFrom,
        sourceEffectiveTo: method.sourceEffectiveTo,
        officialReconciliationRequired: method.officialReconciliationRequired,
      },
      formulaSignals: formulaSignals(programCode, definition),
      exactOfficialGoldenVectorState: "missing",
      officialReconciliationState: "missing",
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
    referenceDocuments: references,
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
        documentType: externalDocumentType(program.outcomeClass),
        label: `${program.claimOutputLabel} external submission and outcome record`,
        format: "original_evidence_and_json",
        immutableAfterFinalisation: true,
        mappingState: "blocked_pending_external_outcome_schema",
        source,
      },
    ],
    gaps: candidateGaps(
      template,
      definition,
      tracked,
      administrators,
      untracked,
    ),
    candidateOnly: true,
    independentlyApproved: false,
    published: false,
    activationReady: false,
  };
}

export const CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES =
  CREDITEX_NON_CERTIFICATE_PROGRAM_CODES.flatMap((programCode) =>
    governmentActivityTemplates(programCode)
      .filter(
        (template) =>
          template.catalogueState === "current" ||
          template.catalogueState === "limited",
      )
      .map(createCandidate)
  ) as readonly CreditexNonCertificateWorkPackContentCandidate[];

export type CreditexNonCertificateWorkPackValidation = {
  valid: boolean;
  errors: readonly string[];
  total: number;
  programCounts: Readonly<Record<CreditexNonCertificateProgramCode, number>>;
  retailerObligationCount: number;
  otherOutcomeCount: number;
  localMethodSignalCount: number;
  missingLocalMethodSignalCount: number;
  candidateContentCompleteCount: number;
  activationReadyCount: number;
};

function candidateContentComplete(
  candidate: CreditexNonCertificateWorkPackContentCandidate,
) {
  return candidate.prompts.length > 0 &&
    candidate.evidenceRequirements.length > 0 &&
    candidate.signers.length > 0 &&
    candidate.referenceDocuments.length > 0 &&
    candidate.finalDocumentNeeds.length > 0 &&
    candidate.gaps.length > 0;
}

function exactExpectedTemplates() {
  return CREDITEX_NON_CERTIFICATE_PROGRAM_CODES.flatMap((programCode) =>
    governmentActivityTemplates(programCode).filter(
      (template) =>
        template.catalogueState === "current" ||
        template.catalogueState === "limited",
    )
  );
}

export function validateCreditexNonCertificateWorkPackContent(
  candidates: readonly CreditexNonCertificateWorkPackContentCandidate[] =
    CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES,
): CreditexNonCertificateWorkPackValidation {
  const errors: string[] = [];
  const expectedTemplates = exactExpectedTemplates();
  const expectedIds = expectedTemplates.map((template) => template.templateId);
  const actualIds = candidates.map((candidate) => candidate.templateId);
  const programCounts = Object.fromEntries(
    CREDITEX_NON_CERTIFICATE_PROGRAM_CODES.map((programCode) => [
      programCode,
      candidates.filter((candidate) => candidate.programCode === programCode).length,
    ]),
  ) as Record<CreditexNonCertificateProgramCode, number>;
  const retailerObligationCount = candidates.filter(
    (candidate) => candidate.output.outcomeClass === "retailer_obligation_credit",
  ).length;
  const otherOutcomeCount = candidates.length - retailerObligationCount;
  const localMethodSignalCount = candidates.filter(
    (candidate) => candidate.calculator.formulaSignals.length > 0,
  ).length;
  const catalogueProgramCodes = GOVERNMENT_PROGRAM_TEMPLATES
    .filter(
      (program) =>
        program.outcomeClass !== "tradable_certificate" &&
        governmentActivityTemplates(program.programCode).some(
          (template) =>
            template.catalogueState === "current" ||
            template.catalogueState === "limited",
        ),
    )
    .map((program) => program.programCode);

  if (candidates.length !== 107) {
    errors.push(`Expected 107 non-certificate candidates, received ${candidates.length}.`);
  }
  if (new Set(actualIds).size !== candidates.length) {
    errors.push("Non-certificate candidate template IDs must be unique.");
  }
  if (
    catalogueProgramCodes.join("|") !==
      CREDITEX_NON_CERTIFICATE_PROGRAM_CODES.join("|")
  ) {
    errors.push(
      "Non-certificate programme codes do not exactly match the current or limited government catalogue.",
    );
  }
  if (actualIds.join("|") !== expectedIds.join("|")) {
    errors.push(
      "Non-certificate candidates do not exactly match the ordered current or limited catalogue.",
    );
  }
  if (retailerObligationCount !== 50 || otherOutcomeCount !== 57) {
    errors.push(
      "Non-certificate outcome coverage must be 50 retailer-obligation rows and 57 other rows.",
    );
  }
  if (CREDITEX_NON_CERTIFICATE_TRACKED_SOURCE_LIBRARY.length !== 94) {
    errors.push("Non-certificate tracked-source library must contain 94 unique custody identities.");
  }
  if (
    new Set(
      CREDITEX_NON_CERTIFICATE_TRACKED_SOURCE_LIBRARY.map(
        (source) => source.sourceId,
      ),
    ).size !== CREDITEX_NON_CERTIFICATE_TRACKED_SOURCE_LIBRARY.length
  ) {
    errors.push("Non-certificate tracked-source identities must be unique.");
  }

  for (const candidate of candidates) {
    const prefix = `${candidate.programCode} ${candidate.registryActivityCode}`;
    const program = programDefinition(candidate.programCode);
    const method = calculationMethod(candidate.programCode, candidate.templateId);
    const definition = creditexLocalActivityDefinition(
      candidate.programCode,
      candidate.registryActivityCode,
    );
    const expectedTracked = trackedSourceBindings(
      candidate.programCode,
      candidate.registryActivityCode,
    );
    const expectedAdministrators = administratorDependencies(candidate.programCode);
    const expectedUntracked = untrackedGovernmentPointers(candidate.programCode);

    if (candidate.schema !== CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_SCHEMA) {
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
      candidate.output.outcomeClass !== program.outcomeClass ||
      candidate.output.claimOutputCode !== program.claimOutputCode ||
      candidate.output.claimOutputLabel !== program.claimOutputLabel ||
      candidate.output.actionClass !== actionClassFor(program.outcomeClass) ||
      candidate.output.actionState !==
        "blocked_until_all_governance_gaps_resolved"
    ) {
      errors.push(`${prefix} has an invalid output classification or action state.`);
    }
    if (
      JSON.stringify(candidate.trackedSourceBindings) !==
        JSON.stringify(expectedTracked)
    ) {
      errors.push(`${prefix} does not match its tracked source identities.`);
    }
    if (
      JSON.stringify(candidate.administratorSourceDependencies) !==
        JSON.stringify(expectedAdministrators) ||
      JSON.stringify(candidate.untrackedGovernmentSourcePointers) !==
        JSON.stringify(expectedUntracked)
    ) {
      errors.push(`${prefix} does not match its unresolved source dependencies.`);
    }
    if (
      candidate.productKind.decisionState !== "unresolved" ||
      candidate.productKind.officialValues.length !== 0 ||
      candidate.product.applicabilityDecision !== "unresolved" ||
      candidate.product.officialRegistrySnapshotRequired !== null ||
      candidate.scenario.decisionState !== "unresolved" ||
      candidate.scenario.officialCodes.length !== 0
    ) {
      errors.push(`${prefix} must keep product and scenario decisions unresolved.`);
    }
    const expectedProductKinds = uniqueSorted(
      officialProductKindsForLocalActivity(
        candidate.programCode,
        candidate.registryActivityCode,
      ),
    );
    if (
      candidate.productKind.localProductKindSignals.join("|") !==
        expectedProductKinds.join("|")
    ) {
      errors.push(`${prefix} does not match local product-kind signals.`);
    }
    if (
      candidate.calculator.officialApplicabilityDecision !== "unresolved" ||
      candidate.calculator.localCatalogueState !== method.state ||
      candidate.calculator.localCataloguePathway !== method.pathway ||
      candidate.calculator.localCatalogueFormulaKeySignal !== method.formulaKey ||
      candidate.calculator.localCatalogueUnitSignal !== method.unit ||
      candidate.calculator.exactOfficialGoldenVectorState !== "missing" ||
      candidate.calculator.officialReconciliationState !== "missing" ||
      candidate.calculator.independentReviewState !== "missing" ||
      candidate.calculator.executionState !== "blocked"
    ) {
      errors.push(`${prefix} has an invalid fail-closed calculation state.`);
    }
    const expectedFormulaSignals = formulaSignals(candidate.programCode, definition);
    if (
      candidate.calculator.formulaSignals.length !== expectedFormulaSignals.length ||
      candidate.calculator.formulaSignals.map((signal) => signal.formulaKey).join("|") !==
        expectedFormulaSignals.map((signal) => signal.formulaKey).join("|")
    ) {
      errors.push(`${prefix} does not match the local method-signal contract.`);
    }
    const gapCodes = candidate.gaps.map((gap) => gap.code);
    if (
      candidate.gaps.some((gap) => gap.blocksActivation !== true) ||
      new Set(gapCodes).size !== gapCodes.length
    ) {
      errors.push(`${prefix} contains invalid or duplicate activation gaps.`);
    }
    if (
      Boolean(definition) ===
        gapCodes.includes("NONCERT_GOVERNED_METHOD_CONTRACT_MISSING")
    ) {
      errors.push(`${prefix} has an invalid governed-method gap decision.`);
    }
    if (
      (expectedTracked.length === 0) !==
        gapCodes.includes("NONCERT_NO_TRACKED_GOVERNMENT_SOURCE") ||
      (expectedAdministrators.length > 0) !==
        gapCodes.includes("NONCERT_ADMINISTRATOR_SOURCE_NOT_GOVERNED") ||
      (expectedUntracked.length > 0) !==
        gapCodes.includes("NONCERT_PROGRAM_POINTER_NOT_IN_CUSTODY")
    ) {
      errors.push(`${prefix} has an invalid source-gap decision.`);
    }
    if (!candidate.signers.every((signer) =>
      signer.visibleSignatureBoxWhenPublished === true &&
      signer.signingEnabled === false &&
      signer.decisionState === "unresolved"
    )) {
      errors.push(`${prefix} has an invalid unresolved signer contract.`);
    }
    if (!candidate.evidenceRequirements.every((evidence) =>
      evidence.captureEnabled === false &&
      evidence.preserveOriginalBytes === true &&
      evidence.preserveOriginalMetadataForMedia === true &&
      evidence.exactRequirementState ===
        "unresolved_pending_transcription_and_review" &&
      evidence.programCode === candidate.programCode &&
      evidence.activityCode === candidate.registryActivityCode
    )) {
      errors.push(`${prefix} has an invalid evidence custody boundary.`);
    }
    if (!candidate.prompts.every((prompt) =>
      prompt.collectionState === "candidate_not_approved" &&
      prompt.programCode === candidate.programCode &&
      prompt.activityCode === candidate.registryActivityCode &&
      prompt.label.includes(candidate.programCode) &&
      prompt.label.includes(candidate.registryActivityCode)
    )) {
      errors.push(`${prefix} has prompts that are not activity-specific and fail-closed.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    total: candidates.length,
    programCounts,
    retailerObligationCount,
    otherOutcomeCount,
    localMethodSignalCount,
    missingLocalMethodSignalCount: candidates.length - localMethodSignalCount,
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

export function canonicalCreditexNonCertificateWorkPackContent(
  candidates: readonly CreditexNonCertificateWorkPackContentCandidate[] =
    CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES,
) {
  return JSON.stringify(canonicalValue(candidates));
}

export const CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANONICAL_SHA256 =
  "c69396cbbd8fbda313d8a6c0be237849deebaa49dbaa9911a30bdd54204a2ba0" as const;

export const CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION =
  validateCreditexNonCertificateWorkPackContent();

if (!CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION.valid) {
  throw new Error(
    `Invalid Creditex non-certificate work-pack candidate content: ${CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION.errors.join(" ")}`,
  );
}

export const CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_COMPLETENESS = {
  expectedCurrentOrLimitedTemplates: 107,
  expectedRetailerObligationTemplates: 50,
  expectedOtherOutcomeTemplates: 57,
  machineReadableCandidateTemplates:
    CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION
      .candidateContentCompleteCount,
  localMethodSignalTemplates:
    CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION.localMethodSignalCount,
  missingLocalMethodSignalTemplates:
    CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION
      .missingLocalMethodSignalCount,
  independentlyApprovedActivationTemplates:
    CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_VALIDATION.activationReadyCount,
  publicationState: "candidate_not_approved" as const,
} as const;
