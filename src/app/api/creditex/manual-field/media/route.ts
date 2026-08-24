import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../../db";
import {
  attachVerifiedManualFieldCapture,
  CREDITEX_MANUAL_FIELD_MAX_BYTES,
  CREDITEX_MANUAL_FIELD_PART_BYTES,
  CreditexManualFieldError,
  manualFieldErrorResponse,
  manualFieldJobRow,
  rejectUnattachedManualFieldUploadSession,
  requireManualFieldDevice,
  requireManualFieldMember,
} from "@/lib/creditex-manual-field-server";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import {
  validateManualEvidenceFormSchema,
  type ManualEvidenceField,
} from "@/lib/creditex-manual-evidence-lab";
import { sha256Hex } from "@/lib/creditex-official-source-custody-server";
import { verifyJpegExif } from "@/lib/jpeg-exif-verifier";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["initiated", "uploading"]);
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const SESSION_HOURS = 24;

type UploadedPart = {
  partNumber: number;
  etag: string;
};

type MultipartUpload = {
  uploadId: string;
  uploadPart(partNumber: number, value: ArrayBuffer): Promise<UploadedPart>;
  complete(parts: UploadedPart[]): Promise<unknown>;
  abort(): Promise<void>;
};

type EvidenceBucket = {
  createMultipartUpload(
    key: string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): MultipartUpload;
  get(key: string): Promise<{
    size?: number;
    httpMetadata?: { contentType?: string };
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
  head(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
};

type UploadSession = {
  id: string;
  organisation_id: string;
  job_id: string;
  field_code: string;
  field_tester_uid: string;
  device_id: string;
  client_upload_id: string;
  object_key: string;
  upload_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  part_size_bytes: number;
  evidence_envelope: string;
  declared_sha256: string;
  status: string;
  capture_id: string;
  last_error: string;
  record_mode: string;
  expires_at: string;
  created_at: string;
  completed_at: string;
  updated_at: string;
};

type AttachedCapture = {
  captureId: string;
  integrityReceiptId: string;
  physicalDeviceState: "reported_physical" | "reported_emulator";
};

type Envelope = {
  schemaVersion?: unknown;
  source?: unknown;
  identifiers?: unknown;
  capture?: unknown;
  location?: unknown;
  original?: unknown;
  integrity?: unknown;
  provenance?: unknown;
};

function bucket() {
  const value = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!value) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_STORAGE_UNAVAILABLE",
      503,
      "Synthetic evidence storage is unavailable.",
    );
  }
  return value;
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, maximum: number) {
  return String(value || "").trim().slice(0, maximum);
}

function cleanIdentifier(
  value: unknown,
  code: string,
  message: string,
  maximum = 180,
) {
  const cleaned = cleanText(value, maximum);
  if (
    !cleaned
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,179}$/.test(cleaned)
  ) {
    throw new CreditexManualFieldError(code, 400, message);
  }
  return cleaned;
}

function safeName(value: unknown) {
  return cleanText(value, 180)
    .replace(/[\r\n"\\/]/g, "_")
    || "synthetic-field-file";
}

function exactContentType(value: unknown) {
  const contentType = cleanText(value, 120).toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new CreditexManualFieldError(
      "EVIDENCE_CONTENT_TYPE_INVALID",
      400,
      "Choose an original JPEG, PNG, WebP or PDF file.",
    );
  }
  return contentType;
}

function exactSize(value: unknown) {
  const size = Number(value);
  if (
    !Number.isSafeInteger(size)
    || size < 1
    || size > CREDITEX_MANUAL_FIELD_MAX_BYTES
  ) {
    throw new CreditexManualFieldError(
      "EVIDENCE_SIZE_INVALID",
      400,
      "Synthetic field evidence must be from 1 byte to 50 MB.",
    );
  }
  return size;
}

function parsedEnvelope(value: unknown) {
  const envelope = objectValue(value) as Envelope | null;
  if (!envelope || envelope.schemaVersion !== 1) {
    throw new CreditexManualFieldError(
      "EVIDENCE_ENVELOPE_INVALID",
      400,
      "The TLink evidence envelope is invalid.",
    );
  }
  return envelope;
}

function fieldForSession(
  formSchema: string,
  fieldCode: string,
) {
  const schema = validateManualEvidenceFormSchema(JSON.parse(formSchema));
  const field = schema.fields.find(
    (candidate) => candidate.fieldCode === fieldCode,
  );
  if (
    !field
    || (field.fieldType !== "photo" && field.fieldType !== "document")
  ) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_REQUIREMENT_INVALID",
      409,
      "The locked evidence prompt does not accept a file.",
    );
  }
  return field;
}

function validateEnvelope(
  envelope: Envelope,
  input: {
    jobId: string;
    field: ManualEvidenceField;
    deviceId: string;
    contentType: string;
    sizeBytes: number;
  },
) {
  const identifiers = objectValue(envelope.identifiers);
  const original = objectValue(envelope.original);
  const integrity = objectValue(envelope.integrity);
  const provenance = objectValue(envelope.provenance);
  const capture = objectValue(envelope.capture);
  if (
    !identifiers
    || identifiers.jobId !== input.jobId
    || identifiers.evidenceRequirementCode !== input.field.fieldCode
    || identifiers.evidenceRequirementId
      !== `${input.jobId}:${input.field.fieldCode}`
  ) {
    throw new CreditexManualFieldError(
      "EVIDENCE_LINK_INVALID",
      409,
      "The evidence envelope is not linked to this locked synthetic prompt.",
    );
  }
  if (
    !integrity
    || integrity.algorithm !== "SHA-256"
    || !/^[0-9a-f]{64}$/.test(
      String(integrity.digestHex || "").toLowerCase(),
    )
    || Number(integrity.byteLength) !== input.sizeBytes
  ) {
    throw new CreditexManualFieldError(
      "EVIDENCE_HASH_INVALID",
      400,
      "The original evidence digest is missing or invalid.",
    );
  }
  if (
    !original
    || original.preservedWithoutAppTransformation !== true
    || original.editingApplied !== false
  ) {
    throw new CreditexManualFieldError(
      "EVIDENCE_ORIGINAL_REQUIRED",
      409,
      "Use the unedited original file captured or selected in TLink.",
    );
  }
  if (
    !provenance
    || provenance.installationId !== input.deviceId
    || !["ios", "android"].includes(String(provenance.platform || ""))
  ) {
    throw new CreditexManualFieldError(
      "EVIDENCE_DEVICE_INVALID",
      409,
      "The evidence provenance does not match this registered test device.",
    );
  }
  if (
    !capture
    || !Number.isFinite(Date.parse(String(capture.observedAtUtc || "")))
    || !Number.isInteger(Number(capture.utcOffsetMinutes))
    || Math.abs(Number(capture.utcOffsetMinutes)) > 14 * 60
  ) {
    throw new CreditexManualFieldError(
      "EVIDENCE_CAPTURE_TIME_REQUIRED",
      409,
      "The evidence capture time and timezone are required.",
    );
  }
  if (!input.field.allowedContentTypes.includes(input.contentType)) {
    throw new CreditexManualFieldError(
      "EVIDENCE_CONTENT_TYPE_INVALID",
      409,
      "The locked evidence prompt does not allow this file type.",
    );
  }
  if (
    input.field.fieldType === "photo"
    && envelope.source !== "in_app_camera"
  ) {
    throw new CreditexManualFieldError(
      "EVIDENCE_CAPTURE_SOURCE_INVALID",
      409,
      "Take this photo inside TLink.",
    );
  }
  if (
    input.field.fieldType === "document"
    && envelope.source !== "document_picker"
  ) {
    throw new CreditexManualFieldError(
      "EVIDENCE_CAPTURE_SOURCE_INVALID",
      409,
      "Choose the original document in TLink.",
    );
  }
  return {
    declaredSha256: String(integrity.digestHex).toLowerCase(),
    physicalDeviceReported: provenance.isPhysicalDevice === true,
  };
}

function validSignature(bytes: Uint8Array, contentType: string) {
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
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return bytes.length >= 5
    && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
}

function capturedLocation(envelope: Envelope) {
  const location = objectValue(envelope.location);
  if (
    !location
    || location.state !== "captured"
    || location.mocked === true
    || !Number.isFinite(Number(location.latitude))
    || Number(location.latitude) < -90
    || Number(location.latitude) > 90
    || !Number.isFinite(Number(location.longitude))
    || Number(location.longitude) < -180
    || Number(location.longitude) > 180
    || !Number.isFinite(Number(location.accuracyMetres))
    || Number(location.accuracyMetres) < 0
    || Number(location.accuracyMetres) > 100
    || !Number.isFinite(Date.parse(String(location.observedAtUtc || "")))
  ) return null;
  return location;
}

function captureTimeVerified(envelope: Envelope) {
  const capture = objectValue(envelope.capture);
  if (!capture) return false;
  const timestamp = Date.parse(String(capture.observedAtUtc || ""));
  return Number.isFinite(timestamp)
    && timestamp <= Date.now() + 5 * 60 * 1_000
    && timestamp >= Date.now() - 7 * 24 * 60 * 60 * 1_000;
}

async function sessionParts(sessionId: string) {
  const result = await getD1().prepare(`SELECT
      part_number partNumber, etag, size_bytes sizeBytes
    FROM compliance_manual_field_upload_parts
    WHERE session_id = ? ORDER BY part_number`)
    .bind(sessionId)
    .all<{ partNumber: number; etag: string; sizeBytes: number }>();
  return result.results.map((part) => ({
    partNumber: Number(part.partNumber),
    etag: part.etag,
    sizeBytes: Number(part.sizeBytes),
  }));
}

async function findSession(
  organisationId: string,
  testerUid: string,
  sessionId: string,
) {
  const session = await getD1().prepare(`SELECT *
    FROM compliance_manual_field_upload_sessions
    WHERE id = ? AND organisation_id = ? AND field_tester_uid = ?
      AND record_mode = 'synthetic_test'
    LIMIT 1`)
    .bind(sessionId, organisationId, testerUid)
    .first<UploadSession>();
  if (!session) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_UPLOAD_NOT_FOUND",
      404,
      "The synthetic evidence upload session was not found.",
    );
  }
  return session;
}

async function sessionPayload(session: UploadSession) {
  const parts = await sessionParts(session.id);
  return {
    id: session.id,
    partSizeBytes: Number(session.part_size_bytes),
    totalParts: Math.ceil(
      Number(session.size_bytes) / Number(session.part_size_bytes),
    ),
    status: session.status,
    parts,
    captureId: session.capture_id,
    recordMode: "synthetic_test",
  };
}

async function attachedCaptureForSession(
  organisationId: string,
  sessionId: string,
) {
  const row = await getD1().prepare(`SELECT
      capture.id capture_id,
      capture.physical_device_state physical_device_state,
      receipt.id integrity_receipt_id
    FROM compliance_manual_evidence_test_captures capture
    JOIN compliance_manual_field_integrity_receipts receipt
      ON receipt.capture_id = capture.id
      AND receipt.organisation_id = capture.organisation_id
      AND receipt.result = 'matched'
    WHERE capture.organisation_id = ?
      AND capture.upload_session_id = ?
      AND capture.record_mode = 'synthetic_test'
      AND capture.status = 'captured'
    ORDER BY receipt.verified_at DESC, receipt.id DESC
    LIMIT 1`)
    .bind(organisationId, sessionId)
    .first<{
      capture_id: string;
      integrity_receipt_id: string;
      physical_device_state: string;
    }>();
  if (!row) return null;
  return {
    captureId: row.capture_id,
    integrityReceiptId: row.integrity_receipt_id,
    physicalDeviceState:
      row.physical_device_state === "reported_physical"
        ? "reported_physical"
        : "reported_emulator",
  } satisfies AttachedCapture;
}

async function finalizeAttachedSession(
  database: D1Database,
  member: { organisationId: string; uid: string },
  session: UploadSession,
  capture: AttachedCapture,
) {
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`UPDATE compliance_manual_field_upload_sessions
      SET status = 'completed', capture_id = ?, last_error = '',
        completed_at = CASE WHEN completed_at = '' THEN ? ELSE completed_at END,
        updated_at = ?
      WHERE id = ? AND organisation_id = ? AND field_tester_uid = ?
        AND status IN ('completing', 'completed')`)
      .bind(
        capture.captureId,
        now,
        now,
        session.id,
        member.organisationId,
        member.uid,
      ),
    database.prepare(`DELETE FROM compliance_manual_field_upload_parts
      WHERE session_id = ?`)
      .bind(session.id),
  ]);
  return findSession(member.organisationId, member.uid, session.id);
}

async function initiate(
  request: Request,
  input: Record<string, unknown>,
) {
  const database = getD1();
  const member = await requireManualFieldMember(request, database);
  const deviceId = cleanIdentifier(
    input.deviceId || request.headers.get("x-aea-device-id"),
    "DEVICE_ID_REQUIRED",
    "Register a stable TLink device ID.",
    120,
  );
  const device = await requireManualFieldDevice(
    request,
    database,
    member,
    deviceId,
  );
  const jobId = cleanIdentifier(
    input.workOrderId,
    "MANUAL_FIELD_JOB_REQUIRED",
    "Choose an assigned synthetic field test.",
  );
  const job = await manualFieldJobRow(database, member, jobId);
  const envelope = parsedEnvelope(input.evidenceEnvelope);
  const identifiers = objectValue(envelope.identifiers);
  const fieldCode = cleanIdentifier(
    identifiers?.evidenceRequirementCode,
    "MANUAL_FIELD_REQUIREMENT_INVALID",
    "Choose a locked synthetic evidence prompt.",
    80,
  );
  const field = fieldForSession(job.form_schema, fieldCode);
  const contentType = exactContentType(input.contentType);
  const sizeBytes = exactSize(input.sizeBytes);
  const verified = validateEnvelope(envelope, {
    jobId,
    field,
    deviceId,
    contentType,
    sizeBytes,
  });
  const clientUploadId = cleanIdentifier(
    input.clientUploadId,
    "MANUAL_FIELD_UPLOAD_ID_INVALID",
    "Add a stable offline upload reference.",
    120,
  );
  const existing = await database.prepare(`SELECT *
    FROM compliance_manual_field_upload_sessions
    WHERE organisation_id = ? AND field_tester_uid = ?
      AND client_upload_id = ?
    LIMIT 1`)
    .bind(member.organisationId, member.uid, clientUploadId)
    .first<UploadSession>();
  if (existing) {
    if (
      existing.job_id === jobId
      && existing.field_code === fieldCode
      && Number(existing.size_bytes) === sizeBytes
      && existing.content_type === contentType
      && existing.declared_sha256 === verified.declaredSha256
    ) {
      return json({
        ok: true,
        duplicate: true,
        upload: await sessionPayload(existing),
      });
    }
    throw new CreditexManualFieldError(
      "IDEMPOTENCY_MISMATCH",
      409,
      "This offline upload reference was already used for different bytes.",
    );
  }
  const counts = await database.prepare(`SELECT
      (SELECT COUNT(*) FROM compliance_manual_evidence_test_captures
        WHERE organisation_id = ? AND job_id = ? AND field_code = ?
          AND field_tester_uid = ?
          AND status = 'captured' AND record_mode = 'synthetic_test')
      + (SELECT COUNT(*) FROM compliance_manual_field_upload_sessions
        WHERE organisation_id = ? AND job_id = ? AND field_code = ?
          AND field_tester_uid = ?
          AND status IN ('initiated', 'uploading', 'completing')
          AND record_mode = 'synthetic_test') count`)
    .bind(
      member.organisationId,
      jobId,
      fieldCode,
      member.uid,
      member.organisationId,
      jobId,
      fieldCode,
      member.uid,
    )
    .first<{ count: number }>();
  if (
    field.maximumCount > 0
    && Number(counts?.count || 0) >= field.maximumCount
  ) {
    throw new CreditexManualFieldError(
      "EVIDENCE_MAXIMUM_REACHED",
      409,
      `The locked prompt allows up to ${field.maximumCount} files.`,
    );
  }
  const sessionId = crypto.randomUUID();
  const objectKey = [
    "synthetic-manual-evidence",
    member.organisationId,
    jobId,
    fieldCode,
    sessionId,
  ].join("/");
  const multipart = await bucket().createMultipartUpload(objectKey, {
    httpMetadata: { contentType },
    customMetadata: {
      recordMode: "synthetic_test",
      jobId,
      fieldCode,
      originalSha256: verified.declaredSha256,
    },
  });
  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + SESSION_HOURS * 60 * 60 * 1_000,
  ).toISOString();
  try {
    await database.prepare(`INSERT INTO
        compliance_manual_field_upload_sessions (
          id, organisation_id, job_id, field_code, field_tester_uid,
          device_id, client_upload_id, object_key, upload_id, file_name,
          content_type, size_bytes, part_size_bytes, evidence_envelope,
          declared_sha256, status, capture_id, last_error, record_mode,
          expires_at, created_at, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'initiated', '', '', 'synthetic_test', ?, ?, '', ?)`)
      .bind(
        sessionId,
        member.organisationId,
        jobId,
        fieldCode,
        member.uid,
        deviceId,
        clientUploadId,
        objectKey,
        multipart.uploadId,
        safeName(input.fileName),
        contentType,
        sizeBytes,
        CREDITEX_MANUAL_FIELD_PART_BYTES,
        JSON.stringify(envelope),
        verified.declaredSha256,
        expiresAt,
        now,
        now,
      )
      .run();
    await database.prepare(`UPDATE compliance_manual_field_devices
      SET is_physical_device = ?, updated_at = ?
      WHERE id = ? AND organisation_id = ? AND firebase_uid = ?`)
      .bind(
        verified.physicalDeviceReported ? 1 : 0,
        now,
        device.id,
        member.organisationId,
        member.uid,
      )
      .run();
  } catch (error) {
    await multipart.abort().catch(() => undefined);
    throw error;
  }
  return json({
    ok: true,
    upload: await sessionPayload(
      await findSession(member.organisationId, member.uid, sessionId),
    ),
  }, 201);
}

async function uploadPart(request: Request, form: FormData) {
  const database = getD1();
  const member = await requireManualFieldMember(request, database);
  const deviceId = cleanIdentifier(
    form.get("deviceId") || request.headers.get("x-aea-device-id"),
    "DEVICE_ID_REQUIRED",
    "Register a stable TLink device ID.",
    120,
  );
  await requireManualFieldDevice(request, database, member, deviceId);
  const session = await findSession(
    member.organisationId,
    member.uid,
    cleanIdentifier(
      form.get("sessionId"),
      "MANUAL_FIELD_UPLOAD_ID_INVALID",
      "Choose a synthetic evidence upload.",
    ),
  );
  if (session.device_id !== deviceId || !ACTIVE_STATUSES.has(session.status)) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_UPLOAD_STATE_INVALID",
      409,
      "This synthetic evidence upload is no longer accepting parts.",
    );
  }
  if (session.expires_at <= new Date().toISOString()) {
    throw new CreditexManualFieldError(
      "UPLOAD_EXPIRED",
      410,
      "This synthetic evidence upload expired. Start it again.",
    );
  }
  const partNumber = Number(form.get("partNumber"));
  const file = form.get("file");
  const totalParts = Math.ceil(
    Number(session.size_bytes) / Number(session.part_size_bytes),
  );
  if (
    !(file instanceof File)
    || !Number.isSafeInteger(partNumber)
    || partNumber < 1
    || partNumber > totalParts
  ) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_UPLOAD_PART_INVALID",
      400,
      "Add a valid synthetic evidence upload part.",
    );
  }
  const expectedBytes = partNumber === totalParts
    ? Number(session.size_bytes)
      - Number(session.part_size_bytes) * (totalParts - 1)
    : Number(session.part_size_bytes);
  if (file.size !== expectedBytes) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_UPLOAD_PART_SIZE_INVALID",
      400,
      `Upload part ${partNumber} must contain exactly ${expectedBytes} bytes.`,
    );
  }
  const uploaded = await bucket()
    .resumeMultipartUpload(session.object_key, session.upload_id)
    .uploadPart(partNumber, await file.arrayBuffer());
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO compliance_manual_field_upload_parts (
        id, session_id, part_number, etag, size_bytes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, part_number) DO UPDATE SET
        etag = excluded.etag,
        size_bytes = excluded.size_bytes,
        updated_at = excluded.updated_at`)
      .bind(
        crypto.randomUUID(),
        session.id,
        partNumber,
        uploaded.etag,
        file.size,
        now,
        now,
      ),
    database.prepare(`UPDATE compliance_manual_field_upload_sessions
      SET status = 'uploading', last_error = '', updated_at = ?
      WHERE id = ? AND organisation_id = ? AND field_tester_uid = ?
        AND status IN ('initiated', 'uploading')`)
      .bind(now, session.id, member.organisationId, member.uid),
  ]);
  return json({
    ok: true,
    upload: await sessionPayload(
      await findSession(member.organisationId, member.uid, session.id),
    ),
  });
}

async function rejectSession(session: UploadSession, reason: string) {
  return rejectUnattachedManualFieldUploadSession(
    getD1(),
    {
      id: session.id,
      organisationId: session.organisation_id,
      objectKey: session.object_key,
      reason,
    },
    async (objectKey) => {
      await bucket().delete(objectKey).catch(() => undefined);
    },
  );
}

async function complete(
  request: Request,
  input: Record<string, unknown>,
) {
  const database = getD1();
  const member = await requireManualFieldMember(request, database);
  const deviceId = cleanIdentifier(
    input.deviceId || request.headers.get("x-aea-device-id"),
    "DEVICE_ID_REQUIRED",
    "Register a stable TLink device ID.",
    120,
  );
  const device = await requireManualFieldDevice(
    request,
    database,
    member,
    deviceId,
  );
  let session = await findSession(
    member.organisationId,
    member.uid,
    cleanIdentifier(
      input.sessionId,
      "MANUAL_FIELD_UPLOAD_ID_INVALID",
      "Choose a synthetic evidence upload.",
    ),
  );
  if (session.device_id !== deviceId) {
    throw new CreditexManualFieldError(
      "EVIDENCE_DEVICE_INVALID",
      409,
      "Resume this upload on the TLink device that started it.",
    );
  }
  if (session.status === "completed") {
    return json({
      ok: true,
      duplicate: true,
      upload: await sessionPayload(session),
    });
  }
  const recoveredCapture = await attachedCaptureForSession(
    member.organisationId,
    session.id,
  );
  if (recoveredCapture) {
    session = await finalizeAttachedSession(
      database,
      member,
      session,
      recoveredCapture,
    );
    return json({
      ok: true,
      duplicate: true,
      upload: await sessionPayload(session),
      capture: {
        ...recoveredCapture,
        regulatoryAcceptance: "not_assessed",
      },
    });
  }
  if (!["initiated", "uploading", "completing"].includes(session.status)) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_UPLOAD_STATE_INVALID",
      409,
      "This synthetic evidence upload cannot be completed.",
    );
  }
  const parts = await sessionParts(session.id);
  const totalParts = Math.ceil(
    Number(session.size_bytes) / Number(session.part_size_bytes),
  );
  if (
    parts.length !== totalParts
    || parts.some((part, index) => part.partNumber !== index + 1)
  ) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_UPLOAD_INCOMPLETE",
      409,
      "Resume the missing evidence parts before completing this upload.",
    );
  }
  if (session.status !== "completing") {
    const claim = await database.prepare(`UPDATE
        compliance_manual_field_upload_sessions
      SET status = 'completing', last_error = '', updated_at = ?
      WHERE id = ? AND organisation_id = ? AND field_tester_uid = ?
        AND status IN ('initiated', 'uploading')`)
      .bind(
        new Date().toISOString(),
        session.id,
        member.organisationId,
        member.uid,
      )
      .run();
    if (Number(claim.meta.changes || 0) === 1) {
      try {
        await bucket()
          .resumeMultipartUpload(session.object_key, session.upload_id)
          .complete(parts.map((part) => ({
            partNumber: part.partNumber,
            etag: part.etag,
          })));
      } catch (error) {
        if (!await bucket().head(session.object_key)) throw error;
      }
    }
    session = await findSession(
      member.organisationId,
      member.uid,
      session.id,
    );
  } else if (!await bucket().head(session.object_key)) {
    try {
      await bucket()
        .resumeMultipartUpload(session.object_key, session.upload_id)
        .complete(parts.map((part) => ({
          partNumber: part.partNumber,
          etag: part.etag,
        })));
    } catch {
      if (!await bucket().head(session.object_key)) {
        throw new CreditexManualFieldError(
          "UPLOAD_RECOVERY_REQUIRED",
          409,
          "The interrupted synthetic evidence upload could not be restored yet.",
        );
      }
    }
  }
  const object = await bucket().get(session.object_key);
  if (!object) {
    throw new CreditexManualFieldError(
      "UPLOAD_RECOVERY_REQUIRED",
      409,
      "The assembled synthetic evidence object is not available for verification.",
    );
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const observedSha256 = await sha256Hex(bytes);
  if (
    bytes.byteLength !== Number(session.size_bytes)
    || observedSha256 !== session.declared_sha256
  ) {
    await rejectSession(session, "original_sha256_mismatch");
    throw new CreditexManualFieldError(
      "EVIDENCE_HASH_MISMATCH",
      409,
      "The retained bytes do not match the original TLink digest.",
    );
  }
  if (!validSignature(bytes, session.content_type)) {
    await rejectSession(session, "content_type_signature_mismatch");
    throw new CreditexManualFieldError(
      "EVIDENCE_FILE_SIGNATURE_MISMATCH",
      409,
      "The retained bytes do not match the declared file type.",
    );
  }
  const job = await manualFieldJobRow(database, member, session.job_id);
  const field = fieldForSession(job.form_schema, session.field_code);
  const envelope = parsedEnvelope(JSON.parse(session.evidence_envelope));
  const exif = session.content_type === "image/jpeg"
    ? verifyJpegExif(bytes)
    : null;
  const metadataState = field.metadataRequired
    ? exif?.status === "valid" && exif.exifPresent
      ? "verified" as const
      : null
    : "not_required" as const;
  if (!metadataState) {
    await rejectSession(session, "embedded_metadata_missing_or_invalid");
    throw new CreditexManualFieldError(
      "EVIDENCE_METADATA_REQUIRED",
      409,
      "The original JPEG does not contain valid embedded camera metadata.",
    );
  }
  const location = capturedLocation(envelope);
  const gpsState = field.gpsRequired
    ? location ? "verified" as const : null
    : "not_required" as const;
  if (!gpsState) {
    await rejectSession(session, "verified_location_missing_or_invalid");
    throw new CreditexManualFieldError(
      "EVIDENCE_GPS_REQUIRED",
      409,
      "The TLink capture does not contain a valid, non-mocked location within 100 metres accuracy.",
    );
  }
  const captureTimeState = field.fieldType === "photo"
    ? captureTimeVerified(envelope) ? "verified" as const : null
    : "not_required" as const;
  if (!captureTimeState) {
    await rejectSession(session, "capture_time_missing_or_invalid");
    throw new CreditexManualFieldError(
      "EVIDENCE_CAPTURE_TIME_REQUIRED",
      409,
      "The TLink capture time is missing or outside the seven-day test window.",
    );
  }
  const physicalDeviceState = Number(device.is_physical_device) === 1
    ? "reported_physical" as const
    : "reported_emulator" as const;
  const captureId = crypto.randomUUID();
  let attached: {
    captureId: string;
    integrityReceiptId: string;
  };
  try {
    attached = await attachVerifiedManualFieldCapture(
      database,
      member,
      {
        captureId,
        sessionId: session.id,
        jobId: session.job_id,
        fieldCode: session.field_code,
        deviceId,
        objectKey: session.object_key,
        fileName: session.file_name,
        contentType: session.content_type,
        sizeBytes: Number(session.size_bytes),
        originalSha256: observedSha256,
        evidenceEnvelope: envelope as Record<string, unknown>,
        serverVerification: {
          schemaVersion: 1,
          authority: "server_parsed_r2_object_bytes",
          observedSha256,
          observedSizeBytes: bytes.byteLength,
          contentType: session.content_type,
          fileSignatureMatched: true,
          embeddedJpegExif: exif,
          independentLocation: location,
          captureTimeState,
          physicalDeviceState,
          regulatoryAcceptance: "not_assessed",
        },
        metadataState,
        gpsState,
        captureTimeState,
        physicalDeviceState,
      },
    );
  } catch (error) {
    const recovered = await attachedCaptureForSession(
      member.organisationId,
      session.id,
    );
    if (recovered) {
      session = await finalizeAttachedSession(
        database,
        member,
        session,
        recovered,
      );
      return json({
        ok: true,
        duplicate: true,
        upload: await sessionPayload(session),
        capture: {
          ...recovered,
          regulatoryAcceptance: "not_assessed",
        },
      });
    }
    const rejected = await rejectSession(session, "capture_attach_failed");
    if (!rejected) {
      const authoritative = await attachedCaptureForSession(
        member.organisationId,
        session.id,
      );
      if (authoritative) {
        session = await finalizeAttachedSession(
          database,
          member,
          session,
          authoritative,
        );
        return json({
          ok: true,
          duplicate: true,
          upload: await sessionPayload(session),
          capture: {
            ...authoritative,
            regulatoryAcceptance: "not_assessed",
          },
        });
      }
      throw new CreditexManualFieldError(
        "UPLOAD_RECOVERY_REQUIRED",
        409,
        "The retained evidence entered custody while completion was being recovered.",
      );
    }
    throw error;
  }
  session = await finalizeAttachedSession(
    database,
    member,
    session,
    {
      ...attached,
      physicalDeviceState,
    },
  );
  return json({
    ok: true,
    upload: await sessionPayload(session),
    capture: {
      ...attached,
      physicalDeviceState,
      regulatoryAcceptance: "not_assessed",
    },
  }, 201);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const database = getD1();
    const member = await requireManualFieldMember(request, database);
    const params = new URL(request.url).searchParams;
    const deviceId = cleanIdentifier(
      params.get("deviceId") || request.headers.get("x-aea-device-id"),
      "DEVICE_ID_REQUIRED",
    "Register a stable TLink device ID.",
      120,
    );
    await requireManualFieldDevice(
      request,
      database,
      member,
      deviceId,
    );
    const session = await findSession(
      member.organisationId,
      member.uid,
      cleanIdentifier(
        params.get("sessionId"),
        "MANUAL_FIELD_UPLOAD_ID_INVALID",
        "Choose a synthetic evidence upload.",
      ),
    );
    if (session.device_id !== deviceId) {
      throw new CreditexManualFieldError(
        "EVIDENCE_DEVICE_INVALID",
        409,
        "Resume this upload on the TLink device that started it.",
      );
    }
    return json({ ok: true, upload: await sessionPayload(session) });
  } catch (error) {
    const response = manualFieldErrorResponse(error);
    return json(response.body, response.status);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      if (form.get("action") !== "upload_part") {
        return json({
          ok: false,
          code: "MANUAL_FIELD_UPLOAD_ACTION_INVALID",
          error: "Choose a supported synthetic evidence upload action.",
        }, 400);
      }
      return await uploadPart(request, form);
    }
    const parsed = await readBoundedJsonRequest(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({
        ok: false,
        code: "MANUAL_FIELD_UPLOAD_REQUEST_INVALID",
        error: "Enter a valid synthetic evidence upload request.",
      }, 400);
    }
    const body = parsed as Record<string, unknown>;
    const action = cleanText(body.action, 40);
    if (action === "initiate") return await initiate(request, body);
    if (action === "complete") return await complete(request, body);
    return json({
      ok: false,
      code: "MANUAL_FIELD_UPLOAD_ACTION_INVALID",
      error: "Choose a supported synthetic evidence upload action.",
    }, 400);
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) {
      return json({
        ok: false,
        code: error.code,
        error: error.message,
      }, error.status);
    }
    const response = manualFieldErrorResponse(error);
    return json(response.body, response.status);
  }
}
