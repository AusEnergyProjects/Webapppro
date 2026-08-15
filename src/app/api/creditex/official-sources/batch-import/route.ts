import { getD1 } from "../../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  importCreditexOfficialSourceCustodyBatch,
  listCreditexOfficialSourceCustodyCandidateStatus,
  readBoundedCreditexOfficialSourceBatchInput,
} from "@/lib/creditex-official-source-batch-import-server";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";
import {
  CreditexOfficialSourceCustodyError,
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
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
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
      error: "The official source custody record changed during import.",
    }, 409);
  }
  console.error("Creditex official source batch import failed", error);
  return json({
    ok: false,
    code: "SOURCE_BATCH_UNAVAILABLE",
    error: "The selected official sources could not be imported safely.",
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
    const status = await listCreditexOfficialSourceCustodyCandidateStatus(
      database,
      member.organisationId,
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
    const database = getD1();
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "case_manager"],
    }, database);
    const result = await importCreditexOfficialSourceCustodyBatch(
      database,
      getCreditexCustodyBucket(),
      {
        uid: member.uid,
        organisationId: member.organisationId,
        role: member.role,
        actorKind: "compliance",
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
