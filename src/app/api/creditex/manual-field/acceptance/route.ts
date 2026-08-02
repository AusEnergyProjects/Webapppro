import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../../db";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import { ComplianceAccessError } from "@/lib/compliance-access-server";
import {
  CreditexManualFieldAcceptanceError,
  listManualFieldAcceptanceRuns,
  reviewManualFieldAcceptanceRun,
  submitManualFieldAcceptanceRun,
} from "@/lib/creditex-manual-field-acceptance-server";
import {
  CreditexManualFieldError,
  requireManualFieldMember,
} from "@/lib/creditex-manual-field-server";
import { sha256Hex } from "@/lib/creditex-official-source-custody-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type EvidenceBucket = {
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
};

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
    || error instanceof CreditexManualFieldAcceptanceError
    || error instanceof CreditexManualFieldError
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
      error.message.includes("COMPLIANCE_MANUAL_FIELD_ACCEPTANCE_")
      || error.message.includes("SQLITE_CONSTRAINT")
    )
  ) {
    return json({
      ok: false,
      code: "MANUAL_FIELD_ACCEPTANCE_STATE_CONFLICT",
      error:
        "The protected physical-device run changed before this request completed. Refresh and reconcile it.",
    }, 409);
  }
  console.error("Creditex manual field acceptance failed", error);
  return json({
    ok: false,
    code: "MANUAL_FIELD_ACCEPTANCE_UNAVAILABLE",
    error: "The synthetic physical-device acceptance service is unavailable.",
  }, 500);
}

function bucket() {
  const value = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!value) {
    throw new CreditexManualFieldAcceptanceError(
      "MANUAL_FIELD_ACCEPTANCE_STORAGE_UNAVAILABLE",
      503,
      "Synthetic evidence storage is unavailable.",
    );
  }
  return value;
}

async function restoreObject(objectKey: string) {
  const object = await bucket().get(objectKey);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  return {
    sha256: await sha256Hex(bytes),
    sizeBytes: bytes.byteLength,
  };
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
    const member = await requireManualFieldMember(request, database);
    const jobId = new URL(request.url).searchParams.get("jobId") || "";
    return json({
      ok: true,
      acceptance: await listManualFieldAcceptanceRuns(
        database,
        member,
        jobId,
      ),
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
    const member = await requireManualFieldMember(request, database);
    const body = await readBoundedJsonRequest(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new CreditexManualFieldAcceptanceError(
        "MANUAL_FIELD_ACCEPTANCE_REQUEST_INVALID",
        400,
        "Enter a valid physical-device acceptance request.",
      );
    }
    const input = body as Record<string, unknown>;
    const action = String(input.action || "").trim();
    if (action === "submit_physical_run") {
      const result = await submitManualFieldAcceptanceRun(
        database,
        member,
        input,
        restoreObject,
      );
      return json({ ok: true, ...result }, result.reused ? 200 : 201);
    }
    if (action === "review_physical_run") {
      return json({
        ok: true,
        ...await reviewManualFieldAcceptanceRun(database, member, input),
      });
    }
    throw new CreditexManualFieldAcceptanceError(
      "MANUAL_FIELD_ACCEPTANCE_ACTION_INVALID",
      400,
      "Choose the physical-run submission or independent-review action.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}
