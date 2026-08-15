import { getD1 } from "../../../../../db";
import {
  adminError,
  requireAdminIdentity,
  sameOrigin,
} from "@/lib/admin-server";
import {
  resolveActiveCreditexOfficialSourceOrganisation,
} from "@/lib/creditex-official-source-custody-server";
import {
  handleCreditexWorkPackGovernanceRequest,
  workPackGovernanceError,
  workPackGovernanceJson,
} from "@/app/api/creditex/work-packs/_shared";

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
    const administrator = await requireAdminIdentity(request, [
      "owner",
      "admin",
      "reviewer",
      "support",
    ]);
    const database = getD1();
    const organisationId =
      await resolveActiveCreditexOfficialSourceOrganisation(database);
    return handleCreditexWorkPackGovernanceRequest(request, database, {
      actorUid: administrator.uid,
      organisationId,
      actorKind: "admin",
    });
  } catch (error) {
    try {
      return workPackGovernanceError(error);
    } catch (unexpected) {
      return adminError(unexpected);
    }
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
