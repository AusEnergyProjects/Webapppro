import type { EnergyAssistantKnowledgeSource } from "../data/energy-assistant-knowledge.ts";

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
