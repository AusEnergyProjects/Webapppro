import type { EnergyAssistantKnowledgeSource } from "../data/energy-assistant-knowledge.ts";
import {
  compareCapturedArtifactToBaseline,
  type OfficialSourceBaseline,
  type OfficialSourceCaptureOutcome,
} from "./energy-assistant-official-source-custody.ts";

export type OfficialSourceReviewReason = "change_detected" | "overdue" | "due_soon";

export type OfficialSourceReviewItem = {
  sourceId: string;
  title: string;
  url: string;
  reviewDue: string;
  volatilityClass: EnergyAssistantKnowledgeSource["volatilityClass"];
  reason: OfficialSourceReviewReason;
};

export type OfficialSourceApproval = {
  sourceId: string;
  evidenceRecordSha256: string;
  approvedBy: string;
  approvedOn: string;
  reviewDue: string;
  status: "approved";
};

export type OfficialSourceCustodyApproval = {
  sourceId: string;
  upstreamArtifactSha256: string;
  evidenceRecordSha256: string;
  preparedBy: string;
  approvedBy: string;
  approvedOn: string;
  reviewDue: string;
  status: "approved";
};

export type OfficialSourceCustodyState =
  | "fetch_failed"
  | "unreviewed"
  | "changed_pending_review"
  | "awaiting_approval"
  | "review_expired"
  | "approved_unchanged";

export type OfficialSourceCustodyAssessment = {
  sourceId: string;
  state: OfficialSourceCustodyState;
  mayAnswerCurrentFact: boolean;
  reason: string;
  observedSha256: string | null;
  baselineSha256: string | null;
};

export function canonicalOfficialSourceEvidence(source: EnergyAssistantKnowledgeSource) {
  return JSON.stringify({
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    topic: source.topic,
    audience: [...source.audience],
    jurisdiction: source.jurisdiction,
    effectiveFrom: source.effectiveFrom,
    effectiveTo: source.effectiveTo,
    reviewedAt: source.reviewedAt,
    reviewDue: source.reviewDue,
    reuseBasis: source.reuseBasis,
    volatilityClass: source.volatilityClass,
    storagePolicy: source.storagePolicy,
    official: source.official,
    summary: source.summary,
    keywords: [...source.keywords],
  });
}

function isoDay(value: Date | string) {
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(parsed.getTime())) throw new Error("A valid source review date is required.");
  return parsed.toISOString().slice(0, 10);
}

function dayDistance(from: string, to: string) {
  return Math.ceil((new Date(`${to}T00:00:00.000Z`).getTime()
    - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000);
}

function isSha256(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

function isIsoDayValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && isoDay(value) === value;
}

export function sourceMayAnswerCurrentFact(
  source: EnergyAssistantKnowledgeSource,
  asOf: Date | string = new Date(),
  changeDetected = false,
  approval?: OfficialSourceApproval,
  evidenceRecordSha256?: string,
) {
  const day = isoDay(asOf);
  if (!source.official || changeDetected) return false;
  if (source.effectiveFrom && source.effectiveFrom > day) return false;
  if (source.effectiveTo && source.effectiveTo < day) return false;
  if (source.reviewDue < day) return false;
  if (source.volatilityClass !== "volatile_program") return true;
  return approval?.status === "approved"
    && approval.sourceId === source.id
    && approval.reviewDue >= day
    && approval.reviewDue === source.reviewDue
    && approval.evidenceRecordSha256 === evidenceRecordSha256;
}

/**
 * Strict current-fact gate backed by upstream response bytes. Any changed,
 * missing, expired or non-independent evidence remains unavailable until a
 * human review updates both the immutable baseline and matching approval.
 */
export function assessOfficialSourceCustody(
  source: EnergyAssistantKnowledgeSource,
  capture: OfficialSourceCaptureOutcome,
  baseline: OfficialSourceBaseline | undefined,
  approval: OfficialSourceCustodyApproval | undefined,
  evidenceRecordSha256: string,
  asOf: Date | string = new Date(),
): OfficialSourceCustodyAssessment {
  const day = isoDay(asOf);
  const result = (
    state: OfficialSourceCustodyState,
    reason: string,
    observedSha256: string | null,
    baselineSha256: string | null,
  ): OfficialSourceCustodyAssessment => ({
    sourceId: source.id,
    state,
    mayAnswerCurrentFact: state === "approved_unchanged",
    reason,
    observedSha256,
    baselineSha256,
  });

  if (!source.official || capture.status === "fetch_failed") {
    return result("fetch_failed", capture.status === "fetch_failed" ? capture.message : "Source is not official.", null, baseline?.artifactSha256 || null);
  }
  if (!capture.metadata.ok) {
    return result(
      "fetch_failed",
      `Upstream returned HTTP ${capture.metadata.statusCode}.`,
      capture.metadata.sha256,
      baseline?.artifactSha256 || null,
    );
  }
  const comparison = compareCapturedArtifactToBaseline(capture, baseline);
  if (comparison.state === "baseline_missing") {
    return result("unreviewed", "No immutable reviewed upstream baseline exists.", capture.metadata.sha256, null);
  }
  if (comparison.state === "changed") {
    return result(
      "changed_pending_review",
      `Upstream evidence changed: ${comparison.reasons.join(", ")}.`,
      capture.metadata.sha256,
      comparison.baselineSha256,
    );
  }
  if (
    (source.effectiveFrom && source.effectiveFrom > day)
    || (source.effectiveTo && source.effectiveTo < day)
    || source.reviewDue < day
    || (approval && approval.reviewDue < day)
  ) {
    return result("review_expired", "The source or approval is outside its effective review window.", capture.metadata.sha256, comparison.baselineSha256);
  }
  const preparedBy = approval?.preparedBy.trim().toLowerCase();
  const approvedBy = approval?.approvedBy.trim().toLowerCase();
  const baselineCaptureDay = baseline!.capturedAt.slice(0, 10);
  if (
    approval?.status !== "approved"
    || approval.sourceId !== source.id
    || approval.upstreamArtifactSha256 !== capture.metadata.sha256
    || approval.evidenceRecordSha256 !== evidenceRecordSha256
    || approval.reviewDue !== source.reviewDue
    || approval.preparedBy !== baseline!.preparedBy
    || !preparedBy
    || !approvedBy
    || preparedBy === "pending"
    || approvedBy === "pending"
    || preparedBy === approvedBy
    || !isSha256(approval.upstreamArtifactSha256)
    || !isSha256(approval.evidenceRecordSha256)
    || !isIsoDayValue(approval.approvedOn)
    || !isIsoDayValue(approval.reviewDue)
    || approval.approvedOn > day
    || approval.approvedOn < baselineCaptureDay
    || approval.approvedOn < source.reviewedAt
  ) {
    return result("awaiting_approval", "A matching independent preparer and approver record is required.", capture.metadata.sha256, comparison.baselineSha256);
  }
  return result("approved_unchanged", "Upstream bytes and reviewed local evidence match the independent approval.", capture.metadata.sha256, comparison.baselineSha256);
}

export function sourceMayAnswerCurrentFactFromCustody(
  assessment: OfficialSourceCustodyAssessment,
) {
  return assessment.state === "approved_unchanged" && assessment.mayAnswerCurrentFact;
}

export function buildOfficialSourceReviewQueue(
  sources: readonly EnergyAssistantKnowledgeSource[],
  asOf: Date | string = new Date(),
  observedChangedIds: readonly string[] = [],
): OfficialSourceReviewItem[] {
  const day = isoDay(asOf);
  const changed = new Set(observedChangedIds);
  const priority: Record<OfficialSourceReviewReason, number> = {
    change_detected: 0,
    overdue: 1,
    due_soon: 2,
  };

  return sources
    .filter((source) => source.official)
    .flatMap((source): OfficialSourceReviewItem[] => {
      let reason: OfficialSourceReviewReason | null = null;
      if (changed.has(source.id)) reason = "change_detected";
      else if (source.reviewDue < day) reason = "overdue";
      else {
        const dueInDays = dayDistance(day, source.reviewDue);
        const dueSoonWindow = source.volatilityClass === "volatile_program" ? 14 : 30;
        if (dueInDays <= dueSoonWindow) reason = "due_soon";
      }
      return reason ? [{
        sourceId: source.id,
        title: source.title,
        url: source.url,
        reviewDue: source.reviewDue,
        volatilityClass: source.volatilityClass,
        reason,
      }] : [];
    })
    .sort((left, right) => priority[left.reason] - priority[right.reason]
      || left.reviewDue.localeCompare(right.reviewDue)
      || left.sourceId.localeCompare(right.sourceId))
    .slice(0, 25);
}
