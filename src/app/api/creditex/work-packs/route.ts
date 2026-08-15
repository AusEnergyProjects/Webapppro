import { getD1 } from "../../../../../db";
import { sameOrigin } from "@/lib/admin-server";
import { requireComplianceAccess } from "@/lib/compliance-access-server";
import {
  handleCreditexWorkPackGovernanceRequest,
  workPackGovernanceError,
  workPackGovernanceJson,
} from "./_shared";

export const runtime = "edge";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  if (!sameOrigin(request)) {
    return workPackGovernanceJson({
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
    return handleCreditexWorkPackGovernanceRequest(request, database, {
      actorUid: member.uid,
      organisationId: member.organisationId,
      actorKind: "compliance",
    });
  } catch (error) {
    try {
      return workPackGovernanceError(error);
    } catch (unexpected) {
      console.error("Creditex activity work-pack governance failed", unexpected);
      return workPackGovernanceJson({
        ok: false,
        code: "WORK_PACK_GOVERNANCE_UNAVAILABLE",
        error: "The governed activity work packs could not be loaded or saved.",
      }, 500);
    }
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
