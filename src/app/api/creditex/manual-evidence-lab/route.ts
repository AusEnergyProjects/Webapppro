import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceIdentity,
} from "@/lib/compliance-access-server";
import {
  CreditexManualEvidenceLabError,
  cloneManualEvidenceForm,
  createManualEvidenceTestJob,
  createStarterManualEvidenceForm,
  deleteDraftManualEvidenceForm,
  loadManualEvidenceLab,
  loadManualEvidenceTestJobEvents,
  markManualEvidenceFormTestReady,
  updateManualEvidenceForm,
  updateManualEvidenceTestJob,
} from "@/lib/creditex-manual-evidence-lab-server";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import { ensureCreditexSchemaGuards } from "@/lib/creditex-schema-guards";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
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

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexManualEvidenceLabError
    || error instanceof BoundedJsonRequestError
  ) {
    return json(
      { ok: false, code: error.code, error: error.message },
      error.status,
    );
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json(
      { ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." },
      401,
    );
  }
  if (
    error instanceof Error
    && (
      error.message.includes("UNIQUE constraint failed")
      || error.message.includes("SQLITE_CONSTRAINT")
      || error.message.includes("COMPLIANCE_MANUAL_")
    )
  ) {
    return json({
      ok: false,
      code: "MANUAL_EVIDENCE_STATE_CONFLICT",
      error:
        "The manual evidence workspace changed before this request completed. Refresh and reconcile the current record.",
    }, 409);
  }
  if (
    error instanceof Error
    && error.message.startsWith("CREDITEX_SCHEMA_")
  ) {
    return json({
      ok: false,
      code: "MANUAL_EVIDENCE_SCHEMA_NOT_READY",
      error:
        "The manual evidence workspace is still applying its protected storage contract. Retry shortly.",
    }, 503);
  }
  console.error("Creditex manual evidence lab request failed", error);
  return json({
    ok: false,
    code: "MANUAL_EVIDENCE_UNAVAILABLE",
    error: "The manual evidence lab is temporarily unavailable. Try again.",
  }, 500);
}

async function requireMember(request: Request, database: D1Database) {
  const identity = await requireFirebaseIdentity(request);
  const member = await requireComplianceIdentity(identity, {
    allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
  }, database);
  await ensureCreditexSchemaGuards(database);
  return member;
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
    const member = await requireMember(request, database);
    const searchParams = new URL(request.url).searchParams;
    const jobId = searchParams.get("jobId") || "";
    if (searchParams.get("view") === "events") {
      if (!jobId) {
        throw new CreditexManualEvidenceLabError(
          "MANUAL_EVIDENCE_TEST_JOB_REQUIRED",
          400,
          "Choose a manual evidence test job.",
        );
      }
      return json({
        ok: true,
        events: await loadManualEvidenceTestJobEvents(
          database,
          member,
          jobId,
        ),
      });
    }
    return json({
      ok: true,
      lab: await loadManualEvidenceLab(database, member, {
        programCode: searchParams.get("programCode") || "",
        activityTemplateId:
          searchParams.get("activityTemplateId") || "",
        jobId,
        formPage: Number(searchParams.get("formPage") || 1),
        jobPage: Number(searchParams.get("jobPage") || 1),
        pageSize: Number(searchParams.get("pageSize") || 50),
      }),
    });
  } catch (error) {
    return errorResponse(error);
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
    const database = getD1();
    const member = await requireMember(request, database);
    const body = await readBoundedJsonRequest(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new CreditexManualEvidenceLabError(
        "MANUAL_EVIDENCE_REQUEST_INVALID",
        400,
        "Enter a valid manual evidence request.",
      );
    }
    const action = String(
      (body as Record<string, unknown>).action || "",
    ).trim();
    const handlers = {
      create_starter_form: createStarterManualEvidenceForm,
      update_form: updateManualEvidenceForm,
      mark_test_ready: markManualEvidenceFormTestReady,
      clone_form: cloneManualEvidenceForm,
      delete_draft_form: deleteDraftManualEvidenceForm,
      create_test_job: createManualEvidenceTestJob,
      update_test_job: updateManualEvidenceTestJob,
    } as const;
    const handler = handlers[action as keyof typeof handlers];
    if (!handler) {
      throw new CreditexManualEvidenceLabError(
        "MANUAL_EVIDENCE_ACTION_INVALID",
        400,
        "Choose a supported manual evidence action.",
      );
    }
    const result = await handler(database, member, body);
    return json({ ok: true, result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
