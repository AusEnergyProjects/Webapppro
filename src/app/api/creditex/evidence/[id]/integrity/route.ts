import { getD1 } from "../../../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";
import {
  CreditexEvidenceIntegrityError,
  listCreditexEvidenceIntegrityReceipts,
  verifyCreditexEvidenceIntegrity,
} from "@/lib/creditex-evidence-integrity-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

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
    || error instanceof CreditexEvidenceIntegrityError
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
    && error.message === "CREDITEX_CUSTODY_STORAGE_UNAVAILABLE"
  ) {
    return json({
      ok: false,
      code: "EVIDENCE_INTEGRITY_STORAGE_UNAVAILABLE",
      error: "Evidence custody storage is temporarily unavailable.",
    }, 503);
  }
  if (
    error instanceof Error
    && (
      error.message.includes("COMPLIANCE_EVIDENCE_INTEGRITY")
      || error.message.includes("SQLITE_CONSTRAINT")
    )
  ) {
    return json({
      ok: false,
      code: "EVIDENCE_INTEGRITY_STATE_CONFLICT",
      error:
        "The evidence custody envelope changed before the integrity receipt was saved.",
    }, 409);
  }
  console.error("Creditex evidence integrity request failed", error);
  return json({
    ok: false,
    code: "EVIDENCE_INTEGRITY_UNAVAILABLE",
    error: "The evidence custody integrity check could not be completed.",
  }, 500);
}

async function access(request: Request, database: D1Database) {
  return requireComplianceAccess(request, {
    allowedRoles: ["admin", "reviewer", "auditor"],
  }, database);
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
    const database = getD1();
    const member = await access(request, database);
    const evidenceId = String((await context.params).id || "");
    const receipts = await listCreditexEvidenceIntegrityReceipts(
      database,
      member,
      evidenceId,
    );
    return json({ ok: true, receipts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 8_192) {
      return json({
        ok: false,
        code: "EVIDENCE_INTEGRITY_REQUEST_TOO_LARGE",
        error: "The integrity request was too large.",
      }, 413);
    }
    const body = await request.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    if (!body || Array.isArray(body)) {
      return json({
        ok: false,
        code: "EVIDENCE_INTEGRITY_REQUEST_INVALID",
        error: "Enter a valid evidence integrity request.",
      }, 400);
    }
    const database = getD1();
    const member = await access(request, database);
    const result = await verifyCreditexEvidenceIntegrity(
      database,
      getCreditexCustodyBucket(),
      member,
      {
        evidenceId: String((await context.params).id || ""),
        requestId: body.requestId,
      },
    );
    const status = result.receipt.result === "matched"
      ? 200
      : result.receipt.result === "storage_unavailable"
        ? 503
        : 409;
    return json({ ok: result.receipt.integrityMatched, ...result }, status);
  } catch (error) {
    return errorResponse(error);
  }
}
