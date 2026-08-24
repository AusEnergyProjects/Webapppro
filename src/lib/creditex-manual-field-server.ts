import type { ComplianceIdentity } from "./compliance-access-server.ts";
import {
  manualEvidenceProgress,
  validateManualEvidenceFormSchema,
  validateManualEvidenceResponses,
  type ManualEvidenceField,
  type ManualEvidenceFormSchema,
  type ManualEvidenceResponse,
} from "./creditex-manual-evidence-lab.ts";
import { requireFirebaseIdentity } from "./firebase-server.ts";

export const CREDITEX_MANUAL_FIELD_CONTRACT_VERSION = 1;
export const CREDITEX_MANUAL_FIELD_PART_BYTES = 5 * 1024 * 1024;
export const CREDITEX_MANUAL_FIELD_MAX_BYTES = 50 * 1024 * 1024;

const MANUAL_FIELD_CLIENT_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
const MANUAL_FIELD_PLATFORMS = new Set(["ios", "android"]);

type ManualFieldJobRow = {
  id: string;
  organisation_id: string;
  form_version_id: string;
  program_code: string;
  activity_template_id: string;
  activity_snapshot: string;
  form_schema: string;
  form_schema_sha256: string;
  job_number: string;
  installer_label: string;
  technician_label: string;
  customer_label: string;
  site_state: string;
  site_postcode: string;
  status: string;
  response_snapshot: string;
  required_count: number;
  completed_required_count: number;
  issue_count: number;
  review_note: string;
  record_mode: string;
  revision: number;
  field_tester_uid: string;
  created_at: string;
  updated_at: string;
  form_title: string;
  form_version: number;
};

export type ManualFieldDevice = {
  id: string;
  organisation_id: string;
  firebase_uid: string;
  device_id: string;
  platform: string;
  device_name: string;
  app_version: string;
  is_physical_device: number;
  status: string;
};

export class CreditexManualFieldError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexManualFieldError";
    this.code = code;
    this.status = status;
  }
}

function cleanText(value: unknown, maximum: number) {
  return String(value || "").trim().slice(0, maximum);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function activityRecord(snapshot: Record<string, unknown>) {
  const activity = snapshot.activity;
  return activity && typeof activity === "object" && !Array.isArray(activity)
    ? activity as Record<string, unknown>
    : {};
}

function statusProjection(status: string) {
  if (status === "passed") {
    return { stage: "completed", appointmentStatus: "completed" };
  }
  if (status === "archived") {
    return { stage: "cancelled", appointmentStatus: "cancelled" };
  }
  if (status === "ready_for_audit") {
    return { stage: "blocked", appointmentStatus: "manual_review" };
  }
  if (status === "field_testing" || status === "changes_required") {
    return { stage: "in_progress", appointmentStatus: "manual_test" };
  }
  return { stage: "ready", appointmentStatus: "manual_test" };
}

function formField(field: ManualEvidenceField) {
  const type = field.fieldType;
  if (
    !["checkbox", "text", "textarea", "date", "select", "number"].includes(
      type,
    )
  ) {
    return null;
  }
  return {
    key: field.fieldCode,
    label: field.label,
    type,
    required: field.required,
    maxLength: field.fieldType === "number" ? 40 : 2_000,
    ...(field.fieldType === "select" ? { options: field.options } : {}),
  };
}

function answerValue(field: ManualEvidenceField, response: ManualEvidenceResponse) {
  if (field.fieldType === "checkbox") return response.value === "Yes";
  return response.value;
}

function responseForCode(
  responses: readonly ManualEvidenceResponse[],
  code: string,
) {
  return responses.find((response) => response.fieldCode === code);
}

function mappedRequirement(
  job: ManualFieldJobRow,
  field: ManualEvidenceField,
  response: ManualEvidenceResponse,
) {
  const signatureRequired = field.fieldType === "signature";
  const submittedCount = response.captures.filter(
    (capture) => capture.verificationState === "server_verified",
  ).length;
  const needsEmbeddedMetadata = (
    field.metadataRequired
    || field.gpsRequired
  );
  const allowedContentTypes = needsEmbeddedMetadata
    ? field.allowedContentTypes.filter((type) => type === "image/jpeg")
    : field.allowedContentTypes;
  const captureModes: Array<"camera" | "document"> = signatureRequired
    ? []
    : field.fieldType === "photo"
      ? ["camera"]
      : ["document"];
  const blockers: string[] = [];
  if (signatureRequired) {
    blockers.push(
      "Signature capture is required by this locked form but is not available in TLink.",
    );
  }
  if (needsEmbeddedMetadata && !allowedContentTypes.includes("image/jpeg")) {
    blockers.push(
      "This prompt requires embedded camera metadata, but its locked form does not allow JPEG.",
    );
  }
  return {
    id: `${job.id}:${field.fieldCode}`,
    code: field.fieldCode,
    title: field.label,
    description: field.instructions,
    evidenceType: field.fieldType,
    captureTiming: field.captureTiming,
    minimumCount: field.minimumCount,
    maximumCount: field.maximumCount,
    acceptedCount: 0,
    submittedCount,
    originalRequired: field.originalRequired,
    metadataRequired: field.metadataRequired,
    gpsRequired: field.gpsRequired,
    dateStampRequired: field.fieldType === "photo",
    installerSignatureRequired: false,
    customerSignatureRequired: false,
    allowedContentTypes,
    captureModes: blockers.length ? [] : captureModes,
    compatibility: {
      captureSupported: blockers.length === 0,
      requiresConditionEvaluation: false,
      requiresSignatureCapture: signatureRequired,
      requiresDynamicFieldSchema: false,
      blockers,
    },
    status: blockers.length
      ? "blocked"
      : submittedCount >= field.minimumCount ? "provided" : "pending",
  };
}

export function publicManualFieldJob(row: ManualFieldJobRow) {
  const schema = validateManualEvidenceFormSchema(
    JSON.parse(row.form_schema),
  );
  const responses = validateManualEvidenceResponses(
    schema.fields,
    JSON.parse(row.response_snapshot),
  );
  const snapshot = parseJson<Record<string, unknown>>(
    row.activity_snapshot,
    {},
  );
  const activity = activityRecord(snapshot);
  const projection = statusProjection(row.status);
  const nonFileFields = schema.fields
    .filter((field) => !["photo", "document", "signature"].includes(
      field.fieldType,
    ))
    .map(formField)
    .filter((field): field is NonNullable<ReturnType<typeof formField>> =>
      field !== null
    );
  const answers = Object.fromEntries(
    schema.fields
      .filter((field) => nonFileFields.some(
        (candidate) => candidate.key === field.fieldCode,
      ))
      .map((field) => [
        field.fieldCode,
        answerValue(
          field,
          responseForCode(responses, field.fieldCode)
            || {
              fieldCode: field.fieldCode,
              outcome: "not_started",
              value: "",
              captures: [],
              note: "",
            },
        ),
      ]),
  );
  const missing = nonFileFields
    .filter((field) => field.required && (
      field.type === "checkbox"
        ? answers[field.key] !== true
        : !String(answers[field.key] || "").trim()
    ))
    .map((field) => field.label);
  const evidenceFields = schema.fields.filter((field) =>
    field.fieldType === "photo"
    || field.fieldType === "document"
    || field.fieldType === "signature"
  );
  return {
    id: row.id,
    workNumber: row.job_number,
    title: cleanText(activity.title, 240) || row.form_title,
    serviceCategory: cleanText(activity.serviceCategory, 80),
    siteArea: `${row.site_state} ${row.site_postcode}`,
    stage: projection.stage,
    priority: "standard",
    scheduledStart: "",
    scheduledEnd: "",
    assigneeMemberId: row.field_tester_uid,
    assigneeLabel: row.technician_label,
    protectedJob: true,
    customerName: row.customer_label,
    customerPhone: "",
    serviceAddress: "",
    appointmentId: `manual:${row.id}`,
    appointmentStatus: projection.appointmentStatus,
    appointmentStartsAt: "",
    appointmentEndsAt: "",
    travelStartedAt: "",
    arrivedAt: "",
    workStartedAt: row.status === "field_testing" ? row.updated_at : "",
    completedAt: row.status === "passed" ? row.updated_at : "",
    description:
      `[SYNTHETIC TEST ONLY] ${row.program_code} manual evidence test. `
      + "Use only non-personal test data. No certificate or registry action can be created.",
    openIssues: Number(row.issue_count),
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    recordMode: "synthetic_test",
    fieldLane: "creditex_manual",
    offlinePolicy: {
      containsPersonalData: false,
      maxAgeSeconds: 604_800,
      purgeWhenUnassigned: true,
    },
    tasks: [],
    media: responses.flatMap((response) =>
      response.captures
        .filter((capture) => capture.verificationState === "server_verified")
        .map((capture) => ({
          id: capture.captureId,
          category: response.fieldCode,
          fileName: capture.fileName,
          contentType: capture.contentType,
          sizeBytes: 0,
          caption: response.fieldCode,
          createdAt: capture.capturedAt,
        }))
    ),
    forms: nonFileFields.length
      ? [{
          id: `${row.id}:technical`,
          templateKey: `${row.activity_template_id}:manual`,
          templateVersion: Number(row.form_version),
          name: `${row.form_title} | technical fields`,
          jurisdiction: row.site_state,
          template: {
            guidance:
              "Complete the short locked fields. Photo and document prompts are collected separately below.",
            fields: nonFileFields,
          },
          answers,
          status: missing.length === 0 ? "complete" : "draft",
          revision: Number(row.revision),
          ready: missing.length === 0,
          missing,
          completedAt: missing.length === 0 ? row.updated_at : "",
          updatedAt: row.updated_at,
        }]
      : [],
    compliance: {
      caseId: `synthetic-manual:${row.id}`,
      caseNumber: row.job_number,
      activityVersionId: `synthetic-template:${row.activity_template_id}`,
      activityCode: cleanText(activity.registryActivityCode, 80)
        || cleanText(activity.specificationPart, 80)
        || row.activity_template_id,
      activityTitle: cleanText(activity.title, 240) || row.form_title,
      evidencePolicyVersionId: row.form_version_id,
      requirements: evidenceFields.map((field) =>
        mappedRequirement(
          row,
          field,
          responseForCode(responses, field.fieldCode)
            || {
              fieldCode: field.fieldCode,
              outcome: "not_started",
              value: "",
              captures: [],
              note: "",
            },
        )
      ),
    },
  };
}

export async function requireManualFieldMember(
  request: Request,
  database: D1Database,
) {
  const identity = await requireFirebaseIdentity(request);
  const { requireComplianceIdentity } = await import(
    "./compliance-access-server.ts"
  );
  return requireComplianceIdentity(identity, {
    allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
  }, database);
}

export async function manualFieldAssignedJobs(
  database: D1Database,
  member: ComplianceIdentity,
) {
  const rows = await database.prepare(`SELECT
      job.*, form.title form_title, form.version form_version
    FROM compliance_manual_evidence_test_jobs job
    JOIN compliance_manual_evidence_form_versions form
      ON form.id = job.form_version_id
      AND form.organisation_id = job.organisation_id
      AND form.status IN ('test_ready', 'archived')
    WHERE job.organisation_id = ?
      AND job.field_tester_uid = ?
      AND job.record_mode = 'synthetic_test'
      AND job.status NOT IN ('passed', 'archived')
    ORDER BY job.updated_at DESC, job.id DESC
    LIMIT 500`)
    .bind(member.organisationId, member.uid)
    .all<ManualFieldJobRow>();
  return rows.results.map(publicManualFieldJob);
}

export async function hasManualFieldAssignment(
  database: D1Database,
  member: ComplianceIdentity,
) {
  const row = await database.prepare(`SELECT job.id
    FROM compliance_manual_evidence_test_jobs job
    JOIN compliance_manual_evidence_form_versions form
      ON form.id = job.form_version_id
      AND form.organisation_id = job.organisation_id
      AND form.status IN ('test_ready', 'archived')
    WHERE job.organisation_id = ?
      AND job.field_tester_uid = ?
      AND job.record_mode = 'synthetic_test'
      AND job.status NOT IN ('passed', 'archived')
    LIMIT 1`)
    .bind(member.organisationId, member.uid)
    .first<{ id: string }>();
  return Boolean(row?.id);
}

export async function manualFieldJobRow(
  database: D1Database,
  member: ComplianceIdentity,
  jobId: string,
) {
  const row = await database.prepare(`SELECT
      job.*, form.title form_title, form.version form_version
    FROM compliance_manual_evidence_test_jobs job
    JOIN compliance_manual_evidence_form_versions form
      ON form.id = job.form_version_id
      AND form.organisation_id = job.organisation_id
      AND form.status IN ('test_ready', 'archived')
    WHERE job.id = ?
      AND job.organisation_id = ?
      AND job.field_tester_uid = ?
      AND job.record_mode = 'synthetic_test'
      AND job.status NOT IN ('passed', 'archived')
    LIMIT 1`)
    .bind(jobId, member.organisationId, member.uid)
    .first<ManualFieldJobRow>();
  if (!row) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_JOB_NOT_FOUND",
      404,
      "This synthetic field test is not assigned to the signed-in tester.",
    );
  }
  return row;
}

export async function registerManualFieldDevice(
  database: D1Database,
  member: ComplianceIdentity,
  input: Record<string, unknown>,
) {
  const { appVersionAccepted, mobileAppPolicy } = await import(
    "./trade-mobile-server.ts"
  );
  const deviceId = cleanText(input.deviceId, 120);
  const platform = cleanText(input.platform, 20);
  const appVersion = cleanText(input.appVersion, 40);
  const deviceName = cleanText(input.deviceName, 100) || "TLink device";
  const isPhysicalDevice = input.isPhysicalDevice === true ? 1 : 0;
  if (
    !MANUAL_FIELD_CLIENT_ID_PATTERN.test(deviceId)
    || !MANUAL_FIELD_PLATFORMS.has(platform)
  ) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_DEVICE_INVALID",
      400,
      "Add a stable TLink device ID and choose iOS or Android.",
    );
  }
  if (!appVersionAccepted(platform, appVersion)) {
    throw new CreditexManualFieldError(
      "APP_UPDATE_REQUIRED",
      426,
      "Update TLink before registering this test device.",
    );
  }
  const current = await database.prepare(`SELECT id, status
    FROM compliance_manual_field_devices
    WHERE organisation_id = ? AND firebase_uid = ? AND device_id = ?
    LIMIT 1`)
    .bind(member.organisationId, member.uid, deviceId)
    .first<Record<string, unknown>>();
  if (current?.status === "revoked") {
    throw new CreditexManualFieldError(
      "DEVICE_REAUTHORISATION_REQUIRED",
      403,
      "This test device was revoked and must be reauthorised in Creditex.",
    );
  }
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO compliance_manual_field_devices (
      id, organisation_id, firebase_uid, device_id, platform, device_name,
      app_version, is_physical_device, status, registered_at, last_seen_at,
      revoked_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, '', ?)
    ON CONFLICT(organisation_id, firebase_uid, device_id) DO UPDATE SET
      platform = excluded.platform,
      device_name = excluded.device_name,
      app_version = excluded.app_version,
      is_physical_device = excluded.is_physical_device,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at`)
    .bind(
      current?.id || crypto.randomUUID(),
      member.organisationId,
      member.uid,
      deviceId,
      platform,
      deviceName,
      appVersion,
      isPhysicalDevice,
      now,
      now,
      now,
    )
    .run();
  return {
    registered: true,
    mode: "creditex_manual",
    policy: mobileAppPolicy(platform),
    physicalDeviceReported: isPhysicalDevice === 1,
  };
}

export async function revokeManualFieldDevice(
  database: D1Database,
  member: ComplianceIdentity,
  input: Record<string, unknown>,
) {
  const deviceId = cleanText(input.deviceId, 120);
  if (!MANUAL_FIELD_CLIENT_ID_PATTERN.test(deviceId)) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_DEVICE_INVALID",
      400,
      "Choose the registered TLink test device to sign out.",
    );
  }
  const current = await database.prepare(`SELECT id, status
    FROM compliance_manual_field_devices
    WHERE organisation_id = ? AND firebase_uid = ? AND device_id = ?
    LIMIT 1`)
    .bind(member.organisationId, member.uid, deviceId)
    .first<{ id: string; status: string }>();
  if (!current) {
    return {
      revoked: false,
      reused: true,
      mode: "creditex_manual" as const,
    };
  }
  if (current.status === "revoked") {
    return {
      revoked: true,
      reused: true,
      mode: "creditex_manual" as const,
    };
  }
  const now = new Date().toISOString();
  const updated = await database.prepare(`UPDATE
      compliance_manual_field_devices
    SET status = 'revoked', revoked_at = ?, updated_at = ?
    WHERE id = ? AND organisation_id = ? AND firebase_uid = ?
      AND device_id = ? AND status = 'active'`)
    .bind(
      now,
      now,
      current.id,
      member.organisationId,
      member.uid,
      deviceId,
    )
    .run();
  if (Number(updated.meta.changes || 0) !== 1) {
    const authoritative = await database.prepare(`SELECT status
      FROM compliance_manual_field_devices
      WHERE id = ? AND organisation_id = ? AND firebase_uid = ?
        AND device_id = ?
      LIMIT 1`)
      .bind(
        current.id,
        member.organisationId,
        member.uid,
        deviceId,
      )
      .first<{ status: string }>();
    if (authoritative?.status !== "revoked") {
      throw new CreditexManualFieldError(
        "MANUAL_FIELD_DEVICE_STATE_CONFLICT",
        409,
        "The TLink test device changed before sign-out completed.",
      );
    }
    return {
      revoked: true,
      reused: true,
      mode: "creditex_manual" as const,
    };
  }
  return {
    revoked: true,
    reused: false,
    mode: "creditex_manual" as const,
  };
}

export async function requireManualFieldDevice(
  request: Request,
  database: D1Database,
  member: ComplianceIdentity,
  deviceId: string,
) {
  const { appVersionAccepted } = await import("./trade-mobile-server.ts");
  if (!MANUAL_FIELD_CLIENT_ID_PATTERN.test(deviceId)) {
    throw new CreditexManualFieldError(
      "DEVICE_ID_REQUIRED",
      400,
      "Register a stable TLink device ID.",
    );
  }
  const device = await database.prepare(`SELECT *
    FROM compliance_manual_field_devices
    WHERE organisation_id = ? AND firebase_uid = ? AND device_id = ?
    LIMIT 1`)
    .bind(member.organisationId, member.uid, deviceId)
    .first<ManualFieldDevice>();
  if (!device) {
    throw new CreditexManualFieldError(
      "DEVICE_NOT_REGISTERED",
      403,
      "Register this TLink device before using the synthetic test lane.",
    );
  }
  if (device.status !== "active") {
    throw new CreditexManualFieldError(
      "DEVICE_REVOKED",
      403,
      "This TLink test device has been revoked.",
    );
  }
  const platform = cleanText(
    request.headers.get("x-aea-platform") || device.platform,
    20,
  );
  const appVersion = cleanText(
    request.headers.get("x-aea-app-version"),
    40,
  );
  if (platform !== device.platform) {
    throw new CreditexManualFieldError(
      "DEVICE_PLATFORM_MISMATCH",
      409,
      "The registered test-device platform does not match this request.",
    );
  }
  if (!appVersionAccepted(platform, appVersion)) {
    throw new CreditexManualFieldError(
      "APP_UPDATE_REQUIRED",
      426,
      "Update TLink before syncing this test device.",
    );
  }
  const now = new Date().toISOString();
  await database.prepare(`UPDATE compliance_manual_field_devices
    SET app_version = ?, last_seen_at = ?, updated_at = ?
    WHERE id = ? AND organisation_id = ? AND firebase_uid = ?
      AND status = 'active'`)
    .bind(
      appVersion,
      now,
      now,
      device.id,
      member.organisationId,
      member.uid,
    )
    .run();
  return { ...device, app_version: appVersion };
}

export async function rejectUnattachedManualFieldUploadSession(
  database: D1Database,
  input: {
    id: string;
    organisationId: string;
    objectKey: string;
    reason: string;
  },
  deleteObject: (objectKey: string) => Promise<void>,
) {
  const now = new Date().toISOString();
  const results = await database.batch([
    database.prepare(`UPDATE compliance_manual_field_upload_sessions
      SET status = 'rejected', last_error = ?, updated_at = ?
      WHERE id = ? AND organisation_id = ?
        AND status IN ('initiated', 'uploading', 'completing')
        AND NOT EXISTS (
          SELECT 1 FROM compliance_manual_evidence_test_captures capture
          WHERE capture.organisation_id = ?
            AND (
              capture.upload_session_id = ?
              OR capture.object_key = ?
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM compliance_manual_field_integrity_receipts receipt
          WHERE receipt.organisation_id = ?
            AND receipt.object_key = ?
        )`)
      .bind(
        input.reason,
        now,
        input.id,
        input.organisationId,
        input.organisationId,
        input.id,
        input.objectKey,
        input.organisationId,
        input.objectKey,
      ),
    database.prepare(`DELETE FROM compliance_manual_field_upload_parts
      WHERE session_id = ?
        AND EXISTS (
          SELECT 1 FROM compliance_manual_field_upload_sessions session
          WHERE session.id = ?
            AND session.organisation_id = ?
            AND session.status = 'rejected'
        )
        AND NOT EXISTS (
          SELECT 1 FROM compliance_manual_evidence_test_captures capture
          WHERE capture.organisation_id = ?
            AND (
              capture.upload_session_id = ?
              OR capture.object_key = ?
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM compliance_manual_field_integrity_receipts receipt
          WHERE receipt.organisation_id = ?
            AND receipt.object_key = ?
        )`)
      .bind(
        input.id,
        input.id,
        input.organisationId,
        input.organisationId,
        input.id,
        input.objectKey,
        input.organisationId,
        input.objectKey,
      ),
  ]);
  if (Number(results[0]?.meta.changes || 0) !== 1) return false;
  await deleteObject(input.objectKey);
  return true;
}

function answerResponses(
  schema: ManualEvidenceFormSchema,
  current: readonly ManualEvidenceResponse[],
  answers: Record<string, unknown>,
) {
  return current.map((response) => {
    const field = schema.fields.find(
      (candidate) => candidate.fieldCode === response.fieldCode,
    );
    if (
      !field
      || ["photo", "document", "signature"].includes(field.fieldType)
    ) return response;
    if (!(field.fieldCode in answers)) return response;
    const raw = answers[field.fieldCode];
    const value = field.fieldType === "checkbox"
      ? raw === true ? "Yes" : "No"
      : cleanText(raw, 2_000);
    return {
      ...response,
      value,
      outcome: value ? "provided" as const : "not_started" as const,
    };
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) =>
        `${JSON.stringify(key)}:${canonicalJson(item)}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

type ManualFieldActionReceiptRow = {
  payload_sha256: string;
  response_sha256: string;
  result_revision: number;
};

async function manualFieldActionReceipt(
  database: D1Database,
  member: ComplianceIdentity,
  clientActionId: string,
) {
  return database.prepare(`SELECT
      payload_sha256, response_sha256, result_revision
    FROM compliance_manual_field_action_receipts
    WHERE organisation_id = ? AND field_tester_uid = ?
      AND client_action_id = ? AND action_type = 'save_job_form'
      AND status = 'applied' AND record_mode = 'synthetic_test'
    LIMIT 1`)
    .bind(member.organisationId, member.uid, clientActionId)
    .first<ManualFieldActionReceiptRow>();
}

function manualFieldReplayResult(
  clientActionId: string,
  payloadSha256: string,
  receipt: ManualFieldActionReceiptRow,
) {
  if (receipt.payload_sha256 !== payloadSha256) {
    return {
      clientActionId,
      status: "conflict",
      code: "MANUAL_FIELD_ACTION_ID_CONFLICT",
      error:
        "This offline field action reference was already used for different form data.",
    };
  }
  return {
    clientActionId,
    status: "duplicate",
    code: "MANUAL_FIELD_ACTION_REPLAYED",
    appliedRevision: Number(receipt.result_revision),
    responseSha256: receipt.response_sha256,
  };
}

function manualFieldRevisionConflict(
  clientActionId: string,
  message: string,
) {
  return {
    clientActionId,
    status: "conflict",
    code: "MANUAL_FIELD_REVISION_CONFLICT",
    error: message,
  };
}

export async function saveManualFieldForm(
  database: D1Database,
  member: ComplianceIdentity,
  action: Record<string, unknown>,
) {
  const jobId = cleanText(action.workOrderId, 180);
  const clientActionId = cleanText(action.clientActionId, 120);
  if (!MANUAL_FIELD_CLIENT_ID_PATTERN.test(clientActionId)) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_ACTION_ID_INVALID",
      400,
      "The offline field action reference is invalid.",
    );
  }
  const formId = cleanText(action.formId, 180);
  const baseRevision = Number(action.baseRevision);
  const payloadSha256 = await sha256Hex(canonicalJson({
    type: cleanText(action.type, 80),
    workOrderId: jobId,
    formId,
    baseRevision,
    answers: action.answers,
    complete: action.complete === true,
  }));
  const storedReceipt = await manualFieldActionReceipt(
    database,
    member,
    clientActionId,
  );
  if (storedReceipt) {
    return manualFieldReplayResult(
      clientActionId,
      payloadSha256,
      storedReceipt,
    );
  }
  if (action.type !== "save_job_form") {
    return {
      clientActionId,
      status: "rejected",
      code: "MANUAL_FIELD_ACTION_UNSUPPORTED",
      error:
        "Synthetic testing accepts only locked technical-form changes in TLink.",
    };
  }
  if (formId !== `${jobId}:technical`) {
    return {
      clientActionId,
      status: "rejected",
      code: "MANUAL_FIELD_FORM_INVALID",
      error: "The locked synthetic technical form does not match this job.",
    };
  }
  const answers = action.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return {
      clientActionId,
      status: "rejected",
      code: "MANUAL_FIELD_ANSWERS_INVALID",
      error: "The locked field answers are invalid.",
    };
  }
  const row = await manualFieldJobRow(database, member, jobId);
  if (baseRevision !== Number(row.revision)) {
    return manualFieldRevisionConflict(
      clientActionId,
        "Creditex changed this synthetic test job. Sync before reapplying the field form.",
    );
  }
  const schema = validateManualEvidenceFormSchema(
    JSON.parse(row.form_schema),
  );
  const current = validateManualEvidenceResponses(
    schema.fields,
    JSON.parse(row.response_snapshot),
  );
  const responses = validateManualEvidenceResponses(
    schema.fields,
    answerResponses(
      schema,
      current,
      answers as Record<string, unknown>,
    ),
  );
  const progress = manualEvidenceProgress(schema.fields, responses);
  const responseJson = canonicalJson(responses);
  const responseSha256 = await sha256Hex(responseJson);
  const now = new Date().toISOString();
  const actionReceiptId = crypto.randomUUID();
  try {
    await database.batch([
      database.prepare(`INSERT INTO
          compliance_manual_field_action_receipts (
            id, organisation_id, field_tester_uid, client_action_id,
            action_type, job_id, form_id, base_revision, payload_sha256,
            response_sha256, result_revision, status, record_mode, created_at
          ) VALUES (?, ?, ?, ?, 'save_job_form', ?, ?, ?, ?, ?, ?,
            'applied', 'synthetic_test', ?)`)
        .bind(
          actionReceiptId,
          member.organisationId,
          member.uid,
          clientActionId,
          row.id,
          formId,
          row.revision,
          payloadSha256,
          responseSha256,
          Number(row.revision) + 1,
          now,
        ),
      database.prepare(`UPDATE
          compliance_manual_evidence_test_jobs
        SET response_snapshot = ?, response_sha256 = ?,
          required_count = ?, completed_required_count = ?, issue_count = ?,
          status = CASE WHEN status IN ('draft', 'changes_required')
            THEN 'field_testing' ELSE status END,
          revision = revision + 1, updated_by_uid = ?, updated_at = ?
        WHERE id = ? AND organisation_id = ? AND field_tester_uid = ?
          AND revision = ? AND record_mode = 'synthetic_test'
          AND status IN ('draft', 'field_testing', 'changes_required')`)
        .bind(
          responseJson,
          responseSha256,
          progress.requiredCount,
          progress.completedRequired,
          progress.issueCount,
          member.uid,
          now,
          row.id,
          member.organisationId,
          member.uid,
          row.revision,
        ),
      database.prepare(`INSERT INTO
          compliance_manual_evidence_test_events (
            id, organisation_id, job_id, event_type, actor_uid, summary,
            metadata, created_at
          ) VALUES (?, ?, ?, 'manual_field.form_saved', ?,
            'Locked synthetic field form saved from TLink.', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          member.organisationId,
          row.id,
          member.uid,
          canonicalJson({
            actionReceiptId,
            clientActionId,
            actionPayloadSha256: payloadSha256,
            deviceLane: "creditex_manual",
            responseSha256,
            resultRevision: Number(row.revision) + 1,
            recordMode: "synthetic_test",
          }),
          now,
        ),
    ]);
  } catch (error) {
    const receipt = await manualFieldActionReceipt(
      database,
      member,
      clientActionId,
    );
    if (receipt) {
      return manualFieldReplayResult(
        clientActionId,
        payloadSha256,
        receipt,
      );
    }
    if (
      error instanceof Error
      && error.message.includes(
        "COMPLIANCE_MANUAL_FIELD_ACTION_REVISION_CONFLICT",
      )
    ) {
      return manualFieldRevisionConflict(
        clientActionId,
        "Creditex changed this synthetic test job before the save completed.",
      );
    }
    throw error;
  }
  return {
    clientActionId,
    status: "applied",
    appliedRevision: Number(row.revision) + 1,
    responseSha256,
  };
}

export async function attachVerifiedManualFieldCapture(
  database: D1Database,
  member: ComplianceIdentity,
  input: {
    captureId: string;
    sessionId: string;
    jobId: string;
    fieldCode: string;
    deviceId: string;
    objectKey: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    originalSha256: string;
    evidenceEnvelope: Record<string, unknown>;
    serverVerification: Record<string, unknown>;
    metadataState: "verified" | "not_required";
    gpsState: "verified" | "not_required";
    captureTimeState: "verified" | "not_required";
    physicalDeviceState: "reported_physical" | "reported_emulator";
  },
) {
  const row = await manualFieldJobRow(database, member, input.jobId);
  const schema = validateManualEvidenceFormSchema(
    JSON.parse(row.form_schema),
  );
  const field = schema.fields.find(
    (candidate) => candidate.fieldCode === input.fieldCode,
  );
  if (
    !field
    || (field.fieldType !== "photo" && field.fieldType !== "document")
  ) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_REQUIREMENT_INVALID",
      409,
      "The locked evidence prompt no longer accepts this file.",
    );
  }
  const current = validateManualEvidenceResponses(
    schema.fields,
    JSON.parse(row.response_snapshot),
  );
  const response = current.find(
    (candidate) => candidate.fieldCode === input.fieldCode,
  );
  if (!response) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_RESPONSE_INVALID",
      409,
      "The locked evidence response was not found.",
    );
  }
  const testerCaptureRows = await database.prepare(`SELECT id
    FROM compliance_manual_evidence_test_captures
    WHERE organisation_id = ? AND job_id = ? AND field_code = ?
      AND field_tester_uid = ? AND status = 'captured'
      AND record_mode = 'synthetic_test'
    ORDER BY created_at, id`)
    .bind(
      member.organisationId,
      row.id,
      input.fieldCode,
      member.uid,
    )
    .all<{ id: string }>();
  const testerCaptureIds = new Set(
    testerCaptureRows.results.map(({ id }) => id),
  );
  const testerResponseCaptures = response.captures.filter(
    ({ captureId }) => testerCaptureIds.has(captureId),
  );
  if (
    field.maximumCount > 0
    && testerCaptureIds.size >= field.maximumCount
  ) {
    throw new CreditexManualFieldError(
      "EVIDENCE_MAXIMUM_REACHED",
      409,
      `The locked prompt allows up to ${field.maximumCount} files.`,
    );
  }
  const now = new Date().toISOString();
  const capture = {
    captureId: input.captureId,
    fileName: input.fileName,
    contentType: input.contentType,
    originalPresent: true,
    metadataPresent: input.metadataState === "verified",
    gpsPresent: input.gpsState === "verified",
    captureTimePresent: input.captureTimeState === "verified",
    originalSha256: input.originalSha256,
    deviceId: input.deviceId,
    capturedAt: now,
    verificationState: "server_verified" as const,
    physicalDeviceState: input.physicalDeviceState,
  };
  const responses = validateManualEvidenceResponses(
    schema.fields,
    current.map((candidate) =>
      candidate.fieldCode === input.fieldCode
        ? {
            ...candidate,
            outcome: "provided" as const,
            captures: [...testerResponseCaptures, capture],
          }
        : candidate
    ),
  );
  const progress = manualEvidenceProgress(schema.fields, responses);
  const responseJson = canonicalJson(responses);
  const responseSha256 = await sha256Hex(responseJson);
  const envelopeJson = canonicalJson(input.evidenceEnvelope);
  const verificationJson = canonicalJson(input.serverVerification);
  const receiptId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const results = await database.batch([
    database.prepare(`INSERT INTO
        compliance_manual_evidence_test_captures (
          id, organisation_id, job_id, field_code, field_tester_uid,
          device_id, upload_session_id, object_key, file_name, content_type,
          size_bytes, original_sha256, evidence_envelope,
          server_verification, metadata_state, gps_state,
          capture_time_state, physical_device_state, status, record_mode,
          created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'captured', 'synthetic_test', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM compliance_manual_evidence_test_jobs
          WHERE id = ? AND organisation_id = ? AND field_tester_uid = ?
            AND revision = ? AND record_mode = 'synthetic_test'
            AND status IN ('draft', 'field_testing', 'changes_required')
        )
        AND EXISTS (
          SELECT 1 FROM compliance_manual_field_upload_sessions session
          WHERE session.id = ? AND session.organisation_id = ?
            AND session.job_id = ? AND session.field_code = ?
            AND session.field_tester_uid = ? AND session.device_id = ?
            AND session.object_key = ? AND session.status = 'completing'
            AND session.record_mode = 'synthetic_test'
        )`)
      .bind(
        input.captureId,
        member.organisationId,
        row.id,
        input.fieldCode,
        member.uid,
        input.deviceId,
        input.sessionId,
        input.objectKey,
        input.fileName,
        input.contentType,
        input.sizeBytes,
        input.originalSha256,
        envelopeJson,
        verificationJson,
        input.metadataState,
        input.gpsState,
        input.captureTimeState,
        input.physicalDeviceState,
        now,
        now,
        row.id,
        member.organisationId,
        member.uid,
        row.revision,
        input.sessionId,
        member.organisationId,
        row.id,
        input.fieldCode,
        member.uid,
        input.deviceId,
        input.objectKey,
      ),
    database.prepare(`UPDATE compliance_manual_evidence_test_jobs
      SET response_snapshot = ?, response_sha256 = ?,
        required_count = ?, completed_required_count = ?, issue_count = ?,
        status = CASE WHEN status IN ('draft', 'changes_required')
          THEN 'field_testing' ELSE status END,
        revision = revision + 1, updated_by_uid = ?, updated_at = ?
      WHERE id = ? AND organisation_id = ? AND field_tester_uid = ?
        AND revision = ? AND record_mode = 'synthetic_test'
        AND status IN ('draft', 'field_testing', 'changes_required')
        AND EXISTS (
          SELECT 1 FROM compliance_manual_evidence_test_captures
          WHERE id = ? AND organisation_id = ? AND job_id = ?
            AND record_mode = 'synthetic_test'
        )`)
      .bind(
        responseJson,
        responseSha256,
        progress.requiredCount,
        progress.completedRequired,
        progress.issueCount,
        member.uid,
        now,
        row.id,
        member.organisationId,
        member.uid,
        row.revision,
        input.captureId,
        member.organisationId,
        row.id,
      ),
    database.prepare(`INSERT INTO
        compliance_manual_field_integrity_receipts (
          id, organisation_id, capture_id, request_id, object_key,
          expected_sha256, observed_sha256, expected_size_bytes,
          observed_size_bytes, result, verification_scope, verified_by_uid,
          verified_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matched',
          'r2_object_bytes_and_embedded_metadata', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM compliance_manual_evidence_test_captures
          WHERE id = ? AND organisation_id = ?
        )`)
      .bind(
        receiptId,
        member.organisationId,
        input.captureId,
        `upload:${input.sessionId}`,
        input.objectKey,
        input.originalSha256,
        input.originalSha256,
        input.sizeBytes,
        input.sizeBytes,
        member.uid,
        now,
        input.captureId,
        member.organisationId,
      ),
    database.prepare(`INSERT INTO
        compliance_manual_evidence_test_events (
          id, organisation_id, job_id, event_type, actor_uid, summary,
          metadata, created_at
        ) SELECT ?, ?, ?, 'manual_field.capture_verified', ?,
        'Original synthetic evidence bytes verified and retained from TLink.',
          ?, ?
        WHERE EXISTS (
          SELECT 1 FROM compliance_manual_evidence_test_captures
          WHERE id = ? AND organisation_id = ?
        )`)
      .bind(
        eventId,
        member.organisationId,
        row.id,
        member.uid,
        canonicalJson({
          captureId: input.captureId,
          sessionId: input.sessionId,
          fieldCode: input.fieldCode,
          originalSha256: input.originalSha256,
          integrityReceiptId: receiptId,
          metadataState: input.metadataState,
          gpsState: input.gpsState,
          captureTimeState: input.captureTimeState,
          physicalDeviceState: input.physicalDeviceState,
          recordMode: "synthetic_test",
        }),
        now,
        input.captureId,
        member.organisationId,
      ),
  ]);
  if (
    Number(results[0]?.meta.changes || 0) !== 1
    || Number(results[1]?.meta.changes || 0) !== 1
    || Number(results[2]?.meta.changes || 0) !== 1
    || Number(results[3]?.meta.changes || 0) !== 1
  ) {
    throw new CreditexManualFieldError(
      "MANUAL_FIELD_CAPTURE_CONFLICT",
      409,
      "Creditex changed this synthetic test before the verified capture was attached.",
    );
  }
  return { captureId: input.captureId, integrityReceiptId: receiptId };
}

export function manualFieldErrorResponse(error: unknown) {
  if (error instanceof CreditexManualFieldError) {
    return {
      status: error.status,
      body: { ok: false, code: error.code, error: error.message },
    };
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return {
      status: 401,
      body: {
        ok: false,
        code: "AUTH_REQUIRED",
        error: "Sign in to continue.",
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      code: "MANUAL_FIELD_UNAVAILABLE",
      error: "The synthetic TLink lane is temporarily unavailable.",
    },
  };
}
