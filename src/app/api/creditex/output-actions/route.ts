import { getD1 } from "../../../../../db";
import { sameOrigin } from "@/lib/admin-server";
import { requireComplianceAccess } from "@/lib/compliance-access-server";
import {
  handleCreditexOutputActionRequest,
  outputActionError,
  outputActionJson,
} from "./_shared";

export const runtime = "edge";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  if (!sameOrigin(request)) {
    return outputActionJson({
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
    return handleCreditexOutputActionRequest(request, database, {
      actorUid: member.uid,
      organisationId: member.organisationId,
      actorKind: "compliance",
    });
  } catch (error) {
    try {
      return outputActionError(error);
    } catch (unexpected) {
      console.error("Creditex governed output action failed", unexpected);
      return outputActionJson({
        ok: false,
        code: "OUTPUT_ACTION_UNAVAILABLE",
        error: "Governed output actions could not be loaded or saved.",
      }, 500);
    }
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
