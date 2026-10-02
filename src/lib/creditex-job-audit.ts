export const CREDITEX_JOB_AUDIT_VERSION = 'creditex-job-audit-v1';
export const CREDITEX_JOB_AUDIT_QUESTIONS = [
  { key: 'activityDateConfirmed', label: 'The customer confirmed the activity date.' },
  { key: 'customerDetailsConfirmed', label: 'The customer and site details match the job.' },
  { key: 'workConfirmed', label: 'The customer confirmed the work or assessment recorded.' },
  { key: 'evidenceReviewed', label: 'The field answers, photos and supporting files have been reviewed.' },
  { key: 'documentsConfirmed', label: 'The applicable documents and declarations have been checked.' },
  { key: 'noUnresolvedIssues', label: 'There are no unresolved discrepancies or customer concerns.' },
] as const;
export type CreditexJobAuditQuestion = typeof CREDITEX_JOB_AUDIT_QUESTIONS[number]['key'];
export type CreditexJobAuditAnswer = 'yes' | 'no' | 'not_checked';
export type CreditexJobAuditAnswers = Record<CreditexJobAuditQuestion, CreditexJobAuditAnswer>;
export type CreditexJobAuditCallOutcome = 'completed' | 'unavailable' | 'not_required';
export type CreditexJobAuditOutcome = 'draft' | 'audited' | 'correction_required';
export type CreditexJobAuditFileKind = 'field_evidence' | 'field_pdf' | 'work_pack_pdf' | 'work_pack_evidence' | 'work_pack_signature' | 'job_media' | 'case_evidence';
export type CreditexJobAuditFile = {
  kind: CreditexJobAuditFileKind; id: string; parentId: string; label: string; contentType: string;
  sizeBytes: number; sha256: string; previewPath: string; capturedAt: string; unavailableReason?: string;
};
export type CreditexJobAuditAnswerRow = { key: string; label: string; section: string; value: unknown };
export type CreditexJobAuditRecord = {
  kind: 'field' | 'work_pack' | 'job_form'; id: string; title: string; revision: number; status: string;
  updatedAt: string; answers: CreditexJobAuditAnswerRow[];
};
export type CreditexJobAuditSaved = {
  id: string; revision: number; outcome: CreditexJobAuditOutcome; checklistVersion: string;
  answers: CreditexJobAuditAnswers; callOutcome: CreditexJobAuditCallOutcome; callReason: string;
  callId: string; note: string; sourceSha256: string; actorUid: string; actorName: string; createdAt: string;
};
export type CreditexJobAuditWorkspace = {
  target: { intentId: string; caseId: string; workOrderId: string; ownerUid: string; jobRevision: number;
    caseRevision: number; jobNumber: string; jobTitle: string; activityDate: string; activityTitle: string;
    customerName: string; customerPhone: string; siteAddress: string; assignee: string;
    addressReviewRequired: boolean; addressVerificationLabel: string };
  sourceSha256: string; records: CreditexJobAuditRecord[]; files: CreditexJobAuditFile[];
  checklist: CreditexJobAuditSaved | null; history: CreditexJobAuditSaved[];
  auditCompleted: boolean; submissionReady: boolean;
  capabilities: { canSave: boolean; canComplete: boolean; canRequestCorrection: boolean; canCall: boolean; reason: string };
};
export type CreditexJobAuditSaveInput = {
  intentId: string; expectedAuditRevision: number; expectedSourceSha256: string; requestId: string;
  action: 'save' | 'audited' | 'correction_required'; answers: CreditexJobAuditAnswers;
  callOutcome: CreditexJobAuditCallOutcome; callReason: string; callId?: string; note: string;
};
export function emptyCreditexJobAuditAnswers(): CreditexJobAuditAnswers {
  return { activityDateConfirmed: 'not_checked', customerDetailsConfirmed: 'not_checked', workConfirmed: 'not_checked',
    evidenceReviewed: 'not_checked', documentsConfirmed: 'not_checked', noUnresolvedIssues: 'not_checked' };
}
export function creditexJobAuditComplete(answers: CreditexJobAuditAnswers, callOutcome: CreditexJobAuditCallOutcome, callReason: string) {
  return CREDITEX_JOB_AUDIT_QUESTIONS.every(question => answers[question.key] === 'yes')
    && (callOutcome === 'completed' || (callOutcome === 'not_required' && Boolean(callReason.trim())));
}
