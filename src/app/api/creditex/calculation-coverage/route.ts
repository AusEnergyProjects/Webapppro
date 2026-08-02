import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceIdentity,
} from "@/lib/compliance-access-server";
import {
  CREDITEX_CALCULATION_COVERAGE_REVIEWED_ON,
  CREDITEX_CALCULATION_COVERAGE_SUMMARY,
} from "@/lib/creditex-calculation-coverage";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const readiness = Object.freeze({
  reviewedOn: CREDITEX_CALCULATION_COVERAGE_REVIEWED_ON,
  readOnly: true,
  certificateActionsEnabled: false,
  coverage: CREDITEX_CALCULATION_COVERAGE_SUMMARY,
});

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
  if (error instanceof ComplianceAccessError) {
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
  console.error("Creditex calculation coverage request failed", error);
  return json({
    ok: false,
    code: "CREDITEX_CALCULATION_COVERAGE_UNAVAILABLE",
    error: "Calculation coverage is temporarily unavailable. Try again.",
  }, 500);
}

async function requireMember(request: Request, database: D1Database) {
  const identity = await requireFirebaseIdentity(request);
  return requireComplianceIdentity(identity, {
    allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
  }, database);
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
    await requireMember(request, database);
    return json({ ok: true, readiness });
  } catch (error) {
    return errorResponse(error);
  }
}
