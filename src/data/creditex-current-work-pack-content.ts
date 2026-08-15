import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
} from "../lib/australian-government-program-catalogue.ts";
import {
  CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES,
  type CreditexNonCertificateReferenceDocument,
  type CreditexNonCertificateWorkPackContentCandidate,
} from "./creditex-non-certificate-work-pack-content.ts";
import {
  CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES,
  type CreditexNswCertificateSourceBinding,
} from "./creditex-nsw-certificate-work-pack-content.ts";
import {
  CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT,
  type CreditexNswGovernedWorkPackContent,
} from "./creditex-nsw-governed-work-pack-content.ts";
import {
  CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES,
  type CreditexSresSourceBinding,
  type CreditexSresWorkPackContentCandidate,
} from "./creditex-sres-work-pack-content.ts";
import {
  type CreditexVeuSourceBinding,
} from "./creditex-veu-work-pack-content.ts";
import {
  CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT,
  type CreditexVeuCapturedGuideSource,
  type CreditexVeuPublishableWorkPackContent,
} from "./creditex-veu-publishable-work-pack-content.ts";
import type {
  CreditexOfficialProductKind,
} from "../lib/creditex-official-product-registry.ts";

export const CREDITEX_CURRENT_WORK_PACK_CONTENT_SCHEMA =
  "creditex-current-work-pack-content/v1" as const;

type CandidateSource =
  | CreditexVeuSourceBinding
  | CreditexVeuCapturedGuideSource
  | CreditexNswCertificateSourceBinding
  | CreditexNswGovernedWorkPackContent["sources"][number]
  | CreditexSresSourceBinding
  | CreditexNonCertificateReferenceDocument;

export type CreditexCurrentWorkPackSource = Readonly<{
  sourceKey: string;
  sourceId: string | null;
  title: string;
  version: string;
  officialUrl: string;
  expectedSha256: string | null;
  citation: string;
  custodyState:
    | "tracked_candidate_pending_independent_review"
    | "pointer_not_in_governed_custody";
}>;

export type CreditexCurrentWorkPackPromptNeed = Readonly<{
  key: string;
  label: string;
  category: string;
  inputSignal: string;
  unit: string;
  requiredCandidate: boolean;
  approvalState:
    | "guided_capture_publishable"
    | "source_backed_review_candidate"
    | "candidate_not_approved";
  guidance: readonly string[];
  source: CreditexCurrentWorkPackSource;
}>;

export type CreditexCurrentWorkPackEvidenceNeed = Readonly<{
  requirementId: string;
  label: string;
  kind: string;
  requiredCandidate: boolean;
  captureState:
    | "guided_capture_publishable"
    | "source_backed_review_candidate"
    | "candidate_defined"
    | "unresolved_pending_review";
  preserveOriginalBytes: boolean;
  preserveOriginalMetadata: boolean;
  guidance: readonly string[];
  source: CreditexCurrentWorkPackSource;
}>;

export type CreditexCurrentWorkPackProductNeed = Readonly<{
  key: string;
  label: string;
  requiredCandidate: boolean;
  decisionState:
    | "executable_source_bound"
    | "not_applicable_by_source"
    | "source_backed_review_candidate"
    | "candidate_not_approved"
    | "unresolved_pending_review";
  registryCodeSignal: string;
  officialProductKindSignal: string;
  executableRegistryCode: string;
  executableProductKind: CreditexOfficialProductKind | "not_applicable";
  attributes: readonly string[];
  source: CreditexCurrentWorkPackSource;
}>;

export type CreditexCurrentWorkPackScenarioNeed = Readonly<{
  requiredCandidate: boolean;
  decisionState:
    | "executable_source_bound"
    | "source_backed_review_candidate"
    | "candidate_not_approved"
    | "unresolved_pending_review";
  codesOrSignals: readonly string[];
  source: CreditexCurrentWorkPackSource;
}>;

export type CreditexCurrentWorkPackCalculatorNeed = Readonly<{
  key: string;
  label: string;
  outputUnit: string;
  inputKeys: readonly string[];
  scenarioSignals: readonly string[];
  decisionState:
    | "executable_source_bound"
    | "source_backed_review_candidate"
    | "candidate_not_approved"
    | "unresolved_pending_review";
  executableCalculatorKey: string;
  executableCalculatorVersion: number;
  source: CreditexCurrentWorkPackSource;
}>;

export type CreditexCurrentWorkPackSignatureNeed = Readonly<{
  signatureId: string;
  label: string;
  signerRole: string;
  requiredCandidate: boolean;
  decisionState:
    | "blocked_exact_provider_declaration_required"
    | "source_backed_review_candidate"
    | "candidate_not_approved"
    | "unresolved_pending_review";
  source: CreditexCurrentWorkPackSource;
}>;

export type CreditexCurrentWorkPackDocumentNeed = Readonly<{
  documentType: string;
  label: string;
  format: string;
  requiredCandidate: boolean;
  decisionState:
    | "blocked_exact_provider_template_required"
    | "source_backed_review_candidate"
    | "candidate_not_approved"
    | "unresolved_pending_review";
  source: CreditexCurrentWorkPackSource;
}>;

export type CreditexCurrentWorkPackContentCandidate = Readonly<{
  schema: typeof CREDITEX_CURRENT_WORK_PACK_CONTENT_SCHEMA;
  sourceCatalogue: "VEU" | "NSW_CERTIFICATE" | "SRES" | "NON_CERTIFICATE";
  programCode: string;
  templateId: string;
  activityCode: string;
  title: string;
  catalogueState: "current" | "limited";
  outcomeLabel: string;
  identityBindings: readonly Readonly<{ role: string; resolution: string }>[];
  sources: readonly CreditexCurrentWorkPackSource[];
  referenceDocuments: readonly CreditexCurrentWorkPackSource[];
  prompts: readonly CreditexCurrentWorkPackPromptNeed[];
  evidenceRequirements: readonly CreditexCurrentWorkPackEvidenceNeed[];
  productNeeds: readonly CreditexCurrentWorkPackProductNeed[];
  scenarioNeed: CreditexCurrentWorkPackScenarioNeed;
  calculatorNeeds: readonly CreditexCurrentWorkPackCalculatorNeed[];
  signatureNeeds: readonly CreditexCurrentWorkPackSignatureNeed[];
  finalDocumentNeeds: readonly CreditexCurrentWorkPackDocumentNeed[];
  blockers: readonly Readonly<{ code: string; detail: string }>[];
  guidedCaptureState:
    | "publishable_source_bound"
    | "source_backed_review_candidate"
    | "source_only_not_publishable"
    | "candidate_only";
  statutoryDocumentState:
    | "blocked_exact_provider_template_required"
    | "source_backed_review_candidate"
    | "candidate_only";
  providerSchemaState:
    | "blocked_exact_provider_schema_required"
    | "external_provider_schema_not_retained"
    | "candidate_only";
  draftCreationState:
    | "source_bound_guided_capture"
    | "source_backed_review_draft"
    | "not_available";
  candidateOnly: boolean;
  independentlyApproved: false;
  published: false;
  activationReady: false;
}>;

function normaliseSource(source: CandidateSource): CreditexCurrentWorkPackSource {
  const sourceId = source.sourceId;
  const pointerId = "pointerId" in source ? source.pointerId : "";
  const title = "sourceTitle" in source ? source.sourceTitle : source.title;
  const version = "sourceVersion" in source ? source.sourceVersion : "version" in source ? source.version : "";
  const sha256 = "expectedSha256" in source ? source.expectedSha256 : null;
  return {
    sourceKey: sourceId || pointerId,
    sourceId,
    title,
    version,
    officialUrl: source.officialUrl,
    expectedSha256: sha256,
    citation: source.citation,
    custodyState: sourceId && sha256
      ? "tracked_candidate_pending_independent_review"
      : "pointer_not_in_governed_custody",
  };
}

function uniqueSources(sources: readonly CandidateSource[]) {
  const byKey = new Map<string, CreditexCurrentWorkPackSource>();
  for (const source of sources) {
    const normalised = normaliseSource(source);
    if (!byKey.has(normalised.sourceKey)) byKey.set(normalised.sourceKey, normalised);
  }
  return [...byKey.values()];
}

function identityBindings(input: Record<string, string>) {
  return Object.entries(input).map(([role, resolution]) => ({ role, resolution }));
}

function calculatorEngineKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function veu(
  candidate: CreditexVeuPublishableWorkPackContent,
): CreditexCurrentWorkPackContentCandidate {
  const productKinds = [...new Set(
    candidate.productRequirements.scenarioResolution.flatMap(
      (resolution) => resolution.productKinds,
    ),
  )];
  const productNeeds: CreditexCurrentWorkPackProductNeed[] = productKinds.length
    ? productKinds.map((productKind) => {
        const resolution = candidate.productRequirements.scenarioResolution.find(
          (item) => item.productKinds.includes(productKind),
        );
        const registryCode = resolution?.registryCodes[0] || "";
        return {
          key: productKind,
          label: productKind.replaceAll("_", " "),
          requiredCandidate: true,
          decisionState: "executable_source_bound",
          registryCodeSignal: registryCode,
          officialProductKindSignal: productKind,
          executableRegistryCode: registryCode,
          executableProductKind: productKind,
          attributes: candidate.productRequirements.requiredAttributes,
          source: normaliseSource(candidate.productRequirements.source),
        };
      })
    : [{
        key: "not_applicable",
        label: "No governed product registry dependency",
        requiredCandidate: false,
        decisionState: "not_applicable_by_source",
        registryCodeSignal: "not_applicable",
        officialProductKindSignal: "not_applicable",
        executableRegistryCode: "not_applicable",
        executableProductKind: "not_applicable",
        attributes: [],
        source: normaliseSource(candidate.productRequirements.source),
      }];
  return {
    schema: CREDITEX_CURRENT_WORK_PACK_CONTENT_SCHEMA,
    sourceCatalogue: "VEU",
    programCode: candidate.programCode,
    templateId: candidate.templateId,
    activityCode: candidate.activityCode,
    title: candidate.title,
    catalogueState: candidate.catalogueState,
    outcomeLabel: "VEEC certificate work pack",
    identityBindings: identityBindings(candidate.identityBindings),
    sources: uniqueSources([
      ...candidate.sourceBindings,
      ...(candidate.activityGuide ? [candidate.activityGuide] : []),
    ]),
    referenceDocuments: uniqueSources([
      ...candidate.referenceDocuments,
      ...(candidate.activityGuide ? [candidate.activityGuide] : []),
    ]),
    prompts: candidate.prompts.map((prompt) => ({
      key: prompt.key,
      label: prompt.label,
      category: prompt.kind,
      inputSignal: prompt.kind === "calculation" || prompt.unit ? "number" : "text",
      unit: prompt.unit || "",
      requiredCandidate: prompt.required,
      approvalState: "guided_capture_publishable",
      guidance: [`Applies ${prompt.when}.`, `Value source: ${prompt.valueSource}.`],
      source: normaliseSource(prompt.source),
    })),
    evidenceRequirements: candidate.evidenceRequirements.map((evidence) => ({
      requirementId: evidence.requirementId,
      label: evidence.label,
      kind: evidence.kind,
      requiredCandidate: true,
      captureState: "guided_capture_publishable",
      preserveOriginalBytes: true,
      preserveOriginalMetadata: evidence.preserveOriginalMetadata,
      guidance: [...evidence.details, `Applies ${evidence.when}.`],
      source: normaliseSource(evidence.source),
    })),
    productNeeds,
    scenarioNeed: {
      requiredCandidate: true,
      decisionState: "executable_source_bound",
      codesOrSignals: candidate.scenarios.codes,
      source: normaliseSource(candidate.scenarios.source),
    },
    calculatorNeeds: candidate.calculator.formulas.map((formula) => ({
      key: formula.formulaKey,
      label: formula.formulaKey,
      outputUnit: candidate.calculator.outputUnit,
      inputKeys: formula.inputKeys,
      scenarioSignals: formula.scenarioCodes,
      decisionState: "executable_source_bound",
      executableCalculatorKey: calculatorEngineKey(candidate.calculator.engineId),
      executableCalculatorVersion: 1,
      source: normaliseSource(formula.source),
    })),
    signatureNeeds: candidate.signatures.map((signature) => ({
      signatureId: signature.signatureId,
      label: signature.documentType.replaceAll("_", " "),
      signerRole: signature.signerRole,
      requiredCandidate: false,
      decisionState: "blocked_exact_provider_declaration_required",
      source: normaliseSource(signature.source),
    })),
    finalDocumentNeeds: candidate.finalDocumentNeeds.map((document) => ({
      documentType: document.documentType,
      label: document.label,
      format: document.format,
      requiredCandidate: false,
      decisionState: "blocked_exact_provider_template_required",
      source: normaliseSource(document.source),
    })),
    blockers: candidate.publicationRequirements.map((requirement) => ({
      code: requirement.requirementCode,
      detail: requirement.detail,
    })),
    guidedCaptureState: "publishable_source_bound",
    statutoryDocumentState: "blocked_exact_provider_template_required",
    providerSchemaState: "blocked_exact_provider_schema_required",
    draftCreationState: "source_bound_guided_capture",
    candidateOnly: false,
    independentlyApproved: false,
    published: false,
    activationReady: false,
  };
}

function nsw(
  candidate: CreditexNswGovernedWorkPackContent,
): CreditexCurrentWorkPackContentCandidate {
  const legacy = CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.find(
    (item) => item.templateId === candidate.templateId,
  );
  if (!legacy) {
    throw new Error(`Missing NSW catalogue identity ${candidate.templateId}.`);
  }
  const sourceBacked = candidate.completeRetainedOfficialFieldForms;
  const contentDecision = sourceBacked
    ? "source_backed_review_candidate" as const
    : "unresolved_pending_review" as const;
  return {
    schema: CREDITEX_CURRENT_WORK_PACK_CONTENT_SCHEMA,
    sourceCatalogue: "NSW_CERTIFICATE",
    programCode: candidate.programCode,
    templateId: candidate.templateId,
    activityCode: candidate.activityCode,
    title: candidate.title,
    catalogueState: candidate.catalogueState,
    outcomeLabel: legacy.output.claimOutputLabel,
    identityBindings: identityBindings(legacy.identityBindings),
    sources: uniqueSources(candidate.sources),
    referenceDocuments: uniqueSources(candidate.sources),
    prompts: candidate.formSections.flatMap((section) =>
      section.fields.map((prompt) => ({
        key: `${section.sectionKey}:${prompt.key}`,
        label: prompt.label,
        category: section.sectionKey,
        inputSignal: prompt.inputType,
        unit: "unit" in prompt ? prompt.unit : "",
        requiredCandidate: sourceBacked && prompt.required,
        approvalState: sourceBacked
          ? "source_backed_review_candidate" as const
          : "candidate_not_approved" as const,
        guidance: [`Prefill source: ${prompt.prefillFrom}.`, prompt.source.citation],
        source: normaliseSource(prompt.source),
      }))
    ),
    evidenceRequirements: candidate.evidenceRequirements.map((evidence) => ({
      requirementId: evidence.key,
      label: evidence.label,
      kind: evidence.captureKind,
      requiredCandidate: sourceBacked && evidence.required,
      captureState: sourceBacked
        ? "source_backed_review_candidate"
        : "unresolved_pending_review",
      preserveOriginalBytes: evidence.preserveOriginalBytes,
      preserveOriginalMetadata: evidence.preserveOriginalMetadata,
      guidance: [evidence.source.citation],
      source: normaliseSource(evidence.source),
    })),
    productNeeds: [{
      key: "product_applicability",
      label: "Product applicability and registry snapshot",
      requiredCandidate: false,
      decisionState: contentDecision,
      registryCodeSignal: candidate.productContract.registryRequirements.join(", "),
      officialProductKindSignal: candidate.productContract.productKinds.join(", "),
      executableRegistryCode: "not_applicable",
      executableProductKind: "not_applicable",
      attributes: candidate.productContract.registryRequirements,
      source: normaliseSource(candidate.productContract.source),
    }],
    scenarioNeed: {
      requiredCandidate: false,
      decisionState: contentDecision,
      codesOrSignals: candidate.scenarioContract.values,
      source: normaliseSource(candidate.scenarioContract.source),
    },
    calculatorNeeds: candidate.calculatorContracts.map((formula) => ({
      key: formula.formulaKey,
      label: formula.formulaKey,
      outputUnit: formula.outputUnit,
      inputKeys: formula.inputKeys,
      scenarioSignals: candidate.scenarioContract.values,
      decisionState: contentDecision,
      executableCalculatorKey: "not_applicable",
      executableCalculatorVersion: 1,
      source: normaliseSource(formula.source),
    })),
    signatureNeeds: candidate.signatures.map((signature) => ({
      signatureId: signature.signatureId,
      label: signature.placement,
      signerRole: signature.role,
      requiredCandidate: false,
      decisionState: contentDecision,
      source: normaliseSource(signature.source),
    })),
    finalDocumentNeeds: candidate.documentOutputs.map((document) => ({
      documentType: document.documentKey,
      label: document.label,
      format: "pdf",
      requiredCandidate: false,
      decisionState: contentDecision,
      source: normaliseSource(document.source),
    })),
    blockers: candidate.blockers.map(({ code, detail }) => ({ code, detail })),
    guidedCaptureState: sourceBacked
      ? "source_backed_review_candidate"
      : "source_only_not_publishable",
    statutoryDocumentState: sourceBacked
      ? "source_backed_review_candidate"
      : "candidate_only",
    providerSchemaState: "external_provider_schema_not_retained",
    draftCreationState: sourceBacked
      ? "source_backed_review_draft"
      : "not_available",
    candidateOnly: true,
    independentlyApproved: false,
    published: false,
    activationReady: false,
  };
}

function sres(candidate: CreditexSresWorkPackContentCandidate): CreditexCurrentWorkPackContentCandidate {
  return {
    schema: CREDITEX_CURRENT_WORK_PACK_CONTENT_SCHEMA,
    sourceCatalogue: "SRES",
    programCode: candidate.programCode,
    templateId: candidate.templateId,
    activityCode: candidate.activityCode,
    title: candidate.title,
    catalogueState: candidate.catalogueState,
    outcomeLabel: "STC certificate work pack",
    identityBindings: identityBindings(candidate.identityBindings),
    sources: uniqueSources(candidate.sourceBindings),
    referenceDocuments: uniqueSources(candidate.referenceDocuments),
    prompts: candidate.prompts.map((prompt) => ({
      key: prompt.key,
      label: prompt.label,
      category: prompt.kind,
      inputSignal: prompt.fields.length > 1 ? "record" : prompt.kind === "calculation" ? "number" : "text",
      unit: "",
      requiredCandidate: prompt.required,
      approvalState: "candidate_not_approved",
      guidance: [...prompt.fields, `Applies ${prompt.when}.`, `Value source: ${prompt.valueSource}.`],
      source: normaliseSource(prompt.source),
    })),
    evidenceRequirements: candidate.evidenceRequirements.map((evidence) => ({
      requirementId: evidence.requirementId,
      label: evidence.label,
      kind: evidence.kind,
      requiredCandidate: evidence.required,
      captureState: "candidate_defined",
      preserveOriginalBytes: true,
      preserveOriginalMetadata: evidence.preserveOriginalMetadata,
      guidance: [...evidence.details, `Applies ${evidence.when}.`],
      source: normaliseSource(evidence.source),
    })),
    productNeeds: candidate.productDependencies.map((product) => ({
      key: product.productKind,
      label: product.productKind.replaceAll("_", " "),
      requiredCandidate: true,
      decisionState: "candidate_not_approved",
      registryCodeSignal: product.productKind,
      officialProductKindSignal: product.productKind,
      executableRegistryCode: "not_applicable",
      executableProductKind: "not_applicable",
      attributes: product.requiredSnapshotFields,
      source: normaliseSource(product.source),
    })),
    scenarioNeed: {
      requiredCandidate: true,
      decisionState: "candidate_not_approved",
      codesOrSignals: candidate.scenarioRules.sourceOptions,
      source: normaliseSource(candidate.scenarioRules.source),
    },
    calculatorNeeds: [{
      key: candidate.calculator.formulaKey,
      label: candidate.calculator.formulaSummary,
      outputUnit: candidate.calculator.outputUnit,
      inputKeys: candidate.calculator.inputKeys,
      scenarioSignals: candidate.scenarioRules.sourceOptions,
      decisionState: "candidate_not_approved",
      executableCalculatorKey: "not_applicable",
      executableCalculatorVersion: 1,
      source: normaliseSource(candidate.calculator.source),
    }],
    signatureNeeds: candidate.signatures.map((signature) => ({
      signatureId: signature.signatureId,
      label: signature.documentType.replaceAll("_", " "),
      signerRole: signature.signerRole,
      requiredCandidate: signature.required,
      decisionState: "candidate_not_approved",
      source: normaliseSource(signature.source),
    })),
    finalDocumentNeeds: candidate.finalDocumentNeeds.map((document) => ({
      documentType: document.documentType,
      label: document.label,
      format: document.format,
      requiredCandidate: document.required,
      decisionState: "candidate_not_approved",
      source: normaliseSource(document.source),
    })),
    blockers: candidate.gaps.map(({ code, detail }) => ({ code, detail })),
    guidedCaptureState: "candidate_only",
    statutoryDocumentState: "candidate_only",
    providerSchemaState: "candidate_only",
    draftCreationState: "not_available",
    candidateOnly: true,
    independentlyApproved: false,
    published: false,
    activationReady: false,
  };
}

function nonCertificate(candidate: CreditexNonCertificateWorkPackContentCandidate): CreditexCurrentWorkPackContentCandidate {
  return {
    schema: CREDITEX_CURRENT_WORK_PACK_CONTENT_SCHEMA,
    sourceCatalogue: "NON_CERTIFICATE",
    programCode: candidate.programCode,
    templateId: candidate.templateId,
    activityCode: candidate.registryActivityCode,
    title: candidate.title,
    catalogueState: candidate.catalogueState,
    outcomeLabel: candidate.output.claimOutputLabel,
    identityBindings: identityBindings(candidate.identityBindings),
    sources: uniqueSources(candidate.referenceDocuments),
    referenceDocuments: uniqueSources(candidate.referenceDocuments),
    prompts: candidate.prompts.map((prompt) => ({
      key: prompt.key,
      label: prompt.label,
      category: prompt.kind,
      inputSignal: prompt.fieldType,
      unit: prompt.unit,
      requiredCandidate: prompt.requiredWhenPublished,
      approvalState: "candidate_not_approved",
      guidance: [`Signal origin: ${prompt.signalOrigin}.`, `Value source signal: ${prompt.valueSource}.`],
      source: normaliseSource(prompt.source),
    })),
    evidenceRequirements: candidate.evidenceRequirements.map((evidence) => ({
      requirementId: evidence.requirementId,
      label: evidence.label,
      kind: evidence.kind,
      requiredCandidate: false,
      captureState: "unresolved_pending_review",
      preserveOriginalBytes: evidence.preserveOriginalBytes,
      preserveOriginalMetadata: evidence.preserveOriginalMetadataForMedia,
      guidance: [evidence.exactRequirementState],
      source: normaliseSource(evidence.source),
    })),
    productNeeds: [{
      key: "product_applicability",
      label: "Product or service applicability",
      requiredCandidate: false,
      decisionState: "unresolved_pending_review",
      registryCodeSignal: candidate.product.localRegistryRequirementSignals.join(", "),
      officialProductKindSignal: candidate.productKind.localProductKindSignals.join(", "),
      executableRegistryCode: "not_applicable",
      executableProductKind: "not_applicable",
      attributes: [...candidate.product.localRegistryRequirementSignals],
      source: normaliseSource(candidate.product.source),
    }],
    scenarioNeed: {
      requiredCandidate: false,
      decisionState: "unresolved_pending_review",
      codesOrSignals: candidate.scenario.localCatalogueSignals,
      source: normaliseSource(candidate.scenario.source),
    },
    calculatorNeeds: candidate.calculator.formulaSignals.map((formula) => ({
      key: formula.formulaKey,
      label: `${formula.formulaKey} local signal`,
      outputUnit: candidate.calculator.localCatalogueUnitSignal,
      inputKeys: formula.inputs.map((input) => input.key),
      scenarioSignals: [formula.scenario],
      decisionState: "unresolved_pending_review",
      executableCalculatorKey: "not_applicable",
      executableCalculatorVersion: 1,
      source: normaliseSource(candidate.scenario.source),
    })),
    signatureNeeds: candidate.signers.map((signer, index) => ({
      signatureId: `unresolved_signer_${index + 1}`,
      label: "Signer role unresolved pending independent review",
      signerRole: signer.signerRole,
      requiredCandidate: false,
      decisionState: "unresolved_pending_review",
      source: normaliseSource(signer.source),
    })),
    finalDocumentNeeds: candidate.finalDocumentNeeds.map((document) => ({
      documentType: document.documentType,
      label: document.label,
      format: document.format,
      requiredCandidate: false,
      decisionState: "unresolved_pending_review",
      source: normaliseSource(document.source),
    })),
    blockers: candidate.gaps.map(({ code, detail }) => ({ code, detail })),
    guidedCaptureState: "candidate_only",
    statutoryDocumentState: "candidate_only",
    providerSchemaState: "candidate_only",
    draftCreationState: "not_available",
    candidateOnly: true,
    independentlyApproved: false,
    published: false,
    activationReady: false,
  };
}

const CURRENT_OR_LIMITED_TEMPLATES = GOVERNMENT_ACTIVITY_TEMPLATES.filter(
  (template) => template.catalogueState === "current" || template.catalogueState === "limited",
);
const NORMALISED = [
  ...CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT.map(veu),
  ...CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT.map(nsw),
  ...CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.map(sres),
  ...CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.map(nonCertificate),
];
const NORMALISED_BY_TEMPLATE = new Map(NORMALISED.map((candidate) => [candidate.templateId, candidate]));

export const CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES =
  CURRENT_OR_LIMITED_TEMPLATES.map((template) => {
    const candidate = NORMALISED_BY_TEMPLATE.get(template.templateId);
    if (!candidate) throw new Error(`Missing current work-pack content candidate ${template.templateId}.`);
    return candidate;
  });

export const CREDITEX_CURRENT_WORK_PACK_CONTENT_BY_TEMPLATE_ID = new Map(
  CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.map((candidate) => [candidate.templateId, candidate]),
);

export function validateCreditexCurrentWorkPackContent(
  candidates: readonly CreditexCurrentWorkPackContentCandidate[] = CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES,
) {
  const errors: string[] = [];
  const expectedIds = CURRENT_OR_LIMITED_TEMPLATES.map((template) => template.templateId);
  const actualIds = candidates.map((candidate) => candidate.templateId);
  if (candidates.length !== 192) errors.push(`Expected 192 candidates, received ${candidates.length}.`);
  if (new Set(actualIds).size !== actualIds.length) errors.push("Candidate template IDs must be unique.");
  if (expectedIds.some((id, index) => actualIds[index] !== id)) errors.push("Candidates must exactly match the ordered current and limited catalogue.");
  for (const candidate of candidates) {
    if (!candidate.blockers.length || candidate.blockers.some((gap) => !gap.code || !gap.detail)) errors.push(`${candidate.templateId} must retain every explicit activation blocker.`);
    if (candidate.independentlyApproved || candidate.published || candidate.activationReady) errors.push(`${candidate.templateId} must remain operationally unapproved.`);
    if (!candidate.prompts.length || !candidate.evidenceRequirements.length || !candidate.finalDocumentNeeds.length) errors.push(`${candidate.templateId} is missing form content.`);
    const executable = candidate.guidedCaptureState === "publishable_source_bound";
    const sourceBackedReview =
      candidate.guidedCaptureState === "source_backed_review_candidate";
    const expectedDraftCreationState = executable
      ? "source_bound_guided_capture"
      : sourceBackedReview
        ? "source_backed_review_draft"
        : "not_available";
    if (candidate.draftCreationState !== expectedDraftCreationState) errors.push(`${candidate.templateId} has an invalid guided-draft state.`);
    if (executable !== !candidate.candidateOnly) errors.push(`${candidate.templateId} has an invalid candidate-only state.`);
    for (const product of candidate.productNeeds) {
      const enabled = product.decisionState === "executable_source_bound";
      if (enabled && (!product.requiredCandidate || product.executableProductKind === "not_applicable" || product.executableRegistryCode === "not_applicable")) {
        errors.push(`${candidate.templateId} has an invalid executable product dependency.`);
      }
    }
    if (candidate.scenarioNeed.decisionState === "executable_source_bound" && !candidate.scenarioNeed.requiredCandidate) {
      errors.push(`${candidate.templateId} has an invalid executable scenario dependency.`);
    }
    for (const calculator of candidate.calculatorNeeds) {
      const enabled = calculator.decisionState === "executable_source_bound";
      if (enabled !== (calculator.executableCalculatorKey !== "not_applicable")) {
        errors.push(`${candidate.templateId} has an invalid executable calculator dependency.`);
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    total: candidates.length,
    sourceCatalogueCounts: {
      VEU: candidates.filter((candidate) => candidate.sourceCatalogue === "VEU").length,
      NSW_CERTIFICATE: candidates.filter((candidate) => candidate.sourceCatalogue === "NSW_CERTIFICATE").length,
      SRES: candidates.filter((candidate) => candidate.sourceCatalogue === "SRES").length,
      NON_CERTIFICATE: candidates.filter((candidate) => candidate.sourceCatalogue === "NON_CERTIFICATE").length,
    },
    contentStateCounts: {
      guidedCapturePublishable: candidates.filter((candidate) => candidate.guidedCaptureState === "publishable_source_bound").length,
      sourceBackedReviewCandidate: candidates.filter((candidate) => candidate.guidedCaptureState === "source_backed_review_candidate").length,
      sourceOnlyNotPublishable: candidates.filter((candidate) => candidate.guidedCaptureState === "source_only_not_publishable").length,
      candidateOnly: candidates.filter((candidate) => candidate.guidedCaptureState === "candidate_only").length,
      activationReady: candidates.filter((candidate) => candidate.activationReady).length,
    },
  };
}

export const CREDITEX_CURRENT_WORK_PACK_CONTENT_VALIDATION =
  validateCreditexCurrentWorkPackContent();

if (!CREDITEX_CURRENT_WORK_PACK_CONTENT_VALIDATION.valid) {
  throw new Error(CREDITEX_CURRENT_WORK_PACK_CONTENT_VALIDATION.errors.join(" "));
}
