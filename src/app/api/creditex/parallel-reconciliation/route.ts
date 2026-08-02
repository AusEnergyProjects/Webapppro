import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  CREDITEX_PARALLEL_RECONCILIATION_LIMITS,
  CreditexParallelReconciliationError,
  createCreditexCalculatorEngineReceipt,
  createCreditexParallelReconciliationRun,
  listCreditexParallelReconciliationRuns,
} from "@/lib/creditex-parallel-reconciliation-server";
import {
  CreditexSourceLookupReviewError,
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
    throw new CreditexParallelReconciliationError(
      "PARALLEL_REQUEST_INVALID",
      400,
      "Enter a valid parallel reconciliation request.",
    );
  }
  return value as Body;
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexParallelReconciliationError
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
      error.message.includes("COMPLIANCE_PARALLEL_")
      || error.message.includes("SQLITE_CONSTRAINT")
    )
  ) {
    return json({
      ok: false,
      code: "PARALLEL_RECONCILIATION_STATE_CONFLICT",
      error:
        "A governed reconciliation input changed before the dry run was recorded.",
    }, 409);
  }
  console.error("Creditex parallel reconciliation failed", error);
  return json({
    ok: false,
    code: "PARALLEL_RECONCILIATION_UNAVAILABLE",
    error: "The dry-run comparison could not be recorded safely.",
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
    const runs = await listCreditexParallelReconciliationRuns(
      database,
      member,
    );
    return json({ ok: true, runs });
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
        > CREDITEX_PARALLEL_RECONCILIATION_LIMITS.maximumRequestBytes
    ) {
      throw new CreditexParallelReconciliationError(
        "PARALLEL_REQUEST_TOO_LARGE",
        413,
        "The parallel reconciliation request exceeds the 1 MiB limit.",
      );
    }
    const database = getD1();
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "case_manager", "reviewer"],
    }, database);
    const body = requiredBody(await request.json().catch(() => null));
    const action = String(body.action || "").trim();
    if (action === "create_engine_receipt") {
      if (
        Object.keys(body).some((key) => (
          key !== "action" && key !== "calculatorVersionId"
        ))
      ) {
        throw new CreditexParallelReconciliationError(
          "PARALLEL_ENGINE_RECEIPT_INPUT_INVALID",
          400,
          "Receipt hashes and results are produced only by the server-side engine.",
        );
      }
      const result = await createCreditexCalculatorEngineReceipt(
        database,
        member,
        { calculatorVersionId: body.calculatorVersionId },
      );
      return json(
        { ok: true, ...result },
        result.receipt.reused ? 200 : 201,
      );
    }
    if (action !== "create_dry_run") {
      throw new CreditexParallelReconciliationError(
        "PARALLEL_ACTION_INVALID",
        400,
        "Choose a supported engine-receipt or dry-run comparison action.",
      );
    }
    const result = await createCreditexParallelReconciliationRun(
      database,
      member,
      {
        clientRequestId: body.clientRequestId,
        activityVersionId: body.activityVersionId,
        calculatorVersionId: body.calculatorVersionId,
        mappingArtifactId: body.mappingArtifactId,
        rows: body.rows,
      },
    );
    return json({ ok: true, ...result }, result.run.reused ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}
