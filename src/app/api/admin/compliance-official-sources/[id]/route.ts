import { getD1 } from "../../../../../../db";
import {
  adminError,
  requireAdminIdentity,
  sameOrigin,
} from "@/lib/admin-server";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";
import {
  CreditexOfficialSourceCustodyError,
  downloadCreditexOfficialSource,
  resolveActiveCreditexOfficialSourceOrganisation,
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

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: responseHeaders() });
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
  return adminError(error);
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
    const admin = await requireAdminIdentity(request, [
      "owner",
      "admin",
      "reviewer",
      "support",
    ]);
    const database = getD1();
    const organisationId =
      await resolveActiveCreditexOfficialSourceOrganisation(database);
    const result = await downloadCreditexOfficialSource(
      database,
      getCreditexCustodyBucket(),
      {
        uid: admin.uid,
        organisationId,
        role: admin.role,
        actorKind: "admin",
      },
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
