import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type EvidenceBucket = {
  get(key: string): Promise<{
    body: BodyInit;
    httpMetadata?: { contentType?: string };
  } | null>;
};

type EvidenceRecord = {
  id: string;
  organisation_id: string;
  case_id: string;
  source_type: string;
  content_type: string;
  size_bytes: number;
  object_key: string;
  original_sha256: string;
  evidence_envelope: string;
  received_at: string;
};

const VIEWABLE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function responseHeaders() {
  return {
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
  };
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: responseHeaders(),
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function bucket() {
  const value = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!value) throw new Error("EVIDENCE_STORAGE_UNAVAILABLE");
  return value;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? String(parsed)
    : "";
}

function evidenceFactHeaders(record: EvidenceRecord) {
  const headers = new Headers(responseHeaders());
  headers.set("Content-Type", record.content_type);
  headers.set("Content-Disposition", "inline");
  headers.set("Content-Length", String(record.size_bytes));
  headers.set("X-Creditex-Evidence-Received-At", record.received_at);
  headers.set("X-Creditex-Evidence-Source", record.source_type);
  headers.set(
    "X-Creditex-Evidence-Integrity",
    /^[0-9a-f]{64}$/i.test(record.original_sha256) ? "recorded" : "unknown",
  );

  let envelope: Record<string, unknown> = {};
  try {
    envelope = objectValue(JSON.parse(record.evidence_envelope)) || {};
  } catch {
    envelope = {};
  }
  const capture = objectValue(envelope.capture);
  const location = objectValue(envelope.location);
  const original = objectValue(envelope.original);
  const observedAt = typeof capture?.observedAtUtc === "string"
      && Number.isFinite(Date.parse(capture.observedAtUtc))
    ? capture.observedAtUtc
    : "";
  if (observedAt) {
    headers.set("X-Creditex-Evidence-Observed-At", observedAt);
  }

  const latitude = finiteNumber(location?.latitude, -90, 90);
  const longitude = finiteNumber(location?.longitude, -180, 180);
  const accuracy = finiteNumber(location?.accuracyMetres, 0, 100_000);
  const locationReported = location?.state === "captured"
    && Boolean(latitude)
    && Boolean(longitude);
  headers.set(
    "X-Creditex-Evidence-Gps-State",
    locationReported ? "reported" : "unknown",
  );
  if (locationReported) {
    headers.set("X-Creditex-Evidence-Latitude", latitude);
    headers.set("X-Creditex-Evidence-Longitude", longitude);
    if (accuracy) {
      headers.set("X-Creditex-Evidence-Accuracy-Metres", accuracy);
    }
    if (typeof location?.mocked === "boolean") {
      headers.set(
        "X-Creditex-Evidence-Location-Mocked",
        location.mocked ? "true" : "false",
      );
    }
  }

  headers.set(
    "X-Creditex-Evidence-Metadata-State",
    original?.exifState === "available" ? "reported" : "unknown",
  );
  headers.set(
    "X-Creditex-Evidence-Original-State",
    original?.preservedWithoutAppTransformation === true
      ? "preserved"
      : original?.preservedWithoutAppTransformation === false
        ? "not_preserved"
        : "unknown",
  );
  return headers;
}

function errorResponse(error: unknown) {
  if (error instanceof ComplianceAccessError) {
    return json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json({
      ok: false,
      code: "AUTH_REQUIRED",
      error: "Sign in to continue.",
    }, 401);
  }
  if (
    error instanceof Error
    && error.message === "EVIDENCE_STORAGE_UNAVAILABLE"
  ) {
    return json({
      ok: false,
      code: "EVIDENCE_STORAGE_UNAVAILABLE",
      error: "Evidence storage is temporarily unavailable.",
    }, 503);
  }
  console.error("Creditex evidence view failed", error);
  return json({
    ok: false,
    code: "EVIDENCE_VIEW_UNAVAILABLE",
    error: "The evidence item could not be opened.",
  }, 500);
}

export async function GET(request: Request, context: RouteContext) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }

  try {
    const evidenceId = String((await context.params).id || "").trim();
    if (!evidenceId || evidenceId.length > 180) {
      return json({
        ok: false,
        code: "EVIDENCE_ID_REQUIRED",
        error: "Choose an evidence item.",
      }, 400);
    }

    const database = getD1();
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "reviewer", "auditor"],
    }, database);
    const record = await database.prepare(`SELECT
        evidence.id,
        evidence.organisation_id,
        evidence.case_id,
        evidence.source_type,
        evidence.content_type,
        evidence.size_bytes,
        evidence.object_key,
        evidence.original_sha256,
        evidence.evidence_envelope,
        evidence.received_at
      FROM compliance_case_evidence evidence
      JOIN compliance_cases compliance_case
        ON compliance_case.id = evidence.case_id
        AND compliance_case.organisation_id = evidence.organisation_id
      WHERE evidence.id = ?
        AND evidence.organisation_id = ?
        AND (
          ? = 'admin'
          OR (
            ? = 'reviewer'
            AND EXISTS (
              SELECT 1
              FROM compliance_case_assignments assignment
              WHERE assignment.organisation_id = evidence.organisation_id
                AND assignment.case_id = evidence.case_id
                AND assignment.compliance_user_id = ?
                AND assignment.assignment_role IN (
                  'primary_reviewer', 'secondary_reviewer'
                )
                AND assignment.status = 'assigned'
            )
          )
          OR (
            ? = 'auditor'
            AND EXISTS (
              SELECT 1
              FROM compliance_case_assignments assignment
              WHERE assignment.organisation_id = evidence.organisation_id
                AND assignment.case_id = evidence.case_id
                AND assignment.compliance_user_id = ?
                AND assignment.assignment_role = 'auditor'
                AND assignment.status = 'assigned'
            )
          )
        )
      LIMIT 1`)
      .bind(
        evidenceId,
        member.organisationId,
        member.role,
        member.role,
        member.membershipId,
        member.role,
        member.membershipId,
      )
      .first<EvidenceRecord>();

    if (!record) {
      return json({
        ok: false,
        code: "EVIDENCE_NOT_FOUND",
        error: "The evidence item was not found or is not assigned to you.",
      }, 404);
    }
    if (!VIEWABLE_CONTENT_TYPES.has(record.content_type)) {
      return json({
        ok: false,
        code: "EVIDENCE_TYPE_NOT_VIEWABLE",
        error: "This evidence file type cannot be displayed safely in the portal.",
      }, 415);
    }

    const object = await bucket().get(record.object_key);
    if (!object) {
      return json({
        ok: false,
        code: "EVIDENCE_OBJECT_NOT_FOUND",
        error: "The stored evidence item could not be found.",
      }, 404);
    }

    const receiptId = crypto.randomUUID();
    const viewedAt = new Date().toISOString();
    const audit = await database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type,
        target_type, target_id, summary, metadata, created_at
      ) VALUES (
        ?, ?, 'compliance', ?, 'evidence.viewed',
        'compliance_case_evidence', ?,
        'Authorised Creditex member opened protected case evidence.',
        ?, ?
      )`)
      .bind(
        receiptId,
        member.organisationId,
        member.uid,
        record.id,
        JSON.stringify({
          caseId: record.case_id,
          accessRole: member.role,
          contentType: record.content_type,
        }),
        viewedAt,
      )
      .run();
    if (!audit.meta.changes) {
      throw new Error("EVIDENCE_VIEW_AUDIT_FAILED");
    }

    const headers = evidenceFactHeaders(record);
    headers.set("X-Creditex-Evidence-Receipt", receiptId);
    return new Response(object.body, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
