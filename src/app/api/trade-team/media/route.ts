import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { nextJobRevision } from "@/lib/trade-team-sync-server";
import { mobileErrorResponse, MOBILE_CLIENT_ID_PATTERN, requireRegisteredMobileDevice } from "@/lib/trade-mobile-server";
import {
  type JpegExifVerification,
  verifyJpegExif,
} from "@/lib/jpeg-exif-verifier";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";

export const runtime = "edge";

const PART_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const SESSION_HOURS = 24;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MEDIA_CATEGORIES = new Set(["before", "progress", "after", "document"]);
const PRIVATE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?\d[\s().-]*){8,}/i;
const MAX_LOCATION_ACCURACY_METRES = 100;
const MAX_LOCATION_CAPTURE_SKEW_MILLISECONDS = 15 * 60 * 1000;
const MAX_EXIF_CAPTURE_SKEW_MILLISECONDS = 15 * 60 * 1000;
const MAX_GOVERNED_CAPTURE_AGE_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const MAX_GOVERNED_FUTURE_SKEW_MILLISECONDS = 15 * 60 * 1000;
const MAX_EVIDENCE_ENVELOPE_BYTES = 65_536;
const MAX_CLIENT_EVIDENCE_ENVELOPE_BYTES = 60 * 1024;
const MAX_MEDIA_JSON_BYTES = 128 * 1024;
const CLEANUP_PENDING_PREFIX = "cleanup_pending:";
const CLEANUP_CLAIMED_PREFIX = "cleanup_claimed:";
const CLEANUP_CLAIM_LEASE_MILLISECONDS = 5 * 60 * 1000;
const MAX_CLEANUP_SWEEP = 10;
const FINALISATION_CLAIM_STEP = 1;
const FINALISATION_VERIFIED_STEP = 2;
const CAMERA_EVIDENCE_TYPES = new Set(["photo", "product", "serial", "decommission", "location"]);
const DOCUMENT_EVIDENCE_TYPES = new Set(["document", "licence", "invoice", "payment"]);

type UploadedPart = { partNumber: number; etag: string };
type MultipartUpload = {
  uploadId: string;
  uploadPart(partNumber: number, value: ArrayBuffer): Promise<UploadedPart>;
  complete(parts: UploadedPart[]): Promise<unknown>;
  abort(): Promise<void>;
};
type EvidenceBucket = {
  createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): MultipartUpload;
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
};
type UploadSession = {
  id: string; owner_uid: string; actor_uid: string; member_id: string; device_id: string; client_upload_id: string;
  metadata_hash: string; work_order_id: string; object_key: string; upload_id: string; file_name: string;
  content_type: string; size_bytes: number; category: string; caption: string; part_size_bytes: number;
  evidence_envelope: string; original_sha256: string;
  status: string; media_id: string; expires_at: string; completed_at: string;
  last_error: string; created_at: string; updated_at: string;
};
type EvidenceLink = {
  organisationId: string;
  caseId: string;
  activityVersionId: string;
  policyVersionId: string;
  requirementId: string;
  requirementCode: string;
};
type EvidenceContract = {
  envelopeJson: string;
  originalSha256: string;
  link: EvidenceLink | null;
};
type TrustedFileInspection = {
  contentType: string;
  originalSha256: string;
  jpegExif: JpegExifVerification | null;
};
type RegisteredDeviceContext = {
  id: string;
  deviceId: string;
  platform: string;
  appVersion: string;
  deviceName: string;
};
type CompletedUpload = UploadSession & {
  job_revision: number;
  finalisation_verified: number;
};

class EvidenceContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function bucket() {
  const value = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!value) throw new Error("STORAGE_UNAVAILABLE");
  return value;
}

async function cleanupClaimedUploadObject(objectKey: string, uploadId: string) {
  let assembledObject: unknown | null;
  try {
    assembledObject = await bucket().head(objectKey);
  } catch {
    return false;
  }
  if (assembledObject) {
    try {
      await bucket().delete(objectKey);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await bucket().resumeMultipartUpload(objectKey, uploadId).abort();
    return true;
  } catch (error) {
    const status = objectValue(error)?.status;
    const message = error instanceof Error ? error.message : String(error);
    if (status === 404 || /not found|no such upload|does not exist/i.test(message)) {
      return true;
    }
    return false;
  }
}

function safeName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "field-file";
}

function base64Url(bytes: Uint8Array) {
  let binary = ""; bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hashMetadata(value: Record<string, unknown>) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return base64Url(new Uint8Array(digest));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactText(value: unknown, maximum = 180) {
  return typeof value === "string" && value.length <= maximum ? value.trim() : "";
}

function jsonByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function serverVerifiedEnvelopeJson(
  rawEnvelope: string,
  trustedFile: TrustedFileInspection,
) {
  let envelope: Record<string, unknown>;
  try {
    envelope = objectValue(JSON.parse(rawEnvelope)) || {};
  } catch {
    envelope = {};
  }
  if (Object.keys(envelope).length === 0) return "{}";
  delete envelope.serverVerification;
  const original = objectValue(envelope.original);
  if (original) {
    original.exifAuthority = trustedFile.jpegExif?.status === "valid"
      ? "server_parsed_embedded_bytes"
      : "server_checked_not_verified";
  }
  envelope.serverVerification = {
    schemaVersion: 1,
    authority: "server_parsed_assembled_bytes",
    contentType: trustedFile.contentType,
    originalSha256: trustedFile.originalSha256,
    embeddedJpegExif: trustedFile.jpegExif,
  };
  const envelopeJson = JSON.stringify(envelope);
  if (jsonByteLength(envelopeJson) > MAX_EVIDENCE_ENVELOPE_BYTES) {
    throw new EvidenceContractError(
      "EVIDENCE_ENVELOPE_INVALID",
      "The evidence metadata contract is too large after server verification.",
    );
  }
  return envelopeJson;
}

function validDateTime(value: unknown) {
  const text = exactText(value, 60);
  return text !== "" && Number.isFinite(Date.parse(text));
}

function validCaptureTimeZone(capture: Record<string, unknown>) {
  const utcOffsetMinutes = capture.utcOffsetMinutes;
  const timeZone = exactText(capture.timeZone, 100);
  return typeof utcOffsetMinutes === "number"
    && Number.isInteger(utcOffsetMinutes)
    && utcOffsetMinutes >= -14 * 60
    && utcOffsetMinutes <= 14 * 60
    && timeZone !== "unknown"
    && (
      timeZone === "UTC"
      || timeZone === "GMT"
      || /^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)+$/.test(timeZone)
    );
}

function embeddedExifTimestampUtc(
  timestamp: string,
  utcOffsetMinutes: number,
) {
  const match =
    /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(timestamp);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ) - utcOffsetMinutes * 60_000;
}

function localDateAtOffset(timestamp: number, utcOffsetMinutes: number) {
  return new Date(timestamp + utcOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validCapturedLocation(location: Record<string, unknown>) {
  return location.state === "captured"
    && finiteNumber(location.latitude)
    && location.latitude >= -90
    && location.latitude <= 90
    && finiteNumber(location.longitude)
    && location.longitude >= -180
    && location.longitude <= 180
    && finiteNumber(location.accuracyMetres)
    && location.accuracyMetres >= 0
    && location.accuracyMetres <= MAX_LOCATION_ACCURACY_METRES
    && validDateTime(location.observedAtUtc);
}

function distanceMetres(
  firstLatitude: number,
  firstLongitude: number,
  secondLatitude: number,
  secondLongitude: number,
) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(secondLatitude - firstLatitude);
  const longitudeDelta = radians(secondLongitude - firstLongitude);
  const firstLatitudeRadians = radians(firstLatitude);
  const secondLatitudeRadians = radians(secondLatitude);
  const chord = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitudeRadians)
      * Math.cos(secondLatitudeRadians)
      * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
}

function parseStringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function hasConfiguredJson(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || Object.keys(parsed as Record<string, unknown>).length > 0;
  } catch {
    return true;
  }
}

function evidenceCaptureMode(row: Record<string, unknown>) {
  if (Number(row.original_required) === 1) {
    throw new EvidenceContractError(
      "EVIDENCE_REQUIREMENT_UNSUPPORTED",
      "This evidence requirement needs trusted original-camera attestation that this field app version does not yet provide.",
      409,
    );
  }
  if (hasConfiguredJson(row.condition_snapshot)) {
    throw new EvidenceContractError(
      "EVIDENCE_REQUIREMENT_UNSUPPORTED",
      "This evidence requirement has conditional rules that this field app version cannot evaluate.",
      409,
    );
  }
  if (
    Number(row.installer_signature_required) === 1
    || Number(row.customer_signature_required) === 1
  ) {
    throw new EvidenceContractError(
      "EVIDENCE_REQUIREMENT_UNSUPPORTED",
      "This evidence requirement needs a signature capture workflow that this field app version does not support.",
      409,
    );
  }
  if (hasConfiguredJson(row.field_schema)) {
    throw new EvidenceContractError(
      "EVIDENCE_REQUIREMENT_UNSUPPORTED",
      "This evidence requirement needs a dynamic field form that this field app version does not support.",
      409,
    );
  }
  const evidenceType = String(row.evidence_type || "");
  if (CAMERA_EVIDENCE_TYPES.has(evidenceType)) return "in_app_camera";
  if (DOCUMENT_EVIDENCE_TYPES.has(evidenceType)) {
    return Number(row.gps_required) === 1 || Number(row.metadata_required) === 1
      ? "in_app_camera"
      : "document_picker";
  }
  throw new EvidenceContractError(
    "EVIDENCE_REQUIREMENT_UNSUPPORTED",
    `Evidence type ${evidenceType || "unknown"} is not supported by this field app version.`,
    409,
  );
}

function hexDigest(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: ArrayBuffer) {
  return hexDigest(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}

function matchesDeclaredFileSignature(value: ArrayBuffer, contentType: string) {
  const bytes = new Uint8Array(value);
  if (contentType === "image/jpeg") {
    return bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length
      && signature.every((byte, index) => bytes[index] === byte);
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12
      && bytes[0] === 0x52
      && bytes[1] === 0x49
      && bytes[2] === 0x46
      && bytes[3] === 0x46
      && bytes[8] === 0x57
      && bytes[9] === 0x45
      && bytes[10] === 0x42
      && bytes[11] === 0x50;
  }
  if (contentType === "application/pdf") {
    return bytes.length >= 5
      && bytes[0] === 0x25
      && bytes[1] === 0x50
      && bytes[2] === 0x44
      && bytes[3] === 0x46
      && bytes[4] === 0x2d;
  }
  return false;
}

async function complianceCaseForWorkOrder(access: TeamAccess, workOrderId: string) {
  return getD1().prepare(`SELECT c.id
    FROM compliance_cases c
    JOIN compliance_evidence_policy_versions p
      ON p.id = c.evidence_policy_version_id
      AND p.activity_version_id = c.activity_version_id
      AND p.organisation_id = c.organisation_id
      AND p.publish_state IN ('published', 'withdrawn')
    WHERE c.work_order_id = ? AND c.installer_uid = ?
      AND c.status NOT IN ('rejected', 'closed')
    LIMIT 1`).bind(workOrderId, access.ownerUid).first<Record<string, unknown>>();
}

async function validateEvidenceContract(
  access: TeamAccess,
  workOrderId: string,
  contentType: string,
  sizeBytes: number,
  rawEnvelope: unknown,
  trustedAtUtc: string,
  registeredDevice?: RegisteredDeviceContext,
  trustedFile?: TrustedFileInspection,
): Promise<EvidenceContract> {
  const envelope = objectValue(rawEnvelope);
  if (!envelope || Object.keys(envelope).length === 0) {
    if (await complianceCaseForWorkOrder(access, workOrderId)) {
      throw new EvidenceContractError(
        "EVIDENCE_REQUIREMENT_REQUIRED",
        "Choose the applicable compliance evidence requirement before capturing this file.",
      );
    }
    return { envelopeJson: "{}", originalSha256: "", link: null };
  }
  delete envelope.serverVerification;
  if (envelope.schemaVersion !== 1) {
    throw new EvidenceContractError("EVIDENCE_ENVELOPE_INVALID", "The evidence metadata contract is invalid.");
  }
  const identifiers = objectValue(envelope.identifiers);
  const integrity = objectValue(envelope.integrity);
  const capture = objectValue(envelope.capture);
  const original = objectValue(envelope.original);
  const location = objectValue(envelope.location);
  const provenance = objectValue(envelope.provenance);
  const acceptance = objectValue(envelope.acceptance);
  const source = exactText(envelope.source, 40);
  const captureSessionId = exactText(envelope.captureSessionId, 180);
  const digestHex = exactText(integrity?.digestHex, 64).toLowerCase();
  if (!identifiers || !integrity || !capture || !original || !location || !acceptance ||
    !["in_app_camera", "document_picker"].includes(source) ||
    !MOBILE_CLIENT_ID_PATTERN.test(captureSessionId) ||
    integrity.algorithm !== "SHA-256" ||
    !/^[0-9a-f]{64}$/.test(digestHex) ||
    integrity.byteLength !== sizeBytes ||
    acceptance.status !== "not_assessed" ||
    !validDateTime(capture.observedAtUtc) ||
    !validDateTime(integrity.computedAtUtc) ||
    exactText(identifiers.jobId, 180) !== workOrderId) {
    throw new EvidenceContractError("EVIDENCE_ENVELOPE_INVALID", "The evidence metadata contract is invalid.");
  }
  if (!validCaptureTimeZone(capture)) {
    throw new EvidenceContractError(
      "EVIDENCE_CAPTURE_TIME_ZONE_INVALID",
      "Governed evidence must retain a valid capture timezone and UTC offset.",
    );
  }
  const linkValues = {
    caseId: exactText(identifiers.complianceCaseId, 180),
    activityVersionId: exactText(identifiers.complianceActivityVersionId, 180),
    policyVersionId: exactText(identifiers.evidencePolicyVersionId, 180),
    requirementId: exactText(identifiers.evidenceRequirementId, 180),
    requirementCode: exactText(identifiers.evidenceRequirementCode, 120),
  };
  const hasComplianceLink = Object.values(linkValues).some(Boolean);
  if (!hasComplianceLink) {
    const envelopeJson = JSON.stringify(envelope);
    if (jsonByteLength(envelopeJson) > MAX_CLIENT_EVIDENCE_ENVELOPE_BYTES) {
      throw new EvidenceContractError("EVIDENCE_ENVELOPE_INVALID", "The evidence metadata contract is invalid.");
    }
    if (await complianceCaseForWorkOrder(access, workOrderId)) {
      throw new EvidenceContractError(
        "EVIDENCE_REQUIREMENT_REQUIRED",
        "Choose the applicable compliance evidence requirement before capturing this file.",
      );
    }
    return { envelopeJson, originalSha256: digestHex, link: null };
  }
  if (Object.values(linkValues).some((value) => !value)) {
    throw new EvidenceContractError("EVIDENCE_LINK_INVALID", "The compliance evidence requirement link is incomplete.");
  }
  if (
    !registeredDevice
    || !provenance
    || exactText(provenance.installationId, 120) !== registeredDevice.deviceId
    || exactText(provenance.platform, 20) !== registeredDevice.platform
    || exactText(provenance.appVersion, 40) !== registeredDevice.appVersion
  ) {
    throw new EvidenceContractError(
      "EVIDENCE_PROVENANCE_INVALID",
      "The evidence provenance does not match this registered field device and app session.",
      409,
    );
  }
  if (provenance.isPhysicalDevice !== true) {
    throw new EvidenceContractError(
      "EVIDENCE_PHYSICAL_DEVICE_REQUIRED",
      "Governed evidence must be captured or selected on a registered physical field device.",
    );
  }
  const captureObservedAt = Date.parse(String(capture.observedAtUtc));
  const integrityComputedAt = Date.parse(String(integrity.computedAtUtc));
  const locationObservedAt = location.state === "captured"
    ? Date.parse(String(location.observedAtUtc))
    : Number.NaN;
  if (
    integrityComputedAt < captureObservedAt
    || (
      Number.isFinite(locationObservedAt)
      && (
        integrityComputedAt < locationObservedAt
        || Math.abs(locationObservedAt - captureObservedAt) > MAX_LOCATION_CAPTURE_SKEW_MILLISECONDS
      )
    )
  ) {
    throw new EvidenceContractError(
      "EVIDENCE_TIME_ORDER_INVALID",
      "Evidence capture, location and integrity timestamps are not in a valid capture sequence.",
    );
  }
  original.exifAuthority = "client_supplied_non_authoritative";
  const envelopeJson = JSON.stringify(envelope);
  if (jsonByteLength(envelopeJson) > MAX_CLIENT_EVIDENCE_ENVELOPE_BYTES) {
    throw new EvidenceContractError("EVIDENCE_ENVELOPE_INVALID", "The evidence metadata contract is invalid.");
  }
  const row = await getD1().prepare(`SELECT
      c.organisation_id, c.id case_id, c.activity_version_id,
      c.activity_date, a.effective_from, a.effective_to,
      p.id policy_version_id, r.id requirement_id, r.requirement_code,
      r.evidence_type, r.capture_timing, r.maximum_count,
      r.allowed_content_types, r.original_required, r.metadata_required,
      r.gps_required, r.date_stamp_required,
      r.installer_signature_required, r.customer_signature_required,
      r.condition_snapshot, r.field_schema,
      (SELECT COUNT(DISTINCT current_evidence.original_sha256)
       FROM compliance_case_evidence current_evidence
       WHERE current_evidence.organisation_id = c.organisation_id
         AND current_evidence.case_id = c.id
         AND current_evidence.requirement_id = r.id
         AND current_evidence.status IN ('received', 'under_review', 'accepted')) submitted_count
    FROM compliance_cases c
    JOIN compliance_activity_versions a
      ON a.id = c.activity_version_id AND a.publish_state IN ('published', 'withdrawn')
    JOIN compliance_evidence_policy_versions p
      ON p.id = ? AND p.activity_version_id = c.activity_version_id
      AND p.id = c.evidence_policy_version_id
      AND p.organisation_id = c.organisation_id
      AND p.publish_state IN ('published', 'withdrawn')
    JOIN compliance_evidence_requirements r
      ON r.id = ? AND r.policy_version_id = p.id
      AND r.organisation_id = c.organisation_id
    WHERE c.id = ? AND c.work_order_id = ? AND c.installer_uid = ?
      AND c.activity_version_id = ?
      AND c.status NOT IN ('rejected', 'closed')
    LIMIT 1`)
    .bind(linkValues.policyVersionId, linkValues.requirementId, linkValues.caseId,
      workOrderId, access.ownerUid, linkValues.activityVersionId)
    .first<Record<string, unknown>>();
  if (!row || String(row.requirement_code) !== linkValues.requirementCode) {
    throw new EvidenceContractError(
      "EVIDENCE_LINK_INVALID",
      "This evidence requirement is no longer active for the selected compliance case.",
      409,
    );
  }
  if (String(row.capture_timing) !== "any") {
    throw new EvidenceContractError(
      "EVIDENCE_CAPTURE_TIMING_UNSUPPORTED",
      "This evidence timing rule is not supported by the current field workflow. It must remain unavailable until the required job milestone can be verified.",
      409,
    );
  }
  const requiredCaptureSource = evidenceCaptureMode(row);
  const trustedAt = Date.parse(trustedAtUtc);
  if (!Number.isFinite(trustedAt)) {
    throw new Error("INVALID_TRUSTED_EVIDENCE_TIME");
  }
  const earliestAcceptedAt =
    trustedAt - MAX_GOVERNED_CAPTURE_AGE_MILLISECONDS;
  const latestAcceptedAt =
    trustedAt + MAX_GOVERNED_FUTURE_SKEW_MILLISECONDS;
  if (
    captureObservedAt < earliestAcceptedAt
    || captureObservedAt > latestAcceptedAt
    || integrityComputedAt < earliestAcceptedAt
    || integrityComputedAt > latestAcceptedAt
    || (
      Number.isFinite(locationObservedAt)
      && (
        locationObservedAt < earliestAcceptedAt
        || locationObservedAt > latestAcceptedAt
      )
    )
  ) {
    throw new EvidenceContractError(
      "EVIDENCE_CAPTURE_TIME_OUT_OF_RANGE",
      "Governed evidence capture times must be recent and cannot be future-dated.",
      409,
    );
  }
  const activityDate = String(row.activity_date || "");
  if (
    requiredCaptureSource === "in_app_camera" && localDateAtOffset(
      captureObservedAt,
      Number(capture.utcOffsetMinutes),
    ) !== activityDate
  ) {
    throw new EvidenceContractError(
      "EVIDENCE_ACTIVITY_DATE_MISMATCH",
      "The governed evidence capture date does not match the case activity date.",
      409,
    );
  }
  const effectiveFrom = String(row.effective_from || "");
  const effectiveTo = String(row.effective_to || "");
  if (
    activityDate < effectiveFrom
    || (effectiveTo !== "" && activityDate > effectiveTo)
  ) {
    throw new EvidenceContractError(
      "EVIDENCE_ACTIVITY_VERSION_DATE_INVALID",
      "The case activity date is outside the selected activity version.",
      409,
    );
  }
  if (source !== requiredCaptureSource) {
    throw new EvidenceContractError(
      "EVIDENCE_CONTENT_TYPE_INVALID",
      requiredCaptureSource === "in_app_camera"
        ? "Use the in-app camera for this evidence requirement."
        : "Choose the original document file for this evidence requirement.",
    );
  }
  const allowedTypes = parseStringArray(row.allowed_content_types);
  if (allowedTypes.length > 0 && !allowedTypes.includes(contentType)) {
    throw new EvidenceContractError("EVIDENCE_CONTENT_TYPE_INVALID", "This file type is not allowed for the selected evidence requirement.");
  }
  const maximumCount = Number(row.maximum_count);
  if (
    Number.isInteger(maximumCount)
    && maximumCount > 0
    && Number(row.submitted_count || 0) >= maximumCount
  ) {
    throw new EvidenceContractError(
      "EVIDENCE_MAXIMUM_REACHED",
      `The policy maximum of ${maximumCount} submitted evidence file${maximumCount === 1 ? "" : "s"} has been reached for this requirement.`,
      409,
    );
  }
  if (Number(row.original_required) === 1 &&
    (original.preservedWithoutAppTransformation !== true || original.editingApplied !== false)) {
    throw new EvidenceContractError("EVIDENCE_ORIGINAL_REQUIRED", "Capture and upload the unedited original file for this requirement.");
  }
  const exif = objectValue(original.exif);
  if (
    requiredCaptureSource === "in_app_camera"
    && Number(row.metadata_required) === 1
    && (
      exactText(original.exifState, 40) !== "available"
      || !exif
      || Object.keys(exif).length === 0
    )
  ) {
    throw new EvidenceContractError("EVIDENCE_METADATA_REQUIRED", "This requirement needs original capture metadata.");
  }
  const hasCapturedLocation = location.state === "captured";
  const capturedLocationValid = validCapturedLocation(location);
  if (hasCapturedLocation && !capturedLocationValid) {
    throw new EvidenceContractError(
      "EVIDENCE_LOCATION_INVALID",
      "The captured location must include valid coordinates, observed time and bounded accuracy.",
    );
  }
  if (Number(row.gps_required) === 1 && !capturedLocationValid) {
    throw new EvidenceContractError("EVIDENCE_GPS_REQUIRED", "Capture a current location for this evidence requirement.");
  }
  if (Number(row.gps_required) === 1 && location.mocked === true) {
    throw new EvidenceContractError(
      "EVIDENCE_GPS_MOCKED",
      "Mocked device locations cannot satisfy this evidence requirement.",
    );
  }
  if (Number(row.date_stamp_required) === 1 && !validDateTime(capture.observedAtUtc)) {
    throw new EvidenceContractError("EVIDENCE_CAPTURE_TIME_REQUIRED", "Capture time is required for this evidence requirement.");
  }
  if (trustedFile) {
    if (
      trustedFile.contentType !== contentType
      || trustedFile.originalSha256 !== digestHex
    ) {
      throw new EvidenceContractError(
        "EVIDENCE_SERVER_VERIFICATION_INVALID",
        "The server-verified evidence facts do not match this upload.",
        409,
      );
    }
    const jpegExif = trustedFile.jpegExif;
    if (
      requiredCaptureSource === "in_app_camera"
      && Number(row.metadata_required) === 1
      && (
        contentType !== "image/jpeg"
        || jpegExif?.status !== "valid"
        || !jpegExif.exifPresent
      )
    ) {
      throw new EvidenceContractError(
        "EVIDENCE_EMBEDDED_METADATA_REQUIRED",
        "The uploaded JPEG bytes do not contain valid embedded EXIF metadata.",
        409,
      );
    }
    if (
      requiredCaptureSource === "in_app_camera"
      && Number(row.gps_required) === 1
      && (
        contentType !== "image/jpeg"
        || jpegExif?.status !== "valid"
        || !jpegExif.gps
      )
    ) {
      throw new EvidenceContractError(
        "EVIDENCE_EMBEDDED_GPS_REQUIRED",
        "The uploaded JPEG bytes do not contain a valid embedded GPS location.",
        409,
      );
    }
    if (
      requiredCaptureSource === "in_app_camera"
      && Number(row.gps_required) === 1
      && jpegExif?.gps
      && capturedLocationValid
      && distanceMetres(
          Number(location.latitude),
          Number(location.longitude),
          jpegExif.gps.latitude,
          jpegExif.gps.longitude,
        ) > Math.max(
          250,
          Number(location.accuracyMetres) + MAX_LOCATION_ACCURACY_METRES,
        )
    ) {
      throw new EvidenceContractError(
        "EVIDENCE_LOCATION_MISMATCH",
        "The embedded JPEG location does not match the registered device location captured for this evidence.",
        409,
      );
    }
    if (
      requiredCaptureSource === "in_app_camera"
      && Number(row.date_stamp_required) === 1
      && (
        contentType !== "image/jpeg"
        || jpegExif?.status !== "valid"
        || !jpegExif.captureTimestamp
      )
    ) {
      throw new EvidenceContractError(
        "EVIDENCE_EMBEDDED_CAPTURE_TIME_REQUIRED",
        "The uploaded JPEG bytes do not contain a valid embedded capture timestamp.",
        409,
      );
    }
    if (
      requiredCaptureSource === "in_app_camera"
      && Number(row.date_stamp_required) === 1
      && jpegExif?.captureTimestamp
      && Math.abs(
        embeddedExifTimestampUtc(
          jpegExif.captureTimestamp,
          Number(capture.utcOffsetMinutes),
        ) - captureObservedAt
      ) > MAX_EXIF_CAPTURE_SKEW_MILLISECONDS
    ) {
      throw new EvidenceContractError(
        "EVIDENCE_EMBEDDED_CAPTURE_TIME_MISMATCH",
        "The embedded JPEG capture time does not match the registered device capture time.",
        409,
      );
    }
  }
  return {
    envelopeJson,
    originalSha256: digestHex,
    link: {
      organisationId: String(row.organisation_id),
      caseId: String(row.case_id),
      activityVersionId: String(row.activity_version_id),
      policyVersionId: String(row.policy_version_id),
      requirementId: String(row.requirement_id),
      requirementCode: String(row.requirement_code),
    },
  };
}

function mediaError(error: unknown) {
  if (error instanceof EvidenceContractError) {
    return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  }
  const mobile = mobileErrorResponse(error);
  if (mobile) return adminJson({ ok: false, code: mobile.code, error: mobile.error,
    ...(mobile.minimumVersion ? { minimumVersion: mobile.minimumVersion } : {}) }, mobile.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "TEAM_ACCESS_RECORD_REQUIRED") return adminJson({ ok: false, error: "No active installer team access was found." }, 404);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Offline uploads require installer team access." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Offline uploads are available to installer teams only." }, 403);
  if (code === "FIELD_EVIDENCE_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow field uploads." }, 403);
  if (code === "FIELD_EVIDENCE_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow field upload changes." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This job is no longer assigned to this device." }, 403);
  if (code === "STORAGE_UNAVAILABLE") return adminJson({ ok: false, error: "Field file storage is unavailable." }, 503);
  return adminJson({ ok: false, error: "The field upload could not be completed." }, 500);
}

async function sessionParts(sessionId: string) {
  const rows = await getD1().prepare(`SELECT part_number, etag, size_bytes FROM trade_mobile_upload_parts
    WHERE session_id = ? ORDER BY part_number`).bind(sessionId).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ partNumber: Number(row.part_number), etag: String(row.etag), sizeBytes: Number(row.size_bytes) }));
}

async function sessionPayload(session: UploadSession) {
  const parts = await sessionParts(session.id);
  return { id: session.id, clientUploadId: session.client_upload_id, workOrderId: session.work_order_id,
    fileName: session.file_name, contentType: session.content_type, sizeBytes: Number(session.size_bytes),
    category: session.category, caption: session.caption, partSizeBytes: Number(session.part_size_bytes),
    totalParts: Math.ceil(Number(session.size_bytes) / Number(session.part_size_bytes)), status: session.status,
    originalSha256: session.status === "completed" ? session.original_sha256 : "",
    mediaId: session.media_id, expiresAt: session.expires_at, completedAt: session.completed_at, parts };
}

async function findSession(access: TeamAccess, id: string) {
  const row = await getD1().prepare(`SELECT * FROM trade_mobile_upload_sessions WHERE id = ? AND owner_uid = ?`)
    .bind(id, access.ownerUid).first<UploadSession>();
  if (!row || row.actor_uid !== access.actorUid || row.member_id !== access.memberId) throw new Error("UPLOAD_NOT_FOUND");
  return row;
}

async function completedUpload(
  access: TeamAccess,
  sessionId: string,
  requireVerifiedGuard = false,
) {
  return getD1().prepare(`SELECT session.*, work_order.revision job_revision,
      CASE WHEN EXISTS (
        SELECT 1 FROM trade_mobile_upload_finalisation_guards final_guard
        WHERE final_guard.session_id = session.id
          AND final_guard.owner_uid = session.owner_uid
          AND final_guard.step_number = ?
          AND final_guard.verified = 1
      ) THEN 1 ELSE 0 END finalisation_verified
    FROM trade_mobile_upload_sessions session
    JOIN trade_crm_job_media media
      ON media.id = session.media_id
      AND media.work_order_id = session.work_order_id
      AND media.firebase_uid = session.owner_uid
      AND media.object_key = session.object_key
      AND media.original_sha256 = session.original_sha256
      AND media.evidence_envelope = session.evidence_envelope
    JOIN trade_work_orders work_order
      ON work_order.id = session.work_order_id
      AND work_order.firebase_uid = session.owner_uid
    WHERE session.id = ? AND session.owner_uid = ?
      AND session.actor_uid = ? AND session.member_id = ?
      AND session.status = 'completed' AND session.media_id <> ''
      AND (? = 0 OR EXISTS (
        SELECT 1 FROM trade_mobile_upload_finalisation_guards verified_guard
        WHERE verified_guard.session_id = session.id
          AND verified_guard.owner_uid = session.owner_uid
          AND verified_guard.step_number = ?
          AND verified_guard.verified = 1
      ))
    LIMIT 1`)
    .bind(
      FINALISATION_VERIFIED_STEP,
      sessionId,
      access.ownerUid,
      access.actorUid,
      access.memberId,
      requireVerifiedGuard ? 1 : 0,
      FINALISATION_VERIFIED_STEP,
    )
    .first<CompletedUpload>();
}

async function safeDuplicateResponse(
  access: TeamAccess,
  sessionId: string,
  requireVerifiedGuard = false,
) {
  const completed = await completedUpload(access, sessionId, requireVerifiedGuard);
  if (!completed) return null;
  if (
    !requireVerifiedGuard
    && Number(completed.finalisation_verified) !== 1
    && completed.evidence_envelope !== "{}"
  ) {
    return null;
  }
  return adminJson({
    ok: true,
    duplicate: true,
    contractVersion: 3,
    result: {
      revision: Number(completed.job_revision),
      mediaId: completed.media_id,
      completedAt: completed.completed_at,
      duplicate: true,
    },
    upload: await sessionPayload(completed),
  });
}

type CleanupSession = Pick<
  UploadSession,
  "id" | "owner_uid" | "object_key" | "upload_id" | "status" | "last_error"
>;

function pendingCleanupReason(lastError: string) {
  if (lastError.startsWith(CLEANUP_PENDING_PREFIX)) {
    return lastError.slice(CLEANUP_PENDING_PREFIX.length);
  }
  if (lastError.startsWith(CLEANUP_CLAIMED_PREFIX)) {
    const separator = lastError.lastIndexOf("|");
    return separator >= CLEANUP_CLAIMED_PREFIX.length
      ? lastError.slice(separator + 1)
      : "";
  }
  return "";
}

async function finishTerminalUploadCleanup(session: CleanupSession) {
  const reason = pendingCleanupReason(session.last_error);
  if (!reason) return true;
  const claimedAt = new Date().toISOString();
  const claimedError =
    `${CLEANUP_CLAIMED_PREFIX}${claimedAt}|${reason}`;
  let claimed: D1Result;
  try {
    claimed = await getD1().prepare(`UPDATE trade_mobile_upload_sessions
      SET last_error = ?, updated_at = ?
      WHERE id = ? AND owner_uid = ? AND object_key = ? AND upload_id = ?
        AND status = ? AND status IN ('aborted', 'rejected', 'expired')
        AND media_id = '' AND last_error = ?`)
      .bind(
        claimedError,
        claimedAt,
        session.id,
        session.owner_uid,
        session.object_key,
        session.upload_id,
        session.status,
        session.last_error,
      ).run();
  } catch {
    return false;
  }
  if (Number(claimed.meta.changes || 0) !== 1) return false;
  if (!await cleanupClaimedUploadObject(session.object_key, session.upload_id)) {
    try {
      await getD1().prepare(`UPDATE trade_mobile_upload_sessions
        SET last_error = ?, updated_at = ?
        WHERE id = ? AND owner_uid = ? AND object_key = ? AND upload_id = ?
          AND status = ? AND status IN ('aborted', 'rejected', 'expired')
          AND media_id = '' AND last_error = ?`)
        .bind(
          `${CLEANUP_PENDING_PREFIX}${reason}`,
          new Date().toISOString(),
          session.id,
          session.owner_uid,
          session.object_key,
          session.upload_id,
          session.status,
          claimedError,
        ).run();
    } catch {
      // A stale cleanup claim is lease-recoverable by the global sweep.
    }
    return false;
  }
  try {
    await getD1().prepare("DELETE FROM trade_mobile_upload_parts WHERE session_id = ?")
      .bind(session.id).run();
    const completed = await getD1().prepare(`UPDATE trade_mobile_upload_sessions
      SET last_error = ?, updated_at = ?
      WHERE id = ? AND owner_uid = ? AND object_key = ? AND upload_id = ?
        AND media_id = ''
        AND status IN ('aborted', 'rejected', 'expired')
        AND status = ? AND last_error = ?`)
      .bind(
        reason === "aborted" ? "" : reason,
        new Date().toISOString(),
        session.id,
        session.owner_uid,
        session.object_key,
        session.upload_id,
        session.status,
        claimedError,
      ).run();
    return Number(completed.meta.changes || 0) === 1;
  } catch {
    return false;
  }
}

async function sweepTerminalUploadCleanup() {
  const now = new Date().toISOString();
  const staleClaimBefore = new Date(
    Date.parse(now) - CLEANUP_CLAIM_LEASE_MILLISECONDS,
  ).toISOString();
  const rows = await getD1().prepare(`SELECT
      id, owner_uid, object_key, upload_id, status, last_error
    FROM trade_mobile_upload_sessions
    WHERE media_id = '' AND (
        (status IN ('initiated', 'uploading', 'completing') AND expires_at <= ?)
        OR (
          status IN ('aborted', 'rejected', 'expired')
          AND (
            last_error LIKE 'cleanup_pending:%'
            OR (
              last_error LIKE 'cleanup_claimed:%'
              AND updated_at <= ?
            )
          )
        )
      )
    ORDER BY updated_at, id
    LIMIT ?`)
    .bind(
      now,
      staleClaimBefore,
      MAX_CLEANUP_SWEEP,
    )
    .all<CleanupSession>();
  for (const row of rows.results) {
    let cleanupSession = row;
    if (["initiated", "uploading", "completing"].includes(row.status)) {
      const claim = await getD1().prepare(`UPDATE trade_mobile_upload_sessions
        SET status = 'expired', last_error = ?, updated_at = ?
        WHERE id = ? AND owner_uid = ? AND object_key = ? AND upload_id = ?
          AND status = ? AND status IN ('initiated', 'uploading', 'completing')
          AND media_id = '' AND expires_at <= ? AND last_error = ?`)
        .bind(
          `${CLEANUP_PENDING_PREFIX}expired`,
          now,
          row.id,
          row.owner_uid,
          row.object_key,
          row.upload_id,
          row.status,
          now,
          row.last_error,
        ).run();
      if (Number(claim.meta.changes || 0) !== 1) continue;
      cleanupSession = {
        ...row,
        status: "expired",
        last_error: `${CLEANUP_PENDING_PREFIX}expired`,
      };
    }
    await finishTerminalUploadCleanup(cleanupSession);
  }
}

async function initiate(request: Request, access: TeamAccess, body: Record<string, unknown>) {
  const now = new Date().toISOString();
  const deviceId = cleanAdminText(body.deviceId, 120);
  const registeredDevice = await requireRegisteredMobileDevice(
    request,
    access,
    deviceId,
    cleanAdminText(body.platform, 20),
    cleanAdminText(body.appVersion, 40),
  );
  await sweepTerminalUploadCleanup();
  const clientUploadId = cleanAdminText(body.clientUploadId, 120);
  const workOrderId = cleanAdminText(body.workOrderId, 180);
  const fileName = safeName(cleanAdminText(body.fileName, 180));
  const contentType = cleanAdminText(body.contentType, 100);
  const sizeBytes = Number(body.sizeBytes);
  const categoryValue = cleanAdminText(body.category, 20);
  const category = MEDIA_CATEGORIES.has(categoryValue) ? categoryValue : "progress";
  const caption = cleanAdminText(body.caption, 300);
  if (!MOBILE_CLIENT_ID_PATTERN.test(clientUploadId) || !ALLOWED_TYPES.has(contentType) ||
    !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_FILE_BYTES) {
    return adminJson({ ok: false, error: "Add a stable upload ID and a JPEG, PNG, WebP or PDF no larger than 50 MB." }, 400);
  }
  const job = await assignedJob(access, workOrderId);
  if (job.source_type === "opportunity" && (PRIVATE_PATTERN.test(fileName) || PRIVATE_PATTERN.test(caption))) {
    return adminJson({ ok: false, code: "PROTECTED_CUSTOMER_DATA", error: "Remove contact details from the protected job filename and caption." }, 400);
  }
  const evidence = await validateEvidenceContract(
    access,
    workOrderId,
    contentType,
    sizeBytes,
    body.evidenceEnvelope,
    now,
    registeredDevice,
  );
  const metadata = {
    clientUploadId, workOrderId, fileName, contentType, sizeBytes, category, caption,
    evidenceEnvelope: JSON.parse(evidence.envelopeJson) as Record<string, unknown>,
  };
  const metadataHash = await hashMetadata(metadata);
  const existing = await getD1().prepare(`SELECT * FROM trade_mobile_upload_sessions WHERE owner_uid = ? AND client_upload_id = ?`)
    .bind(access.ownerUid, clientUploadId).first<UploadSession>();
  if (existing) {
    if (existing.metadata_hash !== metadataHash) return adminJson({ ok: false, code: "IDEMPOTENCY_MISMATCH",
      error: "This upload ID was already used for different file details." }, 409);
    return adminJson({ ok: true, duplicate: true, contractVersion: 3, upload: await sessionPayload(existing) });
  }
  const id = crypto.randomUUID(); const objectKey = `crm-job-media/${access.ownerUid}/${workOrderId}/${id}`;
  const expiresAt = new Date(Date.parse(now) + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  const multipart = await bucket().createMultipartUpload(objectKey, { httpMetadata: { contentType },
    customMetadata: {
      owner: access.ownerUid,
      actor: access.actorUid,
      workOrderId,
      uploadSessionId: id,
      originalSha256: evidence.originalSha256,
    } });
  try {
    const inserted = await getD1().prepare(`INSERT INTO trade_mobile_upload_sessions
      (id, owner_uid, actor_uid, member_id, device_id, client_upload_id, metadata_hash, work_order_id,
       object_key, upload_id, file_name, content_type, size_bytes, category, caption, evidence_envelope,
       original_sha256, part_size_bytes, status, media_id, expires_at, completed_at, last_error, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'initiated', '', ?, '', '', ?, ?
      FROM trade_mobile_devices device
      WHERE device.id = ? AND device.owner_uid = ? AND device.actor_uid = ?
        AND device.member_id = ? AND device.device_id = ? AND device.status = 'active'`)
      .bind(id, access.ownerUid, access.actorUid, access.memberId, deviceId, clientUploadId, metadataHash,
        workOrderId, objectKey, multipart.uploadId, fileName, contentType, sizeBytes, category, caption,
        evidence.envelopeJson, evidence.originalSha256, PART_SIZE_BYTES, expiresAt, now, now,
        registeredDevice.id, access.ownerUid, access.actorUid, access.memberId, deviceId).run();
    if (Number(inserted.meta.changes || 0) !== 1) {
      await multipart.abort();
      return adminJson({
        ok: false,
        code: "UPLOAD_STATE_CHANGED",
        error: "This registered device stopped accepting uploads before the session was created.",
      }, 409);
    }
  } catch (error) { await multipart.abort(); throw error; }
  const session = await findSession(access, id);
  return adminJson({ ok: true, contractVersion: 3, upload: await sessionPayload(session) }, 201);
}

async function uploadPart(request: Request, access: TeamAccess, form: FormData) {
  const deviceId = cleanAdminText(form.get("deviceId"), 120);
  await requireRegisteredMobileDevice(request, access, deviceId, cleanAdminText(form.get("platform"), 20), cleanAdminText(form.get("appVersion"), 40));
  await sweepTerminalUploadCleanup();
  const session = await findSession(access, cleanAdminText(form.get("sessionId"), 180));
  if (session.device_id !== deviceId) return adminJson({ ok: false, error: "This upload belongs to a different device." }, 403);
  if (!["initiated", "uploading"].includes(session.status)) return adminJson({ ok: false, error: "This upload is no longer accepting parts." }, 409);
  if (session.expires_at <= new Date().toISOString()) return adminJson({ ok: false, code: "UPLOAD_EXPIRED", error: "This upload expired. Start it again." }, 410);
  await assignedJob(access, session.work_order_id);
  const partNumber = Number(form.get("partNumber")); const part = form.get("file");
  const totalParts = Math.ceil(Number(session.size_bytes) / Number(session.part_size_bytes));
  if (!(part instanceof File) || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalParts) {
    return adminJson({ ok: false, error: "Add a valid upload part." }, 400);
  }
  const expectedBytes = partNumber === totalParts
    ? Number(session.size_bytes) - Number(session.part_size_bytes) * (totalParts - 1)
    : Number(session.part_size_bytes);
  if (part.size !== expectedBytes) return adminJson({ ok: false, error: `Upload part ${partNumber} must contain exactly ${expectedBytes} bytes.` }, 400);
  const uploaded = await bucket().resumeMultipartUpload(session.object_key, session.upload_id)
    .uploadPart(partNumber, await part.arrayBuffer());
  const now = new Date().toISOString();
  const results = await getD1().batch([
    getD1().prepare(`UPDATE trade_mobile_upload_sessions
      SET status = 'uploading', last_error = '', updated_at = ?
      WHERE id = ? AND owner_uid = ? AND actor_uid = ? AND member_id = ?
        AND device_id = ? AND status IN ('initiated', 'uploading')
        AND media_id = ''`)
      .bind(
        now,
        session.id,
        access.ownerUid,
        access.actorUid,
        access.memberId,
        deviceId,
      ),
    getD1().prepare(`INSERT INTO trade_mobile_upload_parts
      (id, session_id, part_number, etag, size_bytes, created_at, updated_at)
      SELECT ?, upload.id, ?, ?, ?, ?, ?
      FROM trade_mobile_upload_sessions upload
      WHERE upload.id = ? AND upload.owner_uid = ? AND upload.actor_uid = ?
        AND upload.member_id = ? AND upload.device_id = ?
        AND upload.status = 'uploading' AND upload.media_id = ''
      ON CONFLICT(session_id, part_number) DO UPDATE SET
        etag = excluded.etag, size_bytes = excluded.size_bytes,
        updated_at = excluded.updated_at`)
      .bind(
        crypto.randomUUID(),
        partNumber,
        uploaded.etag,
        part.size,
        now,
        now,
        session.id,
        access.ownerUid,
        access.actorUid,
        access.memberId,
        deviceId,
      ),
  ]);
  if (
    Number(results[0]?.meta.changes || 0) !== 1
    || Number(results[1]?.meta.changes || 0) !== 1
  ) {
    return adminJson({
      ok: false,
      code: "UPLOAD_STATE_CHANGED",
      error: "This upload stopped accepting parts before the saved part could be recorded.",
    }, 409);
  }
  return adminJson({ ok: true, contractVersion: 3, upload: await sessionPayload({ ...session, status: "uploading" }) });
}

async function finalise(
  access: TeamAccess,
  session: UploadSession,
  registeredDevice: RegisteredDeviceContext,
  trustedFile: TrustedFileInspection,
) {
  const existingCompletion = await completedUpload(access, session.id, true);
  if (existingCompletion) {
    return {
      revision: Number(existingCompletion.job_revision),
      mediaId: existingCompletion.media_id,
      completedAt: existingCompletion.completed_at,
      duplicate: true,
    };
  }
  const job = await assignedJob(access, session.work_order_id);
  const now = new Date().toISOString();
  const evidence = await validateEvidenceContract(
    access,
    session.work_order_id,
    session.content_type,
    Number(session.size_bytes),
    (() => {
      try { return JSON.parse(session.evidence_envelope || "{}") as unknown; }
      catch { return {}; }
    })(),
    session.created_at,
    registeredDevice,
    trustedFile,
  );
  const currentRevision = Number(job.revision);
  const revision = nextJobRevision(currentRevision);
  const mediaId = crypto.randomUUID();
  const workEventId = crypto.randomUUID();
  const claimGuardId = crypto.randomUUID();
  const verifiedGuardId = crypto.randomUUID();
  const evidenceId = evidence.link ? crypto.randomUUID() : "";
  const caseEventId = evidence.link ? crypto.randomUUID() : "";
  const auditEventId = evidence.link ? crypto.randomUUID() : "";
  const latestRejectedEvidence = evidence.link
    ? await getD1().prepare(`SELECT id
        FROM compliance_case_evidence
        WHERE organisation_id = ? AND case_id = ? AND requirement_id = ?
          AND status = 'rejected'
        ORDER BY reviewed_at DESC, created_at DESC, id DESC
        LIMIT 1`)
        .bind(
          evidence.link.organisationId,
          evidence.link.caseId,
          evidence.link.requirementId,
        )
        .first<Record<string, unknown>>()
    : null;
  const supersedesEvidenceId = String(latestRejectedEvidence?.id || "");
  const audienceMemberId = String(job.assignee_member_id || "");
  const expectedSyncChanges = audienceMemberId ? 2 : 1;
  const pushEventKey = audienceMemberId
    ? `${access.ownerUid}:${audienceMemberId}:${session.work_order_id}:${revision}:upsert`
    : "";
  const db = getD1();
  const statements: D1PreparedStatement[] = [];
  const expectedChanges: Array<{ index: number; label: string }> = [];
  const expectOne = (label: string, statement: D1PreparedStatement) => {
    expectedChanges.push({ index: statements.length, label });
    statements.push(statement);
  };

  expectOne(
    "finalisation claim",
    db.prepare(`INSERT INTO trade_mobile_upload_finalisation_guards
      (id, owner_uid, session_id, step_number, verified, created_at)
      SELECT ?, upload.owner_uid, upload.id, ?, 1, ?
      FROM trade_mobile_upload_sessions upload
      WHERE upload.id = ? AND upload.owner_uid = ?
        AND upload.status = 'completing' AND upload.media_id = ''`)
      .bind(
        claimGuardId,
        FINALISATION_CLAIM_STEP,
        now,
        session.id,
        access.ownerUid,
      ),
  );
  expectOne(
    "job media",
    db.prepare(`INSERT INTO trade_crm_job_media
      (id, work_order_id, firebase_uid, category, file_name, content_type, size_bytes, object_key, caption,
       evidence_envelope, original_sha256, created_at, updated_at)
      SELECT ?, upload.work_order_id, upload.owner_uid, upload.category,
        upload.file_name, upload.content_type, upload.size_bytes,
        upload.object_key, upload.caption, upload.evidence_envelope,
        upload.original_sha256, ?, ?
      FROM trade_mobile_upload_sessions upload
      JOIN trade_mobile_upload_finalisation_guards claim
        ON claim.id = ? AND claim.owner_uid = upload.owner_uid
        AND claim.session_id = upload.id AND claim.step_number = ?
        AND claim.verified = 1
      WHERE upload.id = ? AND upload.owner_uid = ?
        AND upload.status = 'completing' AND upload.media_id = ''`)
      .bind(
        mediaId,
        now,
        now,
        claimGuardId,
        FINALISATION_CLAIM_STEP,
        session.id,
        access.ownerUid,
      ),
  );
  expectOne(
    "work-order event",
    db.prepare(`INSERT INTO trade_work_order_events
      (id, work_order_id, firebase_uid, event_type, summary, created_at)
      SELECT ?, upload.work_order_id, upload.owner_uid,
        'offline_field_file_added',
        'Field app uploaded a photo or document.', ?
      FROM trade_mobile_upload_sessions upload
      JOIN trade_mobile_upload_finalisation_guards claim
        ON claim.id = ? AND claim.owner_uid = upload.owner_uid
        AND claim.session_id = upload.id AND claim.step_number = ?
        AND claim.verified = 1
      JOIN trade_crm_job_media media
        ON media.id = ? AND media.work_order_id = upload.work_order_id
        AND media.firebase_uid = upload.owner_uid
        AND media.object_key = upload.object_key
      WHERE upload.id = ? AND upload.owner_uid = ?
        AND upload.status = 'completing'`)
      .bind(
        workEventId,
        now,
        claimGuardId,
        FINALISATION_CLAIM_STEP,
        mediaId,
        session.id,
        access.ownerUid,
      ),
  );
  expectOne(
    "work-order revision",
    db.prepare(`UPDATE trade_work_orders
      SET revision = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND revision = ?
        AND EXISTS (
          SELECT 1 FROM trade_mobile_upload_finalisation_guards claim
          WHERE claim.id = ? AND claim.owner_uid = ?
            AND claim.session_id = ? AND claim.step_number = ?
            AND claim.verified = 1
        )
        AND EXISTS (
          SELECT 1 FROM trade_crm_job_media media
          WHERE media.id = ? AND media.work_order_id = trade_work_orders.id
            AND media.firebase_uid = trade_work_orders.firebase_uid
        )
        AND EXISTS (
          SELECT 1 FROM trade_work_order_events event
          WHERE event.id = ? AND event.work_order_id = trade_work_orders.id
            AND event.firebase_uid = trade_work_orders.firebase_uid
        )`)
      .bind(
        revision,
        now,
        session.work_order_id,
        access.ownerUid,
        currentRevision,
        claimGuardId,
        access.ownerUid,
        session.id,
        FINALISATION_CLAIM_STEP,
        mediaId,
        workEventId,
      ),
  );

  if (evidence.link) {
    expectOne(
      "compliance evidence",
      db.prepare(`INSERT INTO compliance_case_evidence
        (id, organisation_id, case_id, requirement_id, job_media_id, supersedes_evidence_id,
         source_type, status, object_key, file_name, content_type, size_bytes, original_sha256,
         evidence_envelope, received_by_type, received_by_uid, received_at, reviewed_by_uid,
         reviewed_at, retention_until, legal_hold, created_at, updated_at)
        SELECT ?, c.organisation_id, c.id, r.id, ?, ?, 'field_app', 'received', ?, ?, ?, ?, ?, ?,
          'installer', ?, ?, '', '', '', 0, ?, ?
        FROM compliance_cases c
        JOIN compliance_evidence_policy_versions p
          ON p.id = ? AND p.organisation_id = c.organisation_id
          AND p.id = c.evidence_policy_version_id
          AND p.activity_version_id = c.activity_version_id
          AND p.publish_state IN ('published', 'withdrawn')
        JOIN compliance_evidence_requirements r
          ON r.id = ? AND r.organisation_id = c.organisation_id AND r.policy_version_id = p.id
          AND r.capture_timing = 'any'
        JOIN trade_mobile_upload_finalisation_guards claim
          ON claim.id = ? AND claim.owner_uid = ?
          AND claim.session_id = ? AND claim.step_number = ?
          AND claim.verified = 1
        WHERE c.id = ? AND c.work_order_id = ? AND c.installer_uid = ?
          AND c.activity_version_id = ? AND c.status NOT IN ('rejected', 'closed')`)
        .bind(evidenceId, mediaId, supersedesEvidenceId, session.object_key, session.file_name, session.content_type,
          session.size_bytes, session.original_sha256, session.evidence_envelope, access.actorUid,
          now, now, now, evidence.link.policyVersionId, evidence.link.requirementId,
          claimGuardId, access.ownerUid, session.id, FINALISATION_CLAIM_STEP,
          evidence.link.caseId, session.work_order_id, access.ownerUid, evidence.link.activityVersionId),
    );
    if (supersedesEvidenceId) {
      expectOne(
        "rejected evidence supersession",
        db.prepare(`UPDATE compliance_case_evidence
          SET status = 'superseded', updated_at = ?
          WHERE id = ? AND organisation_id = ? AND case_id = ?
            AND requirement_id = ? AND status = 'rejected'
            AND EXISTS (
              SELECT 1 FROM compliance_case_evidence replacement
              WHERE replacement.id = ? AND replacement.organisation_id = ?
                AND replacement.case_id = ? AND replacement.requirement_id = ?
                AND replacement.supersedes_evidence_id = compliance_case_evidence.id
                AND replacement.status = 'received'
            )`)
          .bind(
            now,
            supersedesEvidenceId,
            evidence.link.organisationId,
            evidence.link.caseId,
            evidence.link.requirementId,
            evidenceId,
            evidence.link.organisationId,
            evidence.link.caseId,
            evidence.link.requirementId,
          ),
      );
    }
    expectOne(
      "compliance case revision",
      db.prepare(`UPDATE compliance_cases SET
          status = CASE
            WHEN status IN ('ready_for_submission', 'accepted') THEN 'in_review'
            ELSE status
          END,
          evidence_status = 'in_progress',
          revision = revision + 1, updated_at = ?
        WHERE id = ? AND organisation_id = ? AND work_order_id = ? AND installer_uid = ?
          AND activity_version_id = ? AND evidence_policy_version_id = ?
          AND status NOT IN ('rejected', 'closed')
          AND EXISTS (
            SELECT 1 FROM compliance_case_evidence evidence
            WHERE evidence.id = ? AND evidence.case_id = compliance_cases.id
              AND evidence.organisation_id = compliance_cases.organisation_id
              AND evidence.job_media_id = ?
          )`)
        .bind(
          now,
          evidence.link.caseId,
          evidence.link.organisationId,
          session.work_order_id,
          access.ownerUid,
          evidence.link.activityVersionId,
          evidence.link.policyVersionId,
          evidenceId,
          mediaId,
        ),
    );
    expectOne(
      "compliance case event",
      db.prepare(`INSERT INTO compliance_case_events
        (id, case_id, organisation_id, event_type, actor_type, actor_uid, summary, metadata, created_at)
        SELECT ?, ?, ?, 'evidence_received', 'installer', ?,
          ?, ?, ?
        FROM trade_mobile_upload_finalisation_guards claim
        WHERE claim.id = ? AND claim.owner_uid = ?
          AND claim.session_id = ? AND claim.step_number = ?
          AND claim.verified = 1
          AND EXISTS (
            SELECT 1 FROM compliance_case_evidence evidence
            WHERE evidence.id = ? AND evidence.case_id = ?
              AND evidence.organisation_id = ?
          )
          AND EXISTS (
            SELECT 1 FROM compliance_cases compliance_case
            WHERE compliance_case.id = ? AND compliance_case.organisation_id = ?
              AND compliance_case.updated_at = ?
          )`)
        .bind(caseEventId, evidence.link.caseId, evidence.link.organisationId, access.actorUid,
          supersedesEvidenceId
            ? "Correction field evidence received for compliance review."
            : "Original field evidence received for compliance review.",
          JSON.stringify({
            evidenceId,
            mediaId,
            requirementId: evidence.link.requirementId,
            requirementCode: evidence.link.requirementCode,
            originalSha256: session.original_sha256,
            supersedesEvidenceId,
          }), now, claimGuardId, access.ownerUid, session.id,
          FINALISATION_CLAIM_STEP, evidenceId, evidence.link.caseId,
          evidence.link.organisationId, evidence.link.caseId,
          evidence.link.organisationId, now),
    );
    expectOne(
      "compliance audit event",
      db.prepare(`INSERT INTO compliance_audit_events
        (id, organisation_id, actor_type, actor_uid, event_type, target_type, target_id, summary, metadata, created_at)
        SELECT ?, ?, 'installer', ?, 'evidence_received', 'case', ?,
          ?, ?, ?
        FROM trade_mobile_upload_finalisation_guards claim
        WHERE claim.id = ? AND claim.owner_uid = ?
          AND claim.session_id = ? AND claim.step_number = ?
          AND claim.verified = 1
          AND EXISTS (
            SELECT 1 FROM compliance_case_evidence evidence
            WHERE evidence.id = ? AND evidence.case_id = ?
              AND evidence.organisation_id = ?
          )
          AND EXISTS (
            SELECT 1 FROM compliance_case_events event
            WHERE event.id = ? AND event.case_id = ?
              AND event.organisation_id = ?
          )`)
        .bind(auditEventId, evidence.link.organisationId, access.actorUid, evidence.link.caseId,
          supersedesEvidenceId
            ? "Correction field evidence received for compliance review."
            : "Original field evidence received for compliance review.",
          JSON.stringify({
            evidenceId,
            mediaId,
            requirementId: evidence.link.requirementId,
            originalSha256: session.original_sha256,
            supersedesEvidenceId,
          }), now, claimGuardId, access.ownerUid, session.id,
          FINALISATION_CLAIM_STEP, evidenceId, evidence.link.caseId,
          evidence.link.organisationId, caseEventId, evidence.link.caseId,
          evidence.link.organisationId),
    );
  }

  const complianceCompletionCondition = evidence.link
    ? `AND EXISTS (
        SELECT 1 FROM compliance_case_evidence evidence
        WHERE evidence.id = ? AND evidence.organisation_id = ?
          AND evidence.case_id = ? AND evidence.job_media_id = ?
          AND evidence.supersedes_evidence_id = ?
      )
      AND (
        ? = ''
        OR EXISTS (
          SELECT 1 FROM compliance_case_evidence superseded
          WHERE superseded.id = ? AND superseded.organisation_id = ?
            AND superseded.case_id = ? AND superseded.requirement_id = ?
            AND superseded.status = 'superseded'
        )
      )
      AND EXISTS (
        SELECT 1 FROM compliance_case_events event
        WHERE event.id = ? AND event.case_id = ?
          AND event.organisation_id = ?
      )
      AND EXISTS (
        SELECT 1 FROM compliance_audit_events audit
        WHERE audit.id = ? AND audit.organisation_id = ?
          AND audit.target_type = 'case' AND audit.target_id = ?
      )`
    : "";
  const complianceCompletionValues = evidence.link
    ? [
        evidenceId,
        evidence.link.organisationId,
        evidence.link.caseId,
        mediaId,
        supersedesEvidenceId,
        supersedesEvidenceId,
        supersedesEvidenceId,
        evidence.link.organisationId,
        evidence.link.caseId,
        evidence.link.requirementId,
        caseEventId,
        evidence.link.caseId,
        evidence.link.organisationId,
        auditEventId,
        evidence.link.organisationId,
        evidence.link.caseId,
      ]
    : [];
  expectOne(
    "upload completion",
    db.prepare(`UPDATE trade_mobile_upload_sessions
      SET status = 'completed', media_id = ?, completed_at = ?,
        last_error = '', updated_at = ?
      WHERE id = ? AND owner_uid = ? AND status = 'completing'
        AND media_id = ''
        AND EXISTS (
          SELECT 1 FROM trade_mobile_upload_finalisation_guards claim
          WHERE claim.id = ? AND claim.owner_uid = ?
            AND claim.session_id = trade_mobile_upload_sessions.id
            AND claim.step_number = ? AND claim.verified = 1
        )
        AND EXISTS (
          SELECT 1 FROM trade_crm_job_media media
          WHERE media.id = ? AND media.work_order_id = trade_mobile_upload_sessions.work_order_id
            AND media.firebase_uid = trade_mobile_upload_sessions.owner_uid
            AND media.object_key = trade_mobile_upload_sessions.object_key
        )
        AND EXISTS (
          SELECT 1 FROM trade_work_order_events event
          WHERE event.id = ? AND event.work_order_id = trade_mobile_upload_sessions.work_order_id
            AND event.firebase_uid = trade_mobile_upload_sessions.owner_uid
        )
        AND EXISTS (
          SELECT 1 FROM trade_work_orders work_order
          WHERE work_order.id = trade_mobile_upload_sessions.work_order_id
            AND work_order.firebase_uid = trade_mobile_upload_sessions.owner_uid
            AND work_order.revision = ?
            AND work_order.updated_at = ?
        )
        ${complianceCompletionCondition}`)
      .bind(
        mediaId,
        now,
        now,
        session.id,
        access.ownerUid,
        claimGuardId,
        access.ownerUid,
        FINALISATION_CLAIM_STEP,
        mediaId,
        workEventId,
        revision,
        now,
        ...complianceCompletionValues,
      ),
  );
  expectOne(
    "owner sync change",
    db.prepare(`INSERT INTO trade_team_sync_changes
      (owner_uid, audience_member_id, entity_type, entity_id, operation, revision, changed_at)
      SELECT upload.owner_uid, '', 'job', upload.work_order_id,
        'upsert', ?, ?
      FROM trade_mobile_upload_sessions upload
      JOIN trade_mobile_upload_finalisation_guards claim
        ON claim.id = ? AND claim.owner_uid = upload.owner_uid
        AND claim.session_id = upload.id AND claim.step_number = ?
        AND claim.verified = 1
      WHERE upload.id = ? AND upload.owner_uid = ?
        AND upload.status = 'completed' AND upload.media_id = ?`)
      .bind(
        revision,
        now,
        claimGuardId,
        FINALISATION_CLAIM_STEP,
        session.id,
        access.ownerUid,
        mediaId,
      ),
  );
  if (audienceMemberId) {
    expectOne(
      "assignee sync change",
      db.prepare(`INSERT INTO trade_team_sync_changes
        (owner_uid, audience_member_id, entity_type, entity_id, operation, revision, changed_at)
        SELECT upload.owner_uid, ?, 'job', upload.work_order_id,
          'upsert', ?, ?
        FROM trade_mobile_upload_sessions upload
        JOIN trade_mobile_upload_finalisation_guards claim
          ON claim.id = ? AND claim.owner_uid = upload.owner_uid
          AND claim.session_id = upload.id AND claim.step_number = ?
          AND claim.verified = 1
        WHERE upload.id = ? AND upload.owner_uid = ?
          AND upload.status = 'completed' AND upload.media_id = ?`)
        .bind(
          audienceMemberId,
          revision,
          now,
          claimGuardId,
          FINALISATION_CLAIM_STEP,
          session.id,
          access.ownerUid,
          mediaId,
        ),
    );
    expectOne(
      "assignee push event",
      db.prepare(`INSERT INTO trade_mobile_push_outbox
        (id, owner_uid, audience_member_id, event_key, event_type,
         entity_type, entity_id, payload, status, attempts,
         next_attempt_at, created_at, updated_at)
        SELECT ?, upload.owner_uid, ?, ?, 'job_changed', 'job',
          upload.work_order_id, ?, 'pending', 0, '', ?, ?
        FROM trade_mobile_upload_sessions upload
        JOIN trade_mobile_upload_finalisation_guards claim
          ON claim.id = ? AND claim.owner_uid = upload.owner_uid
          AND claim.session_id = upload.id AND claim.step_number = ?
          AND claim.verified = 1
        WHERE upload.id = ? AND upload.owner_uid = ?
          AND upload.status = 'completed' AND upload.media_id = ?`)
        .bind(
          crypto.randomUUID(),
          audienceMemberId,
          pushEventKey,
          JSON.stringify({ contractVersion: 2, reason: "sync_required" }),
          now,
          now,
          claimGuardId,
          FINALISATION_CLAIM_STEP,
          session.id,
          access.ownerUid,
          mediaId,
        ),
    );
  }

  const complianceVerificationCondition = evidence.link
    ? `AND EXISTS (
        SELECT 1 FROM compliance_case_evidence evidence
        WHERE evidence.id = ? AND evidence.organisation_id = ?
          AND evidence.case_id = ? AND evidence.job_media_id = ?
          AND evidence.original_sha256 = upload.original_sha256
          AND evidence.evidence_envelope = upload.evidence_envelope
          AND evidence.supersedes_evidence_id = ?
      )
      AND (
        ? = ''
        OR EXISTS (
          SELECT 1 FROM compliance_case_evidence superseded
          WHERE superseded.id = ? AND superseded.organisation_id = ?
            AND superseded.case_id = ? AND superseded.requirement_id = ?
            AND superseded.status = 'superseded'
        )
      )
      AND EXISTS (
        SELECT 1 FROM compliance_cases compliance_case
        WHERE compliance_case.id = ? AND compliance_case.organisation_id = ?
          AND compliance_case.updated_at = ?
          AND compliance_case.evidence_policy_version_id = ?
          AND compliance_case.status NOT IN (
            'ready_for_submission', 'accepted', 'rejected', 'closed'
          )
          AND compliance_case.evidence_status <> 'not_started'
      )
      AND EXISTS (
        SELECT 1 FROM compliance_case_events event
        WHERE event.id = ? AND event.case_id = ?
          AND event.organisation_id = ?
      )
      AND EXISTS (
        SELECT 1 FROM compliance_audit_events audit
        WHERE audit.id = ? AND audit.organisation_id = ?
          AND audit.target_type = 'case' AND audit.target_id = ?
      )`
    : "";
  const complianceVerificationValues = evidence.link
    ? [
        evidenceId,
        evidence.link.organisationId,
        evidence.link.caseId,
        mediaId,
        supersedesEvidenceId,
        supersedesEvidenceId,
        supersedesEvidenceId,
        evidence.link.organisationId,
        evidence.link.caseId,
        evidence.link.requirementId,
        evidence.link.caseId,
        evidence.link.organisationId,
        now,
        evidence.link.policyVersionId,
        caseEventId,
        evidence.link.caseId,
        evidence.link.organisationId,
        auditEventId,
        evidence.link.organisationId,
        evidence.link.caseId,
      ]
    : [];
  const pushVerificationCondition = audienceMemberId
    ? `AND EXISTS (
        SELECT 1 FROM trade_mobile_push_outbox push
        WHERE push.owner_uid = upload.owner_uid
          AND push.audience_member_id = ?
          AND push.event_key = ?
      )`
    : "";
  const pushVerificationValues = audienceMemberId
    ? [audienceMemberId, pushEventKey]
    : [];
  expectOne(
    "finalisation verification",
    db.prepare(`INSERT INTO trade_mobile_upload_finalisation_guards
      (id, owner_uid, session_id, step_number, verified, created_at)
      SELECT ?, upload.owner_uid, upload.id, ?,
        CASE WHEN upload.status = 'completed' AND upload.media_id = ?
          AND upload.completed_at = ?
          AND EXISTS (
            SELECT 1 FROM trade_crm_job_media media
            WHERE media.id = ? AND media.work_order_id = upload.work_order_id
              AND media.firebase_uid = upload.owner_uid
              AND media.object_key = upload.object_key
              AND media.original_sha256 = upload.original_sha256
              AND media.evidence_envelope = upload.evidence_envelope
          )
          AND EXISTS (
            SELECT 1 FROM trade_work_order_events event
            WHERE event.id = ? AND event.work_order_id = upload.work_order_id
              AND event.firebase_uid = upload.owner_uid
          )
          AND EXISTS (
            SELECT 1 FROM trade_work_orders work_order
            WHERE work_order.id = upload.work_order_id
              AND work_order.firebase_uid = upload.owner_uid
              AND work_order.revision = ?
              AND work_order.updated_at = ?
          )
          AND (
            SELECT COUNT(*) FROM trade_team_sync_changes change
            WHERE change.owner_uid = upload.owner_uid
              AND change.entity_type = 'job'
              AND change.entity_id = upload.work_order_id
              AND change.operation = 'upsert'
              AND change.revision = ?
              AND change.changed_at = ?
          ) = ?
          ${complianceVerificationCondition}
          ${pushVerificationCondition}
        THEN 1 ELSE 0 END,
        ?
      FROM trade_mobile_upload_sessions upload
      JOIN trade_mobile_upload_finalisation_guards claim
        ON claim.id = ? AND claim.owner_uid = upload.owner_uid
        AND claim.session_id = upload.id AND claim.step_number = ?
        AND claim.verified = 1
      WHERE upload.id = ? AND upload.owner_uid = ?`)
      .bind(
        verifiedGuardId,
        FINALISATION_VERIFIED_STEP,
        mediaId,
        now,
        mediaId,
        workEventId,
        revision,
        now,
        revision,
        now,
        expectedSyncChanges,
        ...complianceVerificationValues,
        ...pushVerificationValues,
        now,
        claimGuardId,
        FINALISATION_CLAIM_STEP,
        session.id,
        access.ownerUid,
      ),
  );

  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch (error) {
    const duplicate = await completedUpload(access, session.id, true);
    if (duplicate) {
      return {
        revision: Number(duplicate.job_revision),
        mediaId: duplicate.media_id,
        completedAt: duplicate.completed_at,
        duplicate: true,
      };
    }
    if (
      error instanceof Error
      && error.message.includes("COMPLIANCE_EVIDENCE_MAXIMUM_REACHED")
    ) {
      throw new EvidenceContractError(
        "EVIDENCE_MAXIMUM_REACHED",
        "The policy maximum has already been reached for this evidence requirement.",
        409,
      );
    }
    if (
      error instanceof Error
      && (
        error.message.includes("COMPLIANCE_EVIDENCE_DUPLICATE_ORIGINAL")
        || error.message.includes(
          "compliance_case_evidence_active_original_idx",
        )
        || (
          error.message.includes("UNIQUE constraint failed")
          && error.message.includes(
            "compliance_case_evidence.organisation_id",
          )
          && error.message.includes(
            "compliance_case_evidence.original_sha256",
          )
        )
      )
    ) {
      throw new EvidenceContractError(
        "EVIDENCE_DUPLICATE_ORIGINAL",
        "This exact evidence original is already active for the selected case requirement.",
        409,
      );
    }
    throw error;
  }
  const failedChange = expectedChanges.find(({ index }) =>
    Number(results[index]?.meta.changes || 0) !== 1
  );
  if (failedChange) {
    const duplicate = await completedUpload(access, session.id, true);
    if (duplicate) {
      return {
        revision: Number(duplicate.job_revision),
        mediaId: duplicate.media_id,
        completedAt: duplicate.completed_at,
        duplicate: true,
      };
    }
    throw new EvidenceContractError(
      "UPLOAD_FINALISATION_INCOMPLETE",
      `The verified upload finalisation did not complete its ${failedChange.label} write.`,
      409,
    );
  }
  const completed = await completedUpload(access, session.id, true);
  if (!completed) {
    throw new EvidenceContractError(
      "UPLOAD_FINALISATION_INCOMPLETE",
      "The verified upload finalisation could not be confirmed.",
      409,
    );
  }
  return {
    revision: Number(completed.job_revision),
    mediaId: completed.media_id,
    completedAt: completed.completed_at,
    duplicate: false,
  };
}

async function rejectAssembledUpload(
  access: TeamAccess,
  session: UploadSession,
  lastError: string,
) {
  const pendingError = `${CLEANUP_PENDING_PREFIX}${lastError}`;
  const claim = await getD1().prepare(`UPDATE trade_mobile_upload_sessions
    SET status = 'rejected', last_error = ?, updated_at = ?
    WHERE id = ? AND owner_uid = ? AND actor_uid = ? AND member_id = ?
      AND device_id = ? AND status = 'completing' AND media_id = ''`)
    .bind(
      pendingError,
      new Date().toISOString(),
      session.id,
      access.ownerUid,
      access.actorUid,
      access.memberId,
      session.device_id,
    ).run();
  if (Number(claim.meta.changes || 0) !== 1) return false;
  await finishTerminalUploadCleanup({
    id: session.id,
    owner_uid: access.ownerUid,
    object_key: session.object_key,
    upload_id: session.upload_id,
    status: "rejected",
    last_error: pendingError,
  });
  return true;
}

async function complete(request: Request, access: TeamAccess, body: Record<string, unknown>) {
  const deviceId = cleanAdminText(body.deviceId, 120);
  const registeredDevice = await requireRegisteredMobileDevice(
    request,
    access,
    deviceId,
    cleanAdminText(body.platform, 20),
    cleanAdminText(body.appVersion, 40),
  );
  await sweepTerminalUploadCleanup();
  let session = await findSession(access, cleanAdminText(body.sessionId, 180));
  if (session.device_id !== deviceId) return adminJson({ ok: false, error: "This upload belongs to a different device." }, 403);
  if (session.status === "completed") {
    const duplicate = await safeDuplicateResponse(access, session.id);
    return duplicate || adminJson({
      ok: false,
      code: "UPLOAD_FINALISATION_UNVERIFIED",
      error: "The completed upload could not be matched to its stored job media.",
    }, 409);
  }
  if (session.status === "expired") {
    return adminJson({ ok: false, code: "UPLOAD_EXPIRED", error: "This upload expired. Start it again." }, 410);
  }
  if (!["initiated", "uploading", "completing"].includes(session.status)) return adminJson({ ok: false, error: "This upload cannot be completed." }, 409);
  if (session.expires_at <= new Date().toISOString()) return adminJson({ ok: false, code: "UPLOAD_EXPIRED", error: "This upload expired. Start it again." }, 410);
  await assignedJob(access, session.work_order_id);
  const parts = await sessionParts(session.id); const totalParts = Math.ceil(Number(session.size_bytes) / Number(session.part_size_bytes));
  if (parts.length !== totalParts || parts.reduce((sum, part) => sum + part.sizeBytes, 0) !== Number(session.size_bytes)) {
    return adminJson({ ok: false, code: "UPLOAD_INCOMPLETE", error: "Upload every file part before completing this file.",
      uploadedParts: parts.length, totalParts }, 409);
  }
  const now = new Date().toISOString();
  let claimedAssembly = false;
  if (session.status !== "completing") {
    const claim = await getD1().prepare(`UPDATE trade_mobile_upload_sessions
      SET status = 'completing', last_error = '', updated_at = ?
      WHERE id = ? AND owner_uid = ? AND actor_uid = ? AND member_id = ?
        AND device_id = ? AND status IN ('initiated', 'uploading')
        AND media_id = ''`)
      .bind(
        now,
        session.id,
        access.ownerUid,
        access.actorUid,
        access.memberId,
        deviceId,
      ).run();
    if (Number(claim.meta.changes || 0) !== 1) {
      const latest = await findSession(access, session.id);
      if (latest.status === "completed") {
        const duplicate = await safeDuplicateResponse(access, latest.id);
        return duplicate || adminJson({
          ok: false,
          code: "UPLOAD_FINALISATION_UNVERIFIED",
          error: "The completed upload could not be matched to its stored job media.",
        }, 409);
      }
      if (latest.status !== "completing" || latest.device_id !== deviceId) {
        return adminJson({
          ok: false,
          code: "UPLOAD_STATE_CHANGED",
          error: "This upload changed state before completion could begin.",
        }, 409);
      }
      session = latest;
    } else {
      claimedAssembly = true;
      session = { ...session, status: "completing" };
    }
  }
  if (claimedAssembly) {
    try {
      await bucket().resumeMultipartUpload(session.object_key, session.upload_id)
        .complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
    } catch (error) {
      if (!await bucket().head(session.object_key)) {
        await getD1().prepare(`UPDATE trade_mobile_upload_sessions
          SET last_error = 'complete_failed', updated_at = ?
          WHERE id = ? AND owner_uid = ? AND status = 'completing'
            AND media_id = ''`)
          .bind(new Date().toISOString(), session.id, access.ownerUid).run();
        throw error;
      }
    }
  } else if (!await bucket().head(session.object_key)) {
    try {
      await bucket().resumeMultipartUpload(session.object_key, session.upload_id)
        .complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
    } catch {
      if (!await bucket().head(session.object_key)) {
        await getD1().prepare(`UPDATE trade_mobile_upload_sessions
          SET last_error = 'recovery_failed', updated_at = ?
          WHERE id = ? AND owner_uid = ? AND status = 'completing'
            AND media_id = ''`)
          .bind(new Date().toISOString(), session.id, access.ownerUid).run();
        return adminJson({
          ok: false,
          code: "UPLOAD_RECOVERY_REQUIRED",
          error: "The interrupted upload could not be assembled. Retry completion using its saved parts.",
        }, 409);
      }
    }
  }
  const object = await bucket().get(session.object_key);
  if (!object) {
    await getD1().prepare(`UPDATE trade_mobile_upload_sessions
      SET last_error = 'assembled_object_missing', updated_at = ?
      WHERE id = ? AND owner_uid = ? AND status = 'completing'
        AND media_id = ''`)
      .bind(new Date().toISOString(), session.id, access.ownerUid).run();
    return adminJson({
      ok: false,
      code: "UPLOAD_RECOVERY_REQUIRED",
      error: "The assembled file could not be verified. Retry completion using its saved parts.",
    }, 409);
  }
  const assembledBytes = await object.arrayBuffer();
  const assembledSha256 = await sha256Hex(assembledBytes);
  if (assembledBytes.byteLength !== Number(session.size_bytes) ||
    (session.original_sha256 !== "" && assembledSha256 !== session.original_sha256)) {
    await rejectAssembledUpload(access, session, "original_sha256_mismatch");
    return adminJson({
      ok: false,
      code: "EVIDENCE_HASH_MISMATCH",
      error: "The uploaded bytes do not match the original evidence digest. Capture or upload the file again.",
    }, 409);
  }
  if (!matchesDeclaredFileSignature(assembledBytes, session.content_type)) {
    await rejectAssembledUpload(access, session, "content_type_signature_mismatch");
    return adminJson({
      ok: false,
      code: "EVIDENCE_FILE_SIGNATURE_MISMATCH",
      error: "The uploaded file bytes do not match the declared JPEG, PNG, WebP or PDF type.",
    }, 409);
  }
  const trustedFile: TrustedFileInspection = {
    contentType: session.content_type,
    originalSha256: assembledSha256,
    jpegExif: session.content_type === "image/jpeg"
      ? verifyJpegExif(new Uint8Array(assembledBytes))
      : null,
  };
  if (session.original_sha256 === "") {
    const hashUpdate = await getD1().prepare(`UPDATE trade_mobile_upload_sessions
      SET original_sha256 = ?, updated_at = ?
      WHERE id = ? AND owner_uid = ? AND status = 'completing'
        AND media_id = '' AND original_sha256 = ''`)
      .bind(assembledSha256, new Date().toISOString(), session.id, access.ownerUid).run();
    if (Number(hashUpdate.meta.changes || 0) !== 1) {
      const latest = await findSession(access, session.id);
      if (latest.status === "completed") {
        const duplicate = await safeDuplicateResponse(access, latest.id);
        return duplicate || adminJson({
          ok: false,
          code: "UPLOAD_FINALISATION_UNVERIFIED",
          error: "The completed upload could not be matched to its stored job media.",
        }, 409);
      }
      if (latest.status !== "completing" || latest.original_sha256 !== assembledSha256) {
        return adminJson({
          ok: false,
          code: "EVIDENCE_HASH_STATE_CHANGED",
          error: "The upload evidence digest changed during final verification.",
        }, 409);
      }
      session = latest;
    } else {
      session = { ...session, original_sha256: assembledSha256 };
    }
  }
  let verifiedEnvelopeJson: string;
  try {
    verifiedEnvelopeJson = serverVerifiedEnvelopeJson(
      session.evidence_envelope,
      trustedFile,
    );
  } catch (error) {
    if (error instanceof EvidenceContractError) {
      await rejectAssembledUpload(
        access,
        session,
        "server_verification_envelope_invalid",
      );
    }
    throw error;
  }
  if (verifiedEnvelopeJson !== session.evidence_envelope) {
    const envelopeUpdate = await getD1().prepare(`UPDATE trade_mobile_upload_sessions
      SET evidence_envelope = ?, updated_at = ?
      WHERE id = ? AND owner_uid = ? AND status = 'completing'
        AND media_id = ''`)
      .bind(
        verifiedEnvelopeJson,
        new Date().toISOString(),
        session.id,
        access.ownerUid,
      )
      .run();
    if (Number(envelopeUpdate.meta.changes || 0) !== 1) {
      const latest = await findSession(access, session.id);
      if (latest.status === "completed") {
        const duplicate = await safeDuplicateResponse(access, latest.id);
        return duplicate || adminJson({
          ok: false,
          code: "UPLOAD_FINALISATION_UNVERIFIED",
          error: "The completed upload could not be matched to its stored job media.",
        }, 409);
      }
      if (
        latest.status !== "completing"
        || latest.evidence_envelope !== verifiedEnvelopeJson
      ) {
        return adminJson({
          ok: false,
          code: "EVIDENCE_VERIFICATION_STATE_CHANGED",
          error: "The server-verified evidence envelope changed during completion.",
        }, 409);
      }
      session = latest;
    } else {
      session = { ...session, evidence_envelope: verifiedEnvelopeJson };
    }
  }
  let result: Awaited<ReturnType<typeof finalise>>;
  try {
    result = await finalise(access, session, registeredDevice, trustedFile);
  } catch (error) {
    if (error instanceof EvidenceContractError) {
      const rejectionReasons: Record<string, string> = {
        EVIDENCE_CAPTURE_TIME_ZONE_INVALID:
          "capture_time_zone_invalid",
        EVIDENCE_CAPTURE_TIME_OUT_OF_RANGE:
          "capture_time_out_of_range",
        EVIDENCE_ACTIVITY_DATE_MISMATCH:
          "activity_date_mismatch",
        EVIDENCE_ACTIVITY_VERSION_DATE_INVALID:
          "activity_version_date_invalid",
        EVIDENCE_MAXIMUM_REACHED: "maximum_count_reached",
        EVIDENCE_DUPLICATE_ORIGINAL: "duplicate_original",
        EVIDENCE_REQUIREMENT_UNSUPPORTED: "requirement_unsupported",
        EVIDENCE_SERVER_VERIFICATION_INVALID: "server_verification_invalid",
        EVIDENCE_EMBEDDED_METADATA_REQUIRED: "embedded_metadata_missing",
        EVIDENCE_EMBEDDED_GPS_REQUIRED: "embedded_gps_missing",
        EVIDENCE_EMBEDDED_CAPTURE_TIME_REQUIRED:
          "embedded_capture_time_missing",
        EVIDENCE_EMBEDDED_CAPTURE_TIME_MISMATCH:
          "embedded_capture_time_mismatch",
        EVIDENCE_LOCATION_MISMATCH: "embedded_location_mismatch",
      };
      const reason = rejectionReasons[error.code];
      if (reason) await rejectAssembledUpload(access, session, reason);
    }
    throw error;
  }
  const completed = await findSession(access, session.id);
  return adminJson(
    { ok: true, duplicate: result.duplicate, contractVersion: 3, result, upload: await sessionPayload(completed) },
    result.duplicate ? 200 : 201,
  );
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); const url = new URL(request.url);
    if (!access.canViewFieldEvidence) throw new Error("FIELD_EVIDENCE_VIEW_REQUIRED");
    const deviceId = cleanAdminText(url.searchParams.get("deviceId"), 120);
    await requireRegisteredMobileDevice(request, access, deviceId);
  await sweepTerminalUploadCleanup();
    const session = await findSession(access, cleanAdminText(url.searchParams.get("sessionId"), 180));
    if (session.device_id !== deviceId) return adminJson({ ok: false, error: "This upload belongs to a different device." }, 403);
    await assignedJob(access, session.work_order_id);
    return adminJson({ ok: true, contractVersion: 3, upload: await sessionPayload(session) });
  } catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_NOT_FOUND") return adminJson({ ok: false, error: "Upload session not found." }, 404);
    return mediaError(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.canManageFieldEvidence) throw new Error("FIELD_EVIDENCE_MANAGEMENT_REQUIRED");
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await request.formData();
      if (cleanAdminText(form.get("action"), 30) !== "upload_part") return adminJson({ ok: false, error: "Unsupported upload action." }, 400);
      return await uploadPart(request, access, form);
    }
    let parsedBody: unknown;
    try {
      parsedBody = await readBoundedJsonRequest(request, MAX_MEDIA_JSON_BYTES);
    } catch (error) {
      return adminJson({
        ok: false,
        error: error instanceof BoundedJsonRequestError
          && error.code === "REQUEST_TOO_LARGE"
          ? "The upload request is too large."
          : "The upload request is invalid.",
      }, error instanceof BoundedJsonRequestError ? error.status : 400);
    }
    if (
      !parsedBody
      || typeof parsedBody !== "object"
      || Array.isArray(parsedBody)
    ) {
      return adminJson({
        ok: false,
        error: "The upload request is invalid.",
      }, 400);
    }
    const body = parsedBody as Record<string, unknown>;
    const action = cleanAdminText(body.action, 30);
    if (action === "initiate") return await initiate(request, access, body);
    if (action === "complete") return await complete(request, access, body);
    return adminJson({ ok: false, error: "Unsupported upload action." }, 400);
  } catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_NOT_FOUND") return adminJson({ ok: false, error: "Upload session not found." }, 404);
    return mediaError(error);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); const url = new URL(request.url);
    if (!access.canManageFieldEvidence) throw new Error("FIELD_EVIDENCE_MANAGEMENT_REQUIRED");
    const deviceId = cleanAdminText(url.searchParams.get("deviceId"), 120);
    await requireRegisteredMobileDevice(request, access, deviceId);
    await sweepTerminalUploadCleanup();
    const session = await findSession(access, cleanAdminText(url.searchParams.get("sessionId"), 180));
    if (session.device_id !== deviceId) return adminJson({ ok: false, error: "This upload belongs to a different device." }, 403);
    const now = new Date().toISOString();
    const pendingError = `${CLEANUP_PENDING_PREFIX}aborted`;
    const claim = await getD1().prepare(`UPDATE trade_mobile_upload_sessions
      SET status = 'aborted', last_error = ?, updated_at = ?
      WHERE id = ? AND owner_uid = ? AND actor_uid = ? AND member_id = ?
        AND device_id = ? AND status IN ('initiated', 'uploading', 'completing')
        AND media_id = ''`)
      .bind(
        pendingError,
        now,
        session.id,
        access.ownerUid,
        access.actorUid,
        access.memberId,
        deviceId,
      ).run();
    const aborted = Number(claim.meta.changes || 0) === 1;
    let cleanupPending = false;
    if (aborted) {
      cleanupPending = !await finishTerminalUploadCleanup({
        id: session.id,
        owner_uid: access.ownerUid,
        object_key: session.object_key,
        upload_id: session.upload_id,
        status: "aborted",
        last_error: pendingError,
      });
    }
    return adminJson({ ok: true, aborted, cleanupPending });
  } catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_NOT_FOUND") return adminJson({ ok: false, error: "Upload session not found." }, 404);
    return mediaError(error);
  }
}
