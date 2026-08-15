import type {
  CreditexCurrentWorkPackContentCandidate,
  CreditexCurrentWorkPackEvidenceNeed,
  CreditexCurrentWorkPackPromptNeed,
  CreditexCurrentWorkPackSource,
} from "../data/creditex-current-work-pack-content.ts";
import {
  CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION,
  type CreditexActivityWorkPack,
  type CreditexWorkPackDependency,
  type CreditexWorkPackPrompt,
  validateCreditexActivityWorkPack,
} from "./creditex-activity-work-pack.ts";

export type CreditexSourcedWorkPackDraftInput = Readonly<{
  candidate: CreditexCurrentWorkPackContentCandidate;
  version: number;
  effectiveFrom: string;
  effectiveTo: string;
  catalogueReviewedOn: string;
}>;

export type CreditexSourcedWorkPackSourceBinding = Readonly<{
  sourceId: string;
  expectedSha256: string;
  sourceRole: "requirement" | "product" | "scenario" | "calculator";
  targetKey: string;
  officialUrl: string;
  sourceTitle: string;
  sourceVersion: string;
  citationLocation: string;
}>;

function slug(value: string, fallback: string) {
  const normalised = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return normalised || fallback;
}

function clipped(value: string, maximum: number) {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 3)}...`;
}

function instruction(parts: readonly string[]) {
  return clipped(parts.filter(Boolean).join(" "), 2_000);
}

function basePrompt(input: {
  promptKey: string;
  order: number;
  type: CreditexWorkPackPrompt["type"];
  label: string;
  instructions: string;
  required: boolean;
  stageKey: string;
  requirementKeys: readonly string[];
}): CreditexWorkPackPrompt {
  return {
    promptKey: input.promptKey,
    order: input.order,
    type: input.type,
    label: clipped(input.label, 240),
    instructions: input.instructions,
    required: input.required,
    visibility: null,
    dependencyKeys: [],
    requirementKeys: input.requirementKeys,
    stageKey: input.stageKey,
    options: [],
    signerRoleKey: "",
    attestation: null,
    minimumLength:
      input.type === "text" || input.type === "textarea" ? 0 : null,
    maximumLength:
      input.type === "text" || input.type === "textarea" ? 10_000 : null,
    minimumNumber: null,
    maximumNumber: null,
    numberStep: input.type === "number" ? 0.01 : null,
    unit: "",
    minimumSelections: null,
    maximumSelections: null,
    fileRequirement: null,
    referenceDocument: null,
  };
}

function guidedPrompt(
  prompt: CreditexCurrentWorkPackPromptNeed,
  order: number,
): CreditexWorkPackPrompt {
  const type = prompt.inputSignal === "number" ? "number" : "text";
  return {
    ...basePrompt({
      promptKey: `guided_${slug(prompt.key, `question_${order}`)}`,
      order,
      type,
      label: prompt.label,
      instructions: instruction([
        "Current official-program guided capture requirement.",
        ...prompt.guidance,
        `Source: ${prompt.source.citation}`,
      ]),
      required: (
        prompt.approvalState === "guided_capture_publishable"
        || prompt.approvalState === "source_backed_review_candidate"
      ) && prompt.requiredCandidate,
      stageKey: "activity_details",
      requirementKeys: [prompt.key],
    }),
    unit: type === "number" ? clipped(prompt.unit, 40) : "",
  };
}

function guidedEvidencePrompt(
  evidence: CreditexCurrentWorkPackEvidenceNeed,
  order: number,
): CreditexWorkPackPrompt {
  const photo = evidence.kind.includes("photo");
  const video = evidence.kind.includes("video");
  const required = (
    evidence.captureState === "guided_capture_publishable"
    || evidence.captureState === "source_backed_review_candidate"
  ) && evidence.requiredCandidate;
  return {
    ...basePrompt({
      promptKey: `evidence_${slug(evidence.requirementId, `item_${order}`)}`,
      order,
      type: photo ? "photo" : "document",
      label: evidence.label,
      instructions: instruction([
        "Retain the original evidence and its available capture metadata.",
        ...evidence.guidance,
        `Source: ${evidence.source.citation}`,
      ]),
      required,
      stageKey: "field_evidence",
      requirementKeys: [evidence.requirementId],
    }),
    fileRequirement: {
      minimumCount: required ? 1 : 0,
      maximumCount: 20,
      allowedContentTypes: video
        ? ["video/mp4", "video/quicktime"]
        : photo
        ? ["image/jpeg", "image/png", "image/heic"]
        : ["application/pdf", "image/jpeg", "image/png"],
      originalRequired: evidence.preserveOriginalBytes,
      metadataRequired: evidence.preserveOriginalMetadata,
      gpsRequired: evidence.kind === "geotagged_photograph",
      captureTimeRequired: evidence.preserveOriginalMetadata,
    },
  };
}

function guidedSourcePrompt(
  source: CreditexCurrentWorkPackSource,
  order: number,
): CreditexWorkPackPrompt {
  const targetKey = `source_${slug(source.sourceKey, `document_${order}`)}`;
  return {
    ...basePrompt({
      promptKey: `reference_${slug(source.sourceKey, `document_${order}`)}`,
      order,
      type: "reference_document",
      label: `${source.title}${source.version ? `, ${source.version}` : ""}`,
      instructions: instruction([
        "Exact official source for this guided capture definition.",
        "Independent artifact and citation review is still required before field publication.",
        source.citation,
      ]),
      required: false,
      stageKey: "governing_sources",
      requirementKeys: [],
    }),
    referenceDocument: {
      sourceBindingTargetKey: targetKey,
      acknowledgementMode: "none",
      acknowledgementText: "",
      acknowledgementVersion: "",
    },
  };
}

function sourcedDraftDependencies(
  candidate: CreditexCurrentWorkPackContentCandidate,
): CreditexWorkPackDependency[] {
  const productDependencies = candidate.productNeeds.map((product, index) => {
    if (product.decisionState !== "executable_source_bound") {
      return {
        dependencyKey: `product_${index + 1}`,
        kind: "product" as const,
        label: product.label,
        required: false,
        registryCode: "not_applicable",
        productKind: "not_applicable" as const,
        productCategory: "Not applicable",
        selectionMode: "single" as const,
        minimumCount: 0,
        maximumCount: 1,
      };
    }
    return {
      dependencyKey: `product_${index + 1}`,
      kind: "product" as const,
      label: clipped(product.label, 240),
      required: true,
      registryCode: product.executableRegistryCode,
      productKind: product.executableProductKind,
      productCategory: clipped(product.attributes.join(", ") || product.label, 240),
      selectionMode: "multiple" as const,
      minimumCount: 1,
      maximumCount: 100,
    };
  });
  const scenarioDependencies: CreditexWorkPackDependency[] =
    candidate.scenarioNeed.codesOrSignals.length
      ? [{
          dependencyKey: "scenario",
          kind: "scenario",
          label: "Governed activity scenario",
          required:
            candidate.scenarioNeed.decisionState === "executable_source_bound"
            && candidate.scenarioNeed.requiredCandidate,
          scenarioCodes: [...candidate.scenarioNeed.codesOrSignals],
          selectionMode: "single",
        }]
      : [];
  const calculatorDependencies = candidate.calculatorNeeds.map(
    (calculator, index): CreditexWorkPackDependency => ({
      dependencyKey: `calculator_${index + 1}`,
      kind: "calculator",
      label: clipped(calculator.label, 240),
      required: calculator.decisionState === "executable_source_bound",
      catalogueFormulaKey: calculator.key,
      calculatorKey: calculator.executableCalculatorKey,
      calculatorVersion: calculator.executableCalculatorVersion,
      requiredInputKeys: [...new Set(calculator.inputKeys.map((key) =>
        slug(key, "input")
      ))],
    }),
  );
  return [
    ...productDependencies,
    ...scenarioDependencies,
    ...calculatorDependencies,
  ];
}

function exactSourceBinding(
  source: CreditexCurrentWorkPackSource,
  sourceRole: CreditexSourcedWorkPackSourceBinding["sourceRole"],
  targetKey: string,
): CreditexSourcedWorkPackSourceBinding {
  if (
    !source.sourceId
    || !/^source-[0-9a-f]{20}$/.test(source.sourceId)
    || !source.expectedSha256
    || !/^[0-9a-f]{64}$/.test(source.expectedSha256)
  ) {
    throw new Error(
      `${source.sourceKey} has no exact retained-source identity for a governed draft.`,
    );
  }
  return Object.freeze({
    sourceId: source.sourceId,
    expectedSha256: source.expectedSha256,
    sourceRole,
    targetKey,
    officialUrl: source.officialUrl,
    sourceTitle: source.title,
    sourceVersion: source.version,
    citationLocation: source.citation,
  });
}

export function creditexSourcedWorkPackSourceBindings(
  candidate: CreditexCurrentWorkPackContentCandidate,
  workPackInput: unknown,
): readonly CreditexSourcedWorkPackSourceBinding[] {
  const workPack = validateCreditexActivityWorkPack(workPackInput);
  if (
    candidate.templateId !== workPack.activityTemplateId
    || candidate.draftCreationState === "not_available"
  ) {
    throw new Error("The sourced draft does not match a publishable current activity candidate.");
  }
  const bindings: CreditexSourcedWorkPackSourceBinding[] = [];
  const add = (
    source: CreditexCurrentWorkPackSource,
    sourceRole: CreditexSourcedWorkPackSourceBinding["sourceRole"],
    targetKey: string,
  ) => bindings.push(exactSourceBinding(source, sourceRole, targetKey));

  for (const source of candidate.sources) add(source, "requirement", "work_pack");
  for (const prompt of candidate.prompts) {
    const target = workPack.sections.flatMap((section) => section.prompts)
      .find((item) => item.requirementKeys.includes(prompt.key));
    if (!target) throw new Error(`${prompt.key} has no exact work-pack question mapping.`);
    add(prompt.source, "requirement", target.promptKey);
  }
  for (const evidence of candidate.evidenceRequirements) {
    const target = workPack.sections.flatMap((section) => section.prompts)
      .find((item) => item.requirementKeys.includes(evidence.requirementId));
    if (!target) {
      throw new Error(`${evidence.requirementId} has no exact work-pack evidence mapping.`);
    }
    add(evidence.source, "requirement", target.promptKey);
  }
  for (const source of candidate.referenceDocuments) {
    const target = workPack.sections.flatMap((section) => section.prompts)
      .find((item) => item.referenceDocument?.sourceBindingTargetKey
        === `source_${slug(source.sourceKey, "document")}`);
    if (!target?.referenceDocument) {
      throw new Error(`${source.sourceKey} has no exact reference-document mapping.`);
    }
    add(
      source,
      "requirement",
      target.referenceDocument.sourceBindingTargetKey,
    );
  }
  const products = workPack.dependencies.filter((dependency) =>
    dependency.kind === "product"
  );
  candidate.productNeeds.forEach((product, index) => {
    const target = products[index];
    if (!target) throw new Error(`${product.key} has no exact product dependency mapping.`);
    add(product.source, "product", target.dependencyKey);
  });
  const scenario = workPack.dependencies.find((dependency) =>
    dependency.kind === "scenario"
  );
  if (candidate.scenarioNeed.codesOrSignals.length) {
    if (!scenario) throw new Error("The sourced draft has no exact scenario dependency mapping.");
    add(candidate.scenarioNeed.source, "scenario", scenario.dependencyKey);
  } else if (scenario) {
    throw new Error("The sourced draft has an unexpected scenario dependency mapping.");
  }
  const calculators = workPack.dependencies.filter((dependency) =>
    dependency.kind === "calculator"
  );
  candidate.calculatorNeeds.forEach((calculator, index) => {
    const target = calculators[index];
    if (!target) {
      throw new Error(`${calculator.key} has no exact calculator dependency mapping.`);
    }
    add(calculator.source, "calculator", target.dependencyKey);
  });

  const unique = new Map<string, CreditexSourcedWorkPackSourceBinding>();
  for (const binding of bindings) {
    const key = [
      binding.sourceId,
      binding.sourceRole,
      binding.targetKey,
      binding.citationLocation,
    ].join("|");
    if (!unique.has(key)) unique.set(key, binding);
  }
  return Object.freeze([...unique.values()].sort((left, right) =>
    left.sourceRole.localeCompare(right.sourceRole)
    || left.targetKey.localeCompare(right.targetKey)
    || left.sourceId.localeCompare(right.sourceId)
    || left.citationLocation.localeCompare(right.citationLocation)
  ));
}

export function createCreditexSourcedWorkPackDraft(
  input: CreditexSourcedWorkPackDraftInput,
): CreditexActivityWorkPack {
  const { candidate } = input;
  if (candidate.draftCreationState === "not_available") {
    throw new Error(
      `${candidate.templateId} has no source-backed governed draft definition.`,
    );
  }
  const publishableGuidedCapture =
    candidate.draftCreationState === "source_bound_guided_capture"
    && candidate.guidedCaptureState === "publishable_source_bound"
    && !candidate.candidateOnly
    && candidate.scenarioNeed.decisionState === "executable_source_bound"
    && candidate.calculatorNeeds.every((calculator) =>
      calculator.decisionState === "executable_source_bound"
    );
  const sourceBackedReviewDraft =
    candidate.draftCreationState === "source_backed_review_draft"
    && candidate.guidedCaptureState === "source_backed_review_candidate"
    && candidate.candidateOnly
    && !candidate.activationReady;
  if (!publishableGuidedCapture && !sourceBackedReviewDraft) {
    throw new Error(`${candidate.templateId} has an incomplete executable dependency contract.`);
  }
  const firstGuidedPromptKey = `guided_${slug(
    candidate.prompts[0].key,
    "question_1",
  )}`;

  const workPack: CreditexActivityWorkPack = {
    contract: CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
    activityTemplateId: candidate.templateId,
    version: input.version,
    title: `${candidate.programCode} ${candidate.activityCode} guided field workflow`,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    catalogueReviewedOn: input.catalogueReviewedOn,
    stages: [
      {
        stageKey: "activity_details",
        order: 1,
        label: "Activity details",
        description: "Confirm the activity facts and calculation inputs.",
      },
      {
        stageKey: "field_evidence",
        order: 2,
        label: "Evidence",
        description: "Capture original evidence and available metadata.",
      },
      {
        stageKey: "governing_sources",
        order: 3,
        label: "Governing sources",
        description: "Review the exact official sources bound to this definition.",
      },
      {
        stageKey: "operational_gates",
        order: 4,
        label: "Operational gates",
        description: "Internal requirements that must pass before field publication or certificate action.",
      },
    ],
    signerRoles: [],
    dependencies: sourcedDraftDependencies(candidate),
    sections: [
      {
        sectionKey: "activity_questions",
        order: 1,
        title: "Activity questions",
        description: "Current source-bound guided capture fields.",
        visibility: null,
        repeatability: null,
        prompts: candidate.prompts.map((prompt, index) =>
          guidedPrompt(prompt, index + 1)
        ),
      },
      {
        sectionKey: "evidence_capture",
        order: 2,
        title: "Evidence capture",
        description: "Original evidence and metadata retained against the job.",
        visibility: null,
        repeatability: null,
        prompts: candidate.evidenceRequirements.map((evidence, index) =>
          guidedEvidencePrompt(evidence, index + 1)
        ),
      },
      {
        sectionKey: "reference_documents",
        order: 3,
        title: "Official sources",
        description: "Exact source files and citations used to build this guided capture definition.",
        visibility: null,
        repeatability: null,
        prompts: candidate.referenceDocuments.map((source, index) =>
          guidedSourcePrompt(source, index + 1)
        ),
      },
      {
        sectionKey: "operational_blockers",
        order: 4,
        title: "Operational publication blockers",
        description: "Compliance-only gates. These do not create declarations or certificate approval.",
        visibility: null,
        repeatability: null,
        prompts: candidate.blockers.map((blocker, index) =>
          basePrompt({
            promptKey: `blocker_${slug(blocker.code, `item_${index + 1}`)}`,
            order: index + 1,
            type: "textarea",
            label: blocker.code,
            instructions: clipped(blocker.detail, 2_000),
            required: false,
            stageKey: "operational_gates",
            requirementKeys: [blocker.code],
          })
        ),
      },
    ],
    documentOutputs: [{
      outputKey: "provider_assignment_pdf",
      title: "Exact provider assignment PDF required before field publication",
      sourceBindingTargetKey: "provider_assignment_pdf_required",
      rendererVersion: CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION,
      required: true,
      placements: [{
        placementKey: "guided_capture_field_1",
        kind: "text",
        sourcePath: `/response/answers/${firstGuidedPromptKey}`,
        signaturePromptKey: "",
        signerRoleKey: "",
        pageIndex: 0,
        x: 0.05,
        y: 0.05,
        width: 0.4,
        height: 0.04,
        fontFamily: "helvetica",
        fontSize: 10,
        minimumFontSize: 8,
        overflow: "shrink",
        maximumLines: 1,
        textFormat: "text",
      }],
    }],
  };

  return validateCreditexActivityWorkPack(workPack);
}
