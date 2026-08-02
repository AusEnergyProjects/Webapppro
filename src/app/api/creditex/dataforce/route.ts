import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceIdentity,
} from "@/lib/compliance-access-server";
import {
  CREDITEX_DATAFORCE_IMPORT_LIMITS,
  CreditexDataforceImportError,
  listCreditexDataforceImportBatches,
  stageCreditexDataforceImport,
} from "@/lib/creditex-dataforce-import-server";
import { ensureCreditexPilotSchemaGuards } from "@/lib/creditex-schema-guards";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

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
    throw new CreditexDataforceImportError(
      "DATAFORCE_IMPORT_REQUEST_INVALID",
      400,
      "Enter a valid Dataforce import request.",
    );
  }
  return value as Body;
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexDataforceImportError
  ) {
    return json({
      ok: false,
      code: error.code,
      error: error.message,
      ...(error instanceof CreditexDataforceImportError && error.validation
        ? { validation: error.validation }
        : {}),
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
      error.message.includes("COMPLIANCE_LEGACY_IMPORT")
      || error.message.includes("SQLITE_CONSTRAINT")
    )
  ) {
    return json({
      ok: false,
      code: "DATAFORCE_IMPORT_STATE_CONFLICT",
      error:
        "The staging records changed before the import completed. Refresh and try again.",
    }, 409);
  }
  console.error("Creditex Dataforce staging request failed", error);
  return json({
    ok: false,
    code: "DATAFORCE_IMPORT_UNAVAILABLE",
    error: "Dataforce staging is temporarily unavailable. Try again.",
  }, 500);
}

async function requireMember(
  request: Request,
  database: D1Database,
  write: boolean,
) {
  const identity = await requireFirebaseIdentity(request);
  const member = await requireComplianceIdentity(identity, {
    allowedRoles: write
      ? ["admin", "case_manager"]
      : ["admin", "case_manager", "reviewer", "auditor"],
  }, database);
  await ensureCreditexPilotSchemaGuards(database);
  return member;
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
    const member = await requireMember(request, database, false);
    const batches = await listCreditexDataforceImportBatches(database, member);
    return json({ ok: true, batches });
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
        > CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumSourceBytes * 3
    ) {
      throw new CreditexDataforceImportError(
        "DATAFORCE_IMPORT_REQUEST_TOO_LARGE",
        413,
        "The Dataforce import request is too large.",
      );
    }
    const database = getD1();
    const member = await requireMember(request, database, true);
    const body = requiredBody(await request.json().catch(() => null));
    if (String(body.action || "").trim() !== "stage_import") {
      throw new CreditexDataforceImportError(
        "DATAFORCE_IMPORT_ACTION_INVALID",
        400,
        "Choose the supported Dataforce staging action.",
      );
    }
    const result = await stageCreditexDataforceImport(database, member, {
      fileName: body.fileName,
      csv: body.csv,
    });
    return json({ ok: true, ...result }, result.batch.reused ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}
