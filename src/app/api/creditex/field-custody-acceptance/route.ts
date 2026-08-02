import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  appendCreditexFieldCustodyDecision,
  appendCreditexFieldCustodyTestArtifact,
  CREDITEX_FIELD_ACCEPTANCE_MAXIMUM_REQUEST_BYTES,
  CreditexFieldCustodyAcceptanceError,
  listCreditexFieldCustodyAcceptances,
} from "@/lib/creditex-field-custody-acceptance-server";

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
    throw new CreditexFieldCustodyAcceptanceError(
      "FIELD_ACCEPTANCE_REQUEST_INVALID",
      400,
      "Enter a valid physical field custody acceptance record.",
    );
  }
  return value as Body;
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexFieldCustodyAcceptanceError
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
      error.message.includes("COMPLIANCE_FIELD_ACCEPTANCE_")
      || error.message.includes("COMPLIANCE_FIELD_TEST_ARTIFACT_")
      || error.message.includes("SQLITE_CONSTRAINT")
    )
  ) {
    return json({
      ok: false,
      code: "FIELD_ACCEPTANCE_STATE_CONFLICT",
      error:
        "The protected evidence or acceptance identities changed before the immutable record was appended.",
    }, 409);
  }
  console.error("Creditex field custody acceptance failed", error);
  return json({
    ok: false,
    code: "FIELD_ACCEPTANCE_UNAVAILABLE",
    error: "The physical field custody acceptance record could not be stored.",
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
    const evidenceId = new URL(request.url).searchParams.get("evidenceId");
    const acceptances = await listCreditexFieldCustodyAcceptances(
      database,
      member,
      evidenceId,
    );
    return json({ ok: true, acceptances });
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
      && contentLength > CREDITEX_FIELD_ACCEPTANCE_MAXIMUM_REQUEST_BYTES
    ) {
      throw new CreditexFieldCustodyAcceptanceError(
        "FIELD_ACCEPTANCE_REQUEST_TOO_LARGE",
        413,
        "The field custody acceptance request exceeds the 32 KiB limit.",
      );
    }
    const database = getD1();
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
    }, database);
    const body = requiredBody(await request.json().catch(() => null));
    const action = String(body.action || "").trim();
    if (action === "append_test_artifact") {
      const result = await appendCreditexFieldCustodyTestArtifact(
        database,
        member,
        {
          clientRequestId: body.clientRequestId,
          platform: body.platform,
          nativeBuildIdentifier: body.nativeBuildIdentifier,
          nativeBuildSha256: body.nativeBuildSha256,
          deviceModel: body.deviceModel,
          deviceOsVersion: body.deviceOsVersion,
          deviceIdentifierSha256: body.deviceIdentifierSha256,
          requirementId: body.requirementId,
          evidenceId: body.evidenceId,
          integrityReceiptId: body.integrityReceiptId,
          offlineScenario: body.offlineScenario,
          restoreSha256: body.restoreSha256,
          testResult: body.testResult,
          testerUid: body.testerUid ?? member.uid,
          testedAt: body.testedAt,
        },
      );
      return json(
        { ok: true, ...result },
        result.testArtifact.reused ? 200 : 201,
      );
    }
    if (action === "append_decision") {
      const result = await appendCreditexFieldCustodyDecision(
        database,
        member,
        {
          clientRequestId: body.clientRequestId,
          testArtifactId: body.testArtifactId,
          decision: body.decision,
          decidedAt: body.decidedAt,
        },
      );
      return json(
        { ok: true, ...result },
        result.acceptance.reused ? 200 : 201,
      );
    }
    throw new CreditexFieldCustodyAcceptanceError(
      "FIELD_ACCEPTANCE_ACTION_INVALID",
      400,
      "Choose the append-only tester artifact or governance decision action.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}
