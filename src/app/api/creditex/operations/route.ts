import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceIdentity,
} from "@/lib/compliance-access-server";
import {
  CreditexOperationsError,
  executeCreditexOperation,
  loadCreditexCaseWorkspace,
  loadCreditexOperationsDashboard,
  parseCreditexOperationsFilters,
} from "@/lib/creditex-operations-server";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;

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

function requiredBody(value: unknown): Body {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditexOperationsError(
      "CREDITEX_REQUEST_INVALID",
      400,
      "Enter a valid Creditex operations request.",
    );
  }
  return value as Body;
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexOperationsError
  ) {
    return json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." }, 401);
  }
  if (
    error instanceof Error
    && (
      error.message.includes("UNIQUE constraint failed")
      || error.message.includes("SQLITE_CONSTRAINT_UNIQUE")
    )
  ) {
    return json({
      ok: false,
      code: "CREDITEX_RECORD_EXISTS",
      error: "That governed Creditex record already exists.",
    }, 409);
  }
  if (
    error instanceof Error
    && error.message.includes("compliance_write_guards")
  ) {
    return json({
      ok: false,
      code: "CREDITEX_STATE_CONFLICT",
      error: "The record changed before the operation completed. Refresh and try again.",
    }, 409);
  }
  if (
    error instanceof Error
    && error.message.includes("COMPLIANCE_")
  ) {
    return json({
      ok: false,
      code: "CREDITEX_STATE_CONFLICT",
      error: "The governed record no longer satisfies its compliance constraints. Refresh and review the case.",
    }, 409);
  }
  console.error("Creditex operations request failed", error);
  return json({
    ok: false,
    code: "CREDITEX_OPERATIONS_UNAVAILABLE",
    error: "Creditex operations are temporarily unavailable. Try again.",
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
    const member = await requireMember(request, database);
    const searchParams = new URL(request.url).searchParams;
    const caseId = searchParams.get("caseId");
    if (caseId) {
      const workspace = await loadCreditexCaseWorkspace(
        database,
        member,
        caseId,
      );
      return json({ ok: true, workspace });
    }
    const filters = parseCreditexOperationsFilters(searchParams);
    const dashboard = await loadCreditexOperationsDashboard(
      database,
      member,
      filters,
    );
    return json({ ok: true, dashboard });
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
    const body = requiredBody(await request.json().catch(() => null));
    const result = await executeCreditexOperation(database, member, body);
    return json({ ok: true, result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
