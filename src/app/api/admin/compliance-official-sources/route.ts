import { getD1 } from "../../../../../db";
import {
  adminError,
  requireAdminIdentity,
  sameOrigin,
} from "@/lib/admin-server";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";
import {
  CREDITEX_OFFICIAL_SOURCE_LIMITS,
  CreditexOfficialSourceCustodyError,
  captureCreditexOfficialSourceArtifact,
  listCreditexOfficialSources,
  resolveActiveCreditexOfficialSourceOrganisation,
} from "@/lib/creditex-official-source-custody-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

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
  if (error instanceof CreditexOfficialSourceCustodyError) {
    return json({
      ok: false,
      code: error.code,
      error: error.message,
    }, error.status);
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
      error: "The official source custody record changed before capture completed.",
    }, 409);
  }
  return adminError(error);
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
    const admin = await requireAdminIdentity(request, [
      "owner",
      "admin",
      "reviewer",
      "support",
    ]);
    const database = getD1();
    const organisationId =
      await resolveActiveCreditexOfficialSourceOrganisation(database);
    const search = new URL(request.url).searchParams;
    const sourcePage = await listCreditexOfficialSources(database, {
      uid: admin.uid,
      organisationId,
      role: admin.role,
      actorKind: "admin",
    }, {
      cursor: search.get("cursor"),
      pageSize: search.get("pageSize"),
    });
    return json({
      ok: true,
      sources: sourcePage.items,
      sourcePagination: {
        total: sourcePage.total,
        pageSize: sourcePage.pageSize,
        hasNext: sourcePage.hasNext,
        nextCursor: sourcePage.nextCursor,
      },
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
    const contentLengthHeader = request.headers.get("content-length");
    const contentLength = Number(contentLengthHeader);
    if (!contentLengthHeader
      || !Number.isSafeInteger(contentLength) || contentLength < 1) {
      throw new CreditexOfficialSourceCustodyError(
        "SOURCE_UPLOAD_LENGTH_REQUIRED",
        411,
        "Official source uploads require an exact Content-Length.",
      );
    }
    if (contentLength > CREDITEX_OFFICIAL_SOURCE_LIMITS.maximumRequestBytes) {
      throw new CreditexOfficialSourceCustodyError(
        "SOURCE_FILE_SIZE_INVALID",
        413,
        "Upload an official source file no larger than 15 MB.",
      );
    }
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    const database = getD1();
    const organisationId =
      await resolveActiveCreditexOfficialSourceOrganisation(database);
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
    const result = await captureCreditexOfficialSourceArtifact(
      database,
      getCreditexCustodyBucket(),
      {
        uid: admin.uid,
        organisationId,
        role: admin.role,
        actorKind: "admin",
      },
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
        bytes: new Uint8Array(await sourceFile.arrayBuffer()),
      },
    );
    return json({
      ok: true,
      ...result,
      pendingIndependentCreditexReview: true,
    }, result.reused ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}
