import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function json(body: object, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function errorResponse(error: unknown) {
  if (error instanceof ComplianceAccessError) {
    return json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." }, 401);
  }
  if (
    error instanceof Error
    && error.message.startsWith("CREDITEX_SCHEMA_GUARDS_INSTALLING:")
  ) {
    return json({
      ok: false,
      code: "CREDITEX_SCHEMA_GUARDS_INSTALLING",
      error: "Preparing the governed Creditex workspace.",
    }, 503, { "Retry-After": "1" });
  }
  if (
    error instanceof Error
    && (
      error.message.startsWith("CREDITEX_SCHEMA_GUARD_MISMATCH:")
      || error.message.startsWith("CREDITEX_SCHEMA_GUARDS_UNAVAILABLE:")
      || error.message.startsWith("CREDITEX_SCHEMA_MIGRATIONS_REQUIRED:")
    )
  ) {
    const [code, names = ""] = error.message.split(":", 2);
    console.error("Creditex schema guard verification failed", {
      code,
      affectedGuardCount: names ? names.split(",").length : 0,
    });
    return json({
      ok: false,
      code: "CREDITEX_SCHEMA_GUARD_REVIEW_REQUIRED",
      error:
        "Creditex integrity controls need a governed upgrade before this workspace can open. No compliance write has been accepted.",
    }, 503);
  }
  console.error("Creditex compliance session failed", error);
  return json({
    ok: false,
    code: "COMPLIANCE_SESSION_UNAVAILABLE",
    error: "Compliance access could not be verified. Try again or contact TLink operations.",
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
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
    });
    return json({
      ok: true,
      member: {
        email: member.email,
        displayName: member.displayName,
        role: member.role,
        governanceIdentityVerified: member.governanceIdentityVerified,
        organisation: {
          code: member.organisationCode,
          legalName: member.organisationLegalName,
          tradingName: member.organisationTradingName,
        },
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
