import { customerAdvisorOptions } from "@/lib/customer-projects.mjs";

export const CUSTOMER_EVIDENCE_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const CUSTOMER_EVIDENCE_MAX_PROJECT_FILES = 12;
export const CUSTOMER_EVIDENCE_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const CUSTOMER_EVIDENCE_SESSION_HOURS = 24;
export const CUSTOMER_EVIDENCE_SESSION_RETENTION_DAYS = 30;

export const CUSTOMER_EVIDENCE_ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const CUSTOMER_EVIDENCE_CATEGORIES = new Set([
  "property-photo",
  "existing-equipment",
  "switchboard",
  "supporting-document",
  "other",
]);
export const CUSTOMER_EVIDENCE_QUOTING_PHOTO_CATEGORIES = new Set([
  "property-photo",
  "existing-equipment",
  "switchboard",
]);
export const CUSTOMER_EVIDENCE_SHARING_SCOPES = new Set([
  "private-plan",
  "allocated-installers",
]);

const FACT_KEYS = new Set(
  (customerAdvisorOptions.factKeys as Array<[string, string]>)
    .map(([value]) => value),
);
const CAPTURE_SLOT_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,79}$/;
const CLIENT_UPLOAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/;

export type CustomerEvidenceRecord = {
  id: string;
  project_id: string;
  customer_uid: string;
  client_upload_id: string;
  category: string;
  capture_slot: string;
  fact_keys: string;
  sharing_scope: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  object_key: string;
  privacy_status: string;
  revision: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type CustomerEvidenceUploadSession = {
  id: string;
  project_id: string;
  customer_uid: string;
  client_upload_id: string;
  metadata_hash: string;
  capture_slot: string;
  replacement_evidence_id: string;
  replacement_object_key: string;
  expected_evidence_revision: number;
  staging_object_key: string;
  upload_id: string;
  content_type: string;
  size_bytes: number;
  category: string;
  fact_keys: string;
  sharing_scope: string;
  part_size_bytes: number;
  status: string;
  evidence_id: string;
  privacy_status: string;
  expires_at: string;
  completed_at: string;
  last_error: string;
  created_at: string;
  updated_at: string;
};

export type CustomerEvidenceUploadPart = {
  part_number: number;
  etag: string;
  size_bytes: number;
};

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function hashCustomerEvidenceUploadMetadata(
  value: Record<string, unknown>,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return base64Url(new Uint8Array(digest));
}

export function cleanCustomerEvidenceId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

export function cleanCustomerEvidenceClientUploadId(value: unknown) {
  const cleaned = cleanCustomerEvidenceId(value);
  return CLIENT_UPLOAD_ID_PATTERN.test(cleaned) ? cleaned : "";
}

export function normaliseCustomerEvidenceCaptureSlot(value: unknown) {
  const cleaned = typeof value === "string"
    ? value.trim().toLowerCase().slice(0, 80)
    : "";
  return CAPTURE_SLOT_PATTERN.test(cleaned) ? cleaned : "";
}

export function normaliseCustomerEvidenceFactKeys(value: unknown) {
  let supplied: unknown = value;
  if (typeof value === "string") {
    try {
      supplied = JSON.parse(value);
    } catch {
      supplied = [];
    }
  }
  if (!Array.isArray(supplied)) return [];
  return [...new Set(
    supplied
      .map((item) => String(item || "").trim())
      .filter((item) => FACT_KEYS.has(item)),
  )].slice(0, 6);
}

export function customerEvidenceCategory(value: unknown) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return CUSTOMER_EVIDENCE_CATEGORIES.has(cleaned) ? cleaned : "";
}

export function customerEvidenceSharingScope(value: unknown) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return CUSTOMER_EVIDENCE_SHARING_SCOPES.has(cleaned)
    ? cleaned
    : "private-plan";
}

export function customerEvidencePrivacyStatus(contentType: string) {
  return contentType.startsWith("image/")
    ? "metadata-stripped"
    : "not-applicable";
}

function evidenceExtension(contentType: string) {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

export function privateCustomerEvidenceName(
  category: string,
  contentType: string,
  id: string,
) {
  return `${category}-${id.slice(0, 8)}.${evidenceExtension(contentType)}`;
}

export function publicCustomerEvidence(record: CustomerEvidenceRecord) {
  const previewUrl = record.content_type.startsWith("image/")
    ? `/api/customer-project-evidence?preview=${encodeURIComponent(record.id)}`
    : "";
  return {
    id: record.id,
    category: record.category,
    captureSlot: record.capture_slot || "",
    factKeys: normaliseCustomerEvidenceFactKeys(record.fact_keys),
    sharingScope: CUSTOMER_EVIDENCE_SHARING_SCOPES.has(record.sharing_scope)
      ? record.sharing_scope
      : "private-plan",
    fileName: record.file_name,
    contentType: record.content_type,
    sizeBytes: Number(record.size_bytes),
    privacyStatus: record.privacy_status || "not-recorded",
    revision: Number(record.revision || 1),
    previewUrl,
    thumbnailUrl: previewUrl,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export function publicCustomerEvidenceUpload(
  session: CustomerEvidenceUploadSession,
  parts: CustomerEvidenceUploadPart[],
) {
  const partSizeBytes = Number(session.part_size_bytes);
  const sizeBytes = Number(session.size_bytes);
  return {
    id: session.id,
    clientUploadId: session.client_upload_id,
    projectId: session.project_id,
    captureSlot: session.capture_slot,
    replacementEvidenceId: session.replacement_evidence_id,
    expectedEvidenceRevision: Number(session.expected_evidence_revision || 0),
    contentType: session.content_type,
    sizeBytes,
    category: session.category,
    factKeys: normaliseCustomerEvidenceFactKeys(session.fact_keys),
    sharingScope: customerEvidenceSharingScope(session.sharing_scope),
    partSizeBytes,
    totalParts: Math.ceil(sizeBytes / partSizeBytes),
    uploadedBytes: parts.reduce(
      (total, part) => total + Number(part.size_bytes || 0),
      0,
    ),
    parts: parts.map((part) => ({
      partNumber: Number(part.part_number),
      sizeBytes: Number(part.size_bytes),
    })),
    status: session.status,
    evidenceId: session.evidence_id,
    privacyStatus: session.privacy_status,
    expiresAt: session.expires_at,
    completedAt: session.completed_at,
    updatedAt: session.updated_at,
  };
}
