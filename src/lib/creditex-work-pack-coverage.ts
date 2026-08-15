import {
  CREDITEX_CALCULATION_COVERAGE,
} from "./creditex-calculation-coverage.ts";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_CATALOGUE_REVIEWED_ON,
  GOVERNMENT_PROGRAM_TEMPLATES,
  type ComplianceClaimOutputCode,
  type ComplianceOutcomeClass,
} from "./australian-government-program-catalogue.ts";
import {
  CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
} from "./creditex-activity-work-pack.ts";
import {
  creditexCanonicalSha256,
} from "./creditex-interchange-preflight.ts";

export const CREDITEX_WORK_PACK_COVERAGE_CONTRACT =
  "creditex-work-pack-coverage/v1";

export const CREDITEX_WORK_PACK_COVERAGE_CATALOGUE_STATES = [
  "current",
  "limited",
] as const;

export type CreditexWorkPackActivationEvidence = Readonly<{
  activityVersion: Readonly<{
    id: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }> | null;
  workPackVersion: Readonly<{
    id: string;
    schemaSha256: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    authoredByUid: string;
    reviewedByUid: string;
    reviewedAt: string;
  }> | null;
  manualPolicy: Readonly<{
    id: string;
    version: string;
    sha256: string;
    requestedByUid: string;
    approvedByUid: string;
    approvedAt: string;
  }> | null;
  evidencePolicy: Readonly<{
    id: string;
    version: string;
    sha256: string;
  }> | null;
  sourceBindings: readonly Readonly<{
    id: string;
    role: "requirement" | "product" | "scenario" | "calculator";
    targetKey: string;
    artifactId: string;
    artifactSha256: string;
    createdByUid: string;
    reviewedByUid: string;
    reviewedAt: string;
  }>[];
  productRegistrySnapshot: Readonly<{
    selectionId: string;
    snapshotId: string;
    resolutionSha256: string;
    registryCode: string;
    productId: string;
    productKind: string;
    sourceSha256: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    installationDate: string;
    selectedByUid: string;
    verifiedByUid: string;
    verifiedAt: string;
  }> | null;
  scenarioRules: Readonly<{
    resolutionId: string;
    resolutionSha256: string;
    scenarioBindingId: string;
    scenarioCode: string;
    sourceArtifactId: string;
    sourceSha256: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    authoredByUid: string;
    reviewedByUid: string;
    reviewedAt: string;
  }> | null;
  authoritativeCalculator: Readonly<{
    runId: string;
    dependencyKey: string;
    catalogueFormulaKey: string;
    engineCalculatorKey: string;
    engineCalculatorVersion: number;
    specificationId: string;
    specificationVersion: string;
    specificationSha256: string;
    inputSha256: string;
    outputSha256: string;
    engineContractSha256: string;
    receiptSha256: string;
    sourceBindingId: string;
    sourceArtifactId: string;
    sourceSha256: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    runByUid: string;
    verifiedByUid: string;
    verifiedAt: string;
    certificateQuantity: string;
    certificateUnit: string;
  }> | null;
  fieldCollection: Readonly<{
    instanceId: string;
    instanceKey: string;
    revision: number;
    definitionSha256: string;
    prefillSha256: string;
    responseSha256: string;
    completedByUid: string;
    completedAt: string;
  }> | null;
  completion: Readonly<{
    caseInstanceId: string;
    finalRecordId: string;
    instanceSha256: string;
    responseSha256: string;
    signatureManifestSha256: string;
    pdfSha256: string;
    integrityReceiptId: string;
    finalisedByUid: string;
    finalisedAt: string;
  }> | null;
  programActivationEvidence: Readonly<{
    contract: "creditex-sres-certificate-activation-evidence/v1";
    snapshotId: string;
    programCode: "SRES";
    activityTemplateId: string;
    caseId: string;
    activityDate: string;
    records: readonly Readonly<{
      recordId: string;
      evidenceKind: string;
      subjectKey: string;
      resultCode: string;
      sourceArtifactId: string;
      sourceArtifactSha256: string;
      sourceRecordKey: string;
      responseSha256: string;
      effectiveFrom: string;
      effectiveTo: string;
      observedAt: string;
      validUntil: string;
      reviewed: boolean;
      reviewId: string;
      reviewedByUid: string;
      reviewedAt: string;
    }>[];
  }> | null;
  externalSubmission: Readonly<{
    submissionId: string;
    submissionReference: string;
    submittedPayloadSha256: string;
    providerReceiptSha256: string;
    status: "accepted";
    submittedByUid: string;
    verifiedByUid: string;
    submittedAt: string;
    verifiedAt: string;
  }> | null;
}>;

export type CreditexOperationalOutputDefinition = Readonly<{
  outputCode: ComplianceClaimOutputCode;
  outputClass: Exclude<ComplianceOutcomeClass, "tradable_certificate">;
  sourceBindingId: string;
  sourceArtifactId: string;
  sourceSha256: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  authoredByUid: string;
  reviewedByUid: string;
  reviewedAt: string;
}>;

export type CreditexWorkPackGovernanceCoverageRow = Readonly<{
  activityTemplateId: string;
  programCode: string;
  activityCode: string;
  title: string;
  catalogueState: "current" | "limited";
  activityVersionId: string | null;
  ready: boolean;
  versionId: string | null;
  schemaSha256: string | null;
  blockers: readonly string[];
  currentActivityVersionReady: boolean;
  independentlyApprovedPackReady: boolean;
  approvedExactSourcesReady: boolean;
  productRegistrySnapshotReady: boolean;
  scenarioRulesReady: boolean;
  authoritativeCalculatorReady: boolean;
  fieldCollectionReady: boolean;
  completionReady: boolean;
  externalSubmissionReady: boolean;
  certificateActionEnabled: boolean;
  certificateBlockers: readonly string[];
  outputClass: ComplianceOutcomeClass;
  outputActionReady: boolean;
  outputActionBlockers: readonly string[];
  operationalOutputDefinition: CreditexOperationalOutputDefinition | null;
  activationEvidence: CreditexWorkPackActivationEvidence;
}>;

export const CREDITEX_WORK_PACK_GOVERNANCE_BLOCKERS = [
  "approved_effective_dated_work_pack_version_required",
  "approved_official_source_bindings_required",
  "independent_named_review_required",
] as const;

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const calculationByActivity = new Map(
  CREDITEX_CALCULATION_COVERAGE.map((row) => [
    row.activityTemplateId,
    row,
  ]),
);

const inScopeActivities = GOVERNMENT_ACTIVITY_TEMPLATES.filter((activity) =>
  CREDITEX_WORK_PACK_COVERAGE_CATALOGUE_STATES.includes(
    activity.catalogueState as
      typeof CREDITEX_WORK_PACK_COVERAGE_CATALOGUE_STATES[number],
  )
);

export const CREDITEX_WORK_PACK_COVERAGE = Object.freeze(
  inScopeActivities
    .map((activity) => {
      const program = GOVERNMENT_PROGRAM_TEMPLATES.find(
        (candidate) => candidate.programCode === activity.programCode,
      );
      const calculation = calculationByActivity.get(activity.templateId);
      if (!program || !calculation) {
        throw new Error(
          `Work-pack coverage is missing catalogue dependencies for ${activity.templateId}.`,
        );
      }
      return Object.freeze({
        activityTemplateId: activity.templateId,
        programCode: activity.programCode,
        programName: program.name,
        jurisdiction: program.jurisdiction,
        activityKey: activity.activityKey,
        registryActivityCode: activity.registryActivityCode,
        title: activity.title,
        serviceCategory: activity.serviceCategory,
        catalogueState: activity.catalogueState,
        catalogueReviewedOn: GOVERNMENT_CATALOGUE_REVIEWED_ON,
        workPackContract: CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
        genericEngineSupported: true as const,
        governedReadinessState: "governed_version_required" as const,
        governedVersionAvailable: false as const,
        approvedSourceBindingsAvailable: false as const,
        independentReviewAvailable: false as const,
        fieldCollectionEnabled: false as const,
        completionEnabled: false as const,
        externalSubmissionEnabled: false as const,
        productDependencyState:
          "activity_specific_governed_binding_required" as const,
        scenarioDependencyState:
          "activity_specific_governed_binding_required" as const,
        calculatorDependencyState:
          "activity_specific_governed_binding_required" as const,
        calculationState: calculation.calculationState,
        calculationPathway: calculation.calculationPathway,
        estimateExecutable: calculation.estimateExecutable,
        certificateActionEnabled: false as const,
        governanceBlockers: CREDITEX_WORK_PACK_GOVERNANCE_BLOCKERS,
      });
    })
    .sort((left, right) =>
      compareText(left.activityTemplateId, right.activityTemplateId)
    ),
);

if (
  CREDITEX_WORK_PACK_COVERAGE.length !== inScopeActivities.length
  || new Set(
    CREDITEX_WORK_PACK_COVERAGE.map((row) => row.activityTemplateId),
  ).size !== inScopeActivities.length
) {
  throw new Error(
    "Work-pack coverage requires exactly one row per current or limited activity.",
  );
}

const coverageCore = Object.freeze({
  contract: CREDITEX_WORK_PACK_COVERAGE_CONTRACT,
  catalogueReviewedOn: GOVERNMENT_CATALOGUE_REVIEWED_ON,
  programmeCount: new Set(
    CREDITEX_WORK_PACK_COVERAGE.map((row) => row.programCode),
  ).size,
  activityCount: CREDITEX_WORK_PACK_COVERAGE.length,
  genericEngineSupported: CREDITEX_WORK_PACK_COVERAGE.filter(
    (row) => row.genericEngineSupported,
  ).length,
  governedVersionAvailable: CREDITEX_WORK_PACK_COVERAGE.filter(
    (row) => row.governedVersionAvailable,
  ).length,
  fieldCollectionEnabled: CREDITEX_WORK_PACK_COVERAGE.filter(
    (row) => row.fieldCollectionEnabled,
  ).length,
  completionEnabled: CREDITEX_WORK_PACK_COVERAGE.filter(
    (row) => row.completionEnabled,
  ).length,
  externalSubmissionEnabled: CREDITEX_WORK_PACK_COVERAGE.filter(
    (row) => row.externalSubmissionEnabled,
  ).length,
  rows: CREDITEX_WORK_PACK_COVERAGE,
});

export const CREDITEX_WORK_PACK_COVERAGE_SUMMARY = Object.freeze({
  ...coverageCore,
  coverageSha256: creditexCanonicalSha256(coverageCore),
});
