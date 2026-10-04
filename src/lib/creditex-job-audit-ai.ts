export type CreditexAuditAiSource = {
  id: string; kind: 'job' | 'record' | 'requirement' | 'file' | 'finding'; label: string;
  recordId?: string; recordKind?: string; fileId?: string; fileKind?: string; parentId?: string; requirementId?: string; findingId?: string;
};
export type CreditexAuditAiReview = {
  sourceSha256: string; createdAt: string; summary: string;
  items: { kind: 'missing_information' | 'contradiction' | 'review_point'; detail: string; suggestedCorrection: string; sources: CreditexAuditAiSource[] }[];
};
