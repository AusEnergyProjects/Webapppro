import { getD1 } from "../../../../../../db";
import {
  adminError,
  requireAdminIdentity,
  sameOrigin,
} from "@/lib/admin-server";
import {
  importCreditexOfficialSourceCustodyBatch,
  listCreditexOfficialSourceCustodyCandidateStatus,
  readBoundedCreditexOfficialSourceBatchInput,
} from "@/lib/creditex-official-source-batch-import-server";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";
import {
  CreditexOfficialSourceCustodyError,
  resolveActiveCreditexOfficialSourceOrganisation,
} from "@/lib/creditex-official-source-custody-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
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
      error: "The official source custody record changed during import.",
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
    await requireAdminIdentity(request, [
      "owner",
      "admin",
      "reviewer",
      "support",
    ]);
    const database = getD1();
    const organisationId =
      await resolveActiveCreditexOfficialSourceOrganisation(database);
    const search = new URL(request.url).searchParams;
    const status = await listCreditexOfficialSourceCustodyCandidateStatus(
      database,
      organisationId,
      {
        afterSourceId: search.get("afterSourceId"),
        pageSize: search.get("pageSize"),
      },
    );
    return json({
      ok: true,
      sourceAcquisitionStatus: status,
      pendingIndependentCreditexReview: true,
      operationalReadinessClaimed: false,
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
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    const database = getD1();
    const organisationId =
      await resolveActiveCreditexOfficialSourceOrganisation(database);
    const result = await importCreditexOfficialSourceCustodyBatch(
      database,
      getCreditexCustodyBucket(),
      {
        uid: admin.uid,
        organisationId,
        role: admin.role,
        actorKind: "admin",
      },
      await readBoundedCreditexOfficialSourceBatchInput(request),
    );
    const status = result.failed
      ? 207
      : result.reused === result.requested
        ? 200
        : 201;
    return json({ ok: true, ...result }, status);
  } catch (error) {
    return errorResponse(error);
  }
}
