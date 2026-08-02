import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  CREDITEX_OPERATIONAL_LOOKUP_LIMITS,
  CreditexOperationalLookupError,
  listCreditexOperationalLookupImports,
  stageCreditexOperationalLookupImport,
} from "@/lib/creditex-operational-lookup-server";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";
import {
  CreditexSourceLookupReviewError,
  materialiseApprovedCreditexOperationalLookup,
} from "@/lib/creditex-source-lookup-review-server";

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
    throw new CreditexOperationalLookupError(
      "LOOKUP_REQUEST_INVALID",
      400,
      "Enter a valid official lookup staging request.",
    );
  }
  return value as Body;
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexOperationalLookupError
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
      error.message.includes("COMPLIANCE_LOOKUP_")
      || error.message.includes("SQLITE_CONSTRAINT")
    )
  ) {
    return json({
      ok: false,
      code: "LOOKUP_STAGING_STATE_CONFLICT",
      error:
        "The governed lookup source changed before staging completed. Refresh and try again.",
    }, 409);
  }
  console.error("Creditex operational lookup staging failed", error);
  return json({
    ok: false,
    code: "LOOKUP_STAGING_UNAVAILABLE",
    error: "Official lookup records could not be staged safely.",
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
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.has("importId") || searchParams.has("asOf")) {
      const snapshot = await materialiseApprovedCreditexOperationalLookup(
        database,
        getCreditexCustodyBucket(),
        member,
        searchParams.get("importId"),
        searchParams.get("asOf"),
      );
      return json({ ok: true, snapshot });
    }
    const imports = await listCreditexOperationalLookupImports(
      database,
      member,
    );
    return json({ ok: true, imports });
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
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (
      Number.isFinite(contentLength)
      && contentLength
        > CREDITEX_OPERATIONAL_LOOKUP_LIMITS.maximumRequestBytes
    ) {
      throw new CreditexOperationalLookupError(
        "LOOKUP_REQUEST_TOO_LARGE",
        413,
        "The lookup staging request exceeds the 2 MiB limit.",
      );
    }
    const database = getD1();
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "case_manager"],
    }, database);
    const body = requiredBody(await request.json().catch(() => null));
    if (String(body.action || "").trim() !== "stage_import") {
      throw new CreditexOperationalLookupError(
        "LOOKUP_ACTION_INVALID",
        400,
        "Choose the supported official lookup staging action.",
      );
    }
    const result = await stageCreditexOperationalLookupImport(
      database,
      member,
      {
        clientRequestId: body.clientRequestId,
        lookupKind: body.lookupKind,
        sourceArtifactId: body.sourceArtifactId,
        sourceTimestamp: body.sourceTimestamp,
        records: body.records,
      },
    );
    return json(
      { ok: true, ...result },
      result.importBatch.reused ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
