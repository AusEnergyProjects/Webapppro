import type { ActivityAnswers, ActivityEvidence, ActivityForm, ActivitySignature } from './trade-activity-form-types';
import type { FormJobProgress } from './form-job-progress';

export type SafetyCheckKind = 'electrical' | 'gas';
export type SafetyCheckRecord = {
  id: string; ownerUid: string; workOrderId: string; kind: SafetyCheckKind;
  recordNumber: string; revision: number; status: 'draft' | 'complete';
  form: ActivityForm; formSha256: string; answers: ActivityAnswers;
  evidence: ActivityEvidence[]; signatures: ActivitySignature[];
  signerDefaults: { customer: string; technician: string };
  createdAt: string; updatedAt: string; completedAt: string;
};
export type SafetyCheckDelivery = {
  role: 'customer' | 'business';
  status: 'queued' | 'sending' | 'accepted' | 'failed' | 'blocked' | 'reconciliation_required';
  message: string; acceptedAt: string;
};
export type SafetyCheckPresentation = Omit<SafetyCheckRecord, 'ownerUid' | 'evidence'> & {
  evidence: Omit<ActivityEvidence, 'objectKey' | 'previewObjectKey'>[];
  missing: { key: string; label: string; kind: 'answer' | 'evidence' | 'signature' | 'policy' }[];
  ready: boolean; signingScopes: { before: string; after: string };
  signerFields: Readonly<Record<string, string>>; reportUrl: string;
  delivery: SafetyCheckDelivery[]; jobProgress?: FormJobProgress;
};
export type SafetyCheckBranding = {
  businessName: string; businessEmail: string; businessPhone: string;
  logo?: { bytes: Uint8Array; contentType: string };
};
export class SafetyCheckError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message); this.name = 'SafetyCheckError';
  }
}
