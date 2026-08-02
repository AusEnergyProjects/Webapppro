import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  appendCreditexCalculatorVector,
  createCreditexCalculatorDraft,
  CREDITEX_CALCULATOR_AUTHORING_LIMITS,
  CreditexCalculatorAuthoringError,
  listCreditexCalculatorDrafts,
} from "@/lib/creditex-calculator-authoring-server";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";

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

function requestRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditexCalculatorAuthoringError(
      "CALCULATOR_REQUEST_INVALID",
      400,
      "Enter a valid calculator authoring request.",
    );
  }
  return value as Record<string, unknown>;
}

async function readBoundedRequestBody(
  request: Request,
  maximumBytes: number,
) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new CreditexCalculatorAuthoringError(
          "CALCULATOR_REQUEST_TOO_LARGE",
          413,
          "The calculator authoring request exceeds 256 KiB.",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CreditexCalculatorAuthoringError(
      "CALCULATOR_REQUEST_INVALID",
      400,
      "Enter a valid UTF-8 calculator authoring request.",
    );
  }
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexCalculatorAuthoringError
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
      code: "CALCULATOR_SOURCE_STORAGE_UNAVAILABLE",
      error: "Retained official source storage is temporarily unavailable.",
    }, 503);
  }
  if (
    error instanceof Error
    && (
      error.message.includes("COMPLIANCE_CALCULATOR_")
      || error.message.includes("COMPLIANCE_SOURCE_")
      || error.message.includes("SQLITE_CONSTRAINT")
    )
  ) {
    return json({
      ok: false,
      code: "CALCULATOR_AUTHORING_STATE_CONFLICT",
      error:
        "The immutable calculator draft state changed. Refresh and try again.",
    }, 409);
  }
  console.error("Creditex calculator authoring failed", error);
  return json({
    ok: false,
    code: "CALCULATOR_AUTHORING_UNAVAILABLE",
    error: "The calculator draft operation could not be recorded safely.",
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
      allowedRoles: ["admin", "reviewer"],
    }, database);
    const calculatorVersionId = new URL(request.url)
      .searchParams.get("calculatorVersionId") || "";
    return json({
      ok: true,
      drafts: await listCreditexCalculatorDrafts(
        database,
        member,
        calculatorVersionId,
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
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new CreditexCalculatorAuthoringError(
        "CALCULATOR_REQUEST_MEDIA_TYPE_INVALID",
        415,
        "Send calculator authoring requests as JSON.",
      );
    }
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (
      Number.isFinite(contentLength)
      && contentLength
        > CREDITEX_CALCULATOR_AUTHORING_LIMITS.maximumRequestBytes
    ) {
      throw new CreditexCalculatorAuthoringError(
        "CALCULATOR_REQUEST_TOO_LARGE",
        413,
        "The calculator authoring request exceeds 256 KiB.",
      );
    }
    const database = getD1();
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "reviewer"],
    }, database);
    const rawBody = await readBoundedRequestBody(
      request,
      CREDITEX_CALCULATOR_AUTHORING_LIMITS.maximumRequestBytes,
    );
    let bodyValue: unknown = null;
    try {
      bodyValue = JSON.parse(rawBody);
    } catch {
      // requestRecord supplies the stable public validation response.
    }
    const body = requestRecord(bodyValue);
    const action = String(body.action || "").trim();
    const input = { ...body };
    delete input.action;
    if (action === "create_draft") {
      const result = await createCreditexCalculatorDraft(
        database,
        getCreditexCustodyBucket(),
        member,
        input,
      );
      return json(
        { ok: true, ...result },
        result.draft.reused ? 200 : 201,
      );
    }
    if (action === "append_vector") {
      const result = await appendCreditexCalculatorVector(
        database,
        getCreditexCustodyBucket(),
        member,
        input,
      );
      return json(
        { ok: true, ...result },
        result.vector.reused ? 200 : 201,
      );
    }
    throw new CreditexCalculatorAuthoringError(
      "CALCULATOR_ACTION_INVALID",
      400,
      "Choose create_draft or append_vector.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}
