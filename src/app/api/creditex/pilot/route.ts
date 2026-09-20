import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceIdentity,
  type ComplianceRole,
} from "@/lib/compliance-access-server";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function json(body: object, status: number) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

async function retired(request: Request, allowedRoles: readonly ComplianceRole[]) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false, code: "ORIGIN_REJECTED", error: "Request origin was not accepted." }, 403);
  }
  try {
    const identity = await requireFirebaseIdentity(request);
    await requireComplianceIdentity(identity, { allowedRoles }, getD1());
    return json({ ok: false, code: "CREDITEX_PILOT_RETIRED", error: "The test pilot has been retired. Use the Creditex Jobs workspace." }, 410);
  } catch (error) {
    if (error instanceof ComplianceAccessError) return json({ ok: false, code: error.code, error: error.message }, error.status);
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return json({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." }, 401);
    console.error("Creditex retired pilot access failed", error);
    return json({ ok: false, code: "CREDITEX_PILOT_UNAVAILABLE", error: "Access could not be verified. Try again." }, 500);
  }
}

export async function GET(request: Request) {
  return retired(request, ["admin", "case_manager", "reviewer", "auditor"]);
}

export async function POST(request: Request) {
  return retired(request, ["admin"]);
}
