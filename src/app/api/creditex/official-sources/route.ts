import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";
import {
  CREDITEX_OFFICIAL_SOURCE_LIMITS,
  CreditexOfficialSourceCustodyError,
  captureCreditexOfficialSource,
  listCreditexOfficialSourceTargets,
  listCreditexOfficialSources,
} from "@/lib/creditex-official-source-custody-server";

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
  if (
    error instanceof Error
    && (
      error.message.includes("COMPLIANCE_SOURCE_")
      || error.message.includes("SQLITE_CONSTRAINT")
    )
  ) {
    return json({
      ok: false,
      code: "SOURCE_CUSTODY_STATE_CONFLICT",
      error:
        "The draft source target or custody record changed before capture completed.",
    }, 409);
  }
  console.error("Creditex official source custody request failed", error);
  return json({
    ok: false,
    code: "SOURCE_CUSTODY_UNAVAILABLE",
    error: "The official source could not be captured safely.",
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
    const search = new URL(request.url).searchParams;
    const [sourcePage, targets] = await Promise.all([
      listCreditexOfficialSources(database, member, {
        cursor: search.get("cursor"),
        pageSize: search.get("pageSize"),
      }),
      listCreditexOfficialSourceTargets(database, member),
    ]);
    return json({
      ok: true,
      sources: sourcePage.items,
      sourcePagination: {
        total: sourcePage.total,
        pageSize: sourcePage.pageSize,
        hasNext: sourcePage.hasNext,
        nextCursor: sourcePage.nextCursor,
      },
      targets,
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
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      throw new CreditexOfficialSourceCustodyError(
        "SOURCE_UPLOAD_REQUIRED",
        415,
        "Upload the exact official source file.",
      );
    }
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (
      Number.isFinite(contentLength)
      && contentLength > CREDITEX_OFFICIAL_SOURCE_LIMITS.maximumRequestBytes
    ) {
      throw new CreditexOfficialSourceCustodyError(
        "SOURCE_FILE_SIZE_INVALID",
        413,
        "Upload an official source file no larger than 15 MB.",
      );
    }
    const database = getD1();
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "case_manager"],
    }, database);
    const form = await request.formData().catch(() => null);
    const sourceFile = form?.get("sourceFile");
    if (!(sourceFile instanceof File)) {
      throw new CreditexOfficialSourceCustodyError(
        "SOURCE_UPLOAD_REQUIRED",
        400,
        "Upload the exact official source file.",
      );
    }
    if (
      sourceFile.size < 1
      || sourceFile.size > CREDITEX_OFFICIAL_SOURCE_LIMITS.maximumBytes
    ) {
      throw new CreditexOfficialSourceCustodyError(
        "SOURCE_FILE_SIZE_INVALID",
        413,
        "Upload an official source file no larger than 15 MB.",
      );
    }
    const result = await captureCreditexOfficialSource(
      database,
      getCreditexCustodyBucket(),
      member,
      {
        clientRequestId: form?.get("clientRequestId"),
        sourceUrl: form?.get("sourceUrl"),
        sourceTitle: form?.get("sourceTitle"),
        sourceVersion: form?.get("sourceVersion"),
        originalFileName: sourceFile.name,
        contentType: sourceFile.type,
        assertedRetrievedAt: form?.get("assertedRetrievedAt"),
        sourceEtag: form?.get("sourceEtag"),
        sourceLastModified: form?.get("sourceLastModified"),
        targetType: form?.get("targetType"),
        targetId: form?.get("targetId"),
        citationLocation: form?.get("citationLocation"),
        bytes: new Uint8Array(await sourceFile.arrayBuffer()),
      },
    );
    return json({ ok: true, ...result }, result.reused ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}
