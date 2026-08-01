import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceIdentity,
} from "@/lib/compliance-access-server";
import {
  CreditexVeuPilotError,
  archiveCreditexVeuPilot,
  finaliseCreditexVeuPilot,
  loadCreditexVeuPilotDashboard,
  parseCreditexPilotFilters,
  provisionNextCreditexVeuPilotCohort,
  startCreditexVeuPilot,
  updateCreditexVeuPilotJob,
} from "@/lib/creditex-veu-pilot-server";
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
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_REQUEST_INVALID",
      400,
      "Enter a valid synthetic pilot request.",
    );
  }
  return value as Body;
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexVeuPilotError
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
      || error.message.includes("COMPLIANCE_")
    )
  ) {
    return json({
      ok: false,
      code: "CREDITEX_PILOT_STATE_CONFLICT",
      error:
        "The synthetic pilot changed before the request completed. Refresh and reconcile the current records.",
    }, 409);
  }
  console.error("Creditex synthetic pilot request failed", error);
  return json({
    ok: false,
    code: "CREDITEX_PILOT_UNAVAILABLE",
    error: "The synthetic VEU pilot is temporarily unavailable. Try again.",
  }, 500);
}

async function requireMember(request: Request, database: D1Database) {
  const identity = await requireFirebaseIdentity(request);
  const member = await requireComplianceIdentity(identity, {
    allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
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
    const member = await requireMember(request, database);
    const filters = parseCreditexPilotFilters(
      new URL(request.url).searchParams,
    );
    const pilot = await loadCreditexVeuPilotDashboard(
      database,
      member,
      filters,
    );
    return json({ ok: true, pilot });
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
    const body = requiredBody(await request.json().catch(() => null));
    const action = String(body.action || "").trim();
    let result: unknown;
    if (action === "start") {
      result = await startCreditexVeuPilot(
        database,
        member,
        body.confirmation,
      );
    } else if (action === "provision_next") {
      result = await provisionNextCreditexVeuPilotCohort(database, member);
    } else if (action === "finalise") {
      result = await finaliseCreditexVeuPilot(database, member);
    } else if (action === "update_job") {
      result = await updateCreditexVeuPilotJob(database, member, body);
    } else if (action === "archive") {
      result = await archiveCreditexVeuPilot(
        database,
        member,
        body.confirmation,
      );
    } else {
      throw new CreditexVeuPilotError(
        "CREDITEX_PILOT_ACTION_INVALID",
        400,
        "Choose a supported synthetic pilot action.",
      );
    }
    return json({ ok: true, result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
