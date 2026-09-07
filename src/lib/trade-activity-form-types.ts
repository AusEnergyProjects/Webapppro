export type ActivityAnswer = string | number | boolean;
export type ActivityAnswers = Record<string, ActivityAnswer>;
export type ActivityPhase = "before" | "after";
export type ActivityCondition = { all?: ActivityCondition[]; any?: ActivityCondition[]; fieldKey?: string; equals?: ActivityAnswer; notEquals?: ActivityAnswer };
export type ActivityField = {
  key: string; section: string; label: string;
  type: "text" | "number" | "date" | "select" | "boolean" | "photo" | "document";
  required: boolean; options: string[]; help: string; phase: ActivityPhase;
  condition?: ActivityCondition; repeatGroup?: string; autofill?: string;
  requiredValue?: ActivityAnswer; requireLocation?: boolean;
  referenceDocuments?: { title: string; url: string }[];
};
export type ActivityDeclaration = {
  key: string; title: string; text: string; role: "customer" | "technician" | "other";
  phase: ActivityPhase; required: boolean; condition?: ActivityCondition;
  sourceUrl: string; sourceTextSha256: string;
};
export type ActivityForm = {
  id: string; title: string; version: number; activityTemplateId: string; programCode: string;
  variantId: string; variantOptions: { id: string; label: string }[];
  fields: ActivityField[]; declarations: ActivityDeclaration[];
  sources: { title: string; url: string; sha256: string }[]; reviewNotes: string[];
};
export type ActivityEvidence = {
  id: string; fieldKey: string; fileName: string; contentType: string; size: number;
  sha256: string; objectKey: string; capturedAt: string; uploadedAt: string;
  latitude: number | null; longitude: number | null; accuracy: number | null;
  metadataOrigin: "device_capture" | "file_upload";
  previewObjectKey?: string; previewSha256?: string; previewSize?: number;
  locationObservedAt?: string; locationMocked?: boolean | null;
};
export type ActivityStroke = { points: { x: number; y: number; capturedAtMs?: number; pressure?: number | null }[] };
export type ActivitySignature = {
  id: string; declarationKey: string; signerName: string; role: ActivityDeclaration["role"];
  phase: ActivityPhase; declarationText: string; declarationSha256: string;
  scopeSha256: string; signedAt: string; actorUid: string; strokes: ActivityStroke[];
};
export type ActivityRecord = {
  id: string; recordNumber: string; intentId: string; workOrderId: string; ownerUid: string; organisationId: string;
  revision: number; status: "draft" | "submitted_for_creditex_review";
  form: ActivityForm; formSha256: string; answers: ActivityAnswers;
  evidence: ActivityEvidence[]; signatures: ActivitySignature[];
  signerDefaults: { customer: string; technician: string };
  hasUserEdits?: boolean;
  createdAt: string; updatedAt: string; submittedAt: string; reportUrl: string;
};
