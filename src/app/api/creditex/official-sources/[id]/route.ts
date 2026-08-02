import { getD1 } from "../../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";
import {
  CreditexOfficialSourceCustodyError,
  downloadCreditexOfficialSource,
} from "@/lib/creditex-official-source-custody-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function responseHeaders() {
  return {
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: responseHeaders(),
  });
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexOfficialSourceCustodyError
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
      code: "SOURCE_CUSTODY_STORAGE_UNAVAILABLE",
      error: "Official source custody storage is temporarily unavailable.",
    }, 503);
  }
  console.error("Creditex official source download failed", error);
  return json({
    ok: false,
    code: "SOURCE_DOWNLOAD_UNAVAILABLE",
    error: "The retained official source could not be downloaded safely.",
  }, 500);
}

function attachmentHeader(fileName: string) {
  const asciiName = fileName
    .replace(/[^\u0020-\u007e]/g, "_")
    .replaceAll("\\", "_")
    .replaceAll('"', "_");
  const encodedName = encodeURIComponent(fileName)
    .replaceAll("'", "%27")
    .replaceAll("*", "%2A");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
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
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
    }, database);
    const result = await downloadCreditexOfficialSource(
      database,
      getCreditexCustodyBucket(),
      member,
      (await context.params).id,
    );
    const headers = new Headers(responseHeaders());
    headers.set("Content-Type", result.contentType);
    headers.set("Content-Disposition", attachmentHeader(result.fileName));
    headers.set("Content-Length", String(result.sizeBytes));
    headers.set("X-Creditex-Official-Source-Sha256", result.sha256);
    headers.set("X-Creditex-Official-Source-Receipt", result.receiptId);
    return new Response(result.bytes, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
