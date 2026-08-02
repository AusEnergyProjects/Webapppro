import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceIdentity,
} from "@/lib/compliance-access-server";
import {
  CreditexSyntheticRegisterError,
  loadCreditexSyntheticJobRegister,
  parseCreditexSyntheticRegisterFilters,
} from "@/lib/creditex-synthetic-job-register-server";
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
    || error instanceof CreditexSyntheticRegisterError
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
    && error.message.startsWith("CREDITEX_SCHEMA_")
  ) {
    return json({
      ok: false,
      code: "CREDITEX_SYNTHETIC_REGISTER_SCHEMA_NOT_READY",
      error:
        "The synthetic job register is still applying its protected storage contract. Retry shortly.",
    }, 503);
  }
  console.error("Creditex synthetic job register request failed", error);
  return json({
    ok: false,
    code: "CREDITEX_SYNTHETIC_REGISTER_UNAVAILABLE",
    error: "The synthetic job register is temporarily unavailable. Try again.",
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
    const filters = parseCreditexSyntheticRegisterFilters(
      new URL(request.url).searchParams,
    );
    const register = await loadCreditexSyntheticJobRegister(
      database,
      member,
      filters,
    );
    return json({ ok: true, register });
  } catch (error) {
    return errorResponse(error);
  }
}
