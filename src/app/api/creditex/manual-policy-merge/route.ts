import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceIdentity,
} from "@/lib/compliance-access-server";
import {
  CreditexManualPolicyMergeError,
} from "@/lib/creditex-manual-policy-merge";
import {
  approveManualPolicyBinding,
  createManualPolicyBindingDraft,
  loadManualPolicyMergeStatus,
  lockManualPolicyComposition,
  previewManualPolicyComposition,
  withdrawManualPolicyBinding,
} from "@/lib/creditex-manual-policy-merge-server";
import {
  CreditexSourceLookupReviewError,
} from "@/lib/creditex-source-lookup-review-server";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

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
    || error instanceof CreditexManualPolicyMergeError
    || error instanceof CreditexSourceLookupReviewError
    || error instanceof BoundedJsonRequestError
  ) {
    return json(
      { ok: false, code: error.code, error: error.message },
      error.status,
    );
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json(
      { ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." },
      401,
    );
  }
  if (
    error instanceof Error
    && (
      error.message.includes("UNIQUE constraint failed")
      || error.message.includes("SQLITE_CONSTRAINT")
      || error.message.includes("COMPLIANCE_MANUAL_POLICY_")
    )
  ) {
    return json({
      ok: false,
      code: "MANUAL_POLICY_BINDING_CONFLICT",
      error:
        "The governed manual-policy binding changed before this request completed. Refresh and review the exact snapshot again.",
    }, 409);
  }
  if (
    error instanceof Error
    && (
      error.message.includes("no such table: compliance_manual_policy_bindings")
      || error.message.includes("D1_ERROR")
        && error.message.includes("compliance_manual_policy_bindings")
    )
  ) {
    return json({
      ok: false,
      code: "MANUAL_POLICY_SCHEMA_NOT_READY",
      error:
        "The governed manual-policy storage contract is not available yet.",
    }, 503);
  }
  console.error("Creditex manual-policy merge request failed", error);
  return json({
    ok: false,
    code: "MANUAL_POLICY_UNAVAILABLE",
    error: "The governed manual-policy service is temporarily unavailable.",
  }, 500);
}

async function requireMember(request: Request, database: D1Database) {
  const identity = await requireFirebaseIdentity(request);
  return requireComplianceIdentity(identity, {
    allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
  }, database);
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
    const member = await requireMember(request, database);
    const searchParams = new URL(request.url).searchParams;
    return json({
      ok: true,
      merge: await loadManualPolicyMergeStatus(database, member, {
        activityTemplateId:
          searchParams.get("activityTemplateId") || "",
      }),
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
    const member = await requireMember(request, database);
    const body = await readBoundedJsonRequest(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new CreditexManualPolicyMergeError(
        "MANUAL_POLICY_REQUEST_INVALID",
        400,
        "Enter a valid governed manual-policy request.",
      );
    }
    const input = body as Record<string, unknown>;
    const action = String(input.action || "").trim();
    if (action === "create_binding_draft") {
      return json({
        ok: true,
        result: await createManualPolicyBindingDraft(
          database,
          member,
          input,
        ),
      }, 201);
    }
    if (action === "approve_binding") {
      return json({
        ok: true,
        result: await approveManualPolicyBinding(
          database,
          member,
          input,
        ),
      });
    }
    if (action === "withdraw_binding") {
      return json({
        ok: true,
        result: await withdrawManualPolicyBinding(
          database,
          member,
          input,
        ),
      });
    }
    if (action === "preview_composition") {
      return json({
        ok: true,
        result: await previewManualPolicyComposition(
          database,
          member,
          input,
        ),
      });
    }
    if (action === "lock_composition") {
      return json({
        ok: true,
        result: await lockManualPolicyComposition(
          database,
          member,
          input,
        ),
      }, 201);
    }
    throw new CreditexManualPolicyMergeError(
      "MANUAL_POLICY_ACTION_INVALID",
      400,
      "Choose a supported governed manual-policy action.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}
