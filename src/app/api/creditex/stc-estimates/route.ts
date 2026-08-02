import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  CreditexStcEstimateError,
  estimateCreditexStcs,
} from "@/lib/creditex-stc-estimator";
import {
  BoundedJsonRequestError,
  MAXIMUM_CREDITEX_JSON_BYTES,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";

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
    || error instanceof CreditexStcEstimateError
    || error instanceof BoundedJsonRequestError
  ) {
    const code = error instanceof BoundedJsonRequestError
      ? error.code === "REQUEST_TOO_LARGE"
        ? "STC_REQUEST_TOO_LARGE"
        : "STC_REQUEST_INVALID"
      : error.code;
    return json({
      ok: false,
      code,
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
  console.error("Creditex STC estimate failed", error);
  return json({
    ok: false,
    code: "STC_ESTIMATE_UNAVAILABLE",
    error: "The STC estimate could not be completed safely.",
  }, 500);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({
      ok: false,
      code: "STC_CONTENT_TYPE_INVALID",
      error: "Send STC estimate requests as JSON.",
    }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (
    Number.isFinite(contentLength)
    && contentLength > MAXIMUM_CREDITEX_JSON_BYTES
  ) {
    return json({
      ok: false,
      code: "STC_REQUEST_TOO_LARGE",
      error: "The STC estimate request exceeds 16 KiB.",
    }, 413);
  }

  try {
    const database = getD1();
    await requireComplianceAccess(request, {
      allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
    }, database);
    const body = await readBoundedJsonRequest(
      request,
      MAXIMUM_CREDITEX_JSON_BYTES,
    );
    const estimate = estimateCreditexStcs(body);
    return json({ ok: true, estimate });
  } catch (error) {
    return errorResponse(error);
  }
}
