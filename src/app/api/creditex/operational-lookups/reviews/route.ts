import { getD1 } from "../../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";
import {
  CreditexSourceLookupReviewError,
  listCreditexOperationalLookupReviewDecisions,
  reviewCreditexOperationalLookupImport,
} from "@/lib/creditex-source-lookup-review-server";

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

function bodyRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditexSourceLookupReviewError(
      "LOOKUP_REVIEW_REQUEST_INVALID",
      400,
      "Enter a valid operational lookup review decision.",
    );
  }
  return value as Record<string, unknown>;
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexSourceLookupReviewError
  ) {
    return json({
      ok: false,
      code: error.code,
      error: error.message,
    }, error.status);
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
    && (
      error.message.includes("COMPLIANCE_LOOKUP_REVIEW_")
      || error.message.includes("SQLITE_CONSTRAINT")
    )
  ) {
    return json({
      ok: false,
      code: "LOOKUP_REVIEW_STATE_CONFLICT",
      error: "The lookup review state changed. Refresh and review it again.",
    }, 409);
  }
  console.error("Creditex operational lookup review failed", error);
  return json({
    ok: false,
    code: "LOOKUP_REVIEW_UNAVAILABLE",
    error: "The lookup decision could not be recorded safely.",
  }, 500);
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
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
    }, database);
    return json({
      ok: true,
      decisions: await listCreditexOperationalLookupReviewDecisions(
        database,
        member,
      ),
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
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin"],
    }, database);
    const body = bodyRecord(await request.json().catch(() => null));
    if (String(body.action || "").trim() !== "record_decision") {
      throw new CreditexSourceLookupReviewError(
        "LOOKUP_REVIEW_ACTION_INVALID",
        400,
        "Choose the supported lookup review action.",
      );
    }
    const result = await reviewCreditexOperationalLookupImport(
      database,
      getCreditexCustodyBucket(),
      member,
      {
        importId: body.importId,
        decision: body.decision,
        reviewNote: body.reviewNote,
      },
    );
    return json({ ok: true, ...result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
