import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  createCreditexLegacyMappingDraft,
  CreditexLegacyMappingAuthoringError,
  listCreditexLegacyMappingAuthoring,
  reviewCreditexLegacyMappingArtifact,
} from "@/lib/creditex-legacy-mapping-authoring-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAXIMUM_REQUEST_BYTES = 256 * 1024;

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

function bodyRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditexLegacyMappingAuthoringError(
      "LEGACY_MAPPING_REQUEST_INVALID",
      400,
      "Enter a valid legacy field-mapping request.",
    );
  }
  return value as Record<string, unknown>;
}

async function requestBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAXIMUM_REQUEST_BYTES
  ) {
    throw new CreditexLegacyMappingAuthoringError(
      "LEGACY_MAPPING_REQUEST_TOO_LARGE",
      413,
      "The legacy mapping request exceeds 256 KiB.",
    );
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > MAXIMUM_REQUEST_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new CreditexLegacyMappingAuthoringError(
            "LEGACY_MAPPING_REQUEST_TOO_LARGE",
            413,
            "The legacy mapping request exceeds 256 KiB.",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return bodyRecord(JSON.parse(source));
  } catch (error) {
    if (error instanceof CreditexLegacyMappingAuthoringError) throw error;
    throw new CreditexLegacyMappingAuthoringError(
      "LEGACY_MAPPING_REQUEST_INVALID",
      400,
      "Enter a valid legacy field-mapping request.",
    );
  }
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexLegacyMappingAuthoringError
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
      error.message.includes("COMPLIANCE_LEGACY_MAPPING_")
      || error.message.includes("SQLITE_CONSTRAINT")
    )
  ) {
    return json({
      ok: false,
      code: "LEGACY_MAPPING_STATE_CONFLICT",
      error:
        "The immutable mapping state changed. Refresh and review it again.",
    }, 409);
  }
  console.error("Creditex legacy mapping authoring failed", error);
  return json({
    ok: false,
    code: "LEGACY_MAPPING_UNAVAILABLE",
    error: "The legacy field-mapping operation could not be recorded safely.",
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
    return json({
      ok: true,
      ...await listCreditexLegacyMappingAuthoring(database, member),
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
      allowedRoles: ["admin", "reviewer"],
    }, database);
    const body = await requestBody(request);
    const action = String(body.action || "").trim();
    const input = { ...body };
    delete input.action;
    if (action === "create_draft") {
      const result = await createCreditexLegacyMappingDraft(
        database,
        member,
        input,
      );
      return json({ ok: true, ...result }, 201);
    }
    if (action === "record_decision") {
      const result = await reviewCreditexLegacyMappingArtifact(
        database,
        member,
        input,
      );
      return json({ ok: true, ...result }, 201);
    }
    throw new CreditexLegacyMappingAuthoringError(
      "LEGACY_MAPPING_ACTION_INVALID",
      400,
      "Choose create_draft or record_decision.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}
