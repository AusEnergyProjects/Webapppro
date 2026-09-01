"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CREDITEX_CURRENT_WORK_PACK_CONTENT_BY_TEMPLATE_ID,
  type CreditexCurrentWorkPackContentCandidate,
} from "@/data/creditex-current-work-pack-content";
import type {
  CreditexActivityWorkPack,
  CreditexWorkPackDependency,
  CreditexWorkPackPrompt,
  CreditexWorkPackSection,
  CreditexWorkPackSignerRole,
  CreditexWorkPackStage,
} from "@/lib/creditex-activity-work-pack";
import {
  CREDITEX_OFFICIAL_PRODUCT_KINDS,
  officialProductKindLabel,
} from "@/lib/creditex-official-product-registry";
import { CreditexOfficialSourceBatchAcquisition } from "./CreditexOfficialSourceBatchAcquisition";
import { CreditexWorkPackDocumentOutputEditor } from "./CreditexWorkPackDocumentOutputEditor";
import styles from "./CreditexActivityWorkPackGovernance.module.css";

type Api = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;

type GovernanceAccess = {
  canRead: boolean;
  canAuthor: boolean;
  canReview: boolean;
  canPublish: boolean;
  canWithdraw: boolean;
};

type ActivityOption = {
  id: string;
  activityTemplateId: string;
  programCode: string;
  activityCode: string;
  title: string;
  effectiveFrom: string;
  effectiveTo: string;
  publishState: string;
};

type SourceArtifact = {
  id: string;
  title: string;
  version: string;
  sourceUrl: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  decision: string;
};

type CustodySource = {
  artifact: SourceArtifact;
  artifactDecision: "pending_review" | "approved" | "rejected" | "withdrawn";
};

type SourceUploadDraft = {
  clientRequestId: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceVersion: string;
};

type WorkPackSourceBinding = {
  id: string;
  workPackVersionId: string;
  schemaSha256: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  sourceRole: "requirement" | "product" | "scenario" | "calculator";
  targetKey: string;
  citationLocation: string;
  state: "pending_review" | "approved" | "rejected" | "withdrawn";
  createdByUid: string;
  createdByName: string;
  createdAt: string;
  reviewedByUid: string;
  reviewedByName: string;
  reviewedAt: string;
  reviewNote: string;
  withdrawnAt: string;
  withdrawalNote: string;
};

type PolicyOption = {
  id: string;
  title: string;
  version: number;
  sha256: string;
  activityVersionId: string;
  status: string;
  requirementsComplete?: boolean;
};

type CoverageRow = {
  activityTemplateId: string;
  programCode: string;
  activityCode: string;
  title: string;
  catalogueState: string;
  activityVersionId: string | null;
  ready: boolean;
  blockers: string[];
};

type CalculatorReview = {
  calculationRunId: string;
  caseId: string;
  workOrderId: string;
  caseInstanceId: string;
  instanceKey: string;
  dependencyKey: string;
  calculatorVersionId: string;
  calculatorKey: string;
  calculatorVersion: string;
  runByUid: string;
  runAt: string;
  inputSha256: string;
  outputSha256: string;
  status: "pending_review" | "approved" | "rejected";
  reviewId: string;
  reviewerUid: string;
  reviewNote: string;
  reviewedAt: string;
};

type WorkPackVersion = {
  id: string;
  activityVersionId: string;
  version: number;
  state: "draft" | "published" | "withdrawn" | "abandoned";
  title: string;
  schema: CreditexActivityWorkPack;
  schemaSha256: string;
  originKind: "manual" | "source_candidate";
  clientRequestId: string;
  sourceCandidateSha256: string;
  sourceBindingMapSha256: string;
  sourceBindingMap: SourcedDraftBindingMap[];
  candidateBlockers: { code: string; detail: string }[];
  sourceBindingIds: string[];
  manualPolicyBindingId: string;
  evidencePolicyVersionId: string;
  effectiveFrom: string;
  effectiveTo: string;
  authoredByUid: string;
  authoredByName: string;
  authoredAt: string;
  reviewedByName: string;
  updatedAt: string;
  reviewNote: string;
  withdrawalNote: string;
  abandonmentNote: string;
};

type SourcedDraftBindingMap = {
  contract: string;
  sourceId: string;
  expectedSha256: string;
  sourceRole: WorkPackSourceBinding["sourceRole"];
  targetKey: string;
  officialUrl: string;
  sourceTitle: string;
  sourceVersion: string;
  citationLocation: string;
  artifactId: string;
  artifactSha256: string;
  artifactReviewState: string;
  exactArtifactMatch: boolean;
};

type GovernanceSnapshot = {
  access: GovernanceAccess;
  activities: ActivityOption[];
  versions: WorkPackVersion[];
  sourceArtifacts: SourceArtifact[];
  sourceBindings: WorkPackSourceBinding[];
  manualPolicyBindings: PolicyOption[];
  evidencePolicies: PolicyOption[];
  coverage: CoverageRow[];
  calculatorReviews: CalculatorReview[];
};

type WorkPackDraft = {
  id: string;
  expectedSchemaSha256: string;
  activityVersionId: string;
  manualPolicyBindingId: string;
  evidencePolicyVersionId: string;
  originKind: "manual" | "source_candidate";
  sourceBindingMap: SourcedDraftBindingMap[];
  candidateBlockers: { code: string; detail: string }[];
  schema: CreditexActivityWorkPack;
};

type GovernanceAction = {
  action:
    | "review_source_binding"
    | "withdraw_source_binding"
    | "review_calculation_run"
    | "publish_version"
    | "withdraw_version"
    | "abandon_draft";
  id: string;
  expectedSchemaSha256: string;
  decision?: "approved" | "rejected";
  title: string;
};

type NewSourceBinding = {
  sourceArtifactId: string;
  sourceRole: WorkPackSourceBinding["sourceRole"];
  targetKey: string;
  citationLocation: string;
};

const EMPTY_SOURCE_BINDING: NewSourceBinding = {
  sourceArtifactId: "",
  sourceRole: "requirement",
  targetKey: "work_pack",
  citationLocation: "",
};

const EMPTY_ACCESS: GovernanceAccess = {
  canRead: false,
  canAuthor: false,
  canReview: false,
  canPublish: false,
  canWithdraw: false,
};

function newSourceUploadDraft(): SourceUploadDraft {
  return {
    clientRequestId: `forms-source:${crypto.randomUUID()}`,
    sourceUrl: "",
    sourceTitle: "",
    sourceVersion: "",
  };
}

const PROMPT_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "photo",
  "document",
  "reference_document",
  "signature",
] as const;

const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "in",
  "not_in",
  "contains",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "answered",
  "not_answered",
] as const;

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function boolean(value: unknown) {
  return value === true;
}

function cloneSchema(schema: CreditexActivityWorkPack) {
  return structuredClone(schema) as CreditexActivityWorkPack;
}

function slug(value: string, fallback: string) {
  const result = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return result || fallback;
}

function nextOrder(items: readonly { order: number }[]) {
  return items.length
    ? Math.max(...items.map((item) => item.order)) + 1
    : 1;
}

function move<T>(items: readonly T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function normaliseOrders<T extends { order: number }>(items: readonly T[]) {
  return items.map((item, index) => ({ ...item, order: index + 1 }));
}

function newStage(order = 1): CreditexWorkPackStage {
  return {
    stageKey: `stage_${order}`,
    order,
    label: `Stage ${order}`,
    description: "",
  };
}

function newSignerRole(order = 1): CreditexWorkPackSignerRole {
  return {
    roleKey: `signer_${order}`,
    label: `Signer ${order}`,
    capacity: "",
    identitySource: "customer_context",
    minimumSignatures: 1,
    maximumSignatures: 1,
    identityRequirements: [
      { fieldKey: "full_name", label: "Full name", required: true },
    ],
  };
}

function newPrompt(
  order: number,
  stageKey: string,
): CreditexWorkPackPrompt {
  return {
    promptKey: `question_${order}`,
    order,
    type: "text",
    label: `Question ${order}`,
    instructions: "",
    required: false,
    visibility: null,
    dependencyKeys: [],
    requirementKeys: [],
    stageKey,
    options: [],
    signerRoleKey: "",
    attestation: null,
    minimumLength: null,
    maximumLength: null,
    minimumNumber: null,
    maximumNumber: null,
    numberStep: null,
    unit: "",
    minimumSelections: null,
    maximumSelections: null,
    fileRequirement: null,
    referenceDocument: null,
  };
}

function newSection(order: number, stageKey: string): CreditexWorkPackSection {
  return {
    sectionKey: `section_${order}`,
    order,
    title: `Section ${order}`,
    description: "",
    visibility: null,
    repeatability: null,
    prompts: [newPrompt(1, stageKey)],
  };
}

function emptySchema(activity: ActivityOption, version: number): CreditexActivityWorkPack {
  const stage = newStage(1);
  return {
    contract: "creditex-activity-work-pack/v1",
    activityTemplateId: activity.activityTemplateId,
    version,
    title: `${activity.programCode} ${activity.activityCode} field workflow`,
    effectiveFrom: activity.effectiveFrom,
    effectiveTo: activity.effectiveTo,
    catalogueReviewedOn: new Date().toISOString().slice(0, 10),
    stages: [stage],
    signerRoles: [],
    dependencies: [],
    documentOutputs: [],
    sections: [newSection(1, stage.stageKey)],
  };
}

function parseSnapshot(input: Record<string, unknown>): GovernanceSnapshot {
  const access = record(input.access);
  return {
    access: {
      canRead: boolean(access.canRead),
      canAuthor: boolean(access.canAuthor),
      canReview: boolean(access.canReview),
      canPublish: boolean(access.canPublish),
      canWithdraw: boolean(access.canWithdraw),
    },
    activities: records(input.activities).map((item) => ({
      id: text(item.id),
      activityTemplateId: text(item.activityTemplateId),
      programCode: text(item.programCode),
      activityCode: text(item.activityCode),
      title: text(item.title),
      effectiveFrom: text(item.effectiveFrom),
      effectiveTo: text(item.effectiveTo),
      publishState: text(item.publishState),
    })).filter((item) => item.id && item.activityTemplateId),
    versions: records(input.versions).map((item) => ({
      id: text(item.id),
      activityVersionId: text(item.activityVersionId),
      version: integer(item.version, 1),
      state: text(item.state) as WorkPackVersion["state"],
      title: text(item.title),
      schema: record(item.schema) as CreditexActivityWorkPack,
      schemaSha256: text(item.schemaSha256),
      originKind: text(item.originKind) === "source_candidate"
        ? "source_candidate" as const
        : "manual" as const,
      clientRequestId: text(item.clientRequestId),
      sourceCandidateSha256: text(item.sourceCandidateSha256),
      sourceBindingMapSha256: text(item.sourceBindingMapSha256),
      sourceBindingMap: records(item.sourceBindingMap).map((binding) => ({
        contract: text(binding.contract),
        sourceId: text(binding.sourceId),
        expectedSha256: text(binding.expectedSha256),
        sourceRole: text(binding.sourceRole) as WorkPackSourceBinding["sourceRole"],
        targetKey: text(binding.targetKey),
        officialUrl: text(binding.officialUrl),
        sourceTitle: text(binding.sourceTitle),
        sourceVersion: text(binding.sourceVersion),
        citationLocation: text(binding.citationLocation),
        artifactId: text(binding.artifactId),
        artifactSha256: text(binding.artifactSha256),
        artifactReviewState: text(binding.artifactReviewState),
        exactArtifactMatch: boolean(binding.exactArtifactMatch),
      })).filter((binding) => binding.sourceId && binding.targetKey),
      candidateBlockers: records(item.candidateBlockers).map((blocker) => ({
        code: text(blocker.code),
        detail: text(blocker.detail),
      })).filter((blocker) => blocker.code && blocker.detail),
      sourceBindingIds: strings(item.sourceBindingIds),
      manualPolicyBindingId: text(item.manualPolicyBindingId),
      evidencePolicyVersionId: text(item.evidencePolicyVersionId),
      effectiveFrom: text(item.effectiveFrom),
      effectiveTo: text(item.effectiveTo),
      authoredByUid: text(item.authoredByUid),
      authoredByName: text(item.authoredByName),
      authoredAt: text(item.authoredAt),
      reviewedByName: text(item.reviewedByName),
      updatedAt: text(item.updatedAt),
      reviewNote: text(item.reviewNote),
      withdrawalNote: text(item.withdrawalNote),
      abandonmentNote: text(item.abandonmentNote),
    })).filter((item) => item.id && item.activityVersionId),
    sourceArtifacts: records(input.sourceArtifacts).map((item) => ({
      id: text(item.id),
      title: text(item.title),
      version: text(item.version),
      sourceUrl: text(item.sourceUrl),
      originalFileName: text(item.originalFileName),
      contentType: text(item.contentType),
      sizeBytes: integer(item.sizeBytes),
      sha256: text(item.sha256),
      decision: text(item.decision),
    })).filter((item) => item.id),
    sourceBindings: records(input.sourceBindings).map((item) => ({
      id: text(item.id),
      workPackVersionId: text(item.workPackVersionId),
      schemaSha256: text(item.schemaSha256),
      sourceArtifactId: text(item.sourceArtifactId),
      sourceArtifactSha256: text(item.sourceArtifactSha256),
      sourceRole: text(item.sourceRole) as WorkPackSourceBinding["sourceRole"],
      targetKey: text(item.targetKey),
      citationLocation: text(item.citationLocation),
      state: text(item.state) as WorkPackSourceBinding["state"],
      createdByUid: text(item.createdByUid),
      createdByName: text(item.createdByName),
      createdAt: text(item.createdAt),
      reviewedByUid: text(item.reviewedByUid),
      reviewedByName: text(item.reviewedByName),
      reviewedAt: text(item.reviewedAt),
      reviewNote: text(item.reviewNote),
      withdrawnAt: text(item.withdrawnAt),
      withdrawalNote: text(item.withdrawalNote),
    })).filter((item) => item.id),
    manualPolicyBindings: records(input.manualPolicyBindings).map((item) => ({
      id: text(item.id),
      title: text(item.title),
      version: integer(item.version),
      sha256: text(item.sha256),
      activityVersionId: text(item.activityVersionId),
      status: text(item.status),
      requirementsComplete: boolean(item.requirementsComplete),
    })).filter((item) => item.id),
    evidencePolicies: records(input.evidencePolicies).map((item) => ({
      id: text(item.id),
      title: text(item.title),
      version: integer(item.version),
      sha256: text(item.sha256),
      activityVersionId: text(item.activityVersionId),
      status: text(item.status),
      requirementsComplete: boolean(item.requirementsComplete),
    })).filter((item) => item.id),
    coverage: records(input.coverage).map((item) => ({
      activityTemplateId: text(item.activityTemplateId),
      programCode: text(item.programCode),
      activityCode: text(item.activityCode),
      title: text(item.title),
      catalogueState: text(item.catalogueState),
      activityVersionId: text(item.activityVersionId) || null,
      ready: boolean(item.ready),
      blockers: strings(item.blockers),
    })).filter((item) => item.activityTemplateId),
    calculatorReviews: records(input.calculatorReviews).map((item) => ({
      calculationRunId: text(item.calculationRunId),
      caseId: text(item.caseId),
      workOrderId: text(item.workOrderId),
      caseInstanceId: text(item.caseInstanceId),
      instanceKey: text(item.instanceKey),
      dependencyKey: text(item.dependencyKey),
      calculatorVersionId: text(item.calculatorVersionId),
      calculatorKey: text(item.calculatorKey),
      calculatorVersion: text(item.calculatorVersion),
      runByUid: text(item.runByUid),
      runAt: text(item.runAt),
      inputSha256: text(item.inputSha256),
      outputSha256: text(item.outputSha256),
      status: text(item.status) as CalculatorReview["status"],
      reviewId: text(item.reviewId),
      reviewerUid: text(item.reviewerUid),
      reviewNote: text(item.reviewNote),
      reviewedAt: text(item.reviewedAt),
    })).filter((item) => item.calculationRunId),
  };
}

function parseCustodySources(input: Record<string, unknown>) {
  const byArtifact = new Map<string, CustodySource>();
  for (const item of records(input.sources)) {
    const artifact = record(item.artifact);
    const review = record(item.artifactReview);
    const id = text(artifact.id);
    if (!id || byArtifact.has(id)) continue;
    const decision = text(review.decision);
    byArtifact.set(id, {
      artifact: {
        id,
        title: text(artifact.sourceTitle),
        version: text(artifact.sourceVersion),
        sourceUrl: text(artifact.sourceUrl),
        originalFileName: text(artifact.originalFileName),
        contentType: text(artifact.contentType),
        sizeBytes: integer(artifact.sizeBytes),
        sha256: text(artifact.sha256),
        decision,
      },
      artifactDecision: decision === "approved"
        || decision === "rejected"
        || decision === "withdrawn"
        ? decision
        : "pending_review",
    });
  }
  return [...byArtifact.values()];
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleString("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function stateLabel(value: string) {
  return value.replaceAll("_", " ");
}

function contentStateCopy(candidate: CreditexCurrentWorkPackContentCandidate) {
  if (candidate.guidedCaptureState === "publishable_source_bound") {
    return {
      label: "Guided capture publishable",
      description: "Current source-bound questions, evidence, product, scenario and executable calculation dependencies can be opened as an editable draft. The exact statutory assignment form, provider submission schema, independent review and certificate activation remain separate blocked gates.",
    };
  }
  if (candidate.guidedCaptureState === "source_backed_review_candidate") {
    return {
      label: "Source-backed form review candidate",
      description: "The retained official form set supports compliance review. It is not field-published, trade-ready or certificate-ready until independent review and the external provider submission schema pass.",
    };
  }
  if (candidate.guidedCaptureState === "source_only_not_publishable") {
    return {
      label: "Source-only contract",
      description: "Current official sources are retained, but the complete activity form set is not. This row is visible for compliance work only and cannot start a field workflow.",
    };
  }
  return {
    label: "Candidate-only content",
    description: "The source signals remain an internal authoring candidate. They are not saved, approved, field-published or certificate-ready.",
  };
}

function CandidateContentPanel({
  candidate,
}: {
  candidate: CreditexCurrentWorkPackContentCandidate;
}) {
  const contentCopy = contentStateCopy(candidate);
  return (
    <section className={styles.candidatePanel} aria-labelledby="work-pack-candidate-content-title">
      <header>
        <div>
          <span>{contentCopy.label}</span>
          <h4 id="work-pack-candidate-content-title">Current activity content</h4>
          <p>{contentCopy.description}</p>
        </div>
        <strong>{candidate.blockers.length} blocker(s)</strong>
      </header>
      <dl className={styles.candidateMetrics}>
        <div><dt>Guided capture</dt><dd>{stateLabel(candidate.guidedCaptureState)}</dd></div>
        <div><dt>Statutory form</dt><dd>{stateLabel(candidate.statutoryDocumentState)}</dd></div>
        <div><dt>Provider schema</dt><dd>{stateLabel(candidate.providerSchemaState)}</dd></div>
        <div><dt>Activation</dt><dd>{candidate.activationReady ? "Ready" : "Blocked"}</dd></div>
        <div><dt>Outcome</dt><dd>{candidate.outcomeLabel}</dd></div>
        <div><dt>Questions</dt><dd>{candidate.prompts.length}</dd></div>
        <div><dt>Evidence</dt><dd>{candidate.evidenceRequirements.length}</dd></div>
        <div><dt>References</dt><dd>{candidate.referenceDocuments.length}</dd></div>
        <div><dt>Signatures</dt><dd>{candidate.signatureNeeds.length}</dd></div>
        <div><dt>Final outputs</dt><dd>{candidate.finalDocumentNeeds.length}</dd></div>
      </dl>
      <div className={styles.candidateDetails}>
        <details>
          <summary>Identity and source documents</summary>
          <div className={styles.candidateColumns}>
            <section><h5>Job identity bindings</h5><ul>{candidate.identityBindings.map((binding) => <li key={binding.role}><strong>{stateLabel(binding.role)}</strong><span>{stateLabel(binding.resolution)}</span></li>)}</ul></section>
            <section><h5>Source and reference candidates</h5><ul>{candidate.sources.map((source) => <li key={`source_${source.sourceKey}`}><strong>{source.title}</strong><span>{source.version || "Version not stated"} | {stateLabel(source.custodyState)}</span><small>{source.citation}</small></li>)}{candidate.referenceDocuments.map((source) => <li key={`reference_${source.sourceKey}`}><strong>{source.title}</strong><span>Reference document | {source.version || "Version not stated"} | {stateLabel(source.custodyState)}</span><small>{source.citation}</small></li>)}</ul></section>
          </div>
        </details>
        <details>
          <summary>Questions and evidence</summary>
          <div className={styles.candidateColumns}>
            <section><h5>Questions</h5><ul>{candidate.prompts.map((prompt) => <li key={prompt.key}><strong>{prompt.label}</strong><span>{stateLabel(prompt.category)} | {prompt.requiredCandidate ? "required in this content state" : "not enabled"} | {stateLabel(prompt.approvalState)}</span><small>{prompt.source.citation}</small></li>)}</ul></section>
            <section><h5>Evidence</h5><ul>{candidate.evidenceRequirements.map((evidence) => <li key={evidence.requirementId}><strong>{evidence.label}</strong><span>{stateLabel(evidence.kind)} | {stateLabel(evidence.captureState)}</span><small>{evidence.source.citation}</small></li>)}</ul></section>
          </div>
        </details>
        <details>
          <summary>Product, scenario and calculation needs</summary>
          <div className={styles.candidateColumns}>
            <section><h5>Product needs</h5><ul>{candidate.productNeeds.map((product) => <li key={product.key}><strong>{product.label}</strong><span>{stateLabel(product.decisionState)}</span><small>{product.attributes.length ? product.attributes.join(", ") : "Exact attributes remain unresolved."}</small></li>)}</ul></section>
            <section><h5>Scenario and calculator signals</h5><ul><li><strong>Scenario</strong><span>{stateLabel(candidate.scenarioNeed.decisionState)}</span><small>{candidate.scenarioNeed.codesOrSignals.length ? candidate.scenarioNeed.codesOrSignals.join(", ") : "Exact scenario decision remains unresolved."}</small></li>{candidate.calculatorNeeds.length ? candidate.calculatorNeeds.map((calculator) => <li key={calculator.key}><strong>{calculator.label}</strong><span>{calculator.outputUnit || "No approved unit"} | {stateLabel(calculator.decisionState)}</span><small>{calculator.inputKeys.length ? calculator.inputKeys.join(", ") : "Exact input contract remains unresolved."}</small></li>) : <li><strong>Calculation applicability</strong><span>Unresolved pending review</span></li>}</ul></section>
          </div>
        </details>
        <details>
          <summary>Signatures, documents and activation blockers</summary>
          <div className={styles.candidateColumns}>
            <section><h5>Visible signatures and outputs</h5><ul>{candidate.signatureNeeds.map((signature) => <li key={signature.signatureId}><strong>{signature.label}</strong><span>{stateLabel(signature.signerRole)} | {stateLabel(signature.decisionState)}</span></li>)}{candidate.finalDocumentNeeds.map((document) => <li key={document.documentType}><strong>{document.label}</strong><span>{document.format} | {stateLabel(document.decisionState)}</span></li>)}</ul></section>
            <section className={styles.blockerList}><h5>Must be resolved before activation</h5><ul>{candidate.blockers.map((blocker) => <li key={blocker.code}><strong>{blocker.code}</strong><span>{blocker.detail}</span></li>)}</ul></section>
          </div>
        </details>
      </div>
    </section>
  );
}

function PromptEditor({
  prompt,
  stageKeys,
  signerRoles,
  dependencyKeys,
  conditionPromptKeys,
  onChange,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  prompt: CreditexWorkPackPrompt;
  stageKeys: string[];
  signerRoles: CreditexWorkPackSignerRole[];
  dependencyKeys: string[];
  conditionPromptKeys: string[];
  onChange: (next: CreditexWorkPackPrompt) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const isFile = prompt.type === "photo" || prompt.type === "document";
  const isChoice = prompt.type === "select" || prompt.type === "multiselect";
  const isSignature = prompt.type === "signature";
  const isReferenceDocument = prompt.type === "reference_document";
  const isText = prompt.type === "text" || prompt.type === "textarea";
  const isNumber = prompt.type === "number";
  return (
    <article className={styles.promptEditor}>
      <header>
        <strong>{prompt.label || prompt.promptKey}</strong>
        <div>
          <button type="button" disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label={`Move ${prompt.label} up`}>↑</button>
          <button type="button" disabled={!canMoveDown} onClick={() => onMove(1)} aria-label={`Move ${prompt.label} down`}>↓</button>
          <button type="button" onClick={onRemove}>Remove</button>
        </div>
      </header>
      <div className={styles.formGrid}>
        <label>
          Question key
          <input value={prompt.promptKey} onChange={(event) => onChange({ ...prompt, promptKey: slug(event.target.value, `question_${prompt.order}`) })} />
        </label>
        <label>
          Type
          <select value={prompt.type} onChange={(event) => {
            const type = event.target.value as CreditexWorkPackPrompt["type"];
            onChange({
              ...prompt,
              type,
              options: type === "select" || type === "multiselect" ? prompt.options : [],
              signerRoleKey: type === "signature" ? prompt.signerRoleKey : "",
              attestation: type === "signature" ? prompt.attestation : null,
              minimumLength: type === "text" || type === "textarea" ? prompt.minimumLength : null,
              maximumLength: type === "text" || type === "textarea" ? prompt.maximumLength : null,
              minimumNumber: type === "number" ? prompt.minimumNumber : null,
              maximumNumber: type === "number" ? prompt.maximumNumber : null,
              numberStep: type === "number" ? prompt.numberStep : null,
              unit: type === "number" ? prompt.unit : "",
              minimumSelections: type === "select" || type === "multiselect" ? prompt.minimumSelections : null,
              maximumSelections: type === "select" || type === "multiselect" ? prompt.maximumSelections : null,
              fileRequirement: type === "photo" || type === "document"
                ? prompt.fileRequirement || {
                    minimumCount: prompt.required ? 1 : 0,
                    maximumCount: 10,
                    allowedContentTypes: type === "photo" ? ["image/jpeg", "image/heic"] : ["application/pdf", "image/jpeg"],
                    originalRequired: true,
                    metadataRequired: type === "photo",
                    gpsRequired: false,
                    captureTimeRequired: true,
                  }
                : null,
              referenceDocument: type === "reference_document"
                ? prompt.referenceDocument || {
                    sourceBindingTargetKey: "",
                    acknowledgementMode: "viewed",
                    acknowledgementText: "I confirm I have opened and read this document.",
                    acknowledgementVersion: "1",
                  }
                : null,
            });
          }}>
            {PROMPT_TYPES.map((type) => <option key={type} value={type}>{stateLabel(type)}</option>)}
          </select>
        </label>
        <label className={styles.wide}>
          Question or evidence instruction
          <input value={prompt.label} onChange={(event) => onChange({ ...prompt, label: event.target.value })} />
        </label>
        <label className={styles.wide}>
          Technician guidance
          <textarea rows={2} value={prompt.instructions} onChange={(event) => onChange({ ...prompt, instructions: event.target.value })} />
        </label>
        <label>
          Stage
          <select value={prompt.stageKey} onChange={(event) => onChange({ ...prompt, stageKey: event.target.value })}>
            {stageKeys.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        <label>
          Evidence requirement codes
          <input value={prompt.requirementKeys.join(", ")} onChange={(event) => onChange({ ...prompt, requirementKeys: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="before_photo, installer_id" />
        </label>
        <label>
          Product/scenario/calculator dependencies
          <select multiple value={[...prompt.dependencyKeys]} onChange={(event) => onChange({ ...prompt, dependencyKeys: [...event.target.selectedOptions].map((option) => option.value) })}>
            {dependencyKeys.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={prompt.required} onChange={(event) => onChange({ ...prompt, required: event.target.checked })} />
          Required before field completion
        </label>
        {isChoice && (
          <label className={styles.wide}>
            Options, one per line as value | label
            <textarea rows={4} value={prompt.options.map((option) => `${option.value} | ${option.label}`).join("\n")} onChange={(event) => onChange({
              ...prompt,
              options: event.target.value.split("\n").map((line) => {
                const [value, ...label] = line.split("|");
                return { value: slug(value || "", "option"), label: (label.join("|").trim() || value || "").trim() };
              }).filter((option) => option.value && option.label),
            })} />
          </label>
        )}
        {isText && (
          <fieldset className={`${styles.fileRules} ${styles.wide}`}>
            <legend>Answer length</legend>
            <label>Minimum characters<input type="number" min="0" max="20000" value={prompt.minimumLength ?? ""} onChange={(event) => onChange({ ...prompt, minimumLength: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            <label>Maximum characters<input type="number" min="1" max="20000" value={prompt.maximumLength ?? ""} onChange={(event) => onChange({ ...prompt, maximumLength: event.target.value === "" ? null : Number(event.target.value) })} /></label>
          </fieldset>
        )}
        {isNumber && (
          <fieldset className={`${styles.fileRules} ${styles.wide}`}>
            <legend>Number rules</legend>
            <label>Minimum<input type="number" value={prompt.minimumNumber ?? ""} onChange={(event) => onChange({ ...prompt, minimumNumber: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            <label>Maximum<input type="number" value={prompt.maximumNumber ?? ""} onChange={(event) => onChange({ ...prompt, maximumNumber: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            <label>Step<input type="number" min="0.000001" value={prompt.numberStep ?? ""} onChange={(event) => onChange({ ...prompt, numberStep: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            <label>Unit<input value={prompt.unit} onChange={(event) => onChange({ ...prompt, unit: event.target.value })} placeholder="kW, litres, m2" /></label>
          </fieldset>
        )}
        {isChoice && (
          <fieldset className={`${styles.fileRules} ${styles.wide}`}>
            <legend>Selection rules</legend>
            <label>Minimum selections<input type="number" min="0" max={Math.max(1, prompt.options.length)} value={prompt.minimumSelections ?? ""} onChange={(event) => onChange({ ...prompt, minimumSelections: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            <label>Maximum selections<input type="number" min="1" max={Math.max(1, prompt.options.length)} value={prompt.maximumSelections ?? ""} onChange={(event) => onChange({ ...prompt, maximumSelections: event.target.value === "" ? null : Number(event.target.value) })} /></label>
          </fieldset>
        )}
        {isFile && prompt.fileRequirement && (
          <fieldset className={`${styles.fileRules} ${styles.wide}`}>
            <legend>File and metadata rules</legend>
            <label>Minimum<input type="number" min="0" max="100" value={prompt.fileRequirement.minimumCount} onChange={(event) => onChange({ ...prompt, fileRequirement: { ...prompt.fileRequirement!, minimumCount: Number(event.target.value) } })} /></label>
            <label>Maximum<input type="number" min="1" max="100" value={prompt.fileRequirement.maximumCount} onChange={(event) => onChange({ ...prompt, fileRequirement: { ...prompt.fileRequirement!, maximumCount: Number(event.target.value) } })} /></label>
            <label>Allowed types<input value={prompt.fileRequirement.allowedContentTypes.join(", ")} onChange={(event) => onChange({ ...prompt, fileRequirement: { ...prompt.fileRequirement!, allowedContentTypes: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } })} /></label>
            {(["originalRequired", "metadataRequired", "gpsRequired", "captureTimeRequired"] as const).map((key) => (
              <label key={key} className={styles.checkLabel}>
                <input type="checkbox" checked={prompt.fileRequirement![key]} onChange={(event) => onChange({ ...prompt, fileRequirement: { ...prompt.fileRequirement!, [key]: event.target.checked } })} />
                {stateLabel(key.replace("Required", " required"))}
              </label>
            ))}
          </fieldset>
        )}
        {isReferenceDocument && prompt.referenceDocument && (
          <fieldset className={`${styles.signatureRules} ${styles.wide}`}>
            <legend>Official document shown to the technician or customer</legend>
            <label>Source citation target<input required value={prompt.referenceDocument.sourceBindingTargetKey} onChange={(event) => onChange({ ...prompt, referenceDocument: { ...prompt.referenceDocument!, sourceBindingTargetKey: event.target.value } })} placeholder="consumer_rights_document" /></label>
            <label>Acknowledgement<select value={prompt.referenceDocument.acknowledgementMode} onChange={(event) => onChange({ ...prompt, referenceDocument: { ...prompt.referenceDocument!, acknowledgementMode: event.target.value as "none" | "viewed" | "confirmed", acknowledgementText: event.target.value === "none" ? "" : prompt.referenceDocument!.acknowledgementText || "I confirm I have opened and read this document.", acknowledgementVersion: event.target.value === "none" ? "" : prompt.referenceDocument!.acknowledgementVersion || "1" } })}><option value="none">Open only</option><option value="viewed">Record opened and viewed</option><option value="confirmed">Explicit confirmation</option></select></label>
            {prompt.referenceDocument.acknowledgementMode !== "none" ? <>
              <label className={styles.wide}>Acknowledgement text<textarea required rows={3} value={prompt.referenceDocument.acknowledgementText} onChange={(event) => onChange({ ...prompt, referenceDocument: { ...prompt.referenceDocument!, acknowledgementText: event.target.value } })} /></label>
              <label>Text version<input required value={prompt.referenceDocument.acknowledgementVersion} onChange={(event) => onChange({ ...prompt, referenceDocument: { ...prompt.referenceDocument!, acknowledgementVersion: event.target.value } })} /></label>
            </> : null}
          </fieldset>
        )}
        {isSignature && (
          <fieldset className={`${styles.signatureRules} ${styles.wide}`}>
            <legend>Signature declaration</legend>
            <label>
              Signer role
              <select value={prompt.signerRoleKey} onChange={(event) => onChange({ ...prompt, signerRoleKey: event.target.value })}>
                <option value="">Choose signer role</option>
                {signerRoles.map((role) => <option key={role.roleKey} value={role.roleKey}>{role.label}</option>)}
              </select>
            </label>
            <label className={styles.wide}>
              Exact declaration shown before signing
              <textarea rows={4} value={prompt.attestation?.text || ""} onChange={(event) => onChange({
                ...prompt,
                attestation: {
                  text: event.target.value,
                  version: prompt.attestation?.version || "1",
                  sourceBindingTargetKey: prompt.attestation?.sourceBindingTargetKey || "",
                },
              })} />
            </label>
            <label>Declaration version<input value={prompt.attestation?.version || ""} onChange={(event) => onChange({ ...prompt, attestation: { text: prompt.attestation?.text || "", version: event.target.value, sourceBindingTargetKey: prompt.attestation?.sourceBindingTargetKey || "" } })} /></label>
            <label>Source binding target<input value={prompt.attestation?.sourceBindingTargetKey || ""} onChange={(event) => onChange({ ...prompt, attestation: { text: prompt.attestation?.text || "", version: prompt.attestation?.version || "1", sourceBindingTargetKey: event.target.value } })} /></label>
          </fieldset>
        )}
        <fieldset className={`${styles.signatureRules} ${styles.wide}`}>
          <legend>Show this item only when</legend>
          <label className={styles.checkLabel}><input type="checkbox" checked={Boolean(prompt.visibility)} disabled={conditionPromptKeys.length === 0} onChange={(event) => onChange({ ...prompt, visibility: event.target.checked ? { match: "all", conditions: [{ promptKey: conditionPromptKeys[0], scope: "work_pack", operator: "equals", value: "" }] } : null })} />Use an earlier answer to control visibility</label>
          {prompt.visibility ? <>
            <label>Match<select value={prompt.visibility.match} onChange={(event) => onChange({ ...prompt, visibility: { ...prompt.visibility!, match: event.target.value as "all" | "any" } })}><option value="all">All conditions</option><option value="any">Any condition</option></select></label>
            {prompt.visibility.conditions.map((condition, conditionIndex) => <div className={styles.conditionRow} key={`${condition.promptKey}-${conditionIndex}`}>
              <label>Earlier answer<select value={condition.promptKey} onChange={(event) => onChange({ ...prompt, visibility: { ...prompt.visibility!, conditions: prompt.visibility!.conditions.map((item, index) => index === conditionIndex ? { ...item, promptKey: event.target.value } : item) } })}>{conditionPromptKeys.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
              <label>Rule<select value={condition.operator} onChange={(event) => { const operator = event.target.value as typeof condition.operator; onChange({ ...prompt, visibility: { ...prompt.visibility!, conditions: prompt.visibility!.conditions.map((item, index) => index === conditionIndex ? { ...item, operator, value: operator === "answered" || operator === "not_answered" ? null : operator === "in" || operator === "not_in" ? [] : "" } : item) } }); }}>{CONDITION_OPERATORS.map((operator) => <option key={operator} value={operator}>{stateLabel(operator)}</option>)}</select></label>
              <label>Value<input disabled={condition.operator === "answered" || condition.operator === "not_answered"} value={Array.isArray(condition.value) ? condition.value.join(", ") : condition.value === null ? "" : String(condition.value)} onChange={(event) => onChange({ ...prompt, visibility: { ...prompt.visibility!, conditions: prompt.visibility!.conditions.map((item, index) => index === conditionIndex ? { ...item, value: condition.operator === "in" || condition.operator === "not_in" ? event.target.value.split(",").map((value) => value.trim()).filter(Boolean) : event.target.value } : item) } })} placeholder={condition.operator === "in" || condition.operator === "not_in" ? "value1, value2" : "Expected answer"} /></label>
              <button type="button" disabled={prompt.visibility!.conditions.length === 1} onClick={() => onChange({ ...prompt, visibility: { ...prompt.visibility!, conditions: prompt.visibility!.conditions.filter((_, index) => index !== conditionIndex) } })}>Remove condition</button>
            </div>)}
            <button type="button" onClick={() => onChange({ ...prompt, visibility: { ...prompt.visibility!, conditions: [...prompt.visibility!.conditions, { promptKey: conditionPromptKeys[0], scope: "work_pack", operator: "equals", value: "" }] } })}>Add condition</button>
          </> : <small>{conditionPromptKeys.length ? "Always shown until a condition is enabled." : "Add an earlier question before using conditions."}</small>}
        </fieldset>
      </div>
    </article>
  );
}

function SectionVisibilityEditor({
  section,
  earlierPromptKeys,
  onChange,
}: {
  section: CreditexWorkPackSection;
  earlierPromptKeys: readonly string[];
  onChange: (next: CreditexWorkPackSection) => void;
}) {
  const visibility = section.visibility;
  return <fieldset className={styles.sectionVisibility}>
    <legend>Conditional section</legend>
    <label className={styles.checkLabel}>
      <input
        type="checkbox"
        checked={Boolean(visibility)}
        disabled={earlierPromptKeys.length === 0}
        onChange={(event) => onChange({
          ...section,
          visibility: event.target.checked
            ? { match: "all", conditions: [{ promptKey: earlierPromptKeys[0], scope: "work_pack", operator: "equals", value: "" }] }
            : null,
        })}
      />
      Show this whole section only when earlier answers match
    </label>
    {visibility ? <>
      <label>Match<select value={visibility.match} onChange={(event) => onChange({
        ...section,
        visibility: { ...visibility, match: event.target.value as "all" | "any" },
      })}><option value="all">All conditions</option><option value="any">Any condition</option></select></label>
      {visibility.conditions.map((condition, conditionIndex) => <div className={styles.conditionRow} key={`${condition.promptKey}-${conditionIndex}`}>
        <label>Earlier answer<select value={condition.promptKey} onChange={(event) => onChange({
          ...section,
          visibility: { ...visibility, conditions: visibility.conditions.map((item, index) => index === conditionIndex ? { ...item, promptKey: event.target.value } : item) },
        })}>{earlierPromptKeys.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
        <label>Rule<select value={condition.operator} onChange={(event) => {
          const operator = event.target.value as typeof condition.operator;
          onChange({
            ...section,
            visibility: {
              ...visibility,
              conditions: visibility.conditions.map((item, index) => index === conditionIndex
                ? { ...item, operator, value: operator === "answered" || operator === "not_answered" ? null : operator === "in" || operator === "not_in" ? [] : "" }
                : item),
            },
          });
        }}>{CONDITION_OPERATORS.map((operator) => <option key={operator} value={operator}>{stateLabel(operator)}</option>)}</select></label>
        <label>Value<input disabled={condition.operator === "answered" || condition.operator === "not_answered"} value={Array.isArray(condition.value) ? condition.value.join(", ") : condition.value === null ? "" : String(condition.value)} onChange={(event) => onChange({
          ...section,
          visibility: {
            ...visibility,
            conditions: visibility.conditions.map((item, index) => index === conditionIndex
              ? { ...item, value: condition.operator === "in" || condition.operator === "not_in" ? event.target.value.split(",").map((value) => value.trim()).filter(Boolean) : event.target.value }
              : item),
          },
        })} placeholder={condition.operator === "in" || condition.operator === "not_in" ? "value1, value2" : "Expected answer"} /></label>
        <button type="button" disabled={visibility.conditions.length === 1} onClick={() => onChange({
          ...section,
          visibility: { ...visibility, conditions: visibility.conditions.filter((_, index) => index !== conditionIndex) },
        })}>Remove condition</button>
      </div>)}
      <button type="button" onClick={() => onChange({
        ...section,
        visibility: {
          ...visibility,
          conditions: [...visibility.conditions, { promptKey: earlierPromptKeys[0], scope: "work_pack", operator: "equals", value: "" }],
        },
      })}>Add condition</button>
    </> : <small>{earlierPromptKeys.length > 0
      ? "The technician will skip this category unless the configured earlier answers match."
      : "Add a non-repeating question in an earlier section before making this category conditional."}</small>}
  </fieldset>;
}

function WorkPackPreview({ schema, onClose }: { schema: CreditexActivityWorkPack; onClose: () => void }) {
  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className={styles.previewDialog} role="dialog" aria-modal="true" aria-labelledby="work-pack-preview-title">
        <header>
          <div>
            <span>Technician preview</span>
            <h2 id="work-pack-preview-title">{schema.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close workflow preview">×</button>
        </header>
        <aside className={styles.previewIdentityBoundary}>
          <strong>Reusable activity definition</strong>
          <p>
            This preview shows the questions and documents reused for this
            activity. Each assigned job is separately prefixed at runtime with
            server-resolved Creditex provider, installer business, customer,
            job and assigned technician identities. Those identity labels are
            not editable in the form definition.
          </p>
        </aside>
        <ol className={styles.stageList}>
          {schema.stages.map((stage) => <li key={stage.stageKey}><strong>{stage.label}</strong><small>{stage.description}</small></li>)}
        </ol>
        <div className={styles.previewSections}>
          {schema.sections.map((section) => (
            <section key={section.sectionKey}>
              <header><span>{section.sectionKey}</span><h3>{section.title}</h3><p>{section.description}</p></header>
              {section.prompts.map((prompt) => (
                <article key={prompt.promptKey}>
                  <strong>{prompt.label}{prompt.required ? " *" : ""}</strong>
                  {prompt.instructions && <p>{prompt.instructions}</p>}
                  <small>{stateLabel(prompt.type)}{prompt.stageKey ? ` | ${prompt.stageKey}` : ""}</small>
                  {(prompt.type === "select" || prompt.type === "multiselect") && (
                    <ul>{prompt.options.map((option) => <li key={option.value}>{option.label}</li>)}</ul>
                  )}
                  {(prompt.type === "photo" || prompt.type === "document") && prompt.fileRequirement && (
                    <p>{prompt.fileRequirement.minimumCount} to {prompt.fileRequirement.maximumCount} file(s); {prompt.fileRequirement.originalRequired ? "original required" : "derived file allowed"}</p>
                  )}
                  {prompt.type === "reference_document" && prompt.referenceDocument && (
                    <p>Open the exact governed document{prompt.referenceDocument.acknowledgementMode === "none" ? "" : ` and record ${prompt.referenceDocument.acknowledgementMode}`}. Source target: {prompt.referenceDocument.sourceBindingTargetKey}</p>
                  )}
                  {prompt.type === "signature" && prompt.attestation && <blockquote>{prompt.attestation.text}</blockquote>}
                </article>
              ))}
            </section>
          ))}
        </div>
        <footer><button type="button" onClick={onClose}>Close preview</button></footer>
      </section>
    </div>
  );
}

export function CreditexActivityWorkPackGovernance({
  api,
  endpoint,
  sourceEndpoint,
  sourceBatchEndpoint,
  canCaptureSource,
  onDownloadSource,
  contextLabel,
}: {
  api: Api;
  endpoint: string;
  sourceEndpoint: string;
  sourceBatchEndpoint: string;
  canCaptureSource: boolean;
  onDownloadSource: (
    artifactId: string,
    originalFileName: string,
  ) => Promise<string>;
  contextLabel: string;
}) {
  const [snapshot, setSnapshot] = useState<GovernanceSnapshot>({
    access: EMPTY_ACCESS,
    activities: [],
    versions: [],
    sourceArtifacts: [],
    sourceBindings: [],
    manualPolicyBindings: [],
    evidencePolicies: [],
    coverage: [],
    calculatorReviews: [],
  });
  const [selectedActivityId, setSelectedActivityId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [draft, setDraft] = useState<WorkPackDraft | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [governanceAction, setGovernanceAction] = useState<GovernanceAction | null>(null);
  const [governanceComment, setGovernanceComment] = useState("");
  const [newSourceBinding, setNewSourceBinding] = useState<NewSourceBinding>(EMPTY_SOURCE_BINDING);
  const [custodySources, setCustodySources] = useState<CustodySource[]>([]);
  const [sourceUpload, setSourceUpload] = useState<SourceUploadDraft>(
    newSourceUploadDraft,
  );
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUploadOpen, setSourceUploadOpen] = useState(false);
  const [openingSourceId, setOpeningSourceId] = useState("");
  const sourcedDraftRequestIds = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    const [result, sourceResult] = await Promise.all([
      api(endpoint),
      api(`${sourceEndpoint}?pageSize=100`),
    ]);
    const next = parseSnapshot(result);
    setSnapshot(next);
    setCustodySources(parseCustodySources(sourceResult));
    setSelectedActivityId((current) => current || next.activities[0]?.id || "");
    setSelectedVersionId((current) => current || next.versions[0]?.id || "");
  }, [api, endpoint, sourceEndpoint]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Compliance forms could not be loaded."));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const selectedActivity = snapshot.activities.find((activity) => activity.id === selectedActivityId) || null;
  const selectedContentCandidate = selectedActivity
    ? CREDITEX_CURRENT_WORK_PACK_CONTENT_BY_TEMPLATE_ID.get(selectedActivity.activityTemplateId) || null
    : null;
  const selectedVersion = snapshot.versions.find((version) => version.id === selectedVersionId) || null;
  const activityVersions = snapshot.versions.filter((version) => version.activityVersionId === selectedActivityId);
  const coverage = snapshot.coverage.find((row) => row.activityVersionId === selectedActivityId) || null;
  const filteredActivities = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return snapshot.activities;
    return snapshot.activities.filter((activity) => `${activity.programCode} ${activity.activityCode} ${activity.title}`.toLowerCase().includes(needle));
  }, [query, snapshot.activities]);
  const missingActivityVersions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return snapshot.coverage.filter((row) => {
      if (row.activityVersionId) return false;
      if (!needle) return true;
      return `${row.programCode} ${row.activityCode} ${row.title}`
        .toLowerCase()
        .includes(needle);
    });
  }, [query, snapshot.coverage]);
  const relevantManualPolicies = snapshot.manualPolicyBindings.filter((item) => item.activityVersionId === selectedActivityId);
  const relevantEvidencePolicies = snapshot.evidencePolicies.filter((item) => item.activityVersionId === selectedActivityId);
  const selectedBindings = selectedVersion
    ? snapshot.sourceBindings.filter((binding) => binding.workPackVersionId === selectedVersion.id)
    : [];
  const sourceTargetOptions = selectedVersion
    ? [
        { value: "work_pack", label: "Whole workflow" },
        ...selectedVersion.schema.sections.map((section) => ({ value: section.sectionKey, label: `Section: ${section.title}` })),
        ...selectedVersion.schema.sections.flatMap((section) => section.prompts.map((prompt) => ({ value: prompt.promptKey, label: `Question: ${prompt.label}` }))),
        ...selectedVersion.schema.sections.flatMap((section) => section.prompts.flatMap((prompt) => prompt.attestation ? [{ value: prompt.attestation.sourceBindingTargetKey, label: `Declaration: ${prompt.label}` }] : [])),
        ...selectedVersion.schema.sections.flatMap((section) => section.prompts.flatMap((prompt) => prompt.referenceDocument ? [{ value: prompt.referenceDocument.sourceBindingTargetKey, label: `Document: ${prompt.label}` }] : [])),
        ...selectedVersion.schema.dependencies.map((dependency) => ({ value: dependency.dependencyKey, label: `${stateLabel(dependency.kind)}: ${dependency.label}` })),
      ].filter((option, index, items) => option.value && items.findIndex((item) => item.value === option.value) === index)
    : [];
  const sourceCustodyQueue = custodySources.filter(
    (item) => item.artifactDecision !== "approved",
  );
  const pendingCalculatorReviews = snapshot.calculatorReviews.filter(
    (item) => item.status === "pending_review",
  );

  function beginNewDraft() {
    if (!selectedActivity) return;
    const nextVersion = activityVersions.length
      ? Math.max(...activityVersions.map((version) => version.version)) + 1
      : 1;
    setDraft({
      id: "",
      expectedSchemaSha256: "",
      activityVersionId: selectedActivity.id,
      manualPolicyBindingId: relevantManualPolicies[0]?.id || "",
      evidencePolicyVersionId: relevantEvidencePolicies[0]?.id || "",
      originKind: "manual",
      sourceBindingMap: [],
      candidateBlockers: [],
      schema: emptySchema(selectedActivity, nextVersion),
    });
    setError("");
    setStatus("New draft opened. It is not visible to trade accounts until independently reviewed and published.");
  }

  async function beginSourcedDraft() {
    if (
      !selectedActivity
      || !selectedContentCandidate
      || selectedContentCandidate.draftCreationState === "not_available"
    ) return;
    setBusy(true);
    setError("");
    setStatus("Creating the governed source-backed draft...");
    const clientRequestId = sourcedDraftRequestIds.current.get(
      selectedActivity.id,
    ) || `forms-sourced-draft:${crypto.randomUUID()}`;
    sourcedDraftRequestIds.current.set(selectedActivity.id, clientRequestId);
    try {
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({
          action: "create_sourced_draft",
          activityVersionId: selectedActivity.id,
          clientRequestId,
        }),
      });
      const next = parseSnapshot(result);
      const savedId = text(result.savedVersionId);
      const saved = next.versions.find((version) => version.id === savedId);
      if (!saved || saved.originKind !== "source_candidate") {
        throw new Error("The server did not return the governed source-backed draft.");
      }
      sourcedDraftRequestIds.current.delete(selectedActivity.id);
      setSnapshot(next);
      editVersion(saved);
      setStatus("Governed source-backed draft saved and opened for editing. Its exact candidate, blocker and source map are retained. It is not reviewed, published or active for trade accounts.");
    } catch (saveError) {
      setError(saveError instanceof Error
        ? saveError.message
        : "The governed source-backed draft could not be created.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function editVersion(version: WorkPackVersion, clone = false) {
    const cloneManualPolicy = snapshot.manualPolicyBindings.find((policy) =>
      policy.activityVersionId === version.activityVersionId
    )?.id || "";
    const cloneEvidencePolicy = snapshot.evidencePolicies.find((policy) =>
      policy.activityVersionId === version.activityVersionId
    )?.id || "";
    setSelectedActivityId(version.activityVersionId);
    setSelectedVersionId(version.id);
    setDraft({
      id: clone ? "" : version.id,
      expectedSchemaSha256: clone ? "" : version.schemaSha256,
      activityVersionId: version.activityVersionId,
      manualPolicyBindingId: clone
        ? cloneManualPolicy
        : version.manualPolicyBindingId,
      evidencePolicyVersionId: clone
        ? cloneEvidencePolicy
        : version.evidencePolicyVersionId,
      originKind: clone ? "manual" : version.originKind,
      sourceBindingMap: clone ? [] : version.sourceBindingMap,
      candidateBlockers: clone ? [] : version.candidateBlockers,
      schema: {
        ...cloneSchema(version.schema),
        version: clone ? version.version + 1 : version.version,
        catalogueReviewedOn: clone ? new Date().toISOString().slice(0, 10) : version.schema.catalogueReviewedOn,
      },
    });
    setStatus(clone ? "A new draft version was created locally from the selected version." : "Draft opened for editing.");
    setError("");
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    setError("");
    setStatus("Validating and saving the governed draft...");
    try {
      const body = JSON.stringify({
        action: draft.id ? "update_draft" : "create_draft",
        id: draft.id || undefined,
        expectedSchemaSha256: draft.expectedSchemaSha256 || undefined,
        activityVersionId: draft.activityVersionId,
        schema: draft.schema,
        manualPolicyBindingId: draft.manualPolicyBindingId,
        evidencePolicyVersionId: draft.evidencePolicyVersionId,
        effectiveFrom: draft.schema.effectiveFrom,
        effectiveTo: draft.schema.effectiveTo,
      });
      const result = await api(endpoint, {
        method: draft.id ? "PUT" : "POST",
        body,
      });
      const next = parseSnapshot(result);
      setSnapshot(next);
      const savedId = text(result.savedVersionId);
      if (savedId) setSelectedVersionId(savedId);
      setDraft(null);
      setStatus("Draft saved. Trade accounts still cannot see or alter it.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The governed draft could not be saved.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function openGovernanceAction(action: GovernanceAction) {
    setGovernanceAction(action);
    setGovernanceComment("");
    setError("");
  }

  async function submitGovernanceAction() {
    if (!governanceAction || governanceComment.trim().length < 10) return;
    setBusy(true);
    setError("");
    setStatus(`${governanceAction.title} in progress...`);
    try {
      const result = await api(endpoint, {
        method: "PATCH",
        body: JSON.stringify({
          action: governanceAction.action,
          id: governanceAction.action === "review_calculation_run"
            ? undefined
            : governanceAction.id,
          calculationRunId: governanceAction.action === "review_calculation_run"
            ? governanceAction.id
            : undefined,
          expectedSchemaSha256: governanceAction.expectedSchemaSha256 || undefined,
          decision: governanceAction.decision,
          comment: governanceComment.trim(),
        }),
      });
      setSnapshot(parseSnapshot(result));
      setGovernanceAction(null);
      setGovernanceComment("");
      setStatus(`${governanceAction.title} was recorded in the governance history.`);
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : "The governance state could not be changed.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function addSourceBinding(version: WorkPackVersion) {
    if (!newSourceBinding.sourceArtifactId || !newSourceBinding.targetKey.trim() || !newSourceBinding.citationLocation.trim()) return;
    setBusy(true);
    setError("");
    setStatus("Attaching the exact source citation...");
    try {
      const result = await api(endpoint, {
        method: "PATCH",
        body: JSON.stringify({
          action: "add_source_binding",
          id: version.id,
          expectedSchemaSha256: version.schemaSha256,
          sourceArtifactId: newSourceBinding.sourceArtifactId,
          sourceRole: newSourceBinding.sourceRole,
          targetKey: newSourceBinding.targetKey.trim(),
          citationLocation: newSourceBinding.citationLocation.trim(),
        }),
      });
      setSnapshot(parseSnapshot(result));
      setNewSourceBinding(EMPTY_SOURCE_BINDING);
      setStatus("Source citation attached and waiting for independent review.");
    } catch (sourceError) {
      setError(sourceError instanceof Error ? sourceError.message : "The source citation could not be attached.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function uploadSourceDocument() {
    if (
      !canCaptureSource
      || !sourceFile
      || !sourceUpload.sourceUrl.trim()
      || !sourceUpload.sourceTitle.trim()
    ) return;
    setBusy(true);
    setError("");
    setStatus("Retaining the exact official document for independent review...");
    try {
      const form = new FormData();
      form.set("clientRequestId", sourceUpload.clientRequestId);
      form.set("sourceUrl", sourceUpload.sourceUrl.trim());
      form.set("sourceTitle", sourceUpload.sourceTitle.trim());
      form.set("sourceVersion", sourceUpload.sourceVersion.trim());
      form.set("assertedRetrievedAt", new Date().toISOString());
      form.set("sourceFile", sourceFile);
      await api(sourceEndpoint, { method: "POST", body: form });
      await load();
      setSourceUpload(newSourceUploadDraft());
      setSourceFile(null);
      setSourceUploadOpen(false);
      setStatus(
        "Document retained once and queued for independent Creditex artifact review. It cannot be attached to a workflow until approved.",
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error
        ? uploadError.message
        : "The official document could not be retained safely.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function openRetainedSource(artifact: SourceArtifact) {
    setOpeningSourceId(artifact.id);
    setError("");
    try {
      await onDownloadSource(artifact.id, artifact.originalFileName);
      setStatus("The exact retained document passed its custody check and was opened.");
    } catch (openError) {
      setError(openError instanceof Error
        ? openError.message
        : "The exact retained document could not be opened safely.");
      setStatus("");
    } finally {
      setOpeningSourceId("");
    }
  }

  function updateSchema(patch: Partial<CreditexActivityWorkPack>) {
    setDraft((current) => current ? { ...current, schema: { ...current.schema, ...patch } } : current);
  }

  function updateSection(index: number, nextSection: CreditexWorkPackSection) {
    if (!draft) return;
    updateSchema({ sections: draft.schema.sections.map((section, position) => position === index ? nextSection : section) });
  }

  return (
    <section className={styles.workspace} aria-label={`${contextLabel} compliance form governance`}>
      <header className={styles.heading}>
        <div>
          <span>Governed activity workflows</span>
          <h2>Compliance forms</h2>
          <p>Build, review and attach reusable activity-specific technician workflows. Published versions are immutable and jobs keep the version they received. Each job instance receives its server-resolved provider, installer business and assigned technician identities separately.</p>
        </div>
        <dl>
          <div><dt>Current catalogue</dt><dd>{snapshot.coverage.length}</dd></div>
          <div><dt>Authorable versions</dt><dd>{snapshot.activities.length}</dd></div>
          <div><dt>Published-ready</dt><dd>{snapshot.coverage.filter((item) => item.ready).length}</dd></div>
          <div><dt>Coverage gaps</dt><dd>{snapshot.coverage.filter((item) => !item.ready).length}</dd></div>
          <div><dt>Calculations to review</dt><dd>{pendingCalculatorReviews.length}</dd></div>
        </dl>
      </header>

      {(status || error) && <div className={error ? styles.error : styles.status} role={error ? "alert" : "status"}>{error || status}</div>}

      <CreditexOfficialSourceBatchAcquisition
        api={api}
        endpoint={sourceBatchEndpoint}
        canImport={canCaptureSource && snapshot.access.canAuthor}
        onImported={load}
      />

      {pendingCalculatorReviews.length ? (
        <section className={`${styles.builderSection} ${styles.calculationReviewQueue}`} aria-labelledby="work-pack-calculation-review-title">
          <header>
            <div>
              <h4 id="work-pack-calculation-review-title">Independent calculation review</h4>
              <p>The technician cannot see or use a program quantity until a different authorised reviewer reruns and approves the exact inputs, source, calculator version, engine receipt and output hash.</p>
            </div>
            <strong>{pendingCalculatorReviews.length} pending</strong>
          </header>
          <div className={styles.calculationReviewRows}>
            {pendingCalculatorReviews.map((review) => (
              <article key={review.calculationRunId}>
                <div>
                  <strong>{review.calculatorKey} {review.calculatorVersion ? `v${review.calculatorVersion}` : ""}</strong>
                  <small>Job {review.workOrderId} | {review.dependencyKey} | run {dateTime(review.runAt)}</small>
                </div>
                <div className={styles.calculationHashes}>
                  <small>Input {review.inputSha256}</small>
                  <small>Output {review.outputSha256}</small>
                </div>
                {snapshot.access.canReview ? <div className={styles.versionActions}>
                  <button type="button" disabled={busy} onClick={() => openGovernanceAction({ action: "review_calculation_run", id: review.calculationRunId, expectedSchemaSha256: "", decision: "approved", title: "Approve governed calculation" })}>Approve exact run</button>
                  <button type="button" disabled={busy} onClick={() => openGovernanceAction({ action: "review_calculation_run", id: review.calculationRunId, expectedSchemaSha256: "", decision: "rejected", title: "Reject governed calculation" })}>Reject</button>
                </div> : <small>Independent review permission required.</small>}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className={styles.layout}>
        <aside className={styles.activityRail}>
          <label>
            Find activity
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Program, activity or title" />
          </label>
          <nav aria-label="Activity compliance forms">
            {filteredActivities.map((activity) => {
              const row = snapshot.coverage.find((item) => item.activityVersionId === activity.id);
              return (
                <button key={activity.id} type="button" data-selected={selectedActivityId === activity.id} onClick={() => {
                  setSelectedActivityId(activity.id);
                  const first = snapshot.versions.find((version) => version.activityVersionId === activity.id);
                  setSelectedVersionId(first?.id || "");
                  setDraft(null);
                }}>
                  <span>{activity.programCode} {activity.activityCode}</span>
                  <strong>{activity.title}</strong>
                  <small data-ready={row?.ready}>{row?.ready ? "Published and complete" : `${row?.blockers.length || 1} coverage gap(s)`}</small>
                </button>
              );
            })}
            {missingActivityVersions.map((row) => (
              <div key={row.activityTemplateId} className={styles.unregisteredActivity}>
                <span>{row.programCode} {row.activityCode}</span>
                <strong>{row.title}</strong>
                <small>{row.blockers.includes("current_activity_version_required")
                  ? "Current governed activity version required"
                  : `${row.blockers.length || 1} coverage gap(s)`}</small>
              </div>
            ))}
          </nav>
        </aside>

        <main className={styles.main}>
          {selectedActivity ? (
            <>
              <header className={styles.activityHeading}>
                <div>
                  <span>{selectedActivity.programCode} {selectedActivity.activityCode}</span>
                  <h3>{selectedActivity.title}</h3>
                  <p>Effective {selectedActivity.effectiveFrom || "not recorded"} to {selectedActivity.effectiveTo || "open ended"}</p>
                </div>
                {snapshot.access.canAuthor && (
                  <div className={styles.activityActions}>
                    <button type="button" onClick={beginNewDraft}>New blank draft</button>
                    <button
                      type="button"
                      disabled={busy || !selectedContentCandidate || selectedContentCandidate.draftCreationState === "not_available"}
                      onClick={() => void beginSourcedDraft()}
                    >
                      {busy
                        ? "Saving guided draft..."
                        : selectedContentCandidate?.draftCreationState === "source_bound_guided_capture"
                        ? "Create guided draft"
                        : selectedContentCandidate?.draftCreationState === "source_backed_review_draft"
                        ? "Create source-backed review draft"
                        : "Guided draft unavailable"}
                    </button>
                  </div>
                )}
              </header>

              {selectedContentCandidate ? (
                <CandidateContentPanel candidate={selectedContentCandidate} />
              ) : (
                <section className={styles.coverageWarning}>
                  <strong>No current source-backed content candidate matches this activity version.</strong>
                  <p>A draft cannot be preloaded until the activity identity matches the governed 192-activity catalogue.</p>
                </section>
              )}

              {coverage && !coverage.ready && (
                <section className={styles.coverageWarning}>
                  <strong>This activity is not ready for compliant field completion.</strong>
                  <ul>{coverage.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                </section>
              )}

              <section className={styles.versionRegister}>
                <header><h4>Version history</h4><span>{activityVersions.length} version(s)</span></header>
                {activityVersions.length ? activityVersions.map((version) => (
                  <article key={version.id} data-selected={selectedVersionId === version.id}>
                    <button type="button" className={styles.versionSummary} onClick={() => setSelectedVersionId(version.id)}>
                      <span>Version {version.version}</span>
                      <strong>{version.schema.title}</strong>
                      <small>{version.originKind === "source_candidate" ? "Source-backed candidate draft" : stateLabel(version.state)} | updated {dateTime(version.updatedAt)}</small>
                    </button>
                    <div className={styles.versionActions}>
                      <button type="button" onClick={() => { setSelectedVersionId(version.id); setPreviewOpen(true); }}>Preview</button>
                      {snapshot.access.canAuthor && version.state === "draft" && <button type="button" onClick={() => editVersion(version)}>Edit draft</button>}
                      {snapshot.access.canAuthor && <button type="button" onClick={() => editVersion(version, true)}>Clone</button>}
                      {snapshot.access.canPublish && version.state === "draft" && version.originKind === "manual" && <button type="button" disabled={busy} onClick={() => openGovernanceAction({ action: "publish_version", id: version.id, expectedSchemaSha256: version.schemaSha256, title: `Publish version ${version.version}` })}>Review and publish</button>}
                      {snapshot.access.canWithdraw && version.state === "published" && <button type="button" disabled={busy} onClick={() => openGovernanceAction({ action: "withdraw_version", id: version.id, expectedSchemaSha256: "", title: `Withdraw version ${version.version}` })}>Withdraw</button>}
                      {snapshot.access.canAuthor && version.state === "draft" && <button type="button" disabled={busy} onClick={() => openGovernanceAction({ action: "abandon_draft", id: version.id, expectedSchemaSha256: version.schemaSha256, title: `Abandon version ${version.version} draft` })}>Abandon</button>}
                    </div>
                  </article>
                )) : <div className={styles.empty}><strong>No governed workflow attached</strong><p>Create the first source-bound draft for this activity.</p></div>}
              </section>

              {selectedVersion && (
                <section className={styles.builderSection} aria-labelledby="work-pack-source-register-title">
                  <header>
                    <div>
                      <h4 id="work-pack-source-register-title">Exact source documents and citations</h4>
                      <p>Each citation is independently reviewed against the exact saved workflow hash. Editing the workflow requires fresh source review.</p>
                    </div>
                    <strong>{selectedBindings.filter((binding) => binding.state === "approved").length} approved</strong>
                  </header>
                  {canCaptureSource && snapshot.access.canAuthor ? (
                    <div className={styles.sourceLibraryControls}>
                      <div>
                        <strong>Add an official document</strong>
                        <p>
                          Retain one exact government file now. A different
                          verified Creditex administrator must approve the
                          artifact before it becomes selectable below.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setSourceUploadOpen((current) => !current)}
                      >
                        {sourceUploadOpen ? "Close upload" : "Upload document"}
                      </button>
                    </div>
                  ) : null}
                  {sourceUploadOpen && canCaptureSource && snapshot.access.canAuthor ? (
                    <form
                      className={`${styles.formGrid} ${styles.sourceUploadForm}`}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void uploadSourceDocument();
                      }}
                    >
                      <label className={styles.wide}>
                        Official government source URL
                        <input
                          required
                          type="url"
                          inputMode="url"
                          value={sourceUpload.sourceUrl}
                          onChange={(event) => setSourceUpload((current) => ({
                            ...current,
                            sourceUrl: event.target.value,
                          }))}
                          placeholder="Paste the current official source URL"
                        />
                      </label>
                      <label>
                        Document title
                        <input
                          required
                          maxLength={500}
                          value={sourceUpload.sourceTitle}
                          onChange={(event) => setSourceUpload((current) => ({
                            ...current,
                            sourceTitle: event.target.value,
                          }))}
                        />
                      </label>
                      <label>
                        Published version or date, optional
                        <input
                          maxLength={240}
                          value={sourceUpload.sourceVersion}
                          onChange={(event) => setSourceUpload((current) => ({
                            ...current,
                            sourceVersion: event.target.value,
                          }))}
                        />
                      </label>
                      <label className={styles.wide}>
                        Exact downloaded file, maximum 15 MB
                        <input
                          required
                          type="file"
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.json,.xml,.html,.htm,.txt,.csv"
                          onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busy || !sourceFile}
                      >
                        {busy ? "Retaining document..." : "Retain for review"}
                      </button>
                    </form>
                  ) : null}
                  {sourceCustodyQueue.length ? (
                    <div className={styles.sourceCustodyQueue}>
                      <strong>Source custody queue</strong>
                      <p>
                        These files are visible for governance but remain
                        unavailable to workflow authors until artifact approval.
                      </p>
                      <div className={styles.compactRows}>
                        {sourceCustodyQueue.map((item) => (
                          <article key={item.artifact.id}>
                            <div>
                              <strong>{item.artifact.title || item.artifact.originalFileName}</strong>
                              <small>
                                {stateLabel(item.artifactDecision)} | {item.artifact.originalFileName}
                              </small>
                            </div>
                            <button
                              type="button"
                              disabled={openingSourceId === item.artifact.id}
                              onClick={() => void openRetainedSource(item.artifact)}
                            >
                              {openingSourceId === item.artifact.id
                                ? "Checking..."
                                : "Open retained document"}
                            </button>
                            {item.artifact.sourceUrl ? (
                              <a href={item.artifact.sourceUrl} target="_blank" rel="noreferrer">
                                Current government source
                              </a>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {selectedVersion.originKind === "source_candidate" ? (
                    <div className={styles.sourceCustodyQueue}>
                      <strong>Retained source-candidate map</strong>
                      <p>
                        This immutable map records the exact official source
                        identity and workflow target used to create the draft.
                        Artifact review shown here is custody evidence only; it
                        is not workflow approval or publication.
                      </p>
                      <div className={styles.compactRows}>
                        {selectedVersion.sourceBindingMap.map((binding) => (
                          <article key={`${binding.sourceId}-${binding.sourceRole}-${binding.targetKey}-${binding.citationLocation}`}>
                            <div>
                              <strong>{binding.sourceTitle}</strong>
                              <small>{stateLabel(binding.sourceRole)} | {binding.targetKey} | {binding.citationLocation}</small>
                              <small>
                                {binding.sourceId} | expected {binding.expectedSha256.slice(0, 12)}...
                                {` | ${stateLabel(binding.artifactReviewState)}`}
                              </small>
                            </div>
                            <a href={binding.officialUrl} target="_blank" rel="noreferrer">
                              Current government source
                            </a>
                          </article>
                        ))}
                      </div>
                      <div className={styles.blockerList}>
                        <h5>Still blocked from publication and activation</h5>
                        <ul>{selectedVersion.candidateBlockers.map((blocker) => (
                          <li key={blocker.code}>
                            <strong>{blocker.code}</strong>
                            <span>{blocker.detail}</span>
                          </li>
                        ))}</ul>
                      </div>
                    </div>
                  ) : null}
                  {selectedBindings.length ? <div className={styles.compactRows}>
                    {selectedBindings.map((binding) => {
                      const artifact = snapshot.sourceArtifacts.find((item) => item.id === binding.sourceArtifactId);
                      return <article key={binding.id}>
                        <div>
                          <strong>{artifact?.title || artifact?.originalFileName || "Governed source document"}</strong>
                          <small>{stateLabel(binding.sourceRole)} | {binding.targetKey} | {binding.citationLocation}</small>
                          <small>{stateLabel(binding.state)}{binding.reviewedByName ? ` by ${binding.reviewedByName}` : ""}</small>
                        </div>
                        {artifact ? (
                          <button
                            type="button"
                            disabled={openingSourceId === artifact.id}
                            onClick={() => void openRetainedSource(artifact)}
                          >
                            {openingSourceId === artifact.id
                              ? "Checking..."
                              : "Open retained document"}
                          </button>
                        ) : null}
                        {artifact?.sourceUrl ? <a href={artifact.sourceUrl} target="_blank" rel="noreferrer">Current government source</a> : null}
                        {snapshot.access.canReview && binding.state === "pending_review" ? <>
                          <button type="button" disabled={busy} onClick={() => openGovernanceAction({ action: "review_source_binding", id: binding.id, expectedSchemaSha256: binding.schemaSha256, decision: "approved", title: "Approve source citation" })}>Approve</button>
                          <button type="button" disabled={busy} onClick={() => openGovernanceAction({ action: "review_source_binding", id: binding.id, expectedSchemaSha256: binding.schemaSha256, decision: "rejected", title: "Reject source citation" })}>Reject</button>
                        </> : null}
                        {snapshot.access.canWithdraw && binding.state === "approved" ? <button type="button" disabled={busy} onClick={() => openGovernanceAction({ action: "withdraw_source_binding", id: binding.id, expectedSchemaSha256: "", title: "Withdraw source citation" })}>Withdraw citation</button> : null}
                      </article>;
                    })}
                  </div> : <div className={styles.empty}><strong>No exact source citations attached</strong><p>This draft cannot be published until its governing requirements and every required dependency are source-bound and independently approved.</p></div>}
                  {snapshot.access.canAuthor && selectedVersion.state === "draft" && selectedVersion.originKind === "manual" ? <form className={styles.formGrid} onSubmit={(event) => { event.preventDefault(); void addSourceBinding(selectedVersion); }}>
                    <label className={styles.wide}>Approved official document<select required value={newSourceBinding.sourceArtifactId} onChange={(event) => setNewSourceBinding((current) => ({ ...current, sourceArtifactId: event.target.value }))}><option value="">Choose an exact approved source</option>{snapshot.sourceArtifacts.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifact.title || artifact.originalFileName} | {artifact.version || artifact.sha256.slice(0, 12)}</option>)}</select></label>
                    <label>Source role<select value={newSourceBinding.sourceRole} onChange={(event) => setNewSourceBinding((current) => ({ ...current, sourceRole: event.target.value as WorkPackSourceBinding["sourceRole"] }))}><option value="requirement">Requirement</option><option value="product">Product</option><option value="scenario">Scenario</option><option value="calculator">Calculator</option></select></label>
                    <label>Workflow target<select required value={newSourceBinding.targetKey} onChange={(event) => setNewSourceBinding((current) => ({ ...current, targetKey: event.target.value }))}>{sourceTargetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    <label className={styles.wide}>Exact citation location<input required maxLength={500} value={newSourceBinding.citationLocation} onChange={(event) => setNewSourceBinding((current) => ({ ...current, citationLocation: event.target.value }))} placeholder="Section, clause, page, table or paragraph" /></label>
                    <button type="submit" disabled={busy || !newSourceBinding.sourceArtifactId || !newSourceBinding.citationLocation.trim()}>Attach citation for review</button>
                  </form> : null}
                </section>
              )}

              {draft && (
                <form className={styles.builder} onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
                  <header>
                    <div><span>{draft.id ? "Edit governed draft" : "New governed version"}</span><h3>{draft.schema.title}</h3></div>
                    <div><button type="button" onClick={() => setPreviewOpen(true)}>Preview</button><button type="button" onClick={() => setDraft(null)}>Close draft</button></div>
                  </header>

                  <section className={styles.builderSection}>
                    <h4>Identity and effective dates</h4>
                    <div className={styles.formGrid}>
                      <label className={styles.wide}>Workflow title<input required value={draft.schema.title} onChange={(event) => updateSchema({ title: event.target.value })} /></label>
                      <label>Version<input type="number" readOnly value={draft.schema.version} /></label>
                      <label>Catalogue reviewed on<input required type="date" value={draft.schema.catalogueReviewedOn} onChange={(event) => updateSchema({ catalogueReviewedOn: event.target.value })} /></label>
                      <label>Effective from<input required type="date" data-date-range-group={`creditex-work-pack-${draft.activityVersionId}-${draft.schema.version}`} data-date-range-role="start" value={draft.schema.effectiveFrom} onChange={(event) => updateSchema({ effectiveFrom: event.target.value })} /></label>
                      <label>Effective to<input type="date" data-date-range-group={`creditex-work-pack-${draft.activityVersionId}-${draft.schema.version}`} data-date-range-role="end" value={draft.schema.effectiveTo} onChange={(event) => updateSchema({ effectiveTo: event.target.value })} /></label>
                    </div>
                  </section>

                  <section className={styles.builderSection}>
                    <h4>Exact governed sources and policies</h4>
                    {draft.originKind === "source_candidate" ? (
                      <div className={styles.coverageWarning}>
                        <strong>Source-backed authoring candidate</strong>
                        <p>
                          The server retained this draft&apos;s exact current
                          candidate, source-target map and blockers. It can be
                          edited and saved, but cannot be reviewed or published
                          from this candidate record. Create a manual governed
                          version when exact policies and independently reviewed
                          citations are ready.
                        </p>
                      </div>
                    ) : (
                      <>
                        <p>A version cannot be published until its source citations, evidence policy and manual policy are independently approved and exact. Save the draft first, then attach citations to its stable saved hash.</p>
                        <div className={styles.formGrid}>
                          <label>Manual policy composition<select required value={draft.manualPolicyBindingId} onChange={(event) => setDraft({ ...draft, manualPolicyBindingId: event.target.value })}><option value="">Choose approved policy</option>{relevantManualPolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.title} v{policy.version}</option>)}</select></label>
                          <label>Evidence policy<select required value={draft.evidencePolicyVersionId} onChange={(event) => setDraft({ ...draft, evidencePolicyVersionId: event.target.value })}><option value="">Choose published policy</option>{relevantEvidencePolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.title} v{policy.version}</option>)}</select></label>
                        </div>
                      </>
                    )}
                  </section>

                  <section className={styles.builderSection}>
                    <header><div><h4>Workflow stages</h4><p>Organise the technician journey into clear arrival, before, installation, after and sign-off stages.</p></div><button type="button" onClick={() => updateSchema({ stages: [...draft.schema.stages, newStage(nextOrder(draft.schema.stages))] })}>Add stage</button></header>
                    <div className={styles.compactRows}>
                      {draft.schema.stages.map((stage, index) => <article key={`${stage.stageKey}-${index}`}><label>Key<input value={stage.stageKey} onChange={(event) => updateSchema({ stages: draft.schema.stages.map((item, position) => position === index ? { ...item, stageKey: slug(event.target.value, `stage_${index + 1}`) } : item) })} /></label><label>Label<input value={stage.label} onChange={(event) => updateSchema({ stages: draft.schema.stages.map((item, position) => position === index ? { ...item, label: event.target.value } : item) })} /></label><label>Description<input value={stage.description} onChange={(event) => updateSchema({ stages: draft.schema.stages.map((item, position) => position === index ? { ...item, description: event.target.value } : item) })} /></label><button type="button" disabled={draft.schema.stages.length === 1} onClick={() => updateSchema({ stages: draft.schema.stages.filter((_, position) => position !== index) })}>Remove</button></article>)}
                    </div>
                  </section>

                  <section className={styles.builderSection}>
                    <header><div><h4>Signer roles</h4><p>Each signature binds the exact declaration, signer identity, response snapshot and device context.</p></div><button type="button" onClick={() => updateSchema({ signerRoles: [...draft.schema.signerRoles, newSignerRole(draft.schema.signerRoles.length + 1)] })}>Add signer role</button></header>
                    <div className={styles.compactRows}>
                      {draft.schema.signerRoles.map((role, index) => <article key={`${role.roleKey}-${index}`}>
                        <label>Role key<input value={role.roleKey} onChange={(event) => updateSchema({ signerRoles: draft.schema.signerRoles.map((item, position) => position === index ? { ...item, roleKey: slug(event.target.value, `signer_${index + 1}`) } : item) })} /></label>
                        <label>Label<input value={role.label} onChange={(event) => updateSchema({ signerRoles: draft.schema.signerRoles.map((item, position) => position === index ? { ...item, label: event.target.value } : item) })} /></label>
                        <label>Capacity<input value={role.capacity} onChange={(event) => updateSchema({ signerRoles: draft.schema.signerRoles.map((item, position) => position === index ? { ...item, capacity: event.target.value } : item) })} placeholder="Customer, installer, licensed electrician" /></label>
                        <label>Identity comes from<select value={role.identitySource} onChange={(event) => updateSchema({ signerRoles: draft.schema.signerRoles.map((item, position) => position === index ? { ...item, identitySource: event.target.value as CreditexWorkPackSignerRole["identitySource"] } : item) })}><option value="customer_context">Customer record</option><option value="assigned_worker">Assigned technician</option><option value="authenticated_actor">Signed-in compliance user</option><option value="manual_verified">Manually verified person</option></select></label>
                        <label>Minimum signatures<input type="number" min="0" max="20" value={role.minimumSignatures} onChange={(event) => updateSchema({ signerRoles: draft.schema.signerRoles.map((item, position) => position === index ? { ...item, minimumSignatures: Number(event.target.value) } : item) })} /></label>
                        <label>Maximum signatures<input type="number" min="1" max="20" value={role.maximumSignatures} onChange={(event) => updateSchema({ signerRoles: draft.schema.signerRoles.map((item, position) => position === index ? { ...item, maximumSignatures: Number(event.target.value) } : item) })} /></label>
                        <label>Identity fields<textarea rows={3} value={role.identityRequirements.map((requirement) => `${requirement.fieldKey} | ${requirement.label} | ${requirement.required ? "required" : "optional"}`).join("\n")} onChange={(event) => updateSchema({ signerRoles: draft.schema.signerRoles.map((item, position) => position === index ? { ...item, identityRequirements: event.target.value.split("\n").map((line, lineIndex) => { const [fieldKey, label, required] = line.split("|").map((value) => value.trim()); return { fieldKey: slug(fieldKey || "", `field_${lineIndex + 1}`), label: label || fieldKey || `Field ${lineIndex + 1}`, required: required !== "optional" }; }).filter((requirement) => requirement.fieldKey && requirement.label) } : item) })} /></label>
                        <button type="button" onClick={() => updateSchema({ signerRoles: draft.schema.signerRoles.filter((_, position) => position !== index) })}>Remove</button>
                      </article>)}
                    </div>
                  </section>

                  <section className={styles.builderSection}>
                    <header><div><h4>Product, scenario and calculator dependencies</h4><p>These references are checked by the server against current governed catalogues before the work pack can finish.</p></div><button type="button" onClick={() => {
                      const dependency: CreditexWorkPackDependency = { dependencyKey: `product_${draft.schema.dependencies.length + 1}`, kind: "product", label: "Product selection", required: true, registryCode: "", productKind: "not_applicable", productCategory: "", selectionMode: "single", minimumCount: 1, maximumCount: 1 };
                      updateSchema({ dependencies: [...draft.schema.dependencies, dependency] });
                    }}>Add dependency</button></header>
                    <div className={styles.compactRows}>
                      {draft.schema.dependencies.map((dependency, index) => <article key={`${dependency.dependencyKey}-${index}`}><label>Key<input value={dependency.dependencyKey} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...item, dependencyKey: slug(event.target.value, `dependency_${index + 1}`) } as CreditexWorkPackDependency : item) })} /></label><label>Kind<select value={dependency.kind} onChange={(event) => {
                        const kind = event.target.value;
                        const base = { dependencyKey: dependency.dependencyKey, label: dependency.label, required: dependency.required };
                        const next = kind === "product"
                          ? { ...base, kind: "product" as const, registryCode: "", productKind: "not_applicable" as const, productCategory: "", selectionMode: "single" as const, minimumCount: 1, maximumCount: 1 }
                          : kind === "scenario"
                          ? { ...base, kind: "scenario" as const, scenarioCodes: [], selectionMode: "single" as const }
                          : { ...base, kind: "calculator" as const, catalogueFormulaKey: "not_applicable", calculatorKey: "not_applicable", calculatorVersion: 1, requiredInputKeys: [] };
                        updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? next : item) });
                      }}><option value="product">Product</option><option value="scenario">Scenario</option><option value="calculator">Calculator</option></select></label>
                        <label>Label<input value={dependency.label} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...item, label: event.target.value } as CreditexWorkPackDependency : item) })} /></label>
                        <label className={styles.checkLabel}><input type="checkbox" checked={dependency.required} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...item, required: event.target.checked } as CreditexWorkPackDependency : item) })} />Required before completion</label>
                        {dependency.kind === "product" && <>
                          <label>Approved registry<input value={dependency.registryCode} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, registryCode: event.target.value } : item) })} /></label>
                          <label>Governed product type<select value={dependency.productKind} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, productKind: event.target.value as typeof dependency.productKind } : item) })}>
                            <option value="not_applicable">Not applicable</option>
                            {CREDITEX_OFFICIAL_PRODUCT_KINDS.map((productKind) => <option key={productKind} value={productKind}>{officialProductKindLabel(productKind)}</option>)}
                          </select></label>
                          <label>Product category<input value={dependency.productCategory} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, productCategory: event.target.value } : item) })} /></label>
                          <label>Selection<select value={dependency.selectionMode} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, selectionMode: event.target.value as "single" | "multiple", minimumCount: event.target.value === "single" ? Math.min(1, dependency.minimumCount) : dependency.minimumCount, maximumCount: event.target.value === "single" ? 1 : dependency.maximumCount } : item) })}><option value="single">One product</option><option value="multiple">Multiple products</option></select></label>
                          <label>Minimum products<input type="number" min="0" max="100" value={dependency.minimumCount} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, minimumCount: Number(event.target.value) } : item) })} /></label>
                          <label>Maximum products<input type="number" min="1" max="100" value={dependency.maximumCount} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, maximumCount: Number(event.target.value) } : item) })} /></label>
                        </>}
                        {dependency.kind === "scenario" && <>
                          <label>Scenario codes<input value={dependency.scenarioCodes.join(", ")} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, scenarioCodes: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } : item) })} /></label>
                          <label>Selection<select value={dependency.selectionMode} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, selectionMode: event.target.value as "single" | "multiple" } : item) })}><option value="single">One scenario</option><option value="multiple">Multiple scenarios</option></select></label>
                        </>}
                        {dependency.kind === "calculator" && <>
                          <label>Official catalogue formula identity<input value={dependency.catalogueFormulaKey} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, catalogueFormulaKey: event.target.value } : item) })} /></label>
                          <label>Executable calculator key<input value={dependency.calculatorKey} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, calculatorKey: event.target.value } : item) })} /></label>
                          <label>Executable calculator version<input type="number" min="1" max="1000000" value={dependency.calculatorVersion} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, calculatorVersion: Number(event.target.value) } : item) })} /></label>
                          <label>Required calculator inputs<textarea rows={3} value={dependency.requiredInputKeys.join(", ")} onChange={(event) => updateSchema({ dependencies: draft.schema.dependencies.map((item, position) => position === index ? { ...dependency, requiredInputKeys: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } : item) })} /></label>
                        </>}
                        <button type="button" onClick={() => updateSchema({ dependencies: draft.schema.dependencies.filter((_, position) => position !== index) })}>Remove</button>
                      </article>)}
                    </div>
                  </section>

                  <section className={styles.builderSection}>
                    <header><div><h4>Sections and questions</h4><p>Add, remove and reorder questions, evidence captures, documents and signatures. Conditional rules remain bound to stable keys.</p></div><button type="button" onClick={() => updateSchema({ sections: [...draft.schema.sections, newSection(nextOrder(draft.schema.sections), draft.schema.stages[0]?.stageKey || "stage_1")] })}>Add section</button></header>
                    <div className={styles.sectionEditors}>
                      {draft.schema.sections.map((section, sectionIndex) => (
                        <article key={`${section.sectionKey}-${sectionIndex}`} className={styles.sectionEditor}>
                          <header>
                            <div><span>Section {sectionIndex + 1}</span><strong>{section.title}</strong></div>
                            <div><button type="button" disabled={sectionIndex === 0} onClick={() => updateSchema({ sections: normaliseOrders(move(draft.schema.sections, sectionIndex, -1)) })}>↑</button><button type="button" disabled={sectionIndex === draft.schema.sections.length - 1} onClick={() => updateSchema({ sections: normaliseOrders(move(draft.schema.sections, sectionIndex, 1)) })}>↓</button><button type="button" disabled={draft.schema.sections.length === 1} onClick={() => updateSchema({ sections: normaliseOrders(draft.schema.sections.filter((_, position) => position !== sectionIndex)) })}>Remove section</button></div>
                          </header>
                          <div className={styles.formGrid}>
                            <label>Section key<input value={section.sectionKey} onChange={(event) => updateSection(sectionIndex, { ...section, sectionKey: slug(event.target.value, `section_${sectionIndex + 1}`) })} /></label>
                            <label>Title<input value={section.title} onChange={(event) => updateSection(sectionIndex, { ...section, title: event.target.value })} /></label>
                            <label className={styles.wide}>Guidance<textarea rows={2} value={section.description} onChange={(event) => updateSection(sectionIndex, { ...section, description: event.target.value })} /></label>
                            <label className={styles.checkLabel}><input type="checkbox" checked={Boolean(section.repeatability)} onChange={(event) => updateSection(sectionIndex, { ...section, repeatability: event.target.checked ? { itemKey: "item", itemLabel: "Item", minimumInstances: 0, maximumInstances: 25 } : null })} />Repeat this section for multiple products or activities</label>
                            {section.repeatability ? <>
                              <label>Repeated item key<input value={section.repeatability.itemKey} onChange={(event) => updateSection(sectionIndex, { ...section, repeatability: { ...section.repeatability!, itemKey: slug(event.target.value, "item") } })} /></label>
                              <label>Repeated item label<input value={section.repeatability.itemLabel} onChange={(event) => updateSection(sectionIndex, { ...section, repeatability: { ...section.repeatability!, itemLabel: event.target.value } })} /></label>
                              <label>Minimum items<input type="number" min="0" max="100" value={section.repeatability.minimumInstances} onChange={(event) => updateSection(sectionIndex, { ...section, repeatability: { ...section.repeatability!, minimumInstances: Number(event.target.value) } })} /></label>
                              <label>Maximum items<input type="number" min="1" max="100" value={section.repeatability.maximumInstances} onChange={(event) => updateSection(sectionIndex, { ...section, repeatability: { ...section.repeatability!, maximumInstances: Number(event.target.value) } })} /></label>
                            </> : null}
                          </div>
                          <SectionVisibilityEditor
                            section={section}
                            earlierPromptKeys={draft.schema.sections.flatMap((candidateSection, candidateSectionIndex) => (
                              candidateSectionIndex < sectionIndex && !candidateSection.repeatability
                                ? candidateSection.prompts.map((prompt) => prompt.promptKey)
                                : []
                            ))}
                            onChange={(next) => updateSection(sectionIndex, next)}
                          />
                          <div className={styles.promptList}>
                            {section.prompts.map((prompt, promptIndex) => <PromptEditor key={`${prompt.promptKey}-${promptIndex}`} prompt={prompt} stageKeys={draft.schema.stages.map((stage) => stage.stageKey)} signerRoles={[...draft.schema.signerRoles]} dependencyKeys={draft.schema.dependencies.map((dependency) => dependency.dependencyKey)} conditionPromptKeys={draft.schema.sections.flatMap((candidateSection, candidateSectionIndex) => candidateSectionIndex < sectionIndex ? candidateSection.prompts.map((item) => item.promptKey) : candidateSectionIndex === sectionIndex ? candidateSection.prompts.slice(0, promptIndex).map((item) => item.promptKey) : [])} canMoveUp={promptIndex > 0} canMoveDown={promptIndex < section.prompts.length - 1} onMove={(direction) => updateSection(sectionIndex, { ...section, prompts: normaliseOrders(move(section.prompts, promptIndex, direction)) })} onRemove={() => updateSection(sectionIndex, { ...section, prompts: normaliseOrders(section.prompts.filter((_, position) => position !== promptIndex)) })} onChange={(next) => updateSection(sectionIndex, { ...section, prompts: section.prompts.map((item, position) => position === promptIndex ? next : item) })} />)}
                          </div>
                          <button type="button" onClick={() => updateSection(sectionIndex, { ...section, prompts: [...section.prompts, newPrompt(nextOrder(section.prompts), draft.schema.stages[0]?.stageKey || "stage_1")] })}>Add question, document or signature</button>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className={styles.builderSection}>
                    <CreditexWorkPackDocumentOutputEditor
                      value={draft.schema.documentOutputs}
                      prompts={draft.schema.sections.flatMap((section) => section.prompts)}
                      signerRoles={draft.schema.signerRoles}
                      onChange={(documentOutputs) => updateSchema({ documentOutputs: [...documentOutputs] })}
                    />
                  </section>

                  <footer className={styles.builderActions}>
                    <button type="button" onClick={() => setDraft(null)}>Cancel</button>
                    <button type="submit" disabled={busy}>Save governed draft</button>
                  </footer>
                </form>
              )}
            </>
          ) : <div className={styles.empty}><strong>No current activity was returned</strong><p>The forms register stays closed until the governed activity catalogue is available.</p></div>}
        </main>
      </div>

      {governanceAction && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !busy) setGovernanceAction(null);
        }}>
          <section className={styles.governanceDialog} role="dialog" aria-modal="true" aria-labelledby="work-pack-governance-action-title">
            <header>
              <div><span>Governance record</span><h2 id="work-pack-governance-action-title">{governanceAction.title}</h2></div>
              <button type="button" disabled={busy} onClick={() => setGovernanceAction(null)} aria-label="Close governance action">×</button>
            </header>
            <p>Record the evidence-based reason for this decision. The comment is retained with the immutable governance history.</p>
            <label>Review or decision note<textarea autoFocus required minLength={10} maxLength={2000} rows={5} value={governanceComment} onChange={(event) => setGovernanceComment(event.target.value)} /></label>
            <footer>
              <button type="button" disabled={busy} onClick={() => setGovernanceAction(null)}>Cancel</button>
              <button type="button" disabled={busy || governanceComment.trim().length < 10} onClick={() => void submitGovernanceAction()}>Record decision</button>
            </footer>
          </section>
        </div>
      )}

      {previewOpen && (draft || selectedVersion) && (
        <WorkPackPreview schema={draft?.schema || selectedVersion!.schema} onClose={() => setPreviewOpen(false)} />
      )}
    </section>
  );
}
