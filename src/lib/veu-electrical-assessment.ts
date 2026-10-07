import type { ActivityAnswers, ActivityEvidence, ActivityForm, ActivitySignature } from "./trade-activity-form-types";

/** A job safety assessment, never a certificate claim or compliance intent. */
export type PiesaRecord = {
  id: string;
  workOrderId: string;
  ownerUid: string;
  recordNumber: string;
  revision: number;
  status: "draft" | "complete";
  form: ActivityForm;
  formSha256: string;
  answers: ActivityAnswers;
  evidence: ActivityEvidence[];
  signatures: ActivitySignature[];
  initialAttestation?: { actorUid: string; confirmedAt: string; scopeSha256: string };
  signerDefaults: { customer: string; technician: string };
  createdAt: string;
  updatedAt: string;
  completedAt: string;
};

export type PiesaMissing = { key: string; label: string; kind: "answer" | "evidence" | "signature" | "policy" };
export type PiesaDeliveryRole = "customer" | "business";
export type PiesaDeliveryStatus = "queued" | "sending" | "accepted" | "failed" | "blocked" | "reconciliation_required";
export type PiesaDelivery = {
  role: PiesaDeliveryRole;
  status: PiesaDeliveryStatus;
  message: string;
  acceptedAt: string;
};
export type PiesaPresentation = Omit<PiesaRecord, "ownerUid" | "evidence"> & {
  evidence: Omit<ActivityEvidence, "objectKey" | "previewObjectKey">[];
  missing: PiesaMissing[];
  ready: boolean;
  signingScopes: { before: string; after: string };
  reportUrl: string;
  delivery: PiesaDelivery[];
};

export class PiesaError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "PiesaError";
  }
}
