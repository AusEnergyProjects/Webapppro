export const CREDITEX_AUDIT_CALL_STATUS = ["prepared", "dialing", "ringing", "awaiting_consent", "in_progress", "completed", "declined", "cancelled", "expired", "failed", "busy", "no_answer"] as const;
export type CreditexAuditCallStatus = typeof CREDITEX_AUDIT_CALL_STATUS[number];
export const CREDITEX_AUDIT_RECORDING_STATUS = ["none", "starting", "recording", "pending", "saving", "saved", "failed", "unknown"] as const;
export type CreditexAuditRecordingStatus = typeof CREDITEX_AUDIT_RECORDING_STATUS[number];
export type CreditexAuditCall = {
  id: string;
  status: CreditexAuditCallStatus;
  recordingStatus: CreditexAuditRecordingStatus;
  createdAt: string;
  startedByName: string;
  durationSeconds: number;
  consentedAt: string;
  savedAt: string;
  error?: string;
};
export type CreditexAuditCallsResponse = {
  ok: true;
  configured: boolean;
  unavailableReason: string;
  customerPhone: string;
  canCall: boolean;
  calls: CreditexAuditCall[];
};
export type CreditexAuditCallTargetInput = { caseId?: string; jobIntentId?: string };
export type CreditexAuditCallPrepareResponse = { ok: true; callId: string; token: string; expiresAt: string; destinationNumber: string; customHeaders: { name: string; value: string }[] };
export const CREDITEX_AUDIT_CALL_CONSENT_VERSION = "creditex-audit-recording-v1";
export const CREDITEX_AUDIT_CALL_CONSENT_NOTICE = "This is a Creditex audit call about your energy upgrade. With your permission, we will record this call and save it privately with your audit record for authorised compliance staff to review. Press 1 after this notice to agree and speak to the auditor. If you do not agree, hang up. This call will not be recorded without your agreement.";
export const CREDITEX_AUDIT_CALL_LIMITS = { intentSeconds: 120, callSeconds: 1800, organisationDaily: 50, operatorDaily: 20, maximumRecordingBytes: 50 * 1024 * 1024 } as const;

export function normalizeAuditCallPhone(value: unknown) {
  if (typeof value !== "string") return "";
  const phone = value.replace(/[\s()-]/g, "");
  if (/^0[23478]\d{8}$/.test(phone)) return `+61${phone.slice(1)}`;
  return /^\+61[23478]\d{8}$/.test(phone) ? phone : "";
}

export function auditCallIsActive(status: string) {
  return ["prepared", "dialing", "ringing", "awaiting_consent", "in_progress"].includes(status);
}
